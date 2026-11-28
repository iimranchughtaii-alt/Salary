import React, { useState } from 'react';
import { ArrowRight, Calendar, CheckCircle2, RotateCcw, Save, Settings } from 'lucide-react';
import type {
  AttendanceDay,
  DayType,
  PayrollSummary,
  SalaryAndLoanConfig,
} from '../types/payroll';
import {
  getCalendarDayInfo,
  getCurrentCalendarPeriodMeta,
  getDaysInSalaryMonth,
  parsePeriodId,
} from '../utils/calendarUtils';
import { formatCurrency, formatHours } from '../utils/salaryMath';

interface AttendanceTabProps {
  employeeName: string;
  employeeId: string;
  salaryConfig: SalaryAndLoanConfig;
  attendance: AttendanceDay[];
  summary: PayrollSummary;
  savedPeriodIds?: string[];
  onUpdateDay: (dayNumber: number, patch: Partial<AttendanceDay>) => void;
  onReplaceAttendance: (next: AttendanceDay[]) => void;
  onSwitchPeriod: (
    targetMonth: string,
    targetHalf: 'first' | 'second',
    preserveExistingAttendance?: boolean
  ) => {
    carriedLoan: number;
    movedForward: boolean;
    periodId: string;
    restoredFromSaved?: boolean;
  } | null;
  onStartNextCycle: () => void;
  onSaveTimesheet: () => boolean;
  onGoToSlip: () => void;
  onGoToSettings: () => void;
  onNotify?: (message: string) => void;
}

const DAY_TYPES: { value: DayType; label: string }[] = [
  { value: 'working', label: 'Work' },
  { value: 'sunday', label: 'Sun' },
  { value: 'holiday', label: 'Hol' },
  { value: 'leave', label: 'Sick Leave' },
  { value: 'absent', label: 'Absent' },
];

