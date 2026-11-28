import { useEffect, useRef, useState } from 'react';
import type {
  AttendanceDay,
  EmployeeDetails,
  EmployeeWorkspace,
  LoanHistoryEntry,
  PeriodSnapshot,
  SavedSlipRecord,
  SalaryAndLoanConfig,
} from '../types/payroll';
import {
  generateHalfMonthAttendance,
  getCurrentCalendarPeriodMeta,
  getDaysInSalaryMonth,
  getNextCycleMeta,
  getPeriodOrder,
  parseSalaryMonth,
} from '../utils/calendarUtils';
import { getPeriodSortKey, upsertLoanHistoryList } from '../utils/loanLedger';
import { calculatePayrollSummary } from '../utils/salaryMath';

const STORAGE_KEY_WORKSPACES = 'salarycalc_workspaces_v1';
const STORAGE_KEY_ACTIVE_ID = 'salarycalc_active_id_v1';
const STORAGE_KEY_SLIPS = 'salarycalc_saved_slips_v1';

function clonePeriodRecords(
  records?: Record<string, PeriodSnapshot>
): Record<string, PeriodSnapshot> {
  if (!records) return {};
  return Object.fromEntries(
    Object.entries(records).map(([key, snap]) => [
      key,
      {
        ...snap,
        salaryConfig: { ...snap.salaryConfig },
        attendance: snap.attendance.map((d) => ({ ...d })),
      },
    ])
  );
}

function cloneWorkspaces(list: EmployeeWorkspace[]): EmployeeWorkspace[] {
  return list.map((w) => ({
    ...w,
    employee: { ...w.employee },
    salaryConfig: { ...w.salaryConfig },
    attendance: w.attendance.map((d) => ({ ...d })),
    loanHistory: (w.loanHistory || []).map((h) => ({ ...h })),
    periodRecords: clonePeriodRecords(w.periodRecords),
  }));
}

function hasMeaningfulPeriodData(w: EmployeeWorkspace): boolean {
  const cfg = w.salaryConfig;
  if (
    (cfg.monthlySalary || 0) > 0 ||
    (cfg.dailyWageRate || 0) > 0 ||
    (cfg.allowances || 0) > 0 ||
    (cfg.totalLoan || 0) > 0 ||
    (cfg.loanDeduction || 0) > 0 ||
    (cfg.advanceDeduction || 0) > 0 ||
    (cfg.otherDeduction || 0) > 0
  ) {
    return true;
  }
  return w.attendance.some(
    (d) =>
      Boolean(d.inTime || d.outTime) ||
      d.dayType === 'holiday' ||
      d.dayType === 'leave' ||
      d.dayType === 'absent'
  );
}

function buildPeriodSnapshot(w: EmployeeWorkspace, savedAt: string): PeriodSnapshot {
  const periodId = (w.salaryConfig.periodId || '').trim();
  const salaryMonth =
    w.salaryConfig.salaryMonth || getCurrentCalendarPeriodMeta().salaryMonth;
  return {
    periodId,
    salaryMonth,
    salaryConfig: { ...w.salaryConfig },
    attendance: w.attendance.map((d) => ({ ...d })),
    savedAt,
  };
}

function upsertPeriodSnapshot(
  records: Record<string, PeriodSnapshot> | undefined,
  w: EmployeeWorkspace,
  savedAt: string,
  forceSaveEvenIfEmpty = false
): Record<string, PeriodSnapshot> {
  const next = clonePeriodRecords(records);
  const key = (w.salaryConfig.periodId || '').trim();
  if (!key) return next;
  if (forceSaveEvenIfEmpty || hasMeaningfulPeriodData(w) || Boolean(next[key])) {
    next[key] = buildPeriodSnapshot(w, savedAt);
  }
  return next;
}

function recordWorkspacePeriodLoan(
  w: EmployeeWorkspace,
  source: LoanHistoryEntry['source'],
  recordedAt: string
): LoanHistoryEntry[] {
  const existing = w.loanHistory || [];
  const totalLoan = Math.max(0, Number(w.salaryConfig.totalLoan) || 0);
  const loanDeduction = Math.max(0, Number(w.salaryConfig.loanDeduction) || 0);
  const periodId = (w.salaryConfig.periodId || '').trim();
  if (!periodId || (totalLoan <= 0 && loanDeduction <= 0)) {
    return existing;
  }
  return upsertLoanHistoryList(existing, {
    periodId,
    salaryMonth: w.salaryConfig.salaryMonth,
    totalLoan,
    loanDeduction,
    remainingLoan: Math.max(0, totalLoan - loanDeduction),
    recordedAt,
    source,
  });
}

