import React, { useEffect, useState } from 'react';
import {
  BookmarkCheck,
  Calendar,
  CheckCircle2,
  Download,
  Image as ImageIcon,
  MessageCircle,
  Printer,
  Share2,
  Trash2,
  User,
  X,
} from 'lucide-react';
import type {
  EmployeeWorkspace,
  PayrollSummary,
  SavedSlipRecord,
} from '../types/payroll';
import {
  getCurrentCalendarPeriodMeta,
  parsePeriodId,
} from '../utils/calendarUtils';
import {
  buildWhatsAppSlipText,
  downloadSalarySlipJpg,
  shareSalarySlipJpg,
} from '../utils/jpgGenerator';
import { openWhatsAppLink } from '../utils/nativeFileHelper';
import { formatCurrency, formatHours } from '../utils/salaryMath';
import { LoanSummaryCard } from './LoanSummaryCard';

interface SalarySlipTabProps {
  workspace: EmployeeWorkspace;
  workspaces: EmployeeWorkspace[];
  summary: PayrollSummary;
  savedSlips: SavedSlipRecord[];
  savedPeriodIds?: string[];
  initialJpgPreview?: { dataUrl: string; filename: string } | null;
  onSelectEmployee: (id: string) => void;
  onSwitchPeriod?: (
    targetMonth: string,
    targetHalf: 'first' | 'second',
    preserveExistingAttendance?: boolean
  ) => {
    carriedLoan: number;
    movedForward: boolean;
    periodId: string;
    restoredFromSaved?: boolean;
  } | null;
  onSaveToHistory: () => void;
  onDeleteSavedSlip: (id: string) => void;
  onNotify?: (message: string) => void;
}

