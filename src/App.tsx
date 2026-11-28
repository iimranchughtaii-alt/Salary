import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  FolderGit2,
  Image as ImageIcon,
  Mail,
  Phone,
  RotateCcw,
  Save,
  Settings,
  ShieldCheck,
  WifiOff,
  X,
} from 'lucide-react';
import { AttendanceTab } from './components/AttendanceTab';
import { PWAInstallButton } from './components/PWAInstallButton';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { usePayrollStorage } from './hooks/usePayrollStorage';
import { calculatePayrollSummary, formatCurrency } from './utils/salaryMath';

const CalculatorTab = lazy(() =>
  import('./components/CalculatorTab').then((m) => ({ default: m.CalculatorTab }))
);
const SalarySlipTab = lazy(() =>
  import('./components/SalarySlipTab').then((m) => ({ default: m.SalarySlipTab }))
);
const GitHubApkTab = lazy(() =>
  import('./components/GitHubApkTab').then((m) => ({ default: m.GitHubApkTab }))
);

type ActiveTab = 'attendance' | 'slip' | 'settings' | 'github';

const NAV_ITEMS: { id: ActiveTab; label: string; shortLabel: string; icon: typeof Clock }[] = [
  { id: 'attendance', label: 'Time Entry', shortLabel: 'Time Entry', icon: Clock },
  { id: 'slip', label: 'PaySlip', shortLabel: 'PaySlip', icon: FileText },
  { id: 'settings', label: 'Settings', shortLabel: 'Settings', icon: Settings },
  { id: 'github', label: 'Developer Settings', shortLabel: 'Developer', icon: FolderGit2 },
];