export function createDefault15Days(): AttendanceDay[] {
  const meta = getCurrentCalendarPeriodMeta();
  return generateHalfMonthAttendance(meta.salaryMonth, meta.half).map((d) => ({
    ...d,
    inTime: '',
    outTime: '',
  }));
}

export function createSeedWorkspace(): EmployeeWorkspace {
  const meta = getCurrentCalendarPeriodMeta();
  return {
    employee: {
      id: 'emp-default-1',
      name: '',
      employeeId: '',
      fatherName: '',
      designation: '',
      department: '',
      section: '',
      payGroup: 'Accounts / Finance',
      cnic: '',
      phone: '',
      joiningDate: '',
      bankAccountEnabled: true,
      bankName: '',
      branchNo: '',
      accountNo: '',
      userId: 'nadeem',
      photoDataUrl: '',
    },
    salaryConfig: {
      periodId: meta.periodId,
      salaryMonth: meta.salaryMonth,
      employmentType: 'regular',
      monthlySalary: 0,
      daysInMonth: meta.daysInMonth,
      allowances: 0,
      totalLoan: 0,
      loanDeduction: 0,
      advanceDeduction: 0,
      otherDeduction: 0,
    },
    attendance: createDefault15Days(),
    loanHistory: [],
    periodRecords: {},
    lastAutoSyncedPeriodId: meta.periodId,
    updatedAt: new Date().toISOString(),
  };
}

export function createBlankWorkspace(index: number): EmployeeWorkspace {
  const meta = getCurrentCalendarPeriodMeta();
  return {
    employee: {
      id: `emp-${Date.now()}-${index}`,
      name: '',
      employeeId: '',
      fatherName: '',
      designation: '',
      department: '',
      section: '',
      payGroup: 'Accounts / Finance',
      cnic: '',
      phone: '',
      joiningDate: '',
      bankAccountEnabled: true,
      bankName: '',
      branchNo: '',
      accountNo: '',
      userId: 'nadeem',
      photoDataUrl: '',
    },
    salaryConfig: {
      periodId: meta.periodId,
      salaryMonth: meta.salaryMonth,
      employmentType: 'regular',
      monthlySalary: 0,
      daysInMonth: meta.daysInMonth,
      allowances: 0,
      totalLoan: 0,
      loanDeduction: 0,
      advanceDeduction: 0,
      otherDeduction: 0,
    },
    attendance: createDefault15Days(),
    loanHistory: [],
    periodRecords: {},
    lastAutoSyncedPeriodId: meta.periodId,
    updatedAt: new Date().toISOString(),
  };
}

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function getSavedPeriodIdsForWorkspace(
  w: EmployeeWorkspace,
  savedSlips: SavedSlipRecord[]
): string[] {
  const ids = new Set<string>();
  const activePid = (w.salaryConfig.periodId || '').trim();
  if (activePid) ids.add(activePid);
  Object.keys(w.periodRecords || {}).forEach((k) => {
    if (k.trim()) ids.add(k.trim());
  });
  savedSlips
    .filter((s) => s.employee.id === w.employee.id)
    .forEach((s) => {
      const pid = (s.salaryConfig.periodId || '').trim();
      if (pid) ids.add(pid);
    });
  return Array.from(ids).sort(
    (a, b) => getPeriodSortKey(b) - getPeriodSortKey(a)
  );
}