export const SalarySlipTab: React.FC<SalarySlipTabProps> = ({
  workspace,
  workspaces,
  summary,
  savedSlips,
  savedPeriodIds = [],
  initialJpgPreview,
  onSelectEmployee,
  onSwitchPeriod,
  onSaveToHistory,
  onDeleteSavedSlip,
  onNotify,
}) => {
  const { employee, salaryConfig, attendance } = workspace;
  const [downloadFeedback, setDownloadFeedback] = useState<string | null>(null);
  const [jpgPreview, setJpgPreview] = useState<{
    dataUrl: string;
    filename: string;
  } | null>(initialJpgPreview || null);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (initialJpgPreview) {
      setJpgPreview(initialJpgPreview);
    }
  }, [initialJpgPreview]);

  const showFeedback = (msg: string) => {
    setDownloadFeedback(msg);
    onNotify?.(msg);
    setTimeout(() => setDownloadFeedback(null), 5000);
  };

  const handleDownloadJpg = async () => {
    setIsExporting(true);
    try {
      const res = await downloadSalarySlipJpg(
        employee,
        salaryConfig,
        attendance,
        summary
      );
      setJpgPreview({ dataUrl: res.dataUrl, filename: res.filename });
      onSaveToHistory();
      if (res.savedToDevice) {
        showFeedback(
          res.viaShareSheet
            ? `Saved / Shared: ${res.location}`
            : `Saved to device: ${res.location}`
        );
      } else {
        showFeedback(
          `JPG Ready (${res.filename}) — Download started. Preview is also available below.`
        );
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handleShareWhatsApp = async () => {
    setIsExporting(true);
    try {
      const res = await shareSalarySlipJpg(
        employee,
        salaryConfig,
        attendance,
        summary
      );
      setJpgPreview({ dataUrl: res.dataUrl, filename: res.filename });
      onSaveToHistory();
      if (res.method === 'native-share' || res.method === 'web-share') {
        showFeedback(`Share sheet opened for WhatsApp (${res.filename}).`);
      } else if (res.method === 'whatsapp-link') {
        showFeedback(`Opening WhatsApp with Slip summary & ${res.filename} downloaded.`);
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadPdf = async () => {
    setIsExporting(true);
    try {
      const { downloadSalarySlipPdf } = await import('../utils/pdfGenerator');
      const res = await downloadSalarySlipPdf(
        employee,
        salaryConfig,
        attendance,
        summary
      );
      onSaveToHistory();
      if (res.savedToDevice) {
        showFeedback(
          res.viaShareSheet
            ? `PDF Shared / Saved: ${res.location}`
            : `PDF Saved to device: ${res.location}`
        );
      } else {
        showFeedback(`PDF Downloaded: ${res.filename}`);
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadSavedJpg = async (record: SavedSlipRecord) => {
    setIsExporting(true);
    try {
      const res = await downloadSalarySlipJpg(
        record.employee,
        record.salaryConfig,
        record.attendance,
        record.summary
      );
      setJpgPreview({ dataUrl: res.dataUrl, filename: res.filename });
      showFeedback(
        res.savedToDevice
          ? `Saved to device: ${res.location}`
          : `JPG Ready: ${res.filename}`
      );
    } finally {
      setIsExporting(false);
    }
  };

  const nowStr = new Date().toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).replace(/\//g, '-').replace(',', '');

  const [heroImgFailed, setHeroImgFailed] = useState(false);

  const firstRowDays = attendance.slice(0, 8);
  const secondRowDays = attendance.slice(8, 15);
  const isDailyWages = salaryConfig.employmentType === 'daily_wages';
  const bankEnabled = employee.bankAccountEnabled !== false;
  const todayMeta = getCurrentCalendarPeriodMeta();
  const selectablePeriods = Array.from(
    new Set([
      ...(salaryConfig.periodId ? [salaryConfig.periodId] : []),
      ...savedPeriodIds,
    ])
  );

  const handleSelectPeriod = (periodId: string) => {
    if (!onSwitchPeriod) return;
    const parsed = parsePeriodId(periodId);
    if (!parsed) return;
    const res = onSwitchPeriod(parsed.salaryMonth, parsed.half, false);
    setJpgPreview(null);
    if (res?.restoredFromSaved) {
      showFeedback(`Loaded saved slip & entries for period ${res.periodId}.`);
    } else if (res) {
      showFeedback(`Switched slip view to period ${res.periodId}.`);
    }
  };

  const handleJumpToday = () => {
    if (!onSwitchPeriod) return;
    const res = onSwitchPeriod(todayMeta.salaryMonth, todayMeta.half, false);
    setJpgPreview(null);
    if (res?.restoredFromSaved) {
      showFeedback(`Loaded saved slip for today's period (${res.periodId}).`);
    } else if (res) {
      showFeedback(`Switched to today's period (${res.periodId}).`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Executive Salary Slip Hero & Quick Export Bar */}
      <section className="no-print relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-teal-950 p-5 sm:p-6 text-white shadow-sm">
        {!heroImgFailed && (
          <img
            src="/src/assets/images/payroll_hero_surface_1795655964165.jpg"
            alt="Salary slip dark slate backdrop"
            referrerPolicy="no-referrer"
            onError={() => setHeroImgFailed(true)}
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-50"
          />
        )}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-slate-950/92 via-slate-950/80 to-slate-900/70"
        />

        <div className="relative space-y-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-300">
                <span className="font-mono font-semibold text-emerald-300">
                  {employee.employeeId || 'NO-ID'}
                </span>
                <span aria-hidden="true">·</span>
                <span>Period {salaryConfig.periodId || '15 Days'}</span>
                <span aria-hidden="true">·</span>
                <span className={isDailyWages ? 'font-semibold text-amber-300' : 'font-semibold text-teal-300'}>
                  {isDailyWages ? 'Daily Wages' : 'Regular'}
                </span>
                <span aria-hidden="true">·</span>
                <span>{bankEnabled ? 'Bank Transfer' : 'Cash'}</span>
              </div>
              <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white">
                {employee.name || 'Salary Slip Preview'}
              </h2>
              <p className="text-xs text-slate-300">
                Official Salary Payment Voucher · Save JPG to Gallery, Share on WhatsApp, or Export PDF
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-5 border-t border-white/10 pt-3 lg:border-t-0 lg:pt-0">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">
                  Net Payable
                </div>
                <div className="font-mono text-2xl font-bold text-white tabular-nums">
                  PKR {formatCurrency(summary.netSalary)}
                </div>
              </div>
              <div className="h-8 w-px bg-white/15 hidden sm:block" />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">
                  Paid Hours
                </div>
                <div className="font-mono text-base font-semibold text-emerald-300 tabular-nums">
                  {formatHours(summary.totalHours)}h ({summary.equivalentDays.toFixed(2)}d)
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3.5">
            {workspaces.length > 1 && (
              <select
                aria-label="Select Employee Slip"
                value={employee.id}
                onChange={(e) => onSelectEmployee(e.target.value)}
                className="min-h-[42px] rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white focus:border-emerald-400 focus:outline-none"
              >
                {workspaces.map((w, idx) => (
                  <option key={w.employee.id} value={w.employee.id} className="text-slate-900">
                    {w.employee.name || `New Employee ${idx + 1}`} ({w.employee.employeeId || 'No ID'})
                  </option>
                ))}
              </select>
            )}

            {onSwitchPeriod && selectablePeriods.length > 0 && (
              <select
                aria-label="Select Salary Slip Period"
                value={salaryConfig.periodId || todayMeta.periodId}
                onChange={(e) => handleSelectPeriod(e.target.value)}
                className="min-h-[42px] rounded-xl border border-white/20 bg-white/10 px-3 py-2 font-mono text-xs font-semibold text-white focus:border-emerald-400 focus:outline-none"
                title="Switch to any saved period to view its saved Salary Slip"
              >
                {selectablePeriods.map((pid) => (
                  <option key={pid} value={pid} className="text-slate-900">
                    {pid === todayMeta.periodId ? `${pid} (Current)` : pid}
                  </option>
                ))}
              </select>
            )}

            {onSwitchPeriod && salaryConfig.periodId !== todayMeta.periodId && (
              <button
                type="button"
                onClick={handleJumpToday}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/30 transition-colors whitespace-nowrap shrink-0"
                title={`Jump back to current calendar period (${todayMeta.periodId})`}
              >
                <Calendar className="h-3.5 w-3.5" />
                <span>Today ({todayMeta.shortLabel})</span>
              </button>
            )}

            <button
              type="button"
              disabled={isExporting}
              onClick={handleDownloadJpg}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-xs sm:text-sm font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
            >
              <ImageIcon className="h-4 w-4" />
              <span>{isExporting ? 'Saving...' : 'Save JPG Slip'}</span>
            </button>

            <button
              type="button"
              disabled={isExporting}
              onClick={handleShareWhatsApp}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
            >
              <MessageCircle className="h-4 w-4" />
              <span>Share to WhatsApp</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onSaveToHistory();
                showFeedback('Slip snapshot saved to offline history.');
              }}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/20 transition-colors whitespace-nowrap shrink-0"
            >
              <BookmarkCheck className="h-4 w-4 text-emerald-300" />
              <span>Save Copy</span>
            </button>

            <button
              type="button"
              disabled={isExporting}
              onClick={handleDownloadPdf}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="h-4 w-4 text-slate-300" />
              <span>Save PDF</span>
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20 transition-colors whitespace-nowrap shrink-0"
            >
              <Printer className="h-4 w-4 text-slate-300" />
              <span>Print</span>
            </button>
          </div>
        </div>
      </section>

      {downloadFeedback && (
        <div className="no-print flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-semibold text-teal-900">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-700" />
          <span>{downloadFeedback}</span>
        </div>
      )}

      {jpgPreview && (
        <section className="no-print rounded-2xl border border-teal-200 bg-white p-4 shadow-sm space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                JPG Slip Ready ({jpgPreview.filename})
              </h3>
              <p className="text-xs text-slate-500">
                Tap Share to WhatsApp, Download JPG, or press &amp; hold image to save to Gallery
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleShareWhatsApp}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                <Share2 className="h-3.5 w-3.5" />
                <span>Share to WhatsApp</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  openWhatsAppLink(buildWhatsAppSlipText(employee, salaryConfig, summary))
                }
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                <span>WhatsApp Text</span>
              </button>
              <a
                href={jpgPreview.dataUrl}
                download={jpgPreview.filename}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download JPG</span>
              </a>
              <button
                type="button"
                onClick={() => setJpgPreview(null)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100"
                aria-label="Close JPG preview"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
            <img
              src={jpgPreview.dataUrl}
              alt={jpgPreview.filename}
              className="w-full h-auto block"
            />
          </div>
        </section>
      )}

      {/* Authentic Paper Salary Slip Matching Reference Voucher */}
      <section className="mx-auto max-w-[820px] overflow-x-auto rounded-2xl border border-slate-300 bg-white p-5 sm:p-7 shadow-sm">
        <div className="min-w-[720px] text-slate-950 font-sans">
          {/* Top-most Header Row */}
          <div className="flex items-start justify-between text-xs">
            <div className="pt-2.5 font-medium text-slate-900 w-[26%]">
              User ID: <span className="ml-1 font-normal">{employee.userId || 'nadeem'}</span>
            </div>

            <div className="text-center flex-1">
              <h3 className="font-mono text-[15px] font-bold tracking-[0.14em] text-slate-950">
                SALARY PAYMENT [DETAIL]
              </h3>
              <div className="mt-1.5 text-xs font-bold text-slate-950">
                Pay Group: <span className="ml-6 uppercase tracking-wide">ACCOUNTS/FINANCE</span>
              </div>
            </div>

            <div className="text-right text-[11px] font-medium text-slate-800 w-[26%]">
              Page 1 of 1
            </div>
          </div>

          {/* Department / Section (left ~46%) + open center gap + Period ID / Print Date (right ~35%) */}
          <div className="mt-6 flex items-start justify-between text-xs">
            <div className="w-[46%] space-y-2">
              <div className="flex items-baseline gap-2.5">
                <span className="w-[82px] shrink-0 font-medium text-slate-900">Department:</span>
                <span className="flex-1 border-b border-slate-700 pb-0.5 font-bold uppercase tracking-wide text-slate-950">
                  {employee.department || '-'}
                </span>
              </div>
              <div className="flex items-baseline gap-2.5">
                <span className="w-[82px] shrink-0 font-medium text-slate-900">Section:</span>
                <span className="flex-1 border-b border-slate-700 pb-0.5 font-bold uppercase tracking-wide text-slate-950">
                  {employee.section || '-'}
                </span>
              </div>
            </div>

            <div className="w-[35%] space-y-2">
              <div className="flex items-baseline gap-2.5">
                <span className="w-[74px] shrink-0 font-medium text-slate-900">Period ID:</span>
                <span className="flex-1 border-b border-slate-700 pb-0.5 text-center font-mono font-bold tracking-wide text-slate-950">
                  {salaryConfig.periodId || '01-15'}
                </span>
              </div>
              <div className="flex items-baseline gap-2.5">
                <span className="w-[74px] shrink-0 font-medium text-slate-900">Print Date:</span>
                <span className="flex-1 border-b border-slate-700 pb-0.5 text-center font-mono text-[11px] text-slate-950">
                  {nowStr}
                </span>
              </div>
            </div>
          </div>

          {/* Divider Line */}
          <div className="mt-3 border-t-[1.5px] border-slate-950" />

          {/* Main Employee Block (51%) + Hours Table (29%) + Photo Box (14.5%) */}
          <div className="mt-2.5 flex items-stretch justify-between gap-[2.5%]">
            {/* Left Employee Details (~51%) */}
            <div className="w-[51%] flex flex-col justify-between py-0.5">
              <div className="flex items-center justify-between text-[13px] font-bold text-slate-950 mb-1.5">
                <span>{employee.bankAccountEnabled === false ? 'Cash' : 'Transfer To Bank'}</span>
                <span>
                  {salaryConfig.employmentType === 'daily_wages'
                    ? 'Daily Wages'
                    : 'Regular'}
                </span>
              </div>

              <div className="space-y-1.5 text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="w-[92px] shrink-0 font-bold text-slate-950">Emp ID:</span>
                    <span className="font-mono font-normal text-slate-950">
                      {employee.employeeId || '-'}
                    </span>
                  </div>
                  <span className="min-w-[82px] border-b border-slate-800 pl-4 pr-0.5 pb-0.5 text-right font-mono font-normal text-slate-950 tabular-nums">
                    {formatCurrency(summary.regularPay)}
                  </span>
                </div>

                <div className="flex items-baseline gap-2">
                  <span className="w-[92px] shrink-0 font-bold text-slate-950">Name:</span>
                  <span className="truncate font-normal uppercase text-slate-950">
                    {employee.name || '-'}
                  </span>
                </div>

                <div className="flex items-baseline gap-2">
                  <span className="w-[92px] shrink-0 font-bold text-slate-950">Father Name:</span>
                  <span className="truncate font-normal uppercase text-slate-950">
                    {employee.fatherName || '-'}
                  </span>
                </div>

                <div className="flex items-baseline gap-2">
                  <span className="w-[92px] shrink-0 font-bold text-slate-950">Designation:</span>
                  <span className="truncate font-normal uppercase text-slate-950">
                    {employee.designation || '-'}
                  </span>
                </div>
              </div>
            </div>

            {/* Center Hours Table (~29%) */}
            <div className="w-[29%] flex items-stretch">
              <table className="w-full border-collapse border border-slate-950 text-[11px] tabular-nums">
                <thead>
                  <tr>
                    <th className="w-[36%] border border-slate-950 px-1.5 py-1 text-center font-semibold text-slate-950">
                      Detail
                    </th>
                    <th className="w-[32%] border border-slate-950 px-1.5 py-1 text-center font-semibold text-slate-950">
                      Hours
                    </th>
                    <th className="w-[32%] border border-slate-950 px-1.5 py-1 text-center font-semibold text-slate-950">
                      Days
                    </th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  <tr>
                    <td className="border border-slate-950 px-1.5 py-0.5 font-sans text-slate-900">W. Hrs:</td>
                    <td className="border border-slate-950 px-1.5 py-0.5 text-right text-slate-950">
                      {formatHours(summary.totalRegularHours)}
                    </td>
                    <td className="border border-slate-950 px-1.5 py-0.5 text-right text-slate-950">
                      {(summary.totalRegularHours / 8).toFixed(2)}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-slate-950 px-1.5 py-0.5 font-sans text-slate-900">L. Hrs:</td>
                    <td className="border border-slate-950 px-1.5 py-0.5 text-right text-slate-950">
                      {formatHours(summary.totalLeaveHours)}
                    </td>
                    <td className="border border-slate-950 px-1.5 py-0.5 text-right text-slate-950">
                      {(summary.totalLeaveHours / 8).toFixed(2)}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-slate-950 px-1.5 py-0.5 font-sans text-slate-900">OT. Hrs:</td>
                    <td className="border border-slate-950 px-1.5 py-0.5 text-right text-slate-950">
                      {formatHours(summary.totalOtHours)}
                    </td>
                    <td className="border border-slate-950 px-1.5 py-0.5 text-right text-slate-950">
                      {(summary.totalOtHours / 8).toFixed(2)}
                    </td>
                  </tr>
                  <tr className="font-bold">
                    <td className="border border-slate-950 px-1.5 py-0.5 font-sans text-slate-950">Total:</td>
                    <td className="border border-slate-950 px-1.5 py-0.5 text-right text-slate-950">
                      {formatHours(summary.totalHours)}
                    </td>
                    <td className="border border-slate-950 px-1.5 py-0.5 text-right text-slate-950">
                      {summary.equivalentDays.toFixed(2)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Right Photo Frame (~14.5%) */}
            <div className="w-[14.5%] flex justify-end items-stretch">
              <div className="flex w-full min-h-[118px] items-center justify-center overflow-hidden border border-slate-900 bg-white">
                {employee.photoDataUrl ? (
                  <img
                    src={employee.photoDataUrl}
                    alt={employee.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center text-slate-400">
                    <User className="h-8 w-8" strokeWidth={1.5} />
                    <span className="mt-1 text-[9px] uppercase tracking-wider">Photo</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Horizontal Earnings & Deductions Line (Exact Voucher Proportional Widths) */}
          <div className="mt-3 flex items-baseline gap-2 text-xs">
            <div className="flex w-[22%] items-baseline gap-1 min-w-0">
              <span className="shrink-0 font-bold text-slate-950">Gross Salary:</span>
              <span className="flex-1 border-b border-slate-800 pb-0.5 pr-1 text-right font-mono font-normal text-slate-950 tabular-nums">
                {formatCurrency(summary.grossSalary)}
              </span>
            </div>
            <div className="flex w-[14%] items-baseline gap-1 min-w-0">
              <span className="shrink-0 font-bold text-slate-950">Allw.</span>
              <span className="flex-1 border-b border-slate-800 pb-0.5 pr-1 text-right font-mono font-normal text-slate-950 tabular-nums">
                {formatCurrency(summary.earnedAllowance)}
              </span>
            </div>
            <div className="flex w-[22%] items-baseline gap-1 min-w-0">
              <span className="shrink-0 font-bold text-slate-950">Ded.Adv:</span>
              <span className="flex-1 border-b border-slate-800 pb-0.5 pr-1 text-right font-mono font-normal text-slate-950 tabular-nums">
                {formatCurrency(summary.advanceDeduction)}
              </span>
            </div>
            <div className="flex w-[21%] items-baseline gap-1 min-w-0">
              <span className="shrink-0 font-bold text-slate-950">Ded.Loan:</span>
              <span className="flex-1 border-b border-slate-900 pb-0.5 pr-1 text-right font-mono font-normal text-slate-950 tabular-nums">
                {formatCurrency(summary.loanDeduction)}
              </span>
            </div>
            <div className="flex w-[21%] items-baseline gap-1 min-w-0">
              <span className="shrink-0 font-bold text-slate-950">Ded.Oth:</span>
              <span className="flex-1 border-b border-slate-800 pb-0.5 pr-1 text-right font-mono font-normal text-slate-950 tabular-nums">
                {formatCurrency(summary.otherDeduction)}
              </span>
            </div>
          </div>

          {/* Bank Account Row (Shown only for Bank Transfer; Payment Mode: CASH hidden on slip) */}
          {employee.bankAccountEnabled !== false && (
            <div className="mt-2.5 flex items-baseline text-xs">
              <div className="flex w-[34%] items-baseline gap-2 min-w-0">
                <span className="shrink-0 font-bold text-slate-950">Account No:</span>
                <span className="flex-1 border-b border-slate-700 px-2 pb-0.5 font-mono text-slate-950">
                  {employee.accountNo || '-'}
                </span>
              </div>
              <div className="w-[2%]" />
              <div className="flex w-[21%] items-baseline gap-2 min-w-0">
                <span className="shrink-0 text-slate-900">Branch No,:</span>
                <span className="flex-1 border-b border-slate-700 px-2 pb-0.5 font-mono text-slate-950">
                  {employee.branchNo || '-'}
                </span>
              </div>
              <div className="w-[4%]" />
              <div className="flex w-[39%] items-baseline gap-2 min-w-0">
                <span className="shrink-0 text-slate-900">Branch Name:</span>
                <span className="flex-1 border-b border-slate-700 px-2 pb-0.5 font-normal uppercase text-slate-950">
                  {employee.bankName || '-'}
                </span>
              </div>
            </div>
          )}

          {/* Net Salary & Thumb + Signature Row */}
          <div className="mt-3.5 flex items-center justify-between gap-6">
            <div className="flex items-center gap-3 w-[57%]">
              <span className="shrink-0 text-xs font-normal text-slate-950">
                Net Salary &amp; Thumb:
              </span>
              <div className="flex flex-1 border border-slate-950">
                <div className="flex h-14 w-1/2 items-center justify-center border-r border-slate-950 font-mono text-base font-bold text-slate-950 tabular-nums">
                  {formatCurrency(summary.netSalary)}
                </div>
                <div className="h-14 w-1/2" />
              </div>
            </div>

            <div className="w-[33%] pt-3">
              <div className="text-xs font-semibold text-slate-950">X</div>
              <div className="mt-0.5 border-t border-slate-950 pt-1 text-center text-[11px] font-medium uppercase tracking-wide text-slate-950">
                {employee.name || 'EMPLOYEE SIGNATURE'}
              </div>
            </div>
          </div>

          {/* Exact 2-Band 16-Slot Attendance Detail Table (01-08 & 09-15 + Blank 16th) */}
          <div className="mt-4">
            <table className="w-full table-fixed border-collapse border border-slate-950 text-[10px] font-mono tabular-nums">
              {[firstRowDays, secondRowDays].map((rowDays, rIdx) => (
                <tbody key={rIdx}>
                  <tr>
                    <td
                      rowSpan={3}
                      className="w-[12%] border border-slate-950 px-1 py-1.5 text-center font-sans text-xs font-bold text-slate-950"
                    >
                      Attendance
                      <br />
                      Detail
                    </td>
                    {Array.from({ length: 8 }).map((_, cIdx) => {
                      const d = rowDays[cIdx];
                      return (
                        <td
                          key={cIdx}
                          colSpan={2}
                          className="border-t border-r border-l border-slate-950 pt-1 pb-0.5 text-center text-[11px] font-bold text-slate-950"
                        >
                          {d ? d.dateLabel : ''}
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    {Array.from({ length: 8 }).map((_, cIdx) => (
                      <React.Fragment key={cIdx}>
                        <td className="border-l border-slate-950 px-0.5 py-0.5 text-center font-sans text-[8.5px] text-slate-800">
                          <div className="border border-slate-500 py-0.5 leading-none">
                            T. IN
                          </div>
                        </td>
                        <td className="border-r border-slate-950 px-0.5 py-0.5 text-center font-sans text-[8.5px] text-slate-800">
                          <div className="border border-slate-500 py-0.5 leading-none">
                            T. OUT
                          </div>
                        </td>
                      </React.Fragment>
                    ))}
                  </tr>
                  <tr>
                    {Array.from({ length: 8 }).map((_, cIdx) => {
                      const d = rowDays[cIdx];
                      if (!d) {
                        return (
                          <React.Fragment key={cIdx}>
                            <td className="border-b border-l border-slate-950 py-1.5" />
                            <td className="border-b border-r border-slate-950 py-1.5" />
                          </React.Fragment>
                        );
                      }
                      const isOffLabel =
                        (d.dayType === 'sunday' ||
                          d.dayType === 'holiday' ||
                          d.dayType === 'leave' ||
                          d.dayType === 'absent') &&
                        (!d.inTime || !d.outTime);

                      if (isOffLabel) {
                        const offLabel =
                          d.dayType === 'leave'
                            ? 'Sick Leave'
                            : d.dayType.charAt(0).toUpperCase() + d.dayType.slice(1);
                        return (
                          <td
                            key={cIdx}
                            colSpan={2}
                            className="border-b border-l border-r border-slate-950 py-1.5 text-center font-sans text-[10px] font-semibold text-slate-950"
                          >
                            {offLabel}
                          </td>
                        );
                      }
                      if (
                        (d.dayType === 'sunday' || d.dayType === 'holiday') &&
                        d.inTime &&
                        d.outTime
                      ) {
                        const workedOffLabel =
                          d.dayType === 'holiday' ? 'Holiday' : 'Sunday';
                        return (
                          <td
                            key={cIdx}
                            colSpan={2}
                            className="border-b border-l border-r border-slate-950 py-1 text-center"
                          >
                            <div className="font-sans text-[9px] font-bold leading-tight text-slate-800">
                              {workedOffLabel}
                            </div>
                            <div className="mt-0.5 grid grid-cols-2 text-[10px] leading-tight text-slate-950 font-semibold">
                              <span>{d.inTime}</span>
                              <span>{d.outTime}</span>
                            </div>
                          </td>
                        );
                      }
                      return (
                        <React.Fragment key={cIdx}>
                          <td className="border-b border-l border-slate-950 py-1.5 text-center text-[10px] font-medium text-slate-950">
                            {d.inTime || '--:--'}
                          </td>
                          <td className="border-b border-r border-slate-950 py-1.5 text-center text-[10px] font-medium text-slate-950">
                            {d.outTime || '--:--'}
                          </td>
                        </React.Fragment>
                      );
                    })}
                  </tr>
                </tbody>
              ))}
            </table>
          </div>
        </div>
      </section>

      {/* Loan Deduction Summary (All Periods & Remaining) */}
      <LoanSummaryCard
        workspace={workspace}
        savedSlips={savedSlips}
        showPrintToggle
        onNotify={onNotify}
      />

      {/* Saved Offline Slip History */}
      <section className="no-print rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Saved Offline Slip History
            </h3>
            <p className="text-xs text-slate-500">
              Cached locally on your device · Re-download PDF anytime without internet
            </p>
          </div>
        </div>

        {savedSlips.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-xs text-slate-500">
            No saved slips yet. Tap "Download PDF Slip" or "Save Copy" to archive this 15-day period offline.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {savedSlips.map((slip) => (
              <div
                key={slip.id}
                className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {slip.employee.name} · Period {slip.salaryConfig.periodId}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500 font-mono tabular-nums">
                    Net PKR {formatCurrency(slip.summary.netSalary)} · {formatHours(slip.summary.totalHours)} hrs · Remaining Loan PKR {formatCurrency(slip.summary.remainingLoan)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleDownloadSavedJpg(slip)}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    <ImageIcon className="h-3.5 w-3.5 text-teal-700" />
                    <span>JPG</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteSavedSlip(slip.id)}
                    className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-slate-200 px-2.5 py-1.5 text-rose-600 hover:bg-rose-50"
                    aria-label="Delete saved slip"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
