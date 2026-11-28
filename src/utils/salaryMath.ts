import type {
  AttendanceDay,
  DayCalculation,
  EmploymentType,
  PayrollSummary,
  SalaryAndLoanConfig,
} from '../types/payroll';
import { getDaysInSalaryMonth } from './calendarUtils';

const REGULAR_START_MIN = 8 * 60; // 08:00 -> 480 mins
const REGULAR_END_MIN = 17 * 60; // 17:00 -> 1020 mins
const BREAK_THRESHOLD_MIN = 5 * 60; // Deduct 1h break when shift span exceeds 5 hours
const BREAK_DURATION_MIN = 60; // 1 hour break

export function parseTimeToMinutes(timeStr: string): number | null {
  if (!timeStr || !timeStr.includes(':')) return null;
  const [hStr, mStr] = timeStr.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return h * 60 + m;
}

/**
 * Calculates daily hours:
 * Regular mode:
 * - Work: 08:00-17:00 (with 1h break = 8h max) in W. Hrs; after 17:00 in OT. Hrs.
 * - Sunday / Holiday: Paid Off (8.00h) in W. Hrs; if In/Out entered, worked hours added to OT. Hrs.
 * - Sick Leave ('leave'): Paid 8.00h in L. Hrs.
 * - Absent ('absent'): Non-paid (0.00h).
 * Daily Wages mode:
 * - Work: 08:00-17:00 (with 1h break = 8h max) in W. Hrs; after 17:00 in OT. Hrs.
 * - Sunday / Holiday: Non-paid when not worked (0.00h); if In/Out entered, worked hours added to OT. Hrs (no free 8h base).
 * - Sick Leave ('leave') & Absent ('absent'): Non-paid (0.00h).
 */
export function calculateDayHours(
  day: AttendanceDay,
  employmentType: EmploymentType = 'regular'
): DayCalculation {
  const isDailyWages = employmentType === 'daily_wages';

  if (day.dayType === 'leave') {
    if (isDailyWages) {
      return {
        dayNumber: day.dayNumber,
        regularHours: 0,
        leaveHours: 0,
        otHours: 0,
        totalHours: 0,
        breakDeductedHours: 0,
        workedMinutes: 0,
      };
    }
    return {
      dayNumber: day.dayNumber,
      regularHours: 0,
      leaveHours: 8,
      otHours: 0,
      totalHours: 8,
      breakDeductedHours: 0,
      workedMinutes: 480,
    };
  }

  if (day.dayType === 'absent') {
    return {
      dayNumber: day.dayNumber,
      regularHours: 0,
      leaveHours: 0,
      otHours: 0,
      totalHours: 0,
      breakDeductedHours: 0,
      workedMinutes: 0,
    };
  }

  const inMinRaw = parseTimeToMinutes(day.inTime);
  const outMinRaw = parseTimeToMinutes(day.outTime);

  // Sunday / Holiday:
  // Regular: 8.00 W. Hrs base (+ worked hours in OT. Hrs if In/Out entered)
  // Daily Wages: 0.00 W. Hrs base (+ worked hours in OT. Hrs only if In/Out entered)
  if (day.dayType === 'sunday' || day.dayType === 'holiday') {
    const baseHours = isDailyWages ? 0 : 8;
    const baseMinutes = isDailyWages ? 0 : 480;

    if (inMinRaw === null || outMinRaw === null) {
      return {
        dayNumber: day.dayNumber,
        regularHours: baseHours,
        leaveHours: 0,
        otHours: 0,
        totalHours: baseHours,
        breakDeductedHours: 0,
        workedMinutes: baseMinutes,
      };
    }

    let outMin = outMinRaw;
    if (outMin <= inMinRaw) {
      outMin += 24 * 60;
    }
    const span = outMin - inMinRaw;
    const breakMin = span > BREAK_THRESHOLD_MIN ? BREAK_DURATION_MIN : 0;
    const netWorkedMin = Math.max(0, span - breakMin);
    const workedHours = round2(netWorkedMin / 60);

    return {
      dayNumber: day.dayNumber,
      regularHours: baseHours,
      leaveHours: 0,
      otHours: workedHours,
      totalHours: round2(baseHours + workedHours),
      breakDeductedHours: round2(breakMin / 60),
      workedMinutes: baseMinutes + netWorkedMin,
    };
  }

  if (inMinRaw === null || outMinRaw === null) {
    return {
      dayNumber: day.dayNumber,
      regularHours: 0,
      leaveHours: 0,
      otHours: 0,
      totalHours: 0,
      breakDeductedHours: 0,
      workedMinutes: 0,
    };
  }

  // Support overnight OT clock-outs (e.g. 08:00 to 01:00 next day)
  let outMin = outMinRaw;
  if (outMin <= inMinRaw) {
    outMin += 24 * 60;
  }

  // Regular window: 08:00 to 17:00 (9h gross span = 8h work + 1h break)
  const effectiveRegStart = Math.max(inMinRaw, REGULAR_START_MIN);
  const effectiveRegEnd = Math.min(outMin, REGULAR_END_MIN);
  const regularSpanMin = Math.max(0, effectiveRegEnd - effectiveRegStart);

  // Deduct 1h break when regular window span exceeds 5 hours
  const breakMin = regularSpanMin > BREAK_THRESHOLD_MIN ? BREAK_DURATION_MIN : 0;
  const regularNetMin = Math.min(8 * 60, Math.max(0, regularSpanMin - breakMin));

  // Overtime: strictly any time worked after 17:00 (1020 mins)
  const otStart = Math.max(inMinRaw, REGULAR_END_MIN);
  const otMin = Math.max(0, outMin - otStart);

  const regularHours = round2(regularNetMin / 60);
  const otHours = round2(otMin / 60);
  const totalHours = round2(regularHours + otHours);

  return {
    dayNumber: day.dayNumber,
    regularHours,
    leaveHours: 0,
    otHours,
    totalHours,
    breakDeductedHours: round2(breakMin / 60),
    workedMinutes: regularNetMin + otMin,
  };
}

