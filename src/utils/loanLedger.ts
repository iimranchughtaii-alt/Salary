import type {
  EmployeeDetails,
  EmployeeWorkspace,
  LoanHistoryEntry,
  SavedSlipRecord,
} from '../types/payroll';
import { getPeriodOrder } from './calendarUtils';
import { formatCurrency, round2 } from './salaryMath';

export interface LoanSummaryRow extends LoanHistoryEntry {
  isCurrent: boolean;
  hasUnsavedDifference?: boolean;
}

export interface LoanLedgerSummary {
  rows: LoanSummaryRow[];
  totalPeriodsCount: number;
  deductionPeriodsCount: number;
  openingTotalLoan: number;
  totalDeductedAllPeriods: number;
  currentRemainingLoan: number;
  repaidPercent: number;
}

/**
 * Computes a numeric chronological sort key from periodId (e.g. "01-15-11-2026" or "16-30-11-2026")
 * falling back to salaryMonth + half-month indicator.
 */
export function getPeriodSortKey(periodId: string, salaryMonth?: string): number {
  const match = periodId.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (match) {
    const startDay = Number(match[1]);
    const month = Number(match[3]);
    const year = Number(match[4]);
    if (year >= 1900 && month >= 1 && month <= 12) {
      return year * 24 + month * 2 + (startDay >= 16 ? 1 : 0);
    }
  }
  if (salaryMonth) {
    const isSecond = periodId.trim().startsWith('16');
    return getPeriodOrder(salaryMonth, isSecond);
  }
  return 0;
}

export function upsertLoanHistoryList(
  history: LoanHistoryEntry[] = [],
  entry: LoanHistoryEntry
): LoanHistoryEntry[] {
  const key = entry.periodId.trim();
  if (!key) return history;
  const normalized: LoanHistoryEntry = {
    ...entry,
    periodId: key,
    totalLoan: round2(Math.max(0, Number(entry.totalLoan) || 0)),
    loanDeduction: round2(Math.max(0, Number(entry.loanDeduction) || 0)),
    remainingLoan: round2(
      Math.max(
        0,
        Number.isFinite(entry.remainingLoan)
          ? entry.remainingLoan
          : Math.max(0, (Number(entry.totalLoan) || 0) - (Number(entry.loanDeduction) || 0))
      )
    ),
  };

  const filtered = history.filter((item) => item.periodId.trim() !== key);
  const next = [...filtered, normalized];
  next.sort(
    (a, b) =>
      getPeriodSortKey(a.periodId, a.salaryMonth) -
      getPeriodSortKey(b.periodId, b.salaryMonth)
  );
  return next;
}

