export type DayType = 'working' | 'sunday' | 'holiday' | 'leave' | 'absent';
export type EmploymentType = 'regular' | 'daily_wages';

export interface EmployeeDetails {
  id: string;
  name: string;
  employeeId: string;
  fatherName: string;
  designation: string;
  department: string;
  section: string;
  payGroup: string;
  cnic: string;
  phone: string;
  joiningDate: string;
  bankAccountEnabled?: boolean;
  bankName: string;
  branchNo: string;
  accountNo: string;
  userId?: string;
  photoDataUrl?: string;
}

export interface SalaryAndLoanConfig {
  periodId: string;
  salaryMonth?: string;
  employmentType?: EmploymentType;
  monthlySalary: number;
  dailyWageRate?: number;
  daysInMonth: number;
  allowances: number;
  totalLoan: number;
  loanDeduction: number;
  advanceDeduction: number;
  otherDeduction: number;
}

export interface AttendanceDay {
  dayNumber: number; // 1 to 15
  dateLabel: string; // "01" .. "15"
  dayType: DayType;
  inTime: string; // "08:00"
  outTime: string; // "17:00"
}

export interface DayCalculation {
  dayNumber: number;
  regularHours: number;
  leaveHours: number;
  otHours: number;
  totalHours: number;
  breakDeductedHours: number;
  workedMinutes: number;
}

export interface PayrollSummary {
  employmentType?: EmploymentType;
  basicSalary: number;
  dailyWageRate?: number;
  monthlyAllowance: number;
  totalMonthlySalary: number;
  hourlyRate: number;
  otRate: number;
  totalRegularHours: number;
  totalLeaveHours: number;
  totalOtHours: number;
  totalHours: number;
  equivalentDays: number;
  workingDaysLogged: number;
  regularPay: number;
  overtimePay: number;
  grossSalary: number;
  allowances: number;
  earnedAllowance: number;
  totalLoan: number;
  loanDeduction: number;
  remainingLoan: number;
  loanExceedsTotal: boolean;
  advanceDeduction: number;
  otherDeduction: number;
  totalDeductions: number;
  netSalary: number;
  dayCalculations: DayCalculation[];
}

export interface LoanHistoryEntry {
  periodId: string;
  salaryMonth?: string;
  totalLoan: number;
  loanDeduction: number;
  remainingLoan: number;
  recordedAt: string;
  source?: 'saved' | 'cycle' | 'slip' | 'manual';
}

export interface PeriodSnapshot {
  periodId: string;
  salaryMonth: string;
  salaryConfig: SalaryAndLoanConfig;
  attendance: AttendanceDay[];
  savedAt: string;
}

export interface EmployeeWorkspace {
  employee: EmployeeDetails;
  salaryConfig: SalaryAndLoanConfig;
  attendance: AttendanceDay[];
  loanHistory?: LoanHistoryEntry[];
  periodRecords?: Record<string, PeriodSnapshot>;
  lastAutoSyncedPeriodId?: string;
  updatedAt: string;
}

export interface SavedSlipRecord {
  id: string;
  savedAt: string;
  employee: EmployeeDetails;
  salaryConfig: SalaryAndLoanConfig;
  attendance: AttendanceDay[];
  summary: PayrollSummary;
}