export const AttendanceTab: React.FC<AttendanceTabProps> = ({
  employeeName,
  employeeId,
  salaryConfig,
  attendance,
  summary,
  savedPeriodIds = [],
  onUpdateDay,
  onReplaceAttendance,
  onSwitchPeriod,
  onStartNextCycle,
  onSaveTimesheet,
  onGoToSlip,
  onGoToSettings,
  onNotify,
}) => {
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [selectedPulseDay, setSelectedPulseDay] = useState<number | null>(null);
  const [rowFilter, setRowFilter] = useState<'all' | 'ot' | 'off'>('all');
  const todayMeta = getCurrentCalendarPeriodMeta();
  const salaryMonth = salaryConfig.salaryMonth || todayMeta.salaryMonth;
  const daysInMonth = getDaysInSalaryMonth(salaryMonth);
  const isSecondHalf =
    Number(
      attendance[0]?.dateLabel ||
        (salaryConfig.periodId?.startsWith('16') ? '16' : '01')
    ) >= 16;
  const isDailyWages = salaryConfig.employmentType === 'daily_wages';
  const isViewingTodayPeriod = salaryConfig.periodId === todayMeta.periodId;
  const selectablePeriods = Array.from(
    new Set([
      ...(salaryConfig.periodId ? [salaryConfig.periodId] : []),
      ...savedPeriodIds,
    ])
  );

  const scrollToDayRow = (dayNumber: number) => {
    setSelectedPulseDay(dayNumber);
    setRowFilter('all');
    requestAnimationFrame(() => {
      const el = document.getElementById(`day-row-${dayNumber}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  };

  const handleSave = () => {
    onSaveTimesheet();
    const leavePart =
      summary.totalLeaveHours > 0
        ? `, ${formatHours(summary.totalLeaveHours)}h Sick Leave`
        : '';
    const msg = `Saved! (${formatHours(summary.totalRegularHours)}h W.Hrs${leavePart}, ${formatHours(
      summary.totalOtHours
    )}h OT)`;
    setSaveFeedback(msg);
    onNotify?.(msg);
    setTimeout(() => setSaveFeedback(null), 4000);
  };

  const notifyPeriodSwitchResult = (
    res: {
      carriedLoan: number;
      movedForward: boolean;
      periodId: string;
      restoredFromSaved?: boolean;
    } | null
  ) => {
    if (!res) return;
    if (res.restoredFromSaved) {
      onNotify?.(
        `Restored saved entries & salary slip for period ${res.periodId}.`
      );
    } else if (res.movedForward) {
      onNotify?.(
        `Period ${res.periodId}: Previous Remaining Loan PKR ${formatCurrency(
          res.carriedLoan
        )} carried to Total Loan.`
      );
    }
  };

  const handleMonthChange = (newMonth: string) => {
    if (!newMonth || !newMonth.includes('-')) return;
    const half: 'first' | 'second' = isSecondHalf ? 'second' : 'first';
    const res = onSwitchPeriod(newMonth, half, false);
    notifyPeriodSwitchResult(res);
  };

  const switchDateRange = (half: 'first' | 'second') => {
    const res = onSwitchPeriod(salaryMonth, half, false);
    notifyPeriodSwitchResult(res);
  };

  const handleSelectSavedPeriod = (periodId: string) => {
    const parsed = parsePeriodId(periodId);
    if (!parsed) return;
    const res = onSwitchPeriod(parsed.salaryMonth, parsed.half, false);
    notifyPeriodSwitchResult(res);
  };

  const handleJumpToTodayPeriod = () => {
    const res = onSwitchPeriod(todayMeta.salaryMonth, todayMeta.half, false);
    notifyPeriodSwitchResult(res);
    if (!res?.restoredFromSaved && !res?.movedForward) {
      onNotify?.(`Switched to today's period (${todayMeta.periodId}).`);
    }
  };

  const fillRegularShiftAllWorking = () => {
    onReplaceAttendance(
      attendance.map((d) =>
        d.dayType === 'working'
          ? { ...d, inTime: '08:00', outTime: '17:00' }
          : d
      )
    );
  };

  const resetAllTimes = () => {
    onReplaceAttendance(
      attendance.map((d) => {
        const info = getCalendarDayInfo(salaryMonth, d.dateLabel);
        return {
          ...d,
          dayType: info.isSunday ? 'sunday' : 'working',
          inTime: '',
          outTime: '',
        };
      })
    );
  };

  const applyOtPreset = (day: AttendanceDay, extraHoursAfter17: number) => {
    const outHour = 17 + extraHoursAfter17;
    const formatted = `${String(Math.min(23, outHour)).padStart(2, '0')}:00`;
    onUpdateDay(day.dayNumber, {
      dayType:
        day.dayType === 'sunday' || day.dayType === 'holiday'
          ? day.dayType
          : 'working',
      inTime: day.inTime || '08:00',
      outTime: formatted,
    });
  };

  const totalDaysCount = Math.max(1, attendance.length);
  const paidDaysProgress = Math.min(1, summary.workingDaysLogged / totalDaysCount);
  const outerRadius = 32;
  const outerCirc = 2 * Math.PI * outerRadius;
  const outerOffset = outerCirc * (1 - paidDaysProgress);

  const otRatioProgress = Math.min(
    1,
    summary.totalOtHours / Math.max(8, totalDaysCount * 3)
  );
  const innerRadius = 23;
  const innerCirc = 2 * Math.PI * innerRadius;
  const innerOffset = innerCirc * (1 - otRatioProgress);

  const safeTotalHours = Math.max(1, summary.totalHours);
  const regPct = (summary.totalRegularHours / safeTotalHours) * 100;
  const leavePct = (summary.totalLeaveHours / safeTotalHours) * 100;
  const otPct = (summary.totalOtHours / safeTotalHours) * 100;

  const kpiCards = [
    {
      label: isDailyWages ? 'W. Hrs (Work Only)' : 'W. Hrs (Work + Sun/Hol)',
      value: formatHours(summary.totalRegularHours),
      sub: `${(summary.totalRegularHours / 8).toFixed(2)} days · Paid`,
      pct: Math.min(1, summary.totalRegularHours / Math.max(8, totalDaysCount * 8)),
      stroke: '#0F766E',
      valueClass: 'text-slate-900',
    },
    {
      label: isDailyWages ? 'L. Hrs (Sick Leave · Non-Paid)' : 'L. Hrs (Sick Leave)',
      value: formatHours(summary.totalLeaveHours),
      sub: `${(summary.totalLeaveHours / 8).toFixed(2)} days · ${isDailyWages ? 'Non-Paid' : 'Paid'}`,
      pct: Math.min(1, summary.totalLeaveHours / Math.max(8, totalDaysCount * 8)),
      stroke: '#0284C7',
      valueClass: 'text-slate-900',
    },
    {
      label: 'Overtime Hours',
      value: formatHours(summary.totalOtHours),
      sub: 'After 17:00 + Sun/Hol Work',
      pct: otRatioProgress,
      stroke: '#D97706',
      valueClass: 'text-teal-700',
    },
    {
      label: 'Total Paid Hours',
      value: formatHours(summary.totalHours),
      sub: `${summary.equivalentDays.toFixed(2)} equivalent days`,
      pct: Math.min(1, summary.totalHours / Math.max(8, totalDaysCount * 10)),
      stroke: '#0F172A',
      valueClass: 'text-slate-900',
    },
  ];

  const inspectedDay =
    attendance.find((d) => d.dayNumber === selectedPulseDay) ?? attendance[0];
  const inspectedCalc = inspectedDay
    ? summary.dayCalculations.find((c) => c.dayNumber === inspectedDay.dayNumber)
    : undefined;
  const inspectedCal = inspectedDay
    ? getCalendarDayInfo(salaryMonth, inspectedDay.dateLabel)
    : null;

  const filteredAttendance = attendance.filter((day) => {
    if (rowFilter === 'all') return true;
    const calc = summary.dayCalculations.find((c) => c.dayNumber === day.dayNumber);
    if (rowFilter === 'ot') return (calc?.otHours ?? 0) > 0;
    return day.dayType !== 'working';
  });

  return (
    <div className="space-y-5">
      {/* Executive Pay Snapshot & Dual-Arc Visual Attendance Gauge */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-teal-950 p-5 sm:p-6 text-white shadow-sm">
        {!heroImgFailed && (
          <img
            src="/src/assets/images/payroll_hero_surface_1795655964165.jpg"
            alt="Payroll dark slate textured backdrop"
            referrerPolicy="no-referrer"
            onError={() => setHeroImgFailed(true)}
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-55"
          />
        )}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/75 to-slate-900/65"
        />

        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-300">
              <span className="font-semibold text-white">{employeeName || 'Employee'}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{employeeId || '-'}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">Period {salaryConfig.periodId}</span>
              <span aria-hidden="true">·</span>
              <span className={isDailyWages ? 'font-semibold text-amber-300' : 'font-semibold text-emerald-300'}>
                {isDailyWages ? 'Daily Wages' : 'Regular'}
              </span>
            </div>

            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 pt-1">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-slate-400">
                  Net Payable
                </div>
                <div className="font-mono text-2xl sm:text-3xl font-bold tracking-tight text-white tabular-nums">
                  PKR {formatCurrency(summary.netSalary)}
                </div>
              </div>
              <div className="h-8 w-px bg-white/15 hidden sm:block" />
              <div>
                <div className="text-[11px] uppercase tracking-wider text-slate-400">
                  Gross Pay
                </div>
                <div className="font-mono text-base font-semibold text-emerald-300 tabular-nums">
                  PKR {formatCurrency(summary.grossSalary)}
                </div>
              </div>
              <div className="h-8 w-px bg-white/15 hidden sm:block" />
              <div>
                <div className="text-[11px] uppercase tracking-wider text-slate-400">
                  Remaining Loan
                </div>
                <div className="font-mono text-base font-semibold text-slate-200 tabular-nums">
                  PKR {formatCurrency(summary.remainingLoan)}
                </div>
              </div>
            </div>

            {/* Hours Mix Stacked Bar */}
            <div className="pt-2 max-w-md">
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  style={{ width: `${regPct}%` }}
                  className="bg-emerald-400 transition-all duration-200"
                />
                <div
                  style={{ width: `${leavePct}%` }}
                  className="bg-sky-400 transition-all duration-200"
                />
                <div
                  style={{ width: `${otPct}%` }}
                  className="bg-amber-400 transition-all duration-200"
                />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-slate-300 font-mono tabular-nums">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  W {formatHours(summary.totalRegularHours)}h
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-sky-400" />
                  L {formatHours(summary.totalLeaveHours)}h
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  OT {formatHours(summary.totalOtHours)}h
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 lg:justify-end">
            {/* Dual-Arc Gauge (Outer = Paid Days, Inner = OT Ratio) */}
            <div className="flex items-center gap-3.5 rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2.5">
              <svg width="76" height="76" viewBox="0 0 76 76" className="shrink-0">
                <circle
                  cx="38"
                  cy="38"
                  r={outerRadius}
                  fill="none"
                  stroke="rgba(255,255,255,0.12)"
                  strokeWidth="5"
                />
                <circle
                  cx="38"
                  cy="38"
                  r={outerRadius}
                  fill="none"
                  stroke="#10B981"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray={outerCirc}
                  strokeDashoffset={outerOffset}
                  transform="rotate(-90 38 38)"
                />
                <circle
                  cx="38"
                  cy="38"
                  r={innerRadius}
                  fill="none"
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth="4"
                />
                <circle
                  cx="38"
                  cy="38"
                  r={innerRadius}
                  fill="none"
                  stroke="#F59E0B"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={innerCirc}
                  strokeDashoffset={innerOffset}
                  transform="rotate(-90 38 38)"
                />
                <text
                  x="38"
                  y="42"
                  textAnchor="middle"
                  className="fill-white font-mono text-[12px] font-bold"
                >
                  {summary.workingDaysLogged}/{totalDaysCount}
                </text>
              </svg>
              <div className="text-xs space-y-0.5">
                <div className="font-semibold text-white">Paid Days · OT Arc</div>
                <div className="text-emerald-300 font-mono text-[11px] tabular-nums">
                  {summary.equivalentDays.toFixed(2)} eq. days
                </div>
                <div className="text-amber-300 font-mono text-[11px] tabular-nums">
                  {formatHours(summary.totalOtHours)}h OT logged
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onGoToSettings}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/20 active:scale-[0.98] transition-all whitespace-nowrap shrink-0"
            >
              <Settings className="h-4 w-4 text-emerald-300" />
              <span>Settings</span>
            </button>
          </div>
        </div>
      </section>

      {/* Top Hours Summary Bar with Micro SVG Radial Gauges */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpiCards.map((card) => {
          const r = 13;
          const circ = 2 * Math.PI * r;
          const off = circ * (1 - card.pct);
          return (
            <div
              key={card.label}
              className="flex items-start justify-between gap-2 rounded-2xl border border-slate-200/90 bg-white p-4"
            >
              <div className="min-w-0">
                <div className="text-xs font-medium text-slate-500 truncate">
                  {card.label}
                </div>
                <div
                  className={`mt-1 font-mono text-xl font-bold tabular-nums ${card.valueClass}`}
                >
                  {card.value}
                </div>
                <div className="text-[11px] text-slate-500 truncate">{card.sub}</div>
              </div>
              <svg
                width="34"
                height="34"
                viewBox="0 0 34 34"
                aria-hidden="true"
                className="shrink-0 mt-0.5"
              >
                <circle
                  cx="17"
                  cy="17"
                  r={r}
                  fill="none"
                  stroke="#E2E8F0"
                  strokeWidth="3.5"
                />
                <circle
                  cx="17"
                  cy="17"
                  r={r}
                  fill="none"
                  stroke={card.stroke}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeDasharray={circ}
                  strokeDashoffset={off}
                  transform="rotate(-90 17 17)"
                />
              </svg>
            </div>
          );
        })}
      </section>

      {/* Calendar & Quick Actions Toolbar */}
      <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2">
            <label
              htmlFor="entry-month-picker"
              className="text-xs font-semibold text-slate-600 whitespace-nowrap"
            >
              Month:
            </label>
            <input
              id="entry-month-picker"
              type="month"
              value={salaryMonth}
              onChange={(e) => handleMonthChange(e.target.value)}
              className="min-h-[42px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-xs font-semibold text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
            />
          </div>

          <div className="inline-flex items-center rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => switchDateRange('first')}
              className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                !isSecondHalf
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              01–15
            </button>
            <button
              type="button"
              onClick={() => switchDateRange('second')}
              className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                isSecondHalf
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              16–{daysInMonth}
            </button>
          </div>

          {!isViewingTodayPeriod && (
            <button
              type="button"
              onClick={handleJumpToTodayPeriod}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 transition-colors whitespace-nowrap shrink-0"
              title={`Jump back to current calendar period (${todayMeta.periodId})`}
            >
              <Calendar className="h-3.5 w-3.5 text-emerald-700" />
              <span>Today ({todayMeta.shortLabel})</span>
            </button>
          )}

          {selectablePeriods.length > 0 && (
            <select
              aria-label="Switch Saved Period"
              value={salaryConfig.periodId || todayMeta.periodId}
              onChange={(e) => handleSelectSavedPeriod(e.target.value)}
              className="min-h-[42px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-xs font-semibold text-slate-800 focus:border-teal-700 focus:bg-white focus:outline-none"
              title="Open any saved period to view its entries and salary slip"
            >
              {selectablePeriods.map((pid) => (
                <option key={pid} value={pid}>
                  {pid === todayMeta.periodId ? `${pid} (Current)` : pid}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={onStartNextCycle}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3.5 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-100 transition-colors whitespace-nowrap shrink-0"
            title="Start next 15-day cycle and carry Remaining Loan into Total Loan"
          >
            <span>Next Cycle</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={fillRegularShiftAllWorking}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-teal-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0"
          >
            <CheckCircle2 className="h-4 w-4" />
            <span>Fill 08:00–17:00</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={resetAllTimes}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <RotateCcw className="h-4 w-4 text-slate-500" />
            <span>Clear Times</span>
          </button>

          <button
            type="button"
            onClick={handleSave}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            <Save className="h-4 w-4 text-teal-400" />
            <span>Save Times</span>
          </button>

          <button
            type="button"
            onClick={onGoToSlip}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3.5 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-100 transition-colors whitespace-nowrap shrink-0"
          >
            <Calendar className="h-4 w-4" />
            <span>View Salary Slip</span>
          </button>
        </div>
      </section>

      {saveFeedback && (
        <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-xs font-semibold text-teal-900">
          {saveFeedback}
        </div>
      )}

      {/* Interactive 15-Day Attendance Pulse Chart & Row Filter */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              15-Day Attendance &amp; Overtime Pulse
            </h2>
            {inspectedDay && inspectedCal ? (
              <p className="mt-0.5 font-mono text-[11px] text-slate-600 tabular-nums">
                {inspectedCal.shortDate} ({inspectedCal.weekdayShort}) ·{' '}
                <span className="capitalize font-sans font-semibold text-slate-800">
                  {inspectedDay.dayType}
                </span>{' '}
                · {inspectedDay.inTime && inspectedDay.outTime ? `${inspectedDay.inTime}–${inspectedDay.outTime}` : 'No Punch'} ·{' '}
                <strong className="text-teal-700">W {formatHours(inspectedCalc?.regularHours ?? 0)}h</strong> ·{' '}
                <strong className="text-sky-700">L {formatHours(inspectedCalc?.leaveHours ?? 0)}h</strong> ·{' '}
                <strong className="text-amber-700">OT {formatHours(inspectedCalc?.otHours ?? 0)}h</strong>
              </p>
            ) : null}
          </div>

          <div className="inline-flex items-center rounded-xl bg-slate-100 p-1 self-start sm:self-auto">
            {(
              [
                { id: 'all', label: `All (${attendance.length})` },
                { id: 'ot', label: 'OT Only' },
                { id: 'off', label: 'Off / Leave' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setRowFilter(tab.id)}
                className={`min-h-[34px] rounded-lg px-3 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                  rowFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Interactive Stacked Bar SVG Chart */}
        {(() => {
          const maxScaleHours = Math.max(
            12,
            ...attendance.map((d) => {
              const c = summary.dayCalculations.find((x) => x.dayNumber === d.dayNumber);
              return (c?.regularHours ?? 0) + (c?.leaveHours ?? 0) + (c?.otHours ?? 0);
            })
          );
          const chartHeight = 92;
          const baselineY = chartHeight - (8 / maxScaleHours) * chartHeight;

          return (
            <div className="mt-4">
              <div className="relative">
                {/* 8h Standard Shift Reference Line */}
                <div
                  style={{ top: `${baselineY}px` }}
                  className="pointer-events-none absolute inset-x-0 flex items-center"
                >
                  <div className="w-full border-t border-dashed border-slate-300" />
                  <span className="ml-1.5 rounded bg-white px-1 font-mono text-[9px] font-semibold text-slate-400">
                    8h
                  </span>
                </div>

                <div
                  className="grid gap-1.5 sm:gap-2 items-end pt-2"
                  style={{
                    gridTemplateColumns: `repeat(${attendance.length}, minmax(0, 1fr))`,
                    height: `${chartHeight + 24}px`,
                  }}
                >
                  {attendance.map((day) => {
                    const calc = summary.dayCalculations.find(
                      (c) => c.dayNumber === day.dayNumber
                    );
                    const wHrs = calc?.regularHours ?? 0;
                    const lHrs = calc?.leaveHours ?? 0;
                    const otHrs = calc?.otHours ?? 0;
                    const wH = (wHrs / maxScaleHours) * chartHeight;
                    const lH = (lHrs / maxScaleHours) * chartHeight;
                    const otH = (otHrs / maxScaleHours) * chartHeight;
                    const isSelected = selectedPulseDay === day.dayNumber;
                    const isAbsent = day.dayType === 'absent';

                    return (
                      <button
                        key={day.dayNumber}
                        type="button"
                        onClick={() => scrollToDayRow(day.dayNumber)}
                        title={`Day ${day.dateLabel}: ${formatHours(wHrs)}h W, ${formatHours(lHrs)}h L, ${formatHours(otHrs)}h OT`}
                        className={`group flex flex-col items-center justify-end h-full rounded-lg px-0.5 pb-0.5 transition-colors ${
                          isSelected ? 'bg-teal-50/90 ring-1 ring-teal-500/40' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div
                          className="flex w-full max-w-[18px] flex-col-reverse overflow-hidden rounded-t-md bg-slate-100"
                          style={{ height: `${chartHeight}px` }}
                        >
                          {wH > 0 && (
                            <div
                              style={{ height: `${wH}px` }}
                              className="w-full bg-teal-600 transition-all duration-200"
                            />
                          )}
                          {lH > 0 && (
                            <div
                              style={{ height: `${lH}px` }}
                              className="w-full bg-sky-500 transition-all duration-200"
                            />
                          )}
                          {otH > 0 && (
                            <div
                              style={{ height: `${otH}px` }}
                              className="w-full bg-amber-500 transition-all duration-200"
                            />
                          )}
                          {isAbsent && wH === 0 && lH === 0 && otH === 0 && (
                            <div className="h-1.5 w-full bg-rose-500" />
                          )}
                        </div>
                        <span
                          className={`mt-1 font-mono text-[10px] leading-none tabular-nums ${
                            isSelected
                              ? 'font-bold text-teal-800'
                              : 'font-medium text-slate-500'
                          }`}
                        >
                          {day.dateLabel}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-teal-600" />
                    Work
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-sky-500" />
                    Sick Leave
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-amber-500" />
                    Overtime
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-rose-500" />
                    Absent
                  </span>
                </div>
                <span>Tap any bar to jump to day row</span>
              </div>
            </div>
          );
        })()}
      </section>

      {/* Calendar-Linked Daily In / Out Table */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="hidden lg:grid lg:grid-cols-12 lg:gap-4 border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-semibold text-slate-600">
          <div className="col-span-2">Calendar Date</div>
          <div className="col-span-3">Day Status</div>
          <div className="col-span-3">Time In / Out</div>
          <div className="col-span-2">Quick OT</div>
          <div className="col-span-2 text-right">Reg / OT Hours</div>
        </div>

        <div className="divide-y divide-slate-100">
          {filteredAttendance.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No days match this filter. Switch to <strong>All</strong> to view all days.
            </div>
          ) : (
            filteredAttendance.map((day) => {
            const calc = summary.dayCalculations.find(
              (c) => c.dayNumber === day.dayNumber
            );
            const cal = getCalendarDayInfo(salaryMonth, day.dateLabel);
            const isOff =
              (day.dayType === 'sunday' ||
                day.dayType === 'holiday' ||
                day.dayType === 'leave' ||
                day.dayType === 'absent') &&
              (!day.inTime || !day.outTime);

            return (
              <div
                id={`day-row-${day.dayNumber}`}
                key={day.dayNumber}
                className={`day-row-cv p-4 lg:px-5 lg:py-3.5 transition-colors ${
                  selectedPulseDay === day.dayNumber
                    ? 'bg-teal-50/60 ring-1 ring-inset ring-teal-500/30'
                    : cal.isSunday || day.dayType === 'sunday' || day.dayType === 'holiday'
                    ? 'bg-slate-50/80'
                    : 'bg-white'
                }`}
              >
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-12 lg:items-center lg:gap-4">
                  {/* Calendar Date + Weekday + Mobile Calc Summary */}
                  <div className="flex items-center justify-between lg:col-span-2">
                    <div>
                      <div className="font-mono text-sm font-bold text-slate-900">
                        {cal.shortDate}{' '}
                        <span
                          className={
                            cal.isSunday
                              ? 'font-sans text-xs font-bold text-teal-700'
                              : 'font-sans text-xs font-medium text-slate-500'
                          }
                        >
                          · {cal.weekdayShort}
                        </span>
                      </div>
                      <div className="font-mono text-[11px] text-slate-400">
                        {cal.isoDate}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-xs font-mono lg:hidden tabular-nums">
                      {day.dayType === 'absent' || (isDailyWages && isOff) ? (
                        <span className="font-sans font-semibold text-rose-700">
                          Not Paid (0.00h)
                        </span>
                      ) : day.dayType === 'leave' ? (
                        <span className="font-sans font-semibold text-teal-700">
                          Sick Leave: {formatHours(calc?.leaveHours ?? 0)}h (Paid)
                        </span>
                      ) : (
                        <>
                          <span className="text-slate-600">
                            W: <strong className="text-slate-900">{formatHours(calc?.regularHours ?? 0)}h</strong>
                          </span>
                          <span className="text-teal-700">
                            OT: <strong>{formatHours(calc?.otHours ?? 0)}h</strong>
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Day Type Segmented Control */}
                  <div className="lg:col-span-3">
                    <div className="grid grid-cols-5 gap-1 rounded-xl bg-slate-100 p-1">
                      {DAY_TYPES.map((dt) => (
                        <button
                          key={dt.value}
                          type="button"
                          onClick={() => {
                            if (dt.value === 'leave' || dt.value === 'absent') {
                              onUpdateDay(day.dayNumber, {
                                dayType: dt.value,
                                inTime: '',
                                outTime: '',
                              });
                            } else if (dt.value === 'working') {
                              onUpdateDay(day.dayNumber, {
                                dayType: dt.value,
                                inTime: day.inTime || '08:00',
                                outTime: day.outTime || '17:00',
                              });
                            } else {
                              onUpdateDay(day.dayNumber, {
                                dayType: dt.value,
                                inTime: '',
                                outTime: '',
                              });
                            }
                          }}
                          className={`min-h-[38px] rounded-lg px-1 py-1 text-[10px] sm:text-[11px] leading-tight font-semibold transition-colors ${
                            day.dayType === dt.value
                              ? dt.value === 'absent'
                                ? 'bg-rose-600 text-white shadow-sm'
                                : 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {dt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* In Time & Out Time */}
                  <div className="grid grid-cols-2 gap-2.5 lg:col-span-3">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-500 lg:hidden">
                        Time In
                      </label>
                      <input
                        type="time"
                        value={day.inTime}
                        disabled={day.dayType === 'leave' || day.dayType === 'absent'}
                        onChange={(e) =>
                          onUpdateDay(day.dayNumber, { inTime: e.target.value })
                        }
                        className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 font-mono text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-400 focus:border-teal-700 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-500 lg:hidden">
                        Time Out
                      </label>
                      <input
                        type="time"
                        value={day.outTime}
                        disabled={day.dayType === 'leave' || day.dayType === 'absent'}
                        onChange={(e) =>
                          onUpdateDay(day.dayNumber, { outTime: e.target.value })
                        }
                        className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 font-mono text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-400 focus:border-teal-700 focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Quick OT Helpers */}
                  <div className="flex items-center gap-1.5 lg:col-span-2">
                    {[0, 1, 2, 3].map((ot) => (
                      <button
                        key={ot}
                        type="button"
                        onClick={() => applyOtPreset(day, ot)}
                        className={`min-h-[38px] flex-1 rounded-lg border px-1.5 py-1 font-mono text-[11px] font-semibold transition-colors whitespace-nowrap ${
                          day.outTime === `${17 + ot}:00` && day.dayType === 'working'
                            ? 'border-teal-700 bg-teal-50 text-teal-800'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {ot === 0 ? '17:00' : `+${ot}h`}
                      </button>
                    ))}
                  </div>

                  {/* Desktop Calc Column */}
                  <div className="hidden lg:col-span-2 lg:block lg:text-right font-mono tabular-nums">
                    {isOff ? (
                      <div className="text-xs">
                        <span className="font-semibold text-slate-900">
                          {formatHours(
                            day.dayType === 'leave'
                              ? calc?.leaveHours ?? 0
                              : calc?.regularHours ?? 0
                          )}
                          h
                        </span>
                        <span
                          className={`ml-1.5 font-sans text-[11px] capitalize ${
                            day.dayType === 'absent' || isDailyWages
                              ? 'font-semibold text-rose-700'
                              : day.dayType === 'leave'
                              ? 'font-semibold text-teal-700'
                              : 'text-slate-500'
                          }`}
                        >
                          (
                          {day.dayType === 'absent'
                            ? 'Absent · Not Paid'
                            : isDailyWages
                            ? `${day.dayType === 'leave' ? 'Sick Leave' : day.dayType} · Non-Paid`
                            : day.dayType === 'leave'
                            ? 'Sick Leave · L.Hrs'
                            : `${day.dayType} Paid`}
                          )
                        </span>
                      </div>
                    ) : (day.dayType === 'sunday' || day.dayType === 'holiday') && (calc?.otHours ?? 0) > 0 ? (
                      <div className="text-xs">
                        <span className="font-semibold text-slate-900">
                          {formatHours(calc?.regularHours ?? 0)}h
                        </span>
                        <span className="mx-1 text-slate-300">+</span>
                        <span className="font-semibold text-teal-700">
                          {formatHours(calc?.otHours ?? 0)}h OT
                        </span>
                      </div>
                    ) : (
                      <div className="text-xs">
                        <span className="font-semibold text-slate-900">
                          {formatHours(calc?.regularHours ?? 0)}h
                        </span>
                        <span className="mx-1 text-slate-300">/</span>
                        <span
                          className={
                            (calc?.otHours ?? 0) > 0
                              ? 'font-semibold text-teal-700'
                              : 'text-slate-400'
                          }
                        >
                          {formatHours(calc?.otHours ?? 0)}h OT
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
          )}
        </div>
      </section>

      {/* Bottom Save & Continue Bar */}
      <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-slate-600 font-mono tabular-nums">
          Total: <strong className="text-slate-900">{formatHours(summary.totalHours)} hrs</strong> ({formatHours(summary.totalRegularHours)}h W + {formatHours(summary.totalLeaveHours)}h L + {formatHours(summary.totalOtHours)}h OT)
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex min-h-[46px] flex-1 sm:flex-none items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 transition-colors whitespace-nowrap"
          >
            <Save className="h-4 w-4" />
            <span>Save 15-Day Timesheet</span>
          </button>
          <button
            type="button"
            onClick={() => {
              handleSave();
              onGoToSlip();
            }}
            className="inline-flex min-h-[46px] flex-1 sm:flex-none items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-100 transition-colors whitespace-nowrap"
          >
            <Calendar className="h-4 w-4 text-teal-700" />
            <span>Save &amp; View Slip</span>
          </button>
        </div>
      </section>

      {saveFeedback && (
        <div className="flex items-center gap-2 rounded-xl border border-teal-300 bg-teal-50 px-4 py-3 text-xs font-semibold text-teal-900">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-700" />
          <span>{saveFeedback}</span>
        </div>
      )}
    </div>
  );
};