export function calculatePayrollSummary(
  config: SalaryAndLoanConfig,
  attendance: AttendanceDay[]
): PayrollSummary {
  const employmentType: EmploymentType =
    config.employmentType === 'daily_wages' ? 'daily_wages' : 'regular';
  const daysInMonth = config.salaryMonth
    ? getDaysInSalaryMonth(config.salaryMonth)
    : Math.max(1, Number(config.daysInMonth) || 30);
  const monthlyAllowance = Math.max(0, Number(config.allowances) || 0);
  const rawMonthlySalary = Math.max(0, Number(config.monthlySalary) || 0);
  const dailyWageRate =
    config.dailyWageRate !== undefined
      ? Math.max(0, Number(config.dailyWageRate) || 0)
      : round2(rawMonthlySalary / daysInMonth);

  const basicSalary =
    employmentType === 'daily_wages'
      ? round2(dailyWageRate * daysInMonth)
      : rawMonthlySalary;
  const totalMonthlySalary = round2(basicSalary + monthlyAllowance);

  const totalLoan = Math.max(0, Number(config.totalLoan) || 0);
  const loanDeduction = Math.max(0, Number(config.loanDeduction) || 0);
  const advanceDeduction = Math.max(0, Number(config.advanceDeduction) || 0);
  const otherDeduction = Math.max(0, Number(config.otherDeduction) || 0);

  // Regular: Basic Hourly Rate = Basic Salary / Days in Month / 8
  // Daily Wages: Basic Hourly Rate = Per Day Wage / 8
  // Overtime Rate = Total Salary Equivalent (Basic + Allowance) / Days in Month / 8
  const hourlyRate =
    employmentType === 'daily_wages'
      ? dailyWageRate / 8
      : basicSalary / daysInMonth / 8;
  const otRate = totalMonthlySalary / daysInMonth / 8;

  const dayCalculations = attendance.map((d) =>
    calculateDayHours(d, employmentType)
  );

  const totalRegularHours = round2(
    dayCalculations.reduce((sum, d) => sum + d.regularHours, 0)
  );
  const totalLeaveHours = round2(
    dayCalculations.reduce((sum, d) => sum + d.leaveHours, 0)
  );
  const totalOtHours = round2(
    dayCalculations.reduce((sum, d) => sum + d.otHours, 0)
  );
  const totalHours = round2(totalRegularHours + totalLeaveHours + totalOtHours);
  const equivalentDays = round2(totalHours / 8);

  const workingDaysLogged = dayCalculations.filter((d) => d.totalHours > 0).length;

  // Both W. Hrs and L. Hrs are paid at Basic Hourly Rate (L. Hrs is 0 in Daily Wages)
  const regularPay = round2((totalRegularHours + totalLeaveHours) * hourlyRate);
  const overtimePay = round2(totalOtHours * otRate);
  const grossSalary = round2(regularPay + overtimePay);

  // Allowance = (Monthly Allowance / Days in Month) * ((W. Hrs + L. Hrs) / 8)
  const paidAllowanceDays = round2((totalRegularHours + totalLeaveHours) / 8);
  const earnedAllowance = round2((monthlyAllowance / daysInMonth) * paidAllowanceDays);

  const loanExceedsTotal = loanDeduction > totalLoan;
  const remainingLoan = round2(Math.max(0, totalLoan - loanDeduction));
  const totalDeductions = round2(loanDeduction + advanceDeduction + otherDeduction);

  const netSalary = round2(grossSalary + earnedAllowance - totalDeductions);

  return {
    employmentType,
    basicSalary,
    dailyWageRate,
    monthlyAllowance,
    totalMonthlySalary,
    hourlyRate,
    otRate,
    totalRegularHours,
    totalLeaveHours,
    totalOtHours,
    totalHours,
    equivalentDays,
    workingDaysLogged,
    regularPay,
    overtimePay,
    grossSalary,
    allowances: monthlyAllowance,
    earnedAllowance,
    totalLoan,
    loanDeduction,
    remainingLoan,
    loanExceedsTotal,
    advanceDeduction,
    otherDeduction,
    totalDeductions,
    netSalary,
    dayCalculations,
  };
}

export function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export function formatCurrency(val: number): string {
  return new Intl.NumberFormat('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

export function formatHours(val: number): string {
  return val.toFixed(2);
}
