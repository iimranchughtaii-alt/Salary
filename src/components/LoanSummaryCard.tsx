import React, { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  History,
  Image as ImageIcon,
  MessageCircle,
  Plus,
  Printer,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import type { EmployeeWorkspace, SavedSlipRecord } from '../types/payroll';
import {
  buildLoanSummary,
  buildWhatsAppLoanSummaryText,
} from '../utils/loanLedger';
import {
  downloadLoanLedgerJpg,
  downloadLoanLedgerPdf,
  shareLoanLedgerJpg,
} from '../utils/loanSlipGenerator';
import { openWhatsAppLink } from '../utils/nativeFileHelper';
import { formatCurrency } from '../utils/salaryMath';

interface LoanSummaryCardProps {
  workspace: EmployeeWorkspace;
  savedSlips: SavedSlipRecord[];
  allowManage?: boolean;
  showPrintToggle?: boolean;
  onUpsertPeriod?: (entry: {
    periodId: string;
    totalLoan: number;
    loanDeduction: number;
  }) => void;
  onDeletePeriod?: (periodId: string) => void;
  onNotify?: (message: string) => void;
}

export const LoanSummaryCard: React.FC<LoanSummaryCardProps> = ({
  workspace,
  savedSlips,
  allowManage = false,
  showPrintToggle = false,
  onUpsertPeriod,
  onDeletePeriod,
  onNotify,
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [periodInput, setPeriodInput] = useState('');
  const [totalLoanInput, setTotalLoanInput] = useState('');
  const [deductionInput, setDeductionInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [includeInPrint, setIncludeInPrint] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [loanJpgPreview, setLoanJpgPreview] = useState<{
    dataUrl: string;
    filename: string;
  } | null>(null);

  const ledger = useMemo(
    () => buildLoanSummary(workspace, savedSlips),
    [workspace, savedSlips]
  );

  const manualRemainingPreview = Math.max(
    0,
    (Number(totalLoanInput) || 0) - (Number(deductionInput) || 0)
  );

  const handleAddPeriod = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPeriod = periodInput.trim();
    if (!cleanPeriod || !onUpsertPeriod) return;
    const totalLoan = Math.max(0, Number(totalLoanInput) || 0);
    const loanDeduction = Math.max(0, Number(deductionInput) || 0);
    onUpsertPeriod({
      periodId: cleanPeriod,
      totalLoan,
      loanDeduction,
    });
    setPeriodInput('');
    setTotalLoanInput('');
    setDeductionInput('');
    setShowAddForm(false);
    onNotify?.(`Added loan record for Period ${cleanPeriod} — Click Save Changes to keep it.`);
  };

  const handleCopySummary = async () => {
    const text = buildWhatsAppLoanSummaryText(workspace.employee, ledger);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onNotify?.('Loan deduction summary copied.');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      onNotify?.('Clipboard unavailable — use WhatsApp button to share.');
    }
  };

  const handleSaveLoanJpg = async () => {
    setIsExporting(true);
    try {
      const res = await downloadLoanLedgerJpg(workspace.employee, ledger);
      setLoanJpgPreview({ dataUrl: res.dataUrl, filename: res.filename });
      if (res.savedToDevice) {
        onNotify?.(
          res.viaShareSheet
            ? `Saved / Shared Loan Slip: ${res.location}`
            : `Loan Slip saved to device: ${res.location}`
        );
      } else {
        onNotify?.(
          `Loan Slip JPG ready (${res.filename}) — Download started & preview open below.`
        );
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handleSaveLoanPdf = async () => {
    setIsExporting(true);
    try {
      const res = await downloadLoanLedgerPdf(workspace.employee, ledger);
      if (res.savedToDevice) {
        onNotify?.(
          res.viaShareSheet
            ? `Loan Ledger PDF Shared / Saved: ${res.location}`
            : `Loan Ledger PDF saved to device: ${res.location}`
        );
      } else {
        onNotify?.(`Loan Ledger PDF downloaded: ${res.filename}`);
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handleShareWhatsApp = async () => {
    setIsExporting(true);
    try {
      const res = await shareLoanLedgerJpg(workspace.employee, ledger);
      setLoanJpgPreview({ dataUrl: res.dataUrl, filename: res.filename });
      if (res.method === 'native-share' || res.method === 'web-share') {
        onNotify?.(`Share sheet opened for Loan Ledger Slip (${res.filename}).`);
      } else if (res.method === 'whatsapp-link') {
        onNotify?.(`Opening WhatsApp with Loan Ledger summary & ${res.filename} downloaded.`);
      }
    } finally {
      setIsExporting(false);
    }
  };

  const persistedPeriodSet = useMemo(
    () => new Set((workspace.loanHistory || []).map((h) => h.periodId.trim())),
    [workspace.loanHistory]
  );

  return (
    <section
      className={`${
        showPrintToggle && !includeInPrint ? 'no-print' : ''
      } rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-4`}
    >
      {/* Header Row */}
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-emerald-400">
            <History className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Loan Deduction Summary
            </h3>
            <p className="text-xs text-slate-500">
              Personal salary deduction ledger &amp; live remaining balance ·{' '}
              <span className="font-mono font-medium text-slate-700">
                {ledger.totalPeriodsCount} Period{ledger.totalPeriodsCount === 1 ? '' : 's'}
              </span>{' '}
              · This is not a loan app
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isExporting}
            onClick={handleSaveLoanJpg}
            className="no-print inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors whitespace-nowrap"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            <span>{isExporting ? 'Saving...' : 'Save JPG Slip'}</span>
          </button>

          <button
            type="button"
            disabled={isExporting}
            onClick={handleSaveLoanPdf}
            className="no-print inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60 transition-colors whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5 text-teal-700" />
            <span>Save PDF</span>
          </button>

          {showPrintToggle && (
            <button
              type="button"
              onClick={() => setIncludeInPrint((prev) => !prev)}
              className={`no-print inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                includeInPrint
                  ? 'border-teal-700 bg-teal-50 text-teal-800'
                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Printer className="h-3.5 w-3.5" />
              <span>{includeInPrint ? 'Print: Included' : 'Print: Off'}</span>
            </button>
          )}

          {allowManage && onUpsertPeriod && (
            <button
              type="button"
              onClick={() => setShowAddForm((prev) => !prev)}
              className="no-print inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 transition-colors whitespace-nowrap"
            >
              {showAddForm ? (
                <>
                  <X className="h-3.5 w-3.5" />
                  <span>Close</span>
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5 text-teal-700" />
                  <span>Add Past Period</span>
                </>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={handleCopySummary}
            className="no-print inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-600" />
            ) : (
              <Copy className="h-3.5 w-3.5 text-slate-500" />
            )}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button
            type="button"
            disabled={isExporting}
            onClick={handleShareWhatsApp}
            className="no-print inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-60 transition-colors whitespace-nowrap"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            <span>WhatsApp</span>
          </button>
        </div>
      </div>

      {/* Inline Loan Ledger JPG Slip Preview */}
      {loanJpgPreview && (
        <div className="no-print rounded-xl border border-teal-200 bg-slate-50/70 p-3.5 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-slate-900">
                Loan Ledger Slip Ready ({loanJpgPreview.filename})
              </div>
              <p className="text-[11px] text-slate-500">
                Download JPG, Share to WhatsApp, or press &amp; hold image to save
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isExporting}
                onClick={handleShareWhatsApp}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                <Share2 className="h-3.5 w-3.5" />
                <span>Share Slip</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  openWhatsAppLink(buildWhatsAppLoanSummaryText(workspace.employee, ledger))
                }
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                <span>WhatsApp Text</span>
              </button>
              <a
                href={loanJpgPreview.dataUrl}
                download={loanJpgPreview.filename}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download JPG</span>
              </a>
              <button
                type="button"
                onClick={() => setLoanJpgPreview(null)}
                aria-label="Close loan ledger JPG preview"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <img
              src={loanJpgPreview.dataUrl}
              alt={loanJpgPreview.filename}
              className="w-full h-auto block"
            />
          </div>
        </div>
      )}

      {/* 3-Metric Loan Overview Strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
          <div className="text-[11px] font-medium text-slate-500">
            Total Loan (Opening)
          </div>
          <div className="mt-0.5 font-mono text-base font-bold text-slate-900 tabular-nums">
            PKR {formatCurrency(ledger.openingTotalLoan)}
          </div>
        </div>

        <div className="rounded-xl border border-rose-200/80 bg-rose-50/50 px-4 py-3">
          <div className="text-[11px] font-medium text-rose-800">
            Total Deducted ({ledger.deductionPeriodsCount} Periods)
          </div>
          <div className="mt-0.5 font-mono text-base font-bold text-rose-700 tabular-nums">
            - PKR {formatCurrency(ledger.totalDeductedAllPeriods)}
          </div>
        </div>

        <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/50 px-4 py-3">
          <div className="text-[11px] font-medium text-emerald-900">
            Remaining Loan Balance
          </div>
          <div className="mt-0.5 font-mono text-base font-bold text-emerald-800 tabular-nums">
            PKR {formatCurrency(ledger.currentRemainingLoan)}
          </div>
        </div>
      </div>

      {/* Overall Loan Repayment Bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-600 tabular-nums">
          <span>
            Repaid Overall: <strong className="text-teal-800">{ledger.repaidPercent.toFixed(0)}%</strong>
          </span>
          <span>
            Balance Left: <strong className="text-slate-900">PKR {formatCurrency(ledger.currentRemainingLoan)}</strong>
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            style={{ width: `${ledger.repaidPercent}%` }}
            className="h-full bg-teal-600 transition-all duration-300"
          />
        </div>
      </div>

      {/* Optional Add Past Period Form */}
      {allowManage && showAddForm && onUpsertPeriod && (
        <form
          onSubmit={handleAddPeriod}
          className="no-print rounded-xl border border-teal-200 bg-teal-50/40 p-4 space-y-3"
        >
          <div className="text-xs font-semibold text-slate-900">
            Log Previous Period Loan Deduction
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-700">
                Period ID
              </label>
              <input
                type="text"
                required
                value={periodInput}
                onChange={(e) => setPeriodInput(e.target.value)}
                placeholder="16-31-10-2026"
                className="min-h-[42px] w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-700">
                Total Loan in Period (PKR)
              </label>
              <input
                type="number"
                min={0}
                step="100"
                required
                value={totalLoanInput}
                onChange={(e) => setTotalLoanInput(e.target.value)}
                placeholder="25000"
                className="min-h-[42px] w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-700">
                Deducted (PKR)
              </label>
              <input
                type="number"
                min={0}
                step="100"
                required
                value={deductionInput}
                onChange={(e) => setDeductionInput(e.target.value)}
                placeholder="5000"
                className="min-h-[42px] w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="font-mono text-xs text-slate-600 tabular-nums">
              Remaining after deduction: <strong className="text-slate-900">PKR {formatCurrency(manualRemainingPreview)}</strong>
            </span>
            <button
              type="submit"
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors"
            >
              <Plus className="h-3.5 w-3.5 text-emerald-400" />
              <span>Add to Summary</span>
            </button>
          </div>
        </form>
      )}

      {/* Period-by-Period History List / Table */}
      {ledger.rows.length === 0 ? (
        <div className="rounded-xl bg-slate-50 px-4 py-6 text-center text-xs text-slate-500">
          No loan deduction records yet. Enter Total Loan and Loan Deduction, then save or start the next cycle to track deductions and remaining balance by period here.
        </div>
      ) : (
        <>
          {/* Mobile Stacked Period Ledger (<640px) */}
          <div className="divide-y divide-slate-100 sm:hidden">
            {ledger.rows.map((row) => {
              const canDelete =
                allowManage &&
                !row.isCurrent &&
                Boolean(onDeletePeriod) &&
                persistedPeriodSet.has(row.periodId.trim());
              return (
                <div key={row.periodId} className="py-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-slate-900">
                          {row.periodId}
                        </span>
                        {row.isCurrent && (
                          <span className="text-[11px] font-semibold text-teal-700">
                            · Current
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono text-xs font-bold text-slate-900 tabular-nums">
                        Rem: {formatCurrency(row.remainingLoan)}
                      </span>
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => onDeletePeriod?.(row.periodId)}
                          aria-label={`Remove period ${row.periodId}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500">
                    <span>Loan: PKR {formatCurrency(row.totalLoan)}</span>
                    <span className="font-semibold text-rose-700">
                      Deducted: -PKR {formatCurrency(row.loanDeduction)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Tablet/Desktop Tabular Period Ledger (>=640px) */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] font-semibold text-slate-500">
                  <th className="py-2 pr-3">Period ID</th>
                  <th className="py-2 px-3 text-right">Period Loan</th>
                  <th className="py-2 px-3 text-right">Deducted</th>
                  <th className="py-2 pl-3 text-right">Remaining Loan</th>
                  {allowManage && <th className="w-10 py-2 pl-2 text-right" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                {ledger.rows.map((row) => {
                  const canDelete =
                    allowManage &&
                    !row.isCurrent &&
                    Boolean(onDeletePeriod) &&
                    persistedPeriodSet.has(row.periodId.trim());
                  return (
                    <tr
                      key={row.periodId}
                      className={row.isCurrent ? 'bg-teal-50/40' : 'hover:bg-slate-50/70'}
                    >
                      <td className="py-2.5 pr-3 font-semibold text-slate-900">
                        <span>{row.periodId}</span>
                        {row.isCurrent && (
                          <span className="ml-2 font-sans text-[11px] font-semibold text-teal-700">
                            · Current
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700">
                        PKR {formatCurrency(row.totalLoan)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-rose-700">
                        - PKR {formatCurrency(row.loanDeduction)}
                      </td>
                      <td className="py-2.5 pl-3 text-right font-bold text-slate-900">
                        PKR {formatCurrency(row.remainingLoan)}
                      </td>
                      {allowManage && (
                        <td className="py-2.5 pl-2 text-right">
                          {canDelete ? (
                            <button
                              type="button"
                              onClick={() => onDeletePeriod?.(row.periodId)}
                              aria-label={`Remove period ${row.periodId}`}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <span className="text-[10px] font-sans text-slate-400">
                              {row.isCurrent ? 'Active' : 'Slip'}
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50/70 font-mono font-bold tabular-nums">
                  <td className="py-2.5 pr-3 font-sans text-slate-800">
                    Total ({ledger.totalPeriodsCount} Periods)
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-700">
                    PKR {formatCurrency(ledger.openingTotalLoan)}
                  </td>
                  <td className="py-2.5 px-3 text-right text-rose-700">
                    - PKR {formatCurrency(ledger.totalDeductedAllPeriods)}
                  </td>
                  <td className="py-2.5 pl-3 text-right text-emerald-800">
                    PKR {formatCurrency(ledger.currentRemainingLoan)}
                  </td>
                  {allowManage && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </section>
  );
};
