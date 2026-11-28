import type { AttendanceDay } from '../types/payroll';

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function parseSalaryMonth(salaryMonth?: string): { year: number; month: number } {
  const now = new Date();
  const fallback = { year: now.getFullYear(), month: now.getMonth() + 1 };
  if (!salaryMonth || !salaryMonth.includes('-')) return fallback;
  const [yStr, mStr] = salaryMonth.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return fallback;
  }
  return { year, month };
}

export function getCurrentCalendarPeriodMeta(now: Date = new Date()): {
  year: number;
  month: number;
  salaryMonth: string;
  half: 'first' | 'second';
  daysInMonth: number;
  periodId: string;
  shortLabel: string;
} {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const daysInMonth = new Date(year, month, 0).getDate();
  const mStr = String(month).padStart(2, '0');
  const half: 'first' | 'second' = day >= 16 ? 'second' : 'first';
  const periodId =
    half === 'second'
      ? `16-${daysInMonth}-${mStr}-${year}`
      : `01-15-${mStr}-${year}`;
  const shortLabel =
    half === 'second'
      ? `16–${daysInMonth} ${MONTHS_SHORT[month - 1]}`
      : `01–15 ${MONTHS_SHORT[month - 1]}`;
  return {
    year,
    month,
    salaryMonth: `${year}-${mStr}`,
    half,
    daysInMonth,
    periodId,
    shortLabel,
  };
}

export function parsePeriodId(
  periodId: string
): { salaryMonth: string; half: 'first' | 'second' } | null {
  const match = periodId
    .trim()
    .match(/^(\d{1,2})-(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!match) return null;
  const startDay = Number(match[1]);
  const month = Number(match[3]);
  const year = Number(match[4]);
  if (year < 1900 || month < 1 || month > 12) return null;
  return {
    salaryMonth: `${year}-${String(month).padStart(2, '0')}`,
    half: startDay >= 16 ? 'second' : 'first',
  };
}

export function getDaysInSalaryMonth(salaryMonth?: string): number {
  const { year, month } = parseSalaryMonth(salaryMonth);
  return new Date(year, month, 0).getDate();
}

export function getPeriodOrder(
  salaryMonth: string | undefined,
  isSecondHalf: boolean
): number {
  const { year, month } = parseSalaryMonth(salaryMonth);
  return year * 24 + month * 2 + (isSecondHalf ? 1 : 0);
}

export function getNextCycleMeta(
  salaryMonth: string | undefined,
  currentHalf: 'first' | 'second'
): {
  salaryMonth: string;
  half: 'first' | 'second';
  daysInMonth: number;
  periodId: string;
} {
  const { year, month } = parseSalaryMonth(salaryMonth);
  if (currentHalf === 'first') {
    const daysInMonth = new Date(year, month, 0).getDate();
    const mStr = String(month).padStart(2, '0');
    return {
      salaryMonth: `${year}-${mStr}`,
      half: 'second',
      daysInMonth,
      periodId: `16-${daysInMonth}-${mStr}-${year}`,
    };
  }

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const daysInMonth = new Date(nextYear, nextMonth, 0).getDate();
  const mStr = String(nextMonth).padStart(2, '0');
  return {
    salaryMonth: `${nextYear}-${mStr}`,
    half: 'first',
    daysInMonth,
    periodId: `01-15-${mStr}-${nextYear}`,
  };
}

export function getCalendarDayInfo(salaryMonth: string | undefined, dateLabel: string) {
  const { year, month } = parseSalaryMonth(salaryMonth);
  const dayNum = Math.max(1, Math.min(31, Number(dateLabel) || 1));
  const dateObj = new Date(year, month - 1, dayNum);
  const dayOfWeek = dateObj.getDay(); // 0 = Sunday
  const pad = (n: number) => String(n).padStart(2, '0');

  return {
    dayNum,
    year,
    month,
    isoDate: `${year}-${pad(month)}-${pad(dayNum)}`,
    displayDate: `${pad(dayNum)} ${MONTHS_SHORT[month - 1]} ${year}`,
    shortDate: `${pad(dayNum)} ${MONTHS_SHORT[month - 1]}`,
    weekdayShort: WEEKDAYS_SHORT[dayOfWeek],
    isSunday: dayOfWeek === 0,
  };
}

export function generateHalfMonthAttendance(
  salaryMonth: string | undefined,
  half: 'first' | 'second',
  existing?: AttendanceDay[]
): AttendanceDay[] {
  const { year, month } = parseSalaryMonth(salaryMonth);
  const totalDays = new Date(year, month, 0).getDate();
  const startDay = half === 'first' ? 1 : 16;
  const endDay = half === 'first' ? 15 : totalDays;

  const existingByLabel = new Map<string, AttendanceDay>();
  if (existing) {
    for (const item of existing) {
      existingByLabel.set(item.dateLabel, item);
    }
  }

  const days: AttendanceDay[] = [];
  for (let d = startDay; d <= endDay; d++) {
    const label = String(d).padStart(2, '0');
    const isSunday = new Date(year, month - 1, d).getDay() === 0;
    const prev = existingByLabel.get(label);

    if (isSunday) {
      // Auto-select Sunday; preserve times only if user had already entered Sunday work times
      const hadSundayTimes = prev?.dayType === 'sunday' && (prev.inTime || prev.outTime);
      days.push({
        dayNumber: days.length + 1,
        dateLabel: label,
        dayType: 'sunday',
        inTime: hadSundayTimes ? prev.inTime : '',
        outTime: hadSundayTimes ? prev.outTime : '',
      });
    } else if (prev && prev.dayType !== 'sunday') {
      days.push({
        dayNumber: days.length + 1,
        dateLabel: label,
        dayType: prev.dayType,
        inTime: prev.inTime,
        outTime: prev.outTime,
      });
    } else {
      days.push({
        dayNumber: days.length + 1,
        dateLabel: label,
        dayType: 'working',
        inTime: '08:00',
        outTime: '17:00',
      });
    }
  }

  return days;
}