export function usePayrollStorage() {
  const initialSlips = loadFromStorage<SavedSlipRecord[]>(STORAGE_KEY_SLIPS, []);
  const pendingAutoArchivedSlipsRef = useRef<SavedSlipRecord[]>([]);

  const [savedWorkspaces, setSavedWorkspaces] = useState<EmployeeWorkspace[]>(() => {
    const loaded = loadFromStorage<EmployeeWorkspace[]>(STORAGE_KEY_WORKSPACES, []);
    if (loaded.length === 0) {
      return [createSeedWorkspace()];
    }

    let sourceList = loaded;
    try {
      const migrated = localStorage.getItem('salarycalc_blank_init_v1');
      if (
        !migrated &&
        loaded.length === 1 &&
        loaded[0].employee.id === 'emp-default-1' &&
        loaded[0].employee.name === 'Muhammad Imran Akram' &&
        loaded[0].employee.employeeId === '015-093-142' &&
        loaded[0].employee.joiningDate === '2021-03-15' &&
        loaded[0].employee.cnic === '35202-4819201-7'
      ) {
        const blank = [createSeedWorkspace()];
        localStorage.setItem('salarycalc_blank_init_v1', '1');
        localStorage.setItem(STORAGE_KEY_WORKSPACES, JSON.stringify(blank));
        return blank;
      }
      if (!migrated) {
        localStorage.setItem('salarycalc_blank_init_v1', '1');
      }
    } catch {
      // Ignore storage errors
    }

    const todayMeta = getCurrentCalendarPeriodMeta();
    const todayOrder = getPeriodOrder(
      todayMeta.salaryMonth,
      todayMeta.half === 'second'
    );
    const nowIso = new Date().toISOString();
    let didAutoSync = false;

    const normalized = sourceList.map((rawW) => {
      const w: EmployeeWorkspace = {
        ...rawW,
        employee: {
          ...rawW.employee,
          payGroup: rawW.employee.payGroup || 'Accounts / Finance',
          userId: rawW.employee.userId || 'nadeem',
        },
        salaryConfig: {
          ...rawW.salaryConfig,
          salaryMonth: rawW.salaryConfig.salaryMonth || todayMeta.salaryMonth,
          daysInMonth: getDaysInSalaryMonth(
            rawW.salaryConfig.salaryMonth || todayMeta.salaryMonth
          ),
        },
        attendance: (rawW.attendance || []).map((d) => ({ ...d })),
        loanHistory: (rawW.loanHistory || []).map((h) => ({ ...h })),
        periodRecords: clonePeriodRecords(rawW.periodRecords),
      };

      // Ensure outgoing/current period is captured in periodRecords if it has data
      let nextRecords = upsertPeriodSnapshot(w.periodRecords, w, w.updatedAt || nowIso);

      // Auto-select today's calendar period once when calendar rolls into a newer cycle
      if (w.lastAutoSyncedPeriodId !== todayMeta.periodId) {
        const wHalfSecond =
          Number(w.attendance[0]?.dateLabel || '01') >= 16 ||
          (w.salaryConfig.periodId || '').startsWith('16');
        const wOrder = getPeriodOrder(w.salaryConfig.salaryMonth, wHalfSecond);

        if (todayOrder > wOrder) {
          didAutoSync = true;
          const meaningful = hasMeaningfulPeriodData(w);
          const nextLoanHistory = recordWorkspacePeriodLoan(w, 'cycle', nowIso);

          if (
            meaningful &&
            ((w.salaryConfig.monthlySalary || 0) > 0 ||
              (w.salaryConfig.dailyWageRate || 0) > 0)
          ) {
            const outgoingPid = (w.salaryConfig.periodId || '').trim();
            const alreadyInSlips = initialSlips.some(
              (s) =>
                s.employee.id === w.employee.id &&
                (s.salaryConfig.periodId || '').trim() === outgoingPid
            );
            if (!alreadyInSlips && outgoingPid) {
              const summary = calculatePayrollSummary(w.salaryConfig, w.attendance);
              pendingAutoArchivedSlipsRef.current.push({
                id: `slip-auto-${w.employee.id}-${outgoingPid}-${Date.now()}`,
                savedAt: nowIso,
                employee: { ...w.employee },
                salaryConfig: { ...w.salaryConfig },
                attendance: w.attendance.map((d) => ({ ...d })),
                summary,
              });
            }
          }

          const existingTodaySnap = nextRecords[todayMeta.periodId];
          if (existingTodaySnap) {
            return {
              ...w,
              salaryConfig: {
                ...existingTodaySnap.salaryConfig,
                daysInMonth: todayMeta.daysInMonth,
              },
              attendance: existingTodaySnap.attendance.map((d) => ({ ...d })),
              loanHistory: nextLoanHistory,
              periodRecords: nextRecords,
              lastAutoSyncedPeriodId: todayMeta.periodId,
              updatedAt: nowIso,
            };
          }

          const remainingLoan = Math.max(
            0,
            Number(w.salaryConfig.totalLoan || 0) -
              Number(w.salaryConfig.loanDeduction || 0)
          );
          const nextDeduction =
            remainingLoan === 0
              ? 0
              : Math.min(Number(w.salaryConfig.loanDeduction || 0), remainingLoan);
          const hasPunchesOrSalary =
            (w.salaryConfig.monthlySalary || 0) > 0 ||
            (w.salaryConfig.dailyWageRate || 0) > 0 ||
            w.attendance.some((d) => Boolean(d.inTime || d.outTime));

          return {
            ...w,
            salaryConfig: {
              ...w.salaryConfig,
              salaryMonth: todayMeta.salaryMonth,
              daysInMonth: todayMeta.daysInMonth,
              periodId: todayMeta.periodId,
              totalLoan: remainingLoan,
              loanDeduction: nextDeduction,
              advanceDeduction: 0,
              otherDeduction: 0,
            },
            attendance: hasPunchesOrSalary
              ? generateHalfMonthAttendance(todayMeta.salaryMonth, todayMeta.half)
              : createDefault15Days(),
            loanHistory: nextLoanHistory,
            periodRecords: nextRecords,
            lastAutoSyncedPeriodId: todayMeta.periodId,
            updatedAt: nowIso,
          };
        }

        didAutoSync = true;
        return {
          ...w,
          periodRecords: nextRecords,
          lastAutoSyncedPeriodId: todayMeta.periodId,
        };
      }

      return {
        ...w,
        periodRecords: nextRecords,
      };
    });

    if (didAutoSync) {
      try {
        localStorage.setItem(STORAGE_KEY_WORKSPACES, JSON.stringify(normalized));
      } catch {
        // Ignore storage quota issues
      }
    }

    return normalized;
  });

  const [workspaces, setWorkspaces] = useState<EmployeeWorkspace[]>(() =>
    cloneWorkspaces(savedWorkspaces)
  );

  const [savedActiveId, setSavedActiveId] = useState<string>(() => {
    const saved = loadFromStorage<string>(STORAGE_KEY_ACTIVE_ID, '');
    return saved || 'emp-default-1';
  });

  const [activeId, setActiveIdState] = useState<string>(() => savedActiveId);

  const [savedSlips, setSavedSlips] = useState<SavedSlipRecord[]>(() => {
    if (pendingAutoArchivedSlipsRef.current.length > 0) {
      const merged = [...pendingAutoArchivedSlipsRef.current, ...initialSlips].slice(
        0,
        50
      );
      pendingAutoArchivedSlipsRef.current = [];
      return merged;
    }
    return initialSlips;
  });

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const isDirtyRef = useRef(false);

  const activeWorkspace =
    workspaces.find((w) => w.employee.id === activeId) || workspaces[0];

  const savedActiveWorkspace =
    savedWorkspaces.find((w) => w.employee.id === savedActiveId) || savedWorkspaces[0];

  const markDirty = () => {
    if (!isDirtyRef.current) {
      isDirtyRef.current = true;
      setHasUnsavedChanges(true);
    }
  };

  const clearDirty = () => {
    if (isDirtyRef.current) {
      isDirtyRef.current = false;
    }
    setHasUnsavedChanges(false);
  };

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SLIPS, JSON.stringify(savedSlips));
    } catch {
      // Ignore quota issues cleanly
    }
  }, [savedSlips]);

  const setActiveId = (nextId: string) => {
    setActiveIdState(nextId);
    if (!isDirtyRef.current) {
      setSavedActiveId(nextId);
      try {
        localStorage.setItem(STORAGE_KEY_ACTIVE_ID, JSON.stringify(nextId));
      } catch {
        // Ignore quota issues
      }
    }
  };

  const updateEmployee = (patch: Partial<EmployeeDetails>) => {
    if (!activeWorkspace) return;
    markDirty();
    setWorkspaces((prev) =>
      prev.map((w) =>
        w.employee.id === activeWorkspace.employee.id
          ? {
              ...w,
              employee: { ...w.employee, ...patch },
            }
          : w
      )
    );
  };

  const updateSalaryConfig = (patch: Partial<SalaryAndLoanConfig>) => {
    if (!activeWorkspace) return;
    markDirty();
    setWorkspaces((prev) =>
      prev.map((w) => {
        if (w.employee.id !== activeWorkspace.employee.id) return w;
        const fallbackMonth = getCurrentCalendarPeriodMeta().salaryMonth;
        const nextMonth = patch.salaryMonth ?? w.salaryConfig.salaryMonth ?? fallbackMonth;
        return {
          ...w,
          salaryConfig: {
            ...w.salaryConfig,
            ...patch,
            daysInMonth: getDaysInSalaryMonth(nextMonth),
          },
        };
      })
    );
  };

  const updateAttendanceDay = (dayNumber: number, patch: Partial<AttendanceDay>) => {
    if (!activeWorkspace) return;
    markDirty();
    setWorkspaces((prev) =>
      prev.map((w) =>
        w.employee.id === activeWorkspace.employee.id
          ? {
              ...w,
              attendance: w.attendance.map((d) =>
                d.dayNumber === dayNumber ? { ...d, ...patch } : d
              ),
            }
          : w
      )
    );
  };

  const replaceAttendance = (nextAttendance: AttendanceDay[]) => {
    if (!activeWorkspace) return;
    markDirty();
    setWorkspaces((prev) =>
      prev.map((w) =>
        w.employee.id === activeWorkspace.employee.id
          ? {
              ...w,
              attendance: nextAttendance,
            }
          : w
      )
    );
  };

  const switchPeriod = (
    targetMonth: string,
    targetHalf: 'first' | 'second',
    preserveExistingAttendance = false
  ): {
    carriedLoan: number;
    movedForward: boolean;
    periodId: string;
    restoredFromSaved: boolean;
  } | null => {
    if (!activeWorkspace) return null;
    const { year, month } = parseSalaryMonth(targetMonth);
    const autoDays = new Date(year, month, 0).getDate();
    const mStr = String(month).padStart(2, '0');
    const nextPeriodId =
      targetHalf === 'second'
        ? `16-${autoDays}-${mStr}-${year}`
        : `01-15-${mStr}-${year}`;

    const currentPid = (activeWorkspace.salaryConfig.periodId || '').trim();
    if (currentPid === nextPeriodId) {
      return {
        carriedLoan: 0,
        movedForward: false,
        periodId: nextPeriodId,
        restoredFromSaved: false,
      };
    }

    const baseSaved = savedActiveWorkspace || activeWorkspace;
    const currentHalfSecond =
      Number(activeWorkspace.attendance[0]?.dateLabel || '01') >= 16 ||
      (activeWorkspace.salaryConfig.periodId || '').startsWith('16');
    const currentOrder = getPeriodOrder(
      activeWorkspace.salaryConfig.salaryMonth,
      currentHalfSecond
    );
    const targetOrder = getPeriodOrder(targetMonth, targetHalf === 'second');
    const movedForward = targetOrder > currentOrder;
    const outgoingRemainingLoan = Math.max(
      0,
      Number(activeWorkspace.salaryConfig.totalLoan || 0) -
        Number(activeWorkspace.salaryConfig.loanDeduction || 0)
    );

    const existingSnap = activeWorkspace.periodRecords?.[nextPeriodId];
    const slipMatch = !existingSnap
      ? savedSlips.find(
          (s) =>
            s.employee.id === activeWorkspace.employee.id &&
            (s.salaryConfig.periodId || '').trim() === nextPeriodId
        )
      : undefined;
    const restoredFromSaved = Boolean(existingSnap || slipMatch);

    const nowIso = new Date().toISOString();
    const wasDirty = isDirtyRef.current;

    const applyPeriodSwitch = (list: EmployeeWorkspace[]): EmployeeWorkspace[] =>
      list.map((w) => {
        if (w.employee.id !== activeWorkspace.employee.id) return w;

        // 1. Always preserve outgoing period snapshot in periodRecords
        const updatedRecords = upsertPeriodSnapshot(w.periodRecords, w, nowIso);
        let nextLoanHistory = w.loanHistory || [];
        if (movedForward) {
          nextLoanHistory = recordWorkspacePeriodLoan(w, 'cycle', nowIso);
        }

        // 2. Restore from saved PeriodSnapshot or SavedSlipRecord if available
        const snap = updatedRecords[nextPeriodId];
        if (snap) {
          return {
            ...w,
            salaryConfig: {
              ...snap.salaryConfig,
              salaryMonth: targetMonth,
              daysInMonth: autoDays,
              periodId: nextPeriodId,
            },
            attendance: snap.attendance.map((d) => ({ ...d })),
            loanHistory: nextLoanHistory,
            periodRecords: updatedRecords,
            updatedAt: nowIso,
          };
        }

        if (slipMatch) {
          return {
            ...w,
            salaryConfig: {
              ...slipMatch.salaryConfig,
              salaryMonth: targetMonth,
              daysInMonth: autoDays,
              periodId: nextPeriodId,
            },
            attendance: slipMatch.attendance.map((d) => ({ ...d })),
            loanHistory: nextLoanHistory,
            periodRecords: updatedRecords,
            updatedAt: nowIso,
          };
        }

        // 3. Unvisited period: generate calendar & carry loan if moving forward
        const nextSalaryConfig: SalaryAndLoanConfig = {
          ...w.salaryConfig,
          salaryMonth: targetMonth,
          daysInMonth: autoDays,
          periodId: nextPeriodId,
        };

        if (movedForward) {
          nextSalaryConfig.totalLoan = outgoingRemainingLoan;
          nextSalaryConfig.loanDeduction =
            outgoingRemainingLoan === 0
              ? 0
              : Math.min(
                  Number(w.salaryConfig.loanDeduction || 0),
                  outgoingRemainingLoan
                );
          nextSalaryConfig.advanceDeduction = 0;
          nextSalaryConfig.otherDeduction = 0;
        } else {
          // Moving to an unvisited earlier period keeps base pay but clears period-specific deductions
          nextSalaryConfig.advanceDeduction = 0;
          nextSalaryConfig.otherDeduction = 0;
        }

        const hasPunchesOrSalary =
          (baseSaved.salaryConfig.monthlySalary || 0) > 0 ||
          (baseSaved.salaryConfig.dailyWageRate || 0) > 0 ||
          w.attendance.some((d) => Boolean(d.inTime || d.outTime));

        return {
          ...w,
          salaryConfig: nextSalaryConfig,
          loanHistory: nextLoanHistory,
          periodRecords: updatedRecords,
          attendance: hasPunchesOrSalary || preserveExistingAttendance
            ? generateHalfMonthAttendance(
                targetMonth,
                targetHalf,
                preserveExistingAttendance ? w.attendance : undefined
              )
            : generateHalfMonthAttendance(targetMonth, targetHalf).map((d) => ({
                ...d,
                inTime: '',
                outTime: '',
              })),
          updatedAt: nowIso,
        };
      });

    if (wasDirty) {
      setWorkspaces((prev) => applyPeriodSwitch(prev));
    } else {
      const nextList = applyPeriodSwitch(workspaces);
      const committed = cloneWorkspaces(nextList);
      setWorkspaces(committed);
      setSavedWorkspaces(cloneWorkspaces(committed));
      try {
        localStorage.setItem(STORAGE_KEY_WORKSPACES, JSON.stringify(committed));
      } catch {
        // Ignore quota issues
      }
    }

    return {
      carriedLoan: outgoingRemainingLoan,
      movedForward,
      periodId: nextPeriodId,
      restoredFromSaved,
    };
  };

  const startNextCycle = (): { periodId: string; carriedLoan: number } | null => {
    if (!activeWorkspace) return null;
    const isSecondHalf =
      Number(activeWorkspace.attendance[0]?.dateLabel || '01') >= 16 ||
      (activeWorkspace.salaryConfig.periodId || '').startsWith('16');
    const nextMeta = getNextCycleMeta(
      activeWorkspace.salaryConfig.salaryMonth,
      isSecondHalf ? 'second' : 'first'
    );
    const remainingLoan = Math.max(
      0,
      Number(activeWorkspace.salaryConfig.totalLoan || 0) -
        Number(activeWorkspace.salaryConfig.loanDeduction || 0)
    );
    const nextDeduction =
      remainingLoan === 0
        ? 0
        : Math.min(
            Number(activeWorkspace.salaryConfig.loanDeduction || 0),
            remainingLoan
          );

    const nowIso = new Date().toISOString();

    // Auto-archive outgoing cycle slip if it has salary configured and isn't already archived
    const outgoingPid = (activeWorkspace.salaryConfig.periodId || '').trim();
    if (
      outgoingPid &&
      ((activeWorkspace.salaryConfig.monthlySalary || 0) > 0 ||
        (activeWorkspace.salaryConfig.dailyWageRate || 0) > 0)
    ) {
      const existsInSlips = savedSlips.some(
        (s) =>
          s.employee.id === activeWorkspace.employee.id &&
          (s.salaryConfig.periodId || '').trim() === outgoingPid
      );
      if (!existsInSlips) {
        const summary = calculatePayrollSummary(
          activeWorkspace.salaryConfig,
          activeWorkspace.attendance
        );
        const autoSlip: SavedSlipRecord = {
          id: `slip-cycle-${Date.now()}`,
          savedAt: nowIso,
          employee: { ...activeWorkspace.employee },
          salaryConfig: { ...activeWorkspace.salaryConfig },
          attendance: activeWorkspace.attendance.map((d) => ({ ...d })),
          summary,
        };
        setSavedSlips((prev) => [autoSlip, ...prev].slice(0, 50));
      }
    }

    const nextList = workspaces.map((w) => {
      if (w.employee.id !== activeWorkspace.employee.id) return w;
      const recordedHistory = recordWorkspacePeriodLoan(w, 'cycle', nowIso);
      const updatedRecords = upsertPeriodSnapshot(w.periodRecords, w, nowIso, true);
      const existingNextSnap = updatedRecords[nextMeta.periodId];
      if (existingNextSnap) {
        return {
          ...w,
          loanHistory: recordedHistory,
          periodRecords: updatedRecords,
          salaryConfig: {
            ...existingNextSnap.salaryConfig,
            daysInMonth: nextMeta.daysInMonth,
          },
          attendance: existingNextSnap.attendance.map((d) => ({ ...d })),
          updatedAt: nowIso,
        };
      }

      return {
        ...w,
        loanHistory: recordedHistory,
        periodRecords: updatedRecords,
        salaryConfig: {
          ...w.salaryConfig,
          salaryMonth: nextMeta.salaryMonth,
          daysInMonth: nextMeta.daysInMonth,
          periodId: nextMeta.periodId,
          totalLoan: remainingLoan,
          loanDeduction: nextDeduction,
          advanceDeduction: 0,
          otherDeduction: 0,
        },
        attendance: generateHalfMonthAttendance(
          nextMeta.salaryMonth,
          nextMeta.half
        ),
        updatedAt: nowIso,
      };
    });

    const committed = cloneWorkspaces(nextList);
    setWorkspaces(committed);
    setSavedWorkspaces(cloneWorkspaces(committed));
    clearDirty();
    try {
      localStorage.setItem(STORAGE_KEY_WORKSPACES, JSON.stringify(committed));
    } catch {
      // Ignore quota issues
    }

    return {
      periodId: nextMeta.periodId,
      carriedLoan: remainingLoan,
    };
  };

  const addEmployee = () => {
    const next = createBlankWorkspace(workspaces.length + 1);
    markDirty();
    setWorkspaces((prev) => [...prev, next]);
    setActiveIdState(next.employee.id);
  };

  const deleteEmployee = (id: string) => {
    if (workspaces.length <= 1) return;
    const filtered = workspaces.filter((w) => w.employee.id !== id);
    const nextActiveId =
      activeId === id && filtered[0] ? filtered[0].employee.id : activeId;
    const committed = cloneWorkspaces(filtered);
    setWorkspaces(committed);
    setSavedWorkspaces(committed);
    setActiveIdState(nextActiveId);
    setSavedActiveId(nextActiveId);
    clearDirty();
    try {
      localStorage.setItem(STORAGE_KEY_WORKSPACES, JSON.stringify(committed));
      localStorage.setItem(STORAGE_KEY_ACTIVE_ID, JSON.stringify(nextActiveId));
    } catch {
      // Ignore quota issues
    }
  };

  const saveCurrentSlipToHistory = () => {
    const source = isDirtyRef.current ? savedActiveWorkspace : activeWorkspace;
    if (!source) return;
    const summary = calculatePayrollSummary(source.salaryConfig, source.attendance);
    const record: SavedSlipRecord = {
      id: `slip-${Date.now()}`,
      savedAt: new Date().toISOString(),
      employee: { ...source.employee },
      salaryConfig: { ...source.salaryConfig },
      attendance: source.attendance.map((d) => ({ ...d })),
      summary,
    };
    setSavedSlips((prev) => [record, ...prev].slice(0, 50));
  };

  const deleteSavedSlip = (slipId: string) => {
    setSavedSlips((prev) => prev.filter((s) => s.id !== slipId));
  };

  const exportBackupJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      workspaces: savedWorkspaces,
      savedSlips,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `salarycalc_offline_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importBackupJson = (jsonText: string): boolean => {
    try {
      const parsed = JSON.parse(jsonText);
      const fallbackMonth = getCurrentCalendarPeriodMeta().salaryMonth;
      if (Array.isArray(parsed.workspaces) && parsed.workspaces.length > 0) {
        const committed = cloneWorkspaces(parsed.workspaces).map((w) => ({
          ...w,
          salaryConfig: {
            ...w.salaryConfig,
            daysInMonth: getDaysInSalaryMonth(
              w.salaryConfig.salaryMonth || fallbackMonth
            ),
          },
        }));
        const firstId = committed[0].employee.id;
        setWorkspaces(committed);
        setSavedWorkspaces(committed);
        setActiveIdState(firstId);
        setSavedActiveId(firstId);
        clearDirty();
        localStorage.setItem(STORAGE_KEY_WORKSPACES, JSON.stringify(committed));
        localStorage.setItem(STORAGE_KEY_ACTIVE_ID, JSON.stringify(firstId));
      }
      if (Array.isArray(parsed.savedSlips)) {
        setSavedSlips(parsed.savedSlips);
      }
      return true;
    } catch {
      return false;
    }
  };

  const upsertLoanHistoryEntry = (entry: {
    periodId: string;
    totalLoan: number;
    loanDeduction: number;
  }) => {
    if (!activeWorkspace) return;
    const cleanPeriodId = entry.periodId.trim();
    if (!cleanPeriodId) return;
    const totalLoan = Math.max(0, Number(entry.totalLoan) || 0);
    const loanDeduction = Math.max(0, Number(entry.loanDeduction) || 0);
    const remainingLoan = Math.max(0, totalLoan - loanDeduction);
    const nowIso = new Date().toISOString();

    markDirty();
    setWorkspaces((prev) =>
      prev.map((w) => {
        if (w.employee.id !== activeWorkspace.employee.id) return w;
        const isCurrentPeriod =
          (w.salaryConfig.periodId || '').trim() === cleanPeriodId;
        return {
          ...w,
          salaryConfig: isCurrentPeriod
            ? { ...w.salaryConfig, totalLoan, loanDeduction }
            : w.salaryConfig,
          loanHistory: upsertLoanHistoryList(w.loanHistory || [], {
            periodId: cleanPeriodId,
            totalLoan,
            loanDeduction,
            remainingLoan,
            recordedAt: nowIso,
            source: 'manual',
          }),
        };
      })
    );
  };

  const deleteLoanHistoryEntry = (periodId: string) => {
    if (!activeWorkspace) return;
    const cleanPeriodId = periodId.trim();
    markDirty();
    setWorkspaces((prev) =>
      prev.map((w) =>
        w.employee.id === activeWorkspace.employee.id
          ? {
              ...w,
              loanHistory: (w.loanHistory || []).filter(
                (h) => h.periodId.trim() !== cleanPeriodId
              ),
            }
          : w
      )
    );
  };

  const forceSave = () => {
    try {
      const nowIso = new Date().toISOString();
      const stamped = workspaces.map((w) => ({
        ...w,
        employee: { ...w.employee },
        salaryConfig: { ...w.salaryConfig },
        attendance: w.attendance.map((d) => ({ ...d })),
        loanHistory: recordWorkspacePeriodLoan(w, 'saved', nowIso),
        periodRecords: upsertPeriodSnapshot(w.periodRecords, w, nowIso, true),
        updatedAt: nowIso,
      }));
      localStorage.setItem(STORAGE_KEY_WORKSPACES, JSON.stringify(stamped));
      const targetId = activeWorkspace?.employee.id || savedActiveId;
      localStorage.setItem(STORAGE_KEY_ACTIVE_ID, JSON.stringify(targetId));
      setWorkspaces(stamped);
      setSavedWorkspaces(cloneWorkspaces(stamped));
      setSavedActiveId(targetId);

      // Sync any already-archived slip for the active period so Saved Offline Slip History stays fresh
      const activeAfter = stamped.find((w) => w.employee.id === targetId);
      if (activeAfter) {
        const pid = (activeAfter.salaryConfig.periodId || '').trim();
        setSavedSlips((prev) =>
          prev.map((s) => {
            if (
              s.employee.id === activeAfter.employee.id &&
              (s.salaryConfig.periodId || '').trim() === pid
            ) {
              return {
                ...s,
                savedAt: nowIso,
                employee: { ...activeAfter.employee },
                salaryConfig: { ...activeAfter.salaryConfig },
                attendance: activeAfter.attendance.map((d) => ({ ...d })),
                summary: calculatePayrollSummary(
                  activeAfter.salaryConfig,
                  activeAfter.attendance
                ),
              };
            }
            return s;
          })
        );
      }

      clearDirty();
      return true;
    } catch {
      return false;
    }
  };

  const discardChanges = () => {
    const restored = cloneWorkspaces(savedWorkspaces);
    setWorkspaces(restored);
    setActiveIdState(savedActiveId);
    clearDirty();
  };

  const savedPeriodIds = getSavedPeriodIdsForWorkspace(activeWorkspace, savedSlips);

  return {
    workspaces,
    savedWorkspaces,
    activeWorkspace,
    savedActiveWorkspace,
    activeId: activeWorkspace.employee.id,
    setActiveId,
    savedSlips,
    savedPeriodIds,
    hasUnsavedChanges,
    isDirtyRef,
    updateEmployee,
    updateSalaryConfig,
    updateAttendanceDay,
    replaceAttendance,
    switchPeriod,
    startNextCycle,
    addEmployee,
    deleteEmployee,
    saveCurrentSlipToHistory,
    deleteSavedSlip,
    upsertLoanHistoryEntry,
    deleteLoanHistoryEntry,
    exportBackupJson,
    importBackupJson,
    forceSave,
    discardChanges,
  };
}
