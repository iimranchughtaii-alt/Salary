import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Briefcase,
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  FileText,
  FolderArchive,
  Landmark,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react';
import type {
  EmployeeDetails,
  EmployeeWorkspace,
  PayrollSummary,
  SavedSlipRecord,
  SalaryAndLoanConfig,
} from '../types/payroll';
import {
  getCurrentCalendarPeriodMeta,
  getDaysInSalaryMonth,
} from '../utils/calendarUtils';
import { buildLoanSummary } from '../utils/loanLedger';
import { formatCurrency, formatHours } from '../utils/salaryMath';
import { LoanSummaryCard } from './LoanSummaryCard';

interface CalculatorTabProps {
  workspaces: EmployeeWorkspace[];
  activeWorkspace: EmployeeWorkspace;
  summary: PayrollSummary;
  savedSlips: SavedSlipRecord[];
  onSelectEmployee: (id: string) => void;
  onAddEmployee: () => void;
  onDeleteEmployee: (id: string) => void;
  onUpdateEmployee: (patch: Partial<EmployeeDetails>) => void;
  onUpdateSalaryConfig: (patch: Partial<SalaryAndLoanConfig>) => void;
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
  onSaveSettings: () => boolean;
  onUpsertLoanHistory: (entry: {
    periodId: string;
    totalLoan: number;
    loanDeduction: number;
  }) => void;
  onDeleteLoanHistory: (periodId: string) => void;
  onExportBackup: () => void;
  onImportBackup: (json: string) => boolean;
  onGoToAttendance: () => void;
  onGoToSlip: () => void;
  onNotify?: (message: string) => void;
}

type SettingsWindowKey = 'profile' | 'salary' | 'loan' | 'backup';

const WINDOW_TABS: {
  id: SettingsWindowKey;
  label: string;
  subtitle: string;
  icon: typeof UserCheck;
}[] = [
  {
    id: 'profile',
    label: 'Profile & Payout',
    subtitle: 'Personal identity, Bank/Cash payout, Photo & Slip ID',
    icon: UserCheck,
  },
  {
    id: 'salary',
    label: 'Pay & OT Engine',
    subtitle: 'Pay mode, Month & Period ID, Basic/Daily wage & Allowance',
    icon: Wallet,
  },
  {
    id: 'loan',
    label: 'Loan & Ledger',
    subtitle: 'Loan deductions, Remaining balance & Period-by-period history',
    icon: CreditCard,
  },
  {
    id: 'backup',
    label: 'Backup & Profiles',
    subtitle: 'Offline JSON export/restore & multi-profile switching',
    icon: FolderArchive,
  },
];