export function buildLoanSummary(
  workspace: EmployeeWorkspace,
  savedSlips: SavedSlipRecord[] = []
): LoanLedgerSummary {
  const byPeriod = new Map<string, LoanSummaryRow>();
  const empId = workspace.employee.id;

  // 1. Seed from savedSlips for this employee (oldest first so newer overwrite if duplicated)
  const matchingSlips = savedSlips
    .filter((s) => s.employee.id === empId)
    .slice()
    .reverse();

  for (const slip of matchingSlips) {
    const periodKey = (slip.salaryConfig.periodId || '').trim();
    if (!periodKey) continue;
    const totalLoan = round2(Math.max(0, Number(slip.salaryConfig.totalLoan) || 0));
    const loanDeduction = round2(Math.max(0, Number(slip.salaryConfig.loanDeduction) || 0));
    if (totalLoan <= 0 && loanDeduction <= 0) continue;

    byPeriod.set(periodKey, {
      periodId: periodKey,
      salaryMonth: slip.salaryConfig.salaryMonth,
      totalLoan,
      loanDeduction,
      remainingLoan: round2(Math.max(0, totalLoan - loanDeduction)),
      recordedAt: slip.savedAt,
      source: 'slip',
      isCurrent: false,
    });
  }

  // 2. Overlay persisted workspace loanHistory entries (more authoritative than slip snapshots)
  for (const item of workspace.loanHistory || []) {
    const periodKey = (item.periodId || '').trim();
    if (!periodKey) continue;
    byPeriod.set(periodKey, {
      ...item,
      periodId: periodKey,
      totalLoan: round2(Math.max(0, Number(item.totalLoan) || 0)),
      loanDeduction: round2(Math.max(0, Number(item.loanDeduction) || 0)),
      remainingLoan: round2(Math.max(0, Number(item.remainingLoan) || 0)),
      isCurrent: false,
    });
  }

  // 3. Overlay current active workspace period live state
  const currentPeriodKey = (workspace.salaryConfig.periodId || '').trim();
  const currentTotalLoan = round2(Math.max(0, Number(workspace.salaryConfig.totalLoan) || 0));
  const currentDeduction = round2(Math.max(0, Number(workspace.salaryConfig.loanDeduction) || 0));
  const currentRemaining = round2(Math.max(0, currentTotalLoan - currentDeduction));

  if (currentPeriodKey && (currentTotalLoan > 0 || currentDeduction > 0 || byPeriod.has(currentPeriodKey))) {
    const existing = byPeriod.get(currentPeriodKey);
    if (currentTotalLoan > 0 || currentDeduction > 0) {
      byPeriod.set(currentPeriodKey, {
        periodId: currentPeriodKey,
        salaryMonth: workspace.salaryConfig.salaryMonth,
        totalLoan: currentTotalLoan,
        loanDeduction: currentDeduction,
        remainingLoan: currentRemaining,
        recordedAt: workspace.updatedAt || new Date().toISOString(),
        source: existing?.source || 'saved',
        isCurrent: true,
      });
    } else if (existing) {
      byPeriod.set(currentPeriodKey, {
        ...existing,
        isCurrent: true,
      });
    }
  }

  const rows = Array.from(byPeriod.values()).sort((a, b) => {
    const ka = getPeriodSortKey(a.periodId, a.salaryMonth);
    const kb = getPeriodSortKey(b.periodId, b.salaryMonth);
    if (ka !== kb) return ka - kb;
    return a.recordedAt.localeCompare(b.recordedAt);
  });

  const totalDeductedAllPeriods = round2(
    rows.reduce((sum, r) => sum + Math.max(0, r.loanDeduction), 0)
  );
  const deductionPeriodsCount = rows.filter((r) => r.loanDeduction > 0).length;

  const latestRow = rows[rows.length - 1];
  const currentRemainingLoan =
    currentTotalLoan > 0 || currentDeduction > 0
      ? currentRemaining
      : latestRow
      ? latestRow.remainingLoan
      : 0;

  // Original / cumulative principal covered across tracked history
  const firstOpening = rows.length > 0 ? rows[0].totalLoan : currentTotalLoan;
  const cumulativeTotal = round2(totalDeductedAllPeriods + currentRemainingLoan);
  const openingTotalLoan = round2(Math.max(firstOpening, cumulativeTotal, currentTotalLoan));

  const denominator = totalDeductedAllPeriods + currentRemainingLoan;
  const repaidPercent =
    denominator > 0 ? Math.min(100, round2((totalDeductedAllPeriods / denominator) * 100)) : 0;

  return {
    rows,
    totalPeriodsCount: rows.length,
    deductionPeriodsCount,
    openingTotalLoan,
    totalDeductedAllPeriods,
    currentRemainingLoan,
    repaidPercent,
  };
}

export function buildWhatsAppLoanSummaryText(
  employee: EmployeeDetails,
  ledger: LoanLedgerSummary
): string {
  const lines: string[] = [
    `*LOAN DEDUCTION SUMMARY*`,
    `Name: ${employee.name || '-'}`,
    `Emp ID: ${employee.employeeId || '-'}`,
    `-----------------------------`,
  ];

  if (ledger.rows.length === 0) {
    lines.push('No loan deduction periods recorded yet.');
  } else {
    ledger.rows.forEach((row, idx) => {
      const currentTag = row.isCurrent ? ' (Current)' : '';
      lines.push(
        `${idx + 1}. Period ${row.periodId}${currentTag}: Loan ${formatCurrency(
          row.totalLoan
        )} | Deducted -${formatCurrency(row.loanDeduction)} | Remaining ${formatCurrency(
          row.remainingLoan
        )}`
      );
    });
  }

  lines.push(
    `-----------------------------`,
    `Total Deducted (${ledger.deductionPeriodsCount} Periods): PKR ${formatCurrency(
      ledger.totalDeductedAllPeriods
    )}`,
    `*Current Remaining Loan: PKR ${formatCurrency(ledger.currentRemainingLoan)}*`
  );

  return lines.join('\n');
}