export default function App() {
  const showDeveloperTab = useMemo(() => {
    if (import.meta.env.VITE_IS_NATIVE_BUILD === 'true') {
      return false;
    }
    try {
      if (Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'web') {
        return false;
      }
    } catch {
      // Ignore if Capacitor bridge is unavailable
    }
    if (typeof window !== 'undefined') {
      const cap = (
        window as Window & {
          Capacitor?: { isNativePlatform?: () => boolean };
        }
      ).Capacitor;
      if (cap?.isNativePlatform?.()) {
        return false;
      }
      const { protocol, hostname } = window.location;
      if (protocol === 'capacitor:' || protocol === 'file:' || protocol === 'app:') {
        return false;
      }
      // Always keep Developer tab visible inside AI Studio & web preview
      if (
        hostname.endsWith('.run.app') ||
        hostname.includes('aistudio') ||
        window.self !== window.top
      ) {
        return true;
      }
      const ua = window.navigator.userAgent || '';
      // Capacitor / Cordova Android WebView or wrapped Android WebView (; wv)
      if (
        /\bwv\b/i.test(ua) ||
        (hostname === 'localhost' && /Android|iPhone|iPad|iPod/i.test(ua))
      ) {
        return false;
      }
      // Installed Android WebAPK / PWA or TWA (standalone/fullscreen)
      if (
        document.referrer.startsWith('android-app://') ||
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
        window.matchMedia?.(
          '(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)'
        )?.matches
      ) {
        return false;
      }
    }
    return true;
  }, []);

  const visibleNavItems = useMemo(
    () =>
      showDeveloperTab
        ? NAV_ITEMS
        : NAV_ITEMS.filter((item) => item.id !== 'github'),
    [showDeveloperTab]
  );

  const [activeTab, setActiveTab] = useState<ActiveTab>('attendance');

  useEffect(() => {
    if (!showDeveloperTab && activeTab === 'github') {
      setActiveTab('attendance');
    }
  }, [showDeveloperTab, activeTab]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [quickJpgPreview, setQuickJpgPreview] = useState<{
    dataUrl: string;
    filename: string;
  } | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const toastTimerRef = useRef<number | null>(null);
  const isOnline = useOnlineStatus();

  const notify = (message: string) => {
    setToastMessage(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  const {
    workspaces,
    savedWorkspaces,
    activeWorkspace,
    savedActiveWorkspace,
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
  } = usePayrollStorage();

  const draftSummary = useMemo(
    () =>
      calculatePayrollSummary(
        activeWorkspace.salaryConfig,
        activeWorkspace.attendance
      ),
    [activeWorkspace.salaryConfig, activeWorkspace.attendance]
  );

  const savedSummary = useMemo(
    () =>
      calculatePayrollSummary(
        savedActiveWorkspace.salaryConfig,
        savedActiveWorkspace.attendance
      ),
    [savedActiveWorkspace.salaryConfig, savedActiveWorkspace.attendance]
  );

  const runGuardedAction = (action: () => void) => {
    if (isDirtyRef.current) {
      setPendingAction(() => action);
      return;
    }
    action();
  };

  const handleSaveAndRunPending = () => {
    forceSave();
    const act = pendingAction;
    setPendingAction(null);
    notify('Changes saved successfully!');
    if (act) {
      act();
    }
  };

  const handleDiscardAndRunPending = () => {
    discardChanges();
    const act = pendingAction;
    setPendingAction(null);
    notify('Unsaved changes discarded.');
    if (act) {
      act();
    }
  };

  const handleStartNextCycle = () => {
    runGuardedAction(() => {
      const res = startNextCycle();
      if (res) {
        notify(
          `Next cycle (${res.periodId}) started! Remaining Loan PKR ${formatCurrency(
            res.carriedLoan
          )} is now set as Total Loan — click Save Now to keep changes.`
        );
      }
    });
  };

  const handleQuickJpgDownload = async () => {
    const { downloadSalarySlipJpg } = await import('./utils/jpgGenerator');
    const res = await downloadSalarySlipJpg(
      savedActiveWorkspace.employee,
      savedActiveWorkspace.salaryConfig,
      savedActiveWorkspace.attendance,
      savedSummary
    );
    setQuickJpgPreview({ dataUrl: res.dataUrl, filename: res.filename });
    setActiveTab('slip');
    saveCurrentSlipToHistory();
    notify(
      res.savedToDevice
        ? res.viaShareSheet
          ? `Slip saved / shared: ${res.location}`
          : `Saved to device: ${res.location}`
        : `Slip JPG ready (${res.filename}) — preview opened below.`
    );
  };

  return (
    <div className="min-h-screen bg-[#F3F6F5] text-slate-900 flex flex-col">
      {/* Top Navigation Bar (Desktop 3-Zone Contract + Compact Mobile Header) */}
      <header className="no-print sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-13 lg:h-16 max-w-7xl items-center justify-between gap-8 px-4 sm:px-6">
          {/* Zone 1: Brand Logo + Single-line Wordmark */}
          <button
            type="button"
            onClick={() => runGuardedAction(() => setActiveTab('attendance'))}
            className="inline-flex items-center gap-2.5 text-left whitespace-nowrap shrink-0 group"
          >
            <img
              src="/pwa-192x192.png"
              alt="Payroll logo"
              className="h-8 w-8 rounded-xl object-cover shadow-sm ring-1 ring-slate-900/10 transition-transform group-hover:scale-105"
            />
            <span className="text-base sm:text-lg font-bold tracking-tight text-slate-900">
              Payroll
            </span>
          </button>

          {/* Zone 2: Desktop Teal Segmented Nav Switcher */}
          <nav
            aria-label="Primary Desktop Navigation"
            className="hidden lg:flex items-center gap-1 rounded-2xl border border-slate-200/80 bg-slate-100/90 p-1 text-xs font-semibold"
          >
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => runGuardedAction(() => setActiveTab(item.id))}
                  className={`inline-flex min-h-[38px] items-center gap-2 rounded-xl px-4 py-1.5 transition-all whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-teal-700 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-white hover:text-slate-900'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 ${active ? 'text-white' : 'text-slate-400'}`}
                    strokeWidth={active ? 2.2 : 1.8}
                  />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Primary CTA (+ Install trigger on mobile/PWA-ready browsers) */}
          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton variant="compact" />
            <button
              type="button"
              onClick={() => runGuardedAction(() => { void handleQuickJpgDownload(); })}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-teal-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              <span>Save JPG</span>
            </button>
          </div>
        </div>
      </header>

      {/* Unsaved Changes Lock Banner (Manual Save Only) */}
      {hasUnsavedChanges && (
        <div className="no-print border-b border-amber-300 bg-amber-50 px-4 py-2.5">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 font-semibold text-amber-950">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
              <span>Unsaved changes — Please save before switching tabs or performing another action.</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  discardChanges();
                  notify('Changes discarded.');
                }}
                className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 py-1 font-semibold text-amber-900 hover:bg-amber-100"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Discard</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  forceSave();
                  notify('Changes saved successfully!');
                }}
                className="inline-flex min-h-[34px] items-center gap-1 rounded-lg bg-slate-900 px-3 py-1 font-semibold text-white hover:bg-slate-800"
              >
                <Save className="h-3.5 w-3.5 text-teal-400" />
                <span>Save Now</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Offline Mode Notice (shown only when offline) */}
      {!isOnline && (
        <div className="no-print border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-900">
          <span className="inline-flex items-center gap-1.5">
            <WifiOff className="h-3.5 w-3.5" />
            <span>Offline Mode — All employee records and JPG slip generation continue working locally.</span>
          </span>
        </div>
      )}

      {/* Unsaved Changes Guard Modal (Blocks switching / actions until Save or Discard) */}
      {pendingAction && (
        <div className="no-print fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Unsaved Changes
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  You have unsaved edits in your entries or settings. Please <strong>Save</strong> or <strong>Discard</strong> before switching tabs or continuing.
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                className="inline-flex min-h-[42px] items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel (Stay)
              </button>
              <button
                type="button"
                onClick={handleDiscardAndRunPending}
                className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Discard</span>
              </button>
              <button
                type="button"
                onClick={handleSaveAndRunPending}
                className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800"
              >
                <Save className="h-3.5 w-3.5" />
                <span>Save &amp; Continue</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Save / Download Confirmation Notice */}
      {toastMessage && (
        <div className="no-print fixed bottom-20 lg:bottom-6 left-1/2 z-[60] w-[calc(100%-2rem)] max-w-md -translate-x-1/2">
          <div className="flex items-center gap-2.5 rounded-xl border border-teal-700 bg-slate-900 px-4 py-3 text-xs font-semibold text-white shadow-lg">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-400" />
            <span>{toastMessage}</span>
          </div>
        </div>
      )}

      {/* Main Content Canvas */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 pb-24 sm:px-6 lg:py-8 lg:pb-12">
        {activeTab === 'attendance' && (
          <AttendanceTab
            employeeName={activeWorkspace.employee.name}
            employeeId={activeWorkspace.employee.employeeId}
            salaryConfig={activeWorkspace.salaryConfig}
            attendance={activeWorkspace.attendance}
            summary={draftSummary}
            savedPeriodIds={savedPeriodIds}
            onUpdateDay={updateAttendanceDay}
            onReplaceAttendance={replaceAttendance}
            onSwitchPeriod={switchPeriod}
            onStartNextCycle={handleStartNextCycle}
            onSaveTimesheet={forceSave}
            onGoToSlip={() => runGuardedAction(() => setActiveTab('slip'))}
            onGoToSettings={() => runGuardedAction(() => setActiveTab('settings'))}
            onNotify={notify}
          />
        )}

        <Suspense
          fallback={
            <div className="space-y-4 py-4">
              <div className="h-28 w-full animate-pulse rounded-2xl bg-slate-200/70" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="h-44 animate-pulse rounded-2xl bg-slate-200/60" />
                <div className="h-44 animate-pulse rounded-2xl bg-slate-200/60" />
              </div>
            </div>
          }
        >
          {activeTab === 'settings' && (
            <CalculatorTab
              workspaces={workspaces}
              activeWorkspace={activeWorkspace}
              summary={draftSummary}
              savedSlips={savedSlips}
              onSelectEmployee={(id) => runGuardedAction(() => setActiveId(id))}
              onAddEmployee={() => runGuardedAction(() => addEmployee())}
              onDeleteEmployee={(id) => runGuardedAction(() => deleteEmployee(id))}
              onUpdateEmployee={updateEmployee}
              onUpdateSalaryConfig={updateSalaryConfig}
              onSwitchPeriod={switchPeriod}
              onStartNextCycle={handleStartNextCycle}
              onSaveSettings={forceSave}
              onUpsertLoanHistory={upsertLoanHistoryEntry}
              onDeleteLoanHistory={deleteLoanHistoryEntry}
              onExportBackup={exportBackupJson}
              onImportBackup={(json) => {
                if (isDirtyRef.current) {
                  setPendingAction(() => () => importBackupJson(json));
                  return false;
                }
                return importBackupJson(json);
              }}
              onGoToAttendance={() => runGuardedAction(() => setActiveTab('attendance'))}
              onGoToSlip={() => runGuardedAction(() => setActiveTab('slip'))}
              onNotify={notify}
            />
          )}

          {activeTab === 'slip' && (
            <SalarySlipTab
              workspace={savedActiveWorkspace}
              workspaces={savedWorkspaces}
              summary={savedSummary}
              savedSlips={savedSlips}
              savedPeriodIds={savedPeriodIds}
              initialJpgPreview={quickJpgPreview}
              onSelectEmployee={(id) => runGuardedAction(() => setActiveId(id))}
              onSwitchPeriod={(targetMonth, targetHalf, preserve) => {
                if (isDirtyRef.current) {
                  runGuardedAction(() => {
                    switchPeriod(targetMonth, targetHalf, preserve);
                  });
                  return null;
                }
                return switchPeriod(targetMonth, targetHalf, preserve);
              }}
              onSaveToHistory={saveCurrentSlipToHistory}
              onDeleteSavedSlip={deleteSavedSlip}
              onNotify={notify}
            />
          )}

          {showDeveloperTab && activeTab === 'github' && <GitHubApkTab />}
        </Suspense>

        <footer className="no-print mt-6">
          <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200/90 bg-white px-5 py-3.5 text-center shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="mx-auto flex items-center justify-center gap-2.5 text-[11px] font-medium text-slate-500">
              <span className="h-px w-8 bg-slate-200" aria-hidden="true" />
              <span>Developed by</span>
              <span className="h-px w-8 bg-slate-200" aria-hidden="true" />
            </div>

            <p className="mt-0.5 font-serif text-base sm:text-lg font-semibold tracking-tight text-slate-900">
              Muhammad Imran Akram
            </p>

            <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-0.5 text-xs">
              <a
                href="tel:03060600116"
                className="inline-flex min-h-[32px] items-center gap-1.5 font-mono font-medium tabular-nums text-slate-700 transition-colors hover:text-teal-800 hover:underline underline-offset-4 whitespace-nowrap"
              >
                <Phone className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                <span>0306-0600116</span>
              </a>
              <span className="hidden sm:inline text-slate-300" aria-hidden="true">|</span>
              <a
                href="mailto:iimranchughtaii@gmail.com"
                className="inline-flex min-h-[32px] items-center gap-1.5 font-medium text-slate-700 transition-colors hover:text-teal-800 hover:underline underline-offset-4 whitespace-nowrap"
              >
                <Mail className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                <span>iimranchughtaii@gmail.com</span>
              </a>
            </div>

            <div className="mt-2 border-t border-slate-100 pt-2 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-0.5 text-[11px] text-slate-500">
              <span className="font-serif italic text-slate-600">Payroll</span>
              <span aria-hidden="true">·</span>
              <span>Offline Salary Utility</span>
              <span aria-hidden="true">·</span>
              <span>This is not a loan app</span>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => setShowPrivacyModal(true)}
                className="font-semibold text-teal-700 hover:text-teal-800 hover:underline underline-offset-4"
              >
                Privacy Policy
              </button>
            </div>
          </div>
        </footer>
      </main>

      {showPrivacyModal && (
        <div
          className="no-print fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 p-4"
          onClick={() => setShowPrivacyModal(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Privacy Policy &amp; App Info
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Offline Salary &amp; Payslip Calculator
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPrivacyModal(false)}
                aria-label="Close privacy policy"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2.5 text-xs leading-relaxed text-slate-600">
              <p>
                We do not collect any user data, all salary data is stored locally on the user&apos;s device.
              </p>
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-medium text-slate-700">
                <strong>Disclaimer:</strong> This is not a loan app. Payroll does not provide or facilitate loans or lending; it is strictly a personal offline salary, overtime, and deduction calculator.
              </p>
              <p>
                No account or login is required. Device storage access is only used when you save or share your own payslip or backup file.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowPrivacyModal(false)}
              className="mt-2 inline-flex min-h-[42px] w-full items-center justify-center rounded-xl bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Mobile Crisp Frosted Bottom Tab Bar (<1024px) */}
      <nav
        aria-label="Primary Mobile Navigation"
        className="no-print fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200/90 bg-white/95 px-2 py-1.5 shadow-[0_-6px_24px_-8px_rgba(15,23,42,0.08)] backdrop-blur-lg lg:hidden pb-safe"
      >
        <div
          className={`grid items-center gap-1.5 ${
            visibleNavItems.length === 4 ? 'grid-cols-4' : 'grid-cols-3'
          }`}
        >
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => runGuardedAction(() => setActiveTab(item.id))}
                className={`flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 py-1 transition-all duration-150 active:scale-95 ${
                  active
                    ? 'bg-gradient-to-br from-teal-700 to-emerald-700 text-white shadow-sm shadow-teal-700/20 font-semibold'
                    : 'text-slate-500 hover:bg-slate-100/80 hover:text-slate-900'
                }`}
              >
                <Icon
                  className={`h-[18px] w-[18px] ${
                    active ? 'text-white' : 'text-slate-500'
                  }`}
                  strokeWidth={active ? 2.3 : 1.8}
                />
                <span className="text-[11px] leading-tight tracking-tight whitespace-nowrap">
                  {item.shortLabel}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