export const CalculatorTab: React.FC<CalculatorTabProps> = ({
  workspaces,
  activeWorkspace,
  summary,
  savedSlips,
  onSelectEmployee,
  onAddEmployee,
  onDeleteEmployee,
  onUpdateEmployee,
  onUpdateSalaryConfig,
  onSwitchPeriod,
  onStartNextCycle,
  onSaveSettings,
  onUpsertLoanHistory,
  onDeleteLoanHistory,
  onExportBackup,
  onImportBackup,
  onGoToAttendance,
  onGoToSlip,
  onNotify,
}) => {
  const { employee, salaryConfig } = activeWorkspace;
  const [activeWindow, setActiveWindow] = useState<SettingsWindowKey | null>(null);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [activeSlice, setActiveSlice] = useState<'base' | 'ot' | 'allw' | 'ded' | null>(null);
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isDailyWages = salaryConfig.employmentType === 'daily_wages';
  const bankEnabled = employee.bankAccountEnabled !== false;

  useEffect(() => {
    if (!activeWindow) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveWindow(null);
      }
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKey);
    };
  }, [activeWindow]);

  const initials =
    (employee.name || 'EM')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'EM';

  const profileFieldsFilled = [
    employee.name,
    employee.fatherName,
    employee.employeeId,
    employee.designation,
    employee.department,
    employee.joiningDate,
  ].filter((v) => Boolean(v && v.trim().length > 0)).length;
  const profileCompletionPct = Math.round((profileFieldsFilled / 6) * 100);

  const loanLedger = useMemo(
    () => buildLoanSummary(activeWorkspace, savedSlips),
    [activeWorkspace, savedSlips]
  );

  const todayMeta = getCurrentCalendarPeriodMeta();
  const calendarDays = getDaysInSalaryMonth(
    salaryConfig.salaryMonth || todayMeta.salaryMonth
  );

  const handleNumberChange = (
    field: keyof SalaryAndLoanConfig,
    raw: string
  ) => {
    const num = raw === '' ? 0 : Math.max(0, Number(raw));
    onUpdateSalaryConfig({ [field]: Number.isFinite(num) ? num : 0 });
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const ok = onImportBackup(text);
      const msg = ok ? 'Offline backup restored.' : 'Invalid backup JSON file.';
      setBackupMessage(msg);
      onNotify?.(msg);
      setTimeout(() => setBackupMessage(null), 3500);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleSave = (closeAfter = false) => {
    onSaveSettings();
    const msg = `Saved details for ${employee.name || 'Employee'}.`;
    setBackupMessage(msg);
    onNotify?.(msg);
    setTimeout(() => setBackupMessage(null), 3500);
    if (closeAfter) {
      setActiveWindow(null);
    }
  };

  const totalLoanVal = Math.max(0, salaryConfig.totalLoan || 0);
  const deductionVal = Math.max(0, salaryConfig.loanDeduction || 0);
  const paidRatio =
    totalLoanVal > 0 ? Math.min(100, (deductionVal / totalLoanVal) * 100) : 0;

  const currentWindowMeta = WINDOW_TABS.find((t) => t.id === activeWindow) || null;

  return (
    <div className="space-y-5">
      {/* Executive Employee & Pay Configuration Hero */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-teal-950 p-5 sm:p-6 text-white shadow-sm">
        {!heroImgFailed && (
          <img
            src="/src/assets/images/payroll_hero_surface_1795655964165.jpg"
            alt="Payroll executive settings surface"
            referrerPolicy="no-referrer"
            onError={() => setHeroImgFailed(true)}
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-50"
          />
        )}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-slate-950/92 via-slate-950/80 to-slate-900/70"
        />

        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 sm:h-16 sm:w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-white/10 font-mono text-lg font-bold text-emerald-300">
              {employee.photoDataUrl ? (
                <img
                  src={employee.photoDataUrl}
                  alt={employee.name || 'Employee'}
                  className="h-full w-full object-cover"
                />
              ) : (
                initials
              )}
            </div>

            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-300">
                <span className="font-mono font-semibold text-emerald-300">
                  {employee.employeeId || 'NO-ID'}
                </span>
                <span aria-hidden="true">·</span>
                <span>{employee.department || 'Department'}</span>
                <span aria-hidden="true">·</span>
                <span
                  className={
                    isDailyWages
                      ? 'font-semibold text-amber-300'
                      : 'font-semibold text-teal-300'
                  }
                >
                  {isDailyWages ? 'Daily Wages Mode' : 'Regular Monthly Mode'}
                </span>
              </div>
              <h1 className="truncate text-lg sm:text-xl font-bold tracking-tight text-white">
                {employee.name || 'Your Payroll Setup'}
              </h1>
              <p className="text-xs text-slate-300 truncate">
                {employee.designation || 'Tap cards below to configure'} ·{' '}
                {bankEnabled
                  ? `${employee.bankName || 'Bank'} Transfer`
                  : 'Cash Payout'}{' '}
                · Period {salaryConfig.periodId || '15 Days'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-3.5 lg:border-t-0 lg:pt-0 lg:justify-end">
            <div className="grid grid-cols-3 gap-4 sm:gap-5">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">
                  {isDailyWages ? 'Per Day' : 'Total Salary'}
                </div>
                <div className="font-mono text-sm sm:text-base font-bold text-white tabular-nums">
                  {formatCurrency(
                    isDailyWages
                      ? summary.dailyWageRate ?? 0
                      : summary.totalMonthlySalary
                  )}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">
                  Basic / hr
                </div>
                <div className="font-mono text-sm sm:text-base font-bold text-emerald-300 tabular-nums">
                  {formatCurrency(summary.hourlyRate)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">
                  OT / hr
                </div>
                <div className="font-mono text-sm sm:text-base font-bold text-amber-300 tabular-nums">
                  {formatCurrency(summary.otRate)}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleSave(false)}
              className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 active:scale-[0.98] transition-all whitespace-nowrap shrink-0"
            >
              <Save className="h-4 w-4" />
              <span>Save Settings</span>
            </button>
          </div>
        </div>
      </section>

      {/* 3 Smart Window Launcher Cards (Tap Opens Dedicated Window — Zero Scroll) */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* Card 1: Profile & Payout Window */}
        <button
          type="button"
          onClick={() => setActiveWindow('profile')}
          className="group relative flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:border-teal-600/50 hover:shadow-md active:scale-[0.985]"
        >
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-teal-800">
              <UserCheck className="h-3.5 w-3.5 shrink-0" />
              <span>Profile &amp; Payout</span>
            </div>
            <div className="truncate text-sm font-bold text-slate-900">
              {employee.name || 'Setup Your Profile'}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono tabular-nums truncate">
              <span>
                {profileFieldsFilled}/6 filled · {bankEnabled ? 'Bank' : 'Cash'}
              </span>
              <span className="inline-flex items-center gap-0.5 font-sans font-semibold text-teal-700 group-hover:translate-x-0.5 transition-transform">
                · Open <ArrowUpRight className="h-3 w-3" />
              </span>
            </div>
          </div>

          <svg width="44" height="44" viewBox="0 0 42 42" className="shrink-0">
            <circle cx="21" cy="21" r="16" fill="none" stroke="#E2E8F0" strokeWidth="4" />
            <circle
              cx="21"
              cy="21"
              r="16"
              fill="none"
              stroke="#0F766E"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 16}
              strokeDashoffset={2 * Math.PI * 16 * (1 - profileCompletionPct / 100)}
              transform="rotate(-90 21 21)"
            />
            <text
              x="21"
              y="24"
              textAnchor="middle"
              className="fill-slate-900 font-mono text-[10px] font-bold"
            >
              {profileCompletionPct}%
            </text>
          </svg>
        </button>

        {/* Card 2: Pay & OT Engine Window */}
        <button
          type="button"
          onClick={() => setActiveWindow('salary')}
          className="group relative flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:border-sky-600/50 hover:shadow-md active:scale-[0.985]"
        >
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-sky-800">
              <Wallet className="h-3.5 w-3.5 shrink-0" />
              <span>Pay &amp; OT Engine</span>
            </div>
            <div className="truncate font-mono text-sm font-bold text-slate-900 tabular-nums">
              {isDailyWages
                ? `${formatCurrency(summary.dailyWageRate ?? 0)} / day`
                : `PKR ${formatCurrency(summary.totalMonthlySalary)}`}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono tabular-nums truncate">
              <span>
                OT {formatCurrency(summary.otRate)}/hr · {salaryConfig.daysInMonth || 30}d
              </span>
              <span className="inline-flex items-center gap-0.5 font-sans font-semibold text-sky-700 group-hover:translate-x-0.5 transition-transform">
                · Open <ArrowUpRight className="h-3 w-3" />
              </span>
            </div>
          </div>

          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-700 group-hover:bg-sky-100 transition-colors">
            <Sparkles className="h-5 w-5" />
          </div>
        </button>

        {/* Card 3: Loan & Ledger Window */}
        <button
          type="button"
          onClick={() => setActiveWindow('loan')}
          className="group relative flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:border-amber-600/50 hover:shadow-md active:scale-[0.985]"
        >
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-800">
              <CreditCard className="h-3.5 w-3.5 shrink-0" />
              <span>Loan &amp; Ledger</span>
            </div>
            <div className="truncate font-mono text-sm font-bold text-slate-900 tabular-nums">
              Rem: {formatCurrency(loanLedger.currentRemainingLoan)}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono tabular-nums truncate">
              <span>
                {loanLedger.deductionPeriodsCount} periods · -
                {formatCurrency(loanLedger.totalDeductedAllPeriods)}
              </span>
              <span className="inline-flex items-center gap-0.5 font-sans font-semibold text-amber-700 group-hover:translate-x-0.5 transition-transform">
                · Open <ArrowUpRight className="h-3 w-3" />
              </span>
            </div>
          </div>

          <svg width="44" height="44" viewBox="0 0 42 42" className="shrink-0">
            <circle cx="21" cy="21" r="16" fill="none" stroke="#E2E8F0" strokeWidth="4" />
            <circle
              cx="21"
              cy="21"
              r="16"
              fill="none"
              stroke="#D97706"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 16}
              strokeDashoffset={2 * Math.PI * 16 * (1 - loanLedger.repaidPercent / 100)}
              transform="rotate(-90 21 21)"
            />
            <text
              x="21"
              y="24"
              textAnchor="middle"
              className="fill-slate-900 font-mono text-[10px] font-bold"
            >
              {Math.round(loanLedger.repaidPercent)}%
            </text>
          </svg>
        </button>
      </section>

      {/* Compact Utility Command Bar */}
      <section className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveWindow('backup')}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 transition-colors whitespace-nowrap"
          >
            <FolderArchive className="h-3.5 w-3.5 text-emerald-600" />
            <span>Backup &amp; Profiles ({workspaces.length})</span>
            <ArrowUpRight className="h-3.5 w-3.5 text-slate-400" />
          </button>

          <button
            type="button"
            onClick={onStartNextCycle}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100 transition-colors whitespace-nowrap"
          >
            <span>Next Cycle</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {backupMessage && (
          <p className="text-xs font-semibold text-teal-700">{backupMessage}</p>
        )}
      </section>

      {/* Main Executive Overview Grid (Clean Summary — No Long Scrolling Forms) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
        {/* Left Column: Live Rate Visual & Period Loan Summary */}
        <div className="space-y-5 lg:col-span-7">
          {/* Rate & Payout Snapshot Card */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Rate &amp; Payout Snapshot
                </h2>
                <p className="text-xs text-slate-500">
                  {isDailyWages ? 'Daily Wages Rule' : 'Regular Monthly Rule'} ·{' '}
                  {bankEnabled
                    ? `${employee.bankName || 'Bank'} Transfer`
                    : 'Cash Payment'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveWindow('salary')}
                className="inline-flex min-h-[36px] items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 transition-colors whitespace-nowrap"
              >
                <span>Edit Pay &amp; OT</span>
                <ArrowUpRight className="h-3.5 w-3.5 text-sky-700" />
              </button>
            </div>

            {(() => {
              const maxRate = Math.max(1, summary.otRate, summary.hourlyRate);
              const basicBarW = (summary.hourlyRate / maxRate) * 100;
              const otBarW = (summary.otRate / maxRate) * 100;
              return (
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-600">
                        {isDailyWages
                          ? 'Basic Rate (Per Day / 8)'
                          : `Basic Rate (Basic / ${salaryConfig.daysInMonth || 30} / 8)`}
                      </span>
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">
                        PKR {formatCurrency(summary.hourlyRate)}/hr
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        style={{ width: `${basicBarW}%` }}
                        className="h-full bg-slate-800 transition-all duration-300"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-600">
                        OT Rate (Total Salary Rate)
                      </span>
                      <span className="font-mono font-semibold text-teal-700 tabular-nums">
                        PKR {formatCurrency(summary.otRate)}/hr
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        style={{ width: `${otBarW}%` }}
                        className="h-full bg-teal-600 transition-all duration-300"
                      />
                    </div>
                  </div>
                </div>
              );
            })()}
          </section>

          {/* Compact Period-by-Period Loan Summary */}
          <LoanSummaryCard
            workspace={activeWorkspace}
            savedSlips={savedSlips}
            allowManage
            onUpsertPeriod={onUpsertLoanHistory}
            onDeletePeriod={onDeleteLoanHistory}
            onNotify={onNotify}
          />
        </div>

        {/* Right Column: Live 15-Day Salary Calculation Summary */}
        <div className="lg:col-span-5 lg:sticky lg:top-20">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
            <div className="border-b border-slate-100 pb-4">
              <div className="text-xs font-medium text-slate-500">
                Biweekly Net Payable · {salaryConfig.periodId || '15 Days'}
              </div>
              <div className="mt-1 font-mono text-3xl font-bold tracking-tight text-slate-900 tabular-nums">
                PKR {formatCurrency(summary.netSalary)}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {employee.name || 'Employee'} · {summary.workingDaysLogged} paid days
                logged
              </div>

              {/* Interactive SVG Donut Chart: Earnings & Deductions Split */}
              {(() => {
                const slices: {
                  id: 'base' | 'ot' | 'allw' | 'ded';
                  label: string;
                  value: number;
                  color: string;
                  dotClass: string;
                }[] = [
                  {
                    id: 'base',
                    label: 'Base Pay',
                    value: Math.max(0, summary.regularPay),
                    color: '#0F172A',
                    dotClass: 'bg-slate-900',
                  },
                  {
                    id: 'ot',
                    label: 'OT Pay',
                    value: Math.max(0, summary.overtimePay),
                    color: '#0F766E',
                    dotClass: 'bg-teal-700',
                  },
                  {
                    id: 'allw',
                    label: 'Allowance',
                    value: Math.max(0, summary.earnedAllowance),
                    color: '#0284C7',
                    dotClass: 'bg-sky-600',
                  },
                  {
                    id: 'ded',
                    label: 'Deductions',
                    value: Math.max(0, summary.totalDeductions),
                    color: '#E11D48',
                    dotClass: 'bg-rose-600',
                  },
                ];

                const totalVolume = Math.max(
                  1,
                  slices.reduce((acc, s) => acc + s.value, 0)
                );
                const radius = 44;
                const circumference = 2 * Math.PI * radius;
                let cumulativeOffset = 0;

                const selected = slices.find((s) => s.id === activeSlice) || null;

                return (
                  <div className="mt-4 flex flex-col sm:flex-row lg:flex-col xl:flex-row items-center gap-4 rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
                    <div className="relative h-28 w-28 shrink-0">
                      <svg viewBox="0 0 120 120" className="h-full w-full">
                        <circle
                          cx="60"
                          cy="60"
                          r={radius}
                          fill="none"
                          stroke="#E2E8F0"
                          strokeWidth="14"
                        />
                        {slices.map((slice) => {
                          const fraction = slice.value / totalVolume;
                          const dashLength = fraction * circumference;
                          const dashOffset = -cumulativeOffset;
                          cumulativeOffset += dashLength;
                          const isHighlighted =
                            activeSlice === null || activeSlice === slice.id;
                          return (
                            <circle
                              key={slice.id}
                              cx="60"
                              cy="60"
                              r={radius}
                              fill="none"
                              stroke={slice.color}
                              strokeWidth={activeSlice === slice.id ? 17 : 14}
                              strokeDasharray={`${dashLength} ${circumference}`}
                              strokeDashoffset={dashOffset}
                              transform="rotate(-90 60 60)"
                              opacity={isHighlighted ? 1 : 0.35}
                              className="cursor-pointer transition-all duration-200"
                              onClick={() =>
                                setActiveSlice((prev) =>
                                  prev === slice.id ? null : slice.id
                                )
                              }
                            />
                          );
                        })}
                      </svg>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                        <span className="text-[10px] font-medium text-slate-500">
                          {selected ? selected.label : 'Net Pay'}
                        </span>
                        <span className="font-mono text-xs font-bold text-slate-900 tabular-nums">
                          {selected
                            ? `${((selected.value / totalVolume) * 100).toFixed(0)}%`
                            : formatCurrency(summary.netSalary)}
                        </span>
                      </div>
                    </div>

                    <div className="grid w-full grid-cols-2 gap-1.5">
                      {slices.map((slice) => {
                        const isSelected = activeSlice === slice.id;
                        const pct = ((slice.value / totalVolume) * 100).toFixed(0);
                        return (
                          <button
                            key={slice.id}
                            type="button"
                            onClick={() =>
                              setActiveSlice((prev) =>
                                prev === slice.id ? null : slice.id
                              )
                            }
                            className={`flex flex-col items-start rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                              isSelected
                                ? 'border-slate-900 bg-white shadow-sm'
                                : 'border-slate-200/70 bg-white/80 hover:bg-white'
                            }`}
                          >
                            <div className="flex w-full items-center justify-between gap-1 text-[11px] text-slate-600">
                              <span className="inline-flex items-center gap-1.5 font-medium truncate">
                                <span
                                  className={`h-2 w-2 rounded-full shrink-0 ${slice.dotClass}`}
                                />
                                {slice.label}
                              </span>
                              <span className="font-mono text-[10px] text-slate-400">
                                {pct}%
                              </span>
                            </div>
                            <span className="mt-0.5 font-mono text-xs font-semibold text-slate-900 tabular-nums">
                              {formatCurrency(slice.value)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-600">
                  {isDailyWages ? 'W. Hrs (Work Only)' : 'W. Hrs (Work + Sun/Hol)'}
                </span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {formatHours(summary.totalRegularHours)} hrs (
                  {(summary.totalRegularHours / 8).toFixed(2)} d)
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-600">
                  {isDailyWages
                    ? 'L. Hrs (Sick Leave · Non-Paid)'
                    : 'L. Hrs (Sick Leave · Paid)'}
                </span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {formatHours(summary.totalLeaveHours)} hrs (
                  {(summary.totalLeaveHours / 8).toFixed(2)} d)
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-600">OT. Hrs (incl. Sunday Work)</span>
                <span className="font-mono font-semibold text-teal-700 tabular-nums">
                  {formatHours(summary.totalOtHours)} hrs (
                  {(summary.totalOtHours / 8).toFixed(2)} d)
                </span>
              </div>

              <div className="flex items-center justify-between border-t border-slate-100 pt-2.5">
                <span className="font-medium text-slate-700">Total Paid Hours</span>
                <span className="font-mono font-bold text-slate-900 tabular-nums">
                  {formatHours(summary.totalHours)} hrs (
                  {summary.equivalentDays.toFixed(2)} d)
                </span>
              </div>

              <div className="border-t border-slate-100 pt-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">
                    {isDailyWages
                      ? 'Work Hours Pay (Daily Wages)'
                      : 'Regular + Sick Leave Pay'}
                  </span>
                  <span className="font-mono text-slate-900 tabular-nums">
                    PKR {formatCurrency(summary.regularPay)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">
                    Overtime Pay (Total Salary Rate)
                  </span>
                  <span className="font-mono text-teal-700 tabular-nums">
                    + PKR {formatCurrency(summary.overtimePay)}
                  </span>
                </div>
                <div className="flex items-center justify-between font-semibold text-slate-900">
                  <span>Gross Salary</span>
                  <span className="font-mono tabular-nums">
                    PKR {formatCurrency(summary.grossSalary)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-700">
                  <span>
                    Allw. (
                    {((summary.totalRegularHours + summary.totalLeaveHours) / 8).toFixed(
                      2
                    )}
                    d / {salaryConfig.daysInMonth || 30}d)
                  </span>
                  <span className="font-mono tabular-nums">
                    + PKR {formatCurrency(summary.earnedAllowance)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-rose-700">
                  <span>Loan + Other Deductions</span>
                  <span className="font-mono tabular-nums">
                    - PKR {formatCurrency(summary.totalDeductions)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
                  <span>Remaining Loan After Deduction</span>
                  <span className="font-mono font-medium text-slate-700 tabular-nums">
                    PKR {formatCurrency(summary.remainingLoan)}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
              <button
                type="button"
                onClick={() => handleSave(false)}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition-colors"
              >
                <Save className="h-4 w-4 text-teal-400" />
                <span>Save Settings</span>
              </button>
              <button
                type="button"
                onClick={onGoToAttendance}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-100 transition-colors"
              >
                <Clock className="h-4 w-4 text-teal-700" />
                <span>Go to Time Entry</span>
              </button>
              <button
                type="button"
                onClick={onGoToSlip}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 transition-colors"
              >
                <FileText className="h-4 w-4" />
                <span>View PaySlip</span>
              </button>
            </div>
          </section>
        </div>
      </div>

      {/* Dedicated Zero-Scroll Settings Modal Window */}
      {activeWindow && currentWindowMeta && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setActiveWindow(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-window-title"
            className="flex max-h-[92dvh] sm:max-h-[88vh] w-full sm:max-w-3xl flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl border border-slate-200 bg-white shadow-2xl"
          >
            {/* Sticky Modal Header + Quick Window Switcher */}
            <div className="shrink-0 border-b border-slate-200 bg-slate-950 px-5 py-4 text-white">
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/25 sm:hidden" />
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/30">
                    <currentWindowMeta.icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2
                      id="settings-window-title"
                      className="text-base font-bold text-white truncate"
                    >
                      {currentWindowMeta.label}
                    </h2>
                    <p className="text-xs text-slate-300 truncate">
                      {currentWindowMeta.subtitle}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveWindow(null)}
                  aria-label="Close window"
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-white hover:bg-white/20 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Instant Inside-Window Switcher */}
              <div className="mt-3.5 grid grid-cols-4 gap-1 rounded-xl bg-white/10 p-1">
                {WINDOW_TABS.map((tab) => {
                  const Icon = tab.icon;
                  const active = activeWindow === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveWindow(tab.id)}
                      className={`inline-flex min-h-[34px] items-center justify-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-emerald-500 text-slate-950 shadow-sm'
                          : 'text-slate-300 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 hidden sm:inline" />
                      <span className="truncate">
                        {tab.id === 'profile'
                          ? 'Profile'
                          : tab.id === 'salary'
                          ? 'Pay & OT'
                          : tab.id === 'loan'
                          ? 'Loan'
                          : 'Backup'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Scrollable Window Body */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
              {/* WINDOW 1: PROFILE & PAYOUT */}
              {activeWindow === 'profile' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-700">
                        Full Name
                      </label>
                      <input
                        type="text"
                        value={employee.name}
                        onChange={(e) => onUpdateEmployee({ name: e.target.value })}
                        placeholder="Enter full name"
                        className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-700">
                        Father Name
                      </label>
                      <input
                        type="text"
                        value={employee.fatherName}
                        onChange={(e) =>
                          onUpdateEmployee({ fatherName: e.target.value })
                        }
                        placeholder="Enter father name"
                        className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-700">
                        Employee ID
                      </label>
                      <input
                        type="text"
                        value={employee.employeeId}
                        onChange={(e) =>
                          onUpdateEmployee({ employeeId: e.target.value })
                        }
                        placeholder="Enter employee ID"
                        className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-700">
                        Designation
                      </label>
                      <input
                        type="text"
                        value={employee.designation}
                        onChange={(e) =>
                          onUpdateEmployee({ designation: e.target.value })
                        }
                        placeholder="Enter designation"
                        className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-700">
                        Department
                      </label>
                      <input
                        type="text"
                        value={employee.department}
                        onChange={(e) =>
                          onUpdateEmployee({ department: e.target.value })
                        }
                        placeholder="Enter department"
                        className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-700">
                        Section
                      </label>
                      <input
                        type="text"
                        value={employee.section}
                        onChange={(e) => onUpdateEmployee({ section: e.target.value })}
                        placeholder="Enter section"
                        className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="mb-1.5 block text-xs font-medium text-slate-700">
                        Joining Date
                      </label>
                      <input
                        type="date"
                        value={employee.joiningDate}
                        onChange={(e) =>
                          onUpdateEmployee({ joiningDate: e.target.value })
                        }
                        className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Visual Bank vs Cash Payout Selector */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                    <div className="text-xs font-semibold text-slate-800">
                      Salary Payout Method
                    </div>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => onUpdateEmployee({ bankAccountEnabled: true })}
                        className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${
                          bankEnabled
                            ? 'border-teal-700 bg-white shadow-sm'
                            : 'border-slate-200 bg-white/60 hover:bg-white'
                        }`}
                      >
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                            bankEnabled
                              ? 'bg-teal-700 text-white'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          <Landmark className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-bold text-slate-900">
                              Bank Transfer
                            </span>
                            {bankEnabled && (
                              <CheckCircle2 className="h-4 w-4 text-teal-700 shrink-0" />
                            )}
                          </div>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            Slip prints Transfer To Bank + Account
                          </p>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          onUpdateEmployee({ bankAccountEnabled: false })
                        }
                        className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${
                          !bankEnabled
                            ? 'border-slate-900 bg-white shadow-sm'
                            : 'border-slate-200 bg-white/60 hover:bg-white'
                        }`}
                      >
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                            !bankEnabled
                              ? 'bg-slate-900 text-white'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          <Banknote className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-bold text-slate-900">
                              Cash Payment
                            </span>
                            {!bankEnabled && (
                              <CheckCircle2 className="h-4 w-4 text-slate-900 shrink-0" />
                            )}
                          </div>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            Slip prints Cash payout mode
                          </p>
                        </div>
                      </button>
                    </div>

                    {bankEnabled && (
                      <div className="grid grid-cols-1 gap-3 border-t border-slate-200 pt-3 sm:grid-cols-3">
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-700">
                            Bank Name
                          </label>
                          <input
                            type="text"
                            value={employee.bankName}
                            onChange={(e) =>
                              onUpdateEmployee({ bankName: e.target.value })
                            }
                            placeholder="UBL / HBL / Meezan"
                            className="min-h-[42px] w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-700">
                            Branch No.
                          </label>
                          <input
                            type="text"
                            value={employee.branchNo}
                            onChange={(e) =>
                              onUpdateEmployee({ branchNo: e.target.value })
                            }
                            placeholder="0291"
                            className="min-h-[42px] w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-700">
                            Account No.
                          </label>
                          <input
                            type="text"
                            value={employee.accountNo}
                            onChange={(e) =>
                              onUpdateEmployee({ accountNo: e.target.value })
                            }
                            placeholder="Enter account no."
                            className="min-h-[42px] w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Fixed Pay Group, User ID & Photo */}
                  <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-700">
                        Pay Group (Fixed)
                      </label>
                      <input
                        type="text"
                        value="Accounts / Finance"
                        readOnly
                        disabled
                        aria-readonly="true"
                        className="min-h-[44px] w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-700">
                        Slip User ID
                      </label>
                      <input
                        type="text"
                        value={employee.userId ?? 'nadeem'}
                        onChange={(e) => onUpdateEmployee({ userId: e.target.value })}
                        placeholder="nadeem"
                        className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1.5 block text-xs font-medium text-slate-700">
                        Employee Photo (for Slip)
                      </label>
                      <div className="flex items-center gap-3">
                        <label className="inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                          <span>
                            {employee.photoDataUrl ? 'Change Photo' : 'Upload Photo'}
                          </span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const reader = new FileReader();
                              reader.onload = () => {
                                const img = new Image();
                                img.onload = () => {
                                  const canvas = document.createElement('canvas');
                                  const size = 220;
                                  canvas.width = size;
                                  canvas.height = size;
                                  const ctx = canvas.getContext('2d');
                                  if (ctx) {
                                    const minSide = Math.min(img.width, img.height);
                                    const sx = (img.width - minSide) / 2;
                                    const sy = (img.height - minSide) / 2;
                                    ctx.drawImage(
                                      img,
                                      sx,
                                      sy,
                                      minSide,
                                      minSide,
                                      0,
                                      0,
                                      size,
                                      size
                                    );
                                    onUpdateEmployee({
                                      photoDataUrl: canvas.toDataURL('image/jpeg', 0.8),
                                    });
                                  }
                                };
                                if (typeof reader.result === 'string') {
                                  img.src = reader.result;
                                }
                              };
                              reader.readAsDataURL(file);
                              e.target.value = '';
                            }}
                          />
                        </label>
                        {employee.photoDataUrl && (
                          <button
                            type="button"
                            onClick={() => onUpdateEmployee({ photoDataUrl: '' })}
                            className="min-h-[44px] rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* WINDOW 2: PAY & OT ENGINE */}
              {activeWindow === 'salary' && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {/* Visual Regular vs Daily Wages Cards */}
                  <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5">
                    <div className="text-xs font-semibold text-slate-800">
                      Employment Pay Rule
                    </div>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateSalaryConfig({ employmentType: 'regular' })
                        }
                        className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${
                          !isDailyWages
                            ? 'border-teal-700 bg-white shadow-sm'
                            : 'border-slate-200 bg-white/60 hover:bg-white'
                        }`}
                      >
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                            !isDailyWages
                              ? 'bg-teal-700 text-white'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          <Briefcase className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-bold text-slate-900">
                              Regular Salaried
                            </span>
                            {!isDailyWages && (
                              <CheckCircle2 className="h-4 w-4 text-teal-700 shrink-0" />
                            )}
                          </div>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            Sunday, Holiday &amp; Sick Leave Paid
                          </p>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const fallbackDaily = Math.round(
                            (salaryConfig.monthlySalary || 36400) /
                              Math.max(1, salaryConfig.daysInMonth || 30)
                          );
                          onUpdateSalaryConfig({
                            employmentType: 'daily_wages',
                            dailyWageRate:
                              salaryConfig.dailyWageRate !== undefined
                                ? salaryConfig.dailyWageRate
                                : fallbackDaily,
                          });
                        }}
                        className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${
                          isDailyWages
                            ? 'border-amber-600 bg-white shadow-sm'
                            : 'border-slate-200 bg-white/60 hover:bg-white'
                        }`}
                      >
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                            isDailyWages
                              ? 'bg-amber-600 text-white'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          <Clock className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-bold text-slate-900">
                              Daily Wages
                            </span>
                            {isDailyWages && (
                              <CheckCircle2 className="h-4 w-4 text-amber-600 shrink-0" />
                            )}
                          </div>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            Sun, Holiday &amp; Sick Leave Non-Paid
                          </p>
                        </div>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">
                      Select Month (Auto: {calendarDays} Days)
                    </label>
                    <input
                      type="month"
                      value={salaryConfig.salaryMonth || todayMeta.salaryMonth}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (!val || !val.includes('-')) return;
                        const isSecondHalf = (salaryConfig.periodId || '').startsWith(
                          '16'
                        );
                        const res = onSwitchPeriod(
                          val,
                          isSecondHalf ? 'second' : 'first',
                          false
                        );
                        if (res?.restoredFromSaved) {
                          onNotify?.(
                            `Restored saved entries & salary slip for period ${res.periodId}.`
                          );
                        } else if (res?.movedForward) {
                          onNotify?.(
                            `Period ${res.periodId}: Previous Remaining Loan PKR ${formatCurrency(
                              res.carriedLoan
                            )} carried to Total Loan.`
                          );
                        }
                      }}
                      className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">
                      Pay Period ID (15 Days)
                    </label>
                    <input
                      type="text"
                      value={salaryConfig.periodId}
                      onChange={(e) =>
                        onUpdateSalaryConfig({ periodId: e.target.value })
                      }
                      placeholder={todayMeta.periodId}
                      className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                    />
                  </div>

                  {isDailyWages ? (
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-700">
                        Per Day Salary (PKR / Day)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="50"
                        value={
                          salaryConfig.dailyWageRate !== undefined
                            ? salaryConfig.dailyWageRate || ''
                            : Math.round(
                                (salaryConfig.monthlySalary || 0) /
                                  Math.max(1, salaryConfig.daysInMonth || 30)
                              ) || ''
                        }
                        onChange={(e) =>
                          handleNumberChange('dailyWageRate', e.target.value)
                        }
                        placeholder="1500"
                        className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm font-semibold text-slate-900 tabular-nums focus:border-teal-700 focus:bg-white focus:outline-none"
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-700">
                        Basic Salary (PKR)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="100"
                        value={salaryConfig.monthlySalary || ''}
                        onChange={(e) =>
                          handleNumberChange('monthlySalary', e.target.value)
                        }
                        placeholder="30000"
                        className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm font-semibold text-slate-900 tabular-nums focus:border-teal-700 focus:bg-white focus:outline-none"
                      />
                    </div>
                  )}

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">
                      Monthly Allowance (PKR)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="100"
                      value={salaryConfig.allowances || ''}
                      onChange={(e) =>
                        handleNumberChange('allowances', e.target.value)
                      }
                      placeholder="6400"
                      className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm font-semibold text-slate-900 tabular-nums focus:border-teal-700 focus:bg-white focus:outline-none"
                    />
                  </div>

                  {/* Live Hourly Rate & Overtime Comparison Bar */}
                  {(() => {
                    const maxRate = Math.max(1, summary.otRate, summary.hourlyRate);
                    const basicBarW = (summary.hourlyRate / maxRate) * 100;
                    const otBarW = (summary.otRate / maxRate) * 100;
                    return (
                      <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-slate-700">
                            {isDailyWages
                              ? 'Per Day Salary (Daily Wages):'
                              : 'Total Monthly Salary (Basic + Allowance):'}
                          </span>
                          <span className="font-mono font-bold text-slate-900 tabular-nums">
                            PKR{' '}
                            {isDailyWages
                              ? `${formatCurrency(summary.dailyWageRate ?? 0)} / day`
                              : formatCurrency(summary.totalMonthlySalary)}
                          </span>
                        </div>

                        <div className="space-y-2 border-t border-slate-200/80 pt-2.5">
                          <div>
                            <div className="flex items-center justify-between text-[11px] mb-1">
                              <span className="text-slate-600">
                                {isDailyWages
                                  ? 'Basic Rate (Per Day / 8)'
                                  : `Basic Rate (Basic / ${salaryConfig.daysInMonth || 30} / 8)`}
                              </span>
                              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                                PKR {formatCurrency(summary.hourlyRate)}/hr
                              </span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                              <div
                                style={{ width: `${basicBarW}%` }}
                                className="h-full bg-slate-800 transition-all duration-300"
                              />
                            </div>
                          </div>

                          <div>
                            <div className="flex items-center justify-between text-[11px] mb-1">
                              <span className="text-slate-600">
                                OT Rate (Total Salary Rate)
                              </span>
                              <span className="font-mono font-semibold text-teal-700 tabular-nums">
                                PKR {formatCurrency(summary.otRate)}/hr
                              </span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                              <div
                                style={{ width: `${otBarW}%` }}
                                className="h-full bg-teal-600 transition-all duration-300"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* WINDOW 3: LOAN & LEDGER */}
              {activeWindow === 'loan' && (
                <div className="space-y-5">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
                    <span className="font-semibold text-slate-800">Note:</span> Personal offline salary deduction tracker only — <span className="font-semibold text-slate-800">this is not a loan app</span>.
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-700">
                        Total Loan Amount (PKR)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="100"
                        value={salaryConfig.totalLoan || ''}
                        onChange={(e) =>
                          handleNumberChange('totalLoan', e.target.value)
                        }
                        placeholder="0"
                        className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:bg-white focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-700">
                        Loan Deduction This Period (PKR)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="100"
                        value={salaryConfig.loanDeduction || ''}
                        onChange={(e) =>
                          handleNumberChange('loanDeduction', e.target.value)
                        }
                        placeholder="0"
                        className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:bg-white focus:outline-none"
                      />
                      {totalLoanVal > 0 && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateSalaryConfig({
                                loanDeduction: Math.round(totalLoanVal / 2),
                              })
                            }
                            className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            50%
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateSalaryConfig({ loanDeduction: totalLoanVal })
                            }
                            className="rounded-lg border border-teal-200 bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-800 hover:bg-teal-100"
                          >
                            Full Payoff
                          </button>
                          <button
                            type="button"
                            onClick={() => onUpdateSalaryConfig({ loanDeduction: 0 })}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-50"
                          >
                            Clear
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 space-y-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="text-xs font-semibold text-slate-700">
                            Remaining Loan Balance
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Total Loan − This Period Deduction (Carries forward as Total
                            Loan in the next cycle)
                          </div>
                        </div>
                        <div className="flex items-center justify-between sm:justify-end gap-3">
                          <div className="text-left sm:text-right">
                            <div className="font-mono text-lg font-bold text-slate-900 tabular-nums">
                              PKR {formatCurrency(summary.remainingLoan)}
                            </div>
                            {summary.loanExceedsTotal && (
                              <div className="text-[11px] font-medium text-amber-700">
                                Deduction exceeds total loan
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={onStartNextCycle}
                            className="inline-flex min-h-[36px] items-center gap-1 rounded-xl border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100 transition-colors whitespace-nowrap shrink-0"
                          >
                            <span>Next Cycle</span>
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="border-t border-slate-200/80 pt-2.5">
                        <div className="flex items-center justify-between text-[11px] font-mono text-slate-600 tabular-nums mb-1.5">
                          <span>
                            Paid This Cycle:{' '}
                            <strong className="text-teal-700">
                              {paidRatio.toFixed(0)}%
                            </strong>{' '}
                            (PKR {formatCurrency(deductionVal)})
                          </span>
                          <span>
                            Carry Forward:{' '}
                            <strong className="text-slate-900">
                              PKR {formatCurrency(summary.remainingLoan)}
                            </strong>
                          </span>
                        </div>
                        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                          <div
                            style={{ width: `${paidRatio}%` }}
                            className="bg-teal-600 transition-all duration-300"
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-700">
                        Advance Deduction (PKR)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="100"
                        value={salaryConfig.advanceDeduction || ''}
                        onChange={(e) =>
                          handleNumberChange('advanceDeduction', e.target.value)
                        }
                        placeholder="0"
                        className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:bg-white focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-700">
                        Other Deduction (PKR)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="100"
                        value={salaryConfig.otherDeduction || ''}
                        onChange={(e) =>
                          handleNumberChange('otherDeduction', e.target.value)
                        }
                        placeholder="0"
                        className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:bg-white focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Period-by-Period Loan Deduction Summary inside Loan Window */}
                  <LoanSummaryCard
                    workspace={activeWorkspace}
                    savedSlips={savedSlips}
                    allowManage
                    onUpsertPeriod={onUpsertLoanHistory}
                    onDeletePeriod={onDeleteLoanHistory}
                    onNotify={onNotify}
                  />
                </div>
              )}

              {/* WINDOW 4: BACKUP & PROFILES */}
              {activeWindow === 'backup' && (
                <div className="space-y-5">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                    <label
                      htmlFor="employee-selector"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Active Profile ({workspaces.length})
                    </label>
                    <select
                      id="employee-selector"
                      value={employee.id}
                      onChange={(e) => onSelectEmployee(e.target.value)}
                      className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-teal-700 focus:outline-none"
                    >
                      {workspaces.map((w, idx) => (
                        <option key={w.employee.id} value={w.employee.id}>
                          {w.employee.name || `Profile ${idx + 1}`} (
                          {w.employee.employeeId || 'No ID'})
                        </option>
                      ))}
                    </select>

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          onAddEmployee();
                          setBackupMessage(
                            'New profile added — switch to Profile window to enter details.'
                          );
                          setActiveWindow('profile');
                        }}
                        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors"
                      >
                        <Plus className="h-4 w-4 text-emerald-400" />
                        <span>Add New Profile</span>
                      </button>

                      {workspaces.length > 1 && (
                        <button
                          type="button"
                          onClick={() => onDeleteEmployee(employee.id)}
                          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                          <span>Delete Current Profile</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        Offline JSON Backup &amp; Restore
                      </h3>
                      <p className="text-xs text-slate-500">
                        Export all attendance, loan deductions, slips and settings into
                        one JSON file for safe storage.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={onExportBackup}
                        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 transition-colors"
                      >
                        <Download className="h-4 w-4 text-teal-700" />
                        <span>Download Backup JSON</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 transition-colors"
                      >
                        <Upload className="h-4 w-4 text-sky-700" />
                        <span>Restore from JSON</span>
                      </button>

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="application/json"
                        onChange={handleFileImport}
                        className="hidden"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Sticky Modal Footer */}
            <div className="shrink-0 flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3.5 pb-safe">
              <button
                type="button"
                onClick={() => setActiveWindow(null)}
                className="inline-flex min-h-[42px] items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => handleSave(true)}
                className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 py-2 text-xs font-bold text-white hover:bg-teal-800 transition-colors"
              >
                <Save className="h-4 w-4" />
                <span>Save &amp; Done</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
