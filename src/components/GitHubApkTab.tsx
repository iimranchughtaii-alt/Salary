import React, { useEffect, useState } from 'react';
import {
  Archive,
  Check,
  Copy,
  Download,
  ExternalLink,
  FolderGit2,
  KeyRound,
  Smartphone,
  UploadCloud,
} from 'lucide-react';
import projectFiles from 'virtual:project-files';
import { pushProjectToGitHub, type GitHubPushResult } from '../utils/githubPush';
import { PWAInstallButton } from './PWAInstallButton';

const WORKFLOW_YAML = `name: Build Signed Android APK & Play Store AAB

on:
  push:
    branches: [ main, master ]
  pull_request:
    branches: [ main, master ]
  workflow_dispatch:

jobs:
  build-android-release:
    name: Build Signed Release APK & Play Store AAB
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Setup Java 21
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '21'

      - name: Install Dependencies
        run: npm install --no-audit --no-fund --legacy-peer-deps

      - name: Install Capacitor Android Platform
        run: npm install @capacitor/cli@^8 @capacitor/android@^8 --no-save --no-audit --no-fund --legacy-peer-deps

      - name: Build Web Bundle
        env:
          VITE_IS_NATIVE_BUILD: 'true'
        run: npm run build

      - name: Add or Sync Capacitor Android Project
        run: |
          if [ ! -d "android" ]; then
            npx cap add android
          fi
          npx cap sync android

      - name: Apply Custom Payroll Launcher Icons
        run: |
          node -e '
          const fs = require("fs");
          const path = require("path");
          const resDir = "android/app/src/main/res";
          const icon512 = "public/pwa-512x512.png";
          const icon192 = "public/pwa-192x192.png";
          const iconMask = "public/pwa-maskable-512x512.png";
          if (fs.existsSync(resDir) && fs.existsSync(icon512)) {
            const densities = ["mipmap-mdpi", "mipmap-hdpi", "mipmap-xhdpi", "mipmap-xxhdpi", "mipmap-xxxhdpi"];
            for (const d of densities) {
              const dir = path.join(resDir, d);
              fs.mkdirSync(dir, { recursive: true });
              const baseIcon = (d === "mipmap-xxhdpi" || d === "mipmap-xxxhdpi") ? icon512 : icon192;
              fs.copyFileSync(baseIcon, path.join(dir, "ic_launcher.png"));
              fs.copyFileSync(baseIcon, path.join(dir, "ic_launcher_round.png"));
              if (fs.existsSync(iconMask)) {
                fs.copyFileSync(iconMask, path.join(dir, "ic_launcher_foreground.png"));
              }
            }
            const bgXml = path.join(resDir, "values/ic_launcher_background.xml");
            fs.mkdirSync(path.dirname(bgXml), { recursive: true });
            fs.writeFileSync(bgXml, "<?xml version=\\"1.0\\" encoding=\\"utf-8\\"?>\\n<resources>\\n    <color name=\\"ic_launcher_background\\">#0B1419</color>\\n</resources>\\n");
          }
          '

      - name: Prepare Release Keystore
        env:
          KEYSTORE_B64: \${{ secrets.ANDROID_KEYSTORE_BASE64 }}
          SECRET_STORE_PASS: \${{ secrets.KEYSTORE_PASSWORD }}
          SECRET_KEY_ALIAS: \${{ secrets.KEY_ALIAS }}
          SECRET_KEY_PASS: \${{ secrets.KEY_PASSWORD }}
        run: |
          if [ -n "$KEYSTORE_B64" ]; then
            echo "$KEYSTORE_B64" | base64 --decode > android/app/release-keystore.jks
            echo "ANDROID_KEYSTORE_PASS=$SECRET_STORE_PASS" >> $GITHUB_ENV
            echo "ANDROID_KEY_ALIAS=\${SECRET_KEY_ALIAS:-payroll}" >> $GITHUB_ENV
            echo "ANDROID_KEY_PASS=\${SECRET_KEY_PASS:-$SECRET_STORE_PASS}" >> $GITHUB_ENV
            echo "AUTO_GENERATED_KEYSTORE=false" >> $GITHUB_ENV
          else
            PASS="PayrollRelease2026!"
            keytool -genkeypair -v \\
              -keystore android/app/release-keystore.jks \\
              -storetype PKCS12 \\
              -alias payroll \\
              -keyalg RSA -keysize 2048 -validity 10000 \\
              -storepass "$PASS" -keypass "$PASS" \\
              -dname "CN=Payroll, OU=Mobile, O=Muhammad Imran Akram, L=Lahore, S=Punjab, C=PK"
            keytool -list -v -keystore android/app/release-keystore.jks -alias payroll -storepass "$PASS" > android/signing-info.txt
            echo "ANDROID_KEYSTORE_PASS=$PASS" >> $GITHUB_ENV
            echo "ANDROID_KEY_ALIAS=payroll" >> $GITHUB_ENV
            echo "ANDROID_KEY_PASS=$PASS" >> $GITHUB_ENV
            echo "AUTO_GENERATED_KEYSTORE=true" >> $GITHUB_ENV
          fi

      - name: Configure Release Signing in Gradle
        run: |
          node -e '
          const fs = require("fs");
          const p = "android/app/build.gradle";
          let g = fs.readFileSync(p, "utf8");
          if (!g.includes("signingConfigs")) {
            const sigBlock = \`    signingConfigs {\\n        release {\\n            storeFile file("release-keystore.jks")\\n            storePassword System.getenv("ANDROID_KEYSTORE_PASS")\\n            keyAlias System.getenv("ANDROID_KEY_ALIAS")\\n            keyPassword System.getenv("ANDROID_KEY_PASS")\\n        }\\n    }\\n    buildTypes {\`;
            g = g.replace(/^\\s*buildTypes\\s*\\{/m, sigBlock);
            g = g.replace(/(buildTypes\\s*\\{\\s*release\\s*\\{)/, "$1\\n            signingConfig signingConfigs.release");
            fs.writeFileSync(p, g);
          }
          '

      - name: Ensure Gradle Wrapper Executable
        run: chmod +x android/gradlew

      - name: Build Signed Release APK & Play Store AAB
        working-directory: android
        run: ./gradlew assembleRelease bundleRelease --no-daemon

      - name: Upload Signed Release APK
        uses: actions/upload-artifact@v4
        with:
          name: payroll-release-signed-apk
          path: android/app/build/outputs/apk/release/app-release.apk
          retention-days: 30

      - name: Upload Google Play Store AAB Bundle
        uses: actions/upload-artifact@v4
        with:
          name: payroll-playstore-aab
          path: android/app/build/outputs/bundle/release/app-release.aab
          retention-days: 30

      - name: Upload Auto-Generated Keystore & SHA-256
        if: env.AUTO_GENERATED_KEYSTORE == 'true'
        uses: actions/upload-artifact@v4
        with:
          name: release-keystore-backup
          path: |
            android/app/release-keystore.jks
            android/signing-info.txt
          retention-days: 30`;

const CREATE_TOKEN_URL =
  'https://github.com/settings/tokens/new?description=SalaryCalc%20APK%20Builder&scopes=repo,workflow';

export const GitHubApkTab: React.FC = () => {
  const [githubUser, setGithubUser] = useState<string>(
    () => localStorage.getItem('salarycalc_gh_user') || ''
  );
  const [repoName, setRepoName] = useState<string>(
    () => localStorage.getItem('salarycalc_gh_repo') || 'biweekly-salary-app'
  );
  const [branch, setBranch] = useState<string>('main');
  const [token, setToken] = useState<string>('');
  const [isPushing, setIsPushing] = useState(false);
  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [workflowScopeIssue, setWorkflowScopeIssue] = useState(false);
  const [pushResult, setPushResult] = useState<GitHubPushResult | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('salarycalc_gh_user', githubUser);
    localStorage.setItem('salarycalc_gh_repo', repoName);
  }, [githubUser, repoName]);

  const cleanUser = githubUser.trim() || 'your-username';
  const cleanRepo = repoName.trim() || 'biweekly-salary-app';
  const repoUrl = `https://github.com/${cleanUser}/${cleanRepo}`;
  const actionsUrl = `${repoUrl}/actions`;
  const createRepoUrl = `https://github.com/new?name=${encodeURIComponent(cleanRepo)}`;

  const gitPushScript = `git init
git add .
git commit -m "Biweekly Salary Calculator Android APK setup"
git branch -M ${branch || 'main'}
git remote add origin https://${cleanUser}:YOUR_TOKEN@github.com/${cleanUser}/${cleanRepo}.git
git push -u origin ${branch || 'main'}`;

  const runPush = async (skipWorkflow: boolean) => {
    setPushError(null);
    setWorkflowScopeIssue(false);
    setPushResult(null);
    setIsPushing(true);
    setPushStatus('Connecting to GitHub...');

    try {
      const result = await pushProjectToGitHub({
        owner: githubUser,
        repo: repoName,
        branch,
        token,
        commitMessage: 'Biweekly Salary Calculator Android APK & Offline PWA',
        skipWorkflow,
        onProgress: (msg) => setPushStatus(msg),
      });
      if (result.owner) {
        setGithubUser(result.owner);
      }
      setPushResult(result);
      setPushStatus(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to push to GitHub.';
      const isWfError =
        msg.toLowerCase().includes('workflow') ||
        msg.toLowerCase().includes('refusing to allow');
      setWorkflowScopeIssue(isWfError);
      setPushError(msg);
      setPushStatus(null);
    } finally {
      setIsPushing(false);
    }
  };

  const handleDirectPush = (e: React.FormEvent) => {
    e.preventDefault();
    runPush(false);
  };

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2200);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  const downloadWorkflowFile = () => {
    const blob = new Blob([WORKFLOW_YAML], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'build-apk.yml';
    a.click();
    URL.revokeObjectURL(url);
  };

  const addWorkflowOnGitHubUrl = (ownerVal: string, repoVal: string, branchVal: string) =>
    `https://github.com/${encodeURIComponent(ownerVal)}/${encodeURIComponent(
      repoVal
    )}/new/${encodeURIComponent(branchVal)}?filename=${encodeURIComponent(
      '.github/workflows/build-apk.yml'
    )}&value=${encodeURIComponent(WORKFLOW_YAML)}`;

  return (
    <div className="space-y-6">
      {/* 4-Stage Android Release Pipeline Graphic */}
      <section className="rounded-2xl border border-slate-200 bg-slate-950 p-5 sm:p-6 text-white">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
          <div>
            <h1 className="text-base font-bold tracking-tight text-white">
              Android Release &amp; Play Store Pipeline
            </h1>
            <p className="text-xs text-slate-400">
              Automated GitHub Actions workflow compiles, signs, and packages both APK and Play Store AAB
            </p>
          </div>
          <span className="font-mono text-[11px] font-semibold text-emerald-400 shrink-0">
            PKCS12 Keystore Signed · Release Ready
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            {
              step: '01',
              title: 'Web Bundle',
              sub: 'Vite + Tailwind + PWA',
              accent: 'text-teal-300 border-teal-500/30 bg-teal-500/10',
            },
            {
              step: '02',
              title: 'Capacitor Sync',
              sub: 'Native Android Project',
              accent: 'text-sky-300 border-sky-500/30 bg-sky-500/10',
            },
            {
              step: '03',
              title: 'Keystore Sign',
              sub: 'Release RSA-2048 Cert',
              accent: 'text-amber-300 border-amber-500/30 bg-amber-500/10',
            },
            {
              step: '04',
              title: 'APK + Store AAB',
              sub: 'app-release.apk & .aab',
              accent: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
            },
          ].map((stage, idx) => (
            <div
              key={stage.step}
              className="relative flex flex-col justify-between rounded-xl border border-white/10 bg-white/[0.04] p-3.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`inline-flex h-6 w-7 items-center justify-center rounded-md border font-mono text-[11px] font-bold ${stage.accent}`}
                >
                  {stage.step}
                </span>
                {idx < 3 && (
                  <svg
                    aria-hidden="true"
                    className="hidden lg:block h-4 w-4 text-slate-500"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              <div className="mt-2.5">
                <div className="text-xs font-semibold text-white">{stage.title}</div>
                <div className="text-[11px] text-slate-400 font-mono">{stage.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Direct Token Links & One-Click GitHub Push */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 lg:col-span-7">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Direct Token Link &amp; Push to GitHub
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Create a token with repo + workflow scopes, then push all {projectFiles.length} project files directly
              </p>
            </div>
            <FolderGit2 className="h-5 w-5 text-teal-700 shrink-0" />
          </div>

          {/* Direct Links Row */}
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <a
              href={CREATE_TOKEN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 transition-colors"
            >
              <KeyRound className="h-4 w-4 text-teal-400 shrink-0" />
              <span>1. Create GitHub Token (Auto-Scoped)</span>
              <ExternalLink className="h-3.5 w-3.5 opacity-75 shrink-0" />
            </a>

            <a
              href={createRepoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-900 hover:bg-slate-100 transition-colors"
            >
              <FolderGit2 className="h-4 w-4 text-teal-700 shrink-0" />
              <span>2. Create New Repo (Optional)</span>
              <ExternalLink className="h-3.5 w-3.5 text-slate-500 shrink-0" />
            </a>
          </div>

          {/* Direct Push Form */}
          <form onSubmit={handleDirectPush} className="mt-5 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-700">
                  GitHub Username (Optional)
                </label>
                <input
                  type="text"
                  value={githubUser}
                  onChange={(e) => setGithubUser(e.target.value)}
                  placeholder="Auto from token"
                  className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-700">
                  Repository Name
                </label>
                <input
                  type="text"
                  required
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  placeholder="biweekly-salary-app"
                  className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-700">
                  Branch
                </label>
                <input
                  type="text"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="main"
                  className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700">
                GitHub Token (kept only in memory)
              </label>
              <input
                type="password"
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                autoComplete="off"
                className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
              />
            </div>

            {pushStatus && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-xs text-slate-700">
                {pushStatus}
              </div>
            )}

            {pushError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-900 space-y-2.5">
                <div className="font-semibold">{pushError}</div>
                {workflowScopeIssue && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => runPush(true)}
                      disabled={isPushing}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-rose-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-800"
                    >
                      <UploadCloud className="h-3.5 w-3.5" />
                      <span>Push App Files First (Without Workflow)</span>
                    </button>
                    <a
                      href={CREATE_TOKEN_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3.5 py-2 text-xs font-semibold text-rose-900 hover:bg-rose-100"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      <span>Or Generate Token with Workflow Scope</span>
                    </a>
                  </div>
                )}
              </div>
            )}

            {pushResult && (
              <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-xs text-teal-900 space-y-2.5">
                <div className="font-semibold">
                  Pushed {pushResult.fileCount} files to {pushResult.owner}/{pushResult.repo} (
                  {pushResult.commitSha.slice(0, 7)})
                </div>
                {pushResult.skippedWorkflow ? (
                  <div>
                    App files pushed! Click <strong>Add build-apk.yml on GitHub</strong> below to commit the workflow file directly in your browser and trigger the APK build.
                  </div>
                ) : (
                  <div>
                    GitHub Actions is now building the signed <span className="font-mono font-semibold">app-release.apk</span> and Google Play Store <span className="font-mono font-semibold">app-release.aab</span> bundle. Open Actions to download them from Artifacts.
                  </div>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  {pushResult.skippedWorkflow && (
                    <a
                      href={addWorkflowOnGitHubUrl(
                        pushResult.owner,
                        pushResult.repo,
                        pushResult.branch
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      <span>Add build-apk.yml on GitHub</span>
                    </a>
                  )}
                  <a
                    href={pushResult.actionsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-teal-800"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Open Actions &amp; Download APK</span>
                  </a>
                  <a
                    href={pushResult.commitUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-teal-300 bg-white px-3.5 py-2 text-xs font-semibold text-teal-900 hover:bg-teal-100"
                  >
                    <span>View Commit</span>
                  </a>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={isPushing}
                className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60 transition-colors whitespace-nowrap"
              >
                <UploadCloud className="h-4 w-4" />
                <span>{isPushing ? 'Pushing Files...' : 'Push Project Files to GitHub'}</span>
              </button>

              <button
                type="button"
                onClick={async () => {
                  const { downloadProjectZip } = await import('../utils/zipExport');
                  await downloadProjectZip(`${cleanRepo}.zip`);
                }}
                className="inline-flex min-h-[48px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                <Archive className="h-4 w-4 text-teal-700" />
                <span>Download Project ZIP</span>
              </button>

              <a
                href={actionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[48px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                <ExternalLink className="h-4 w-4 text-slate-500" />
                <span>Open Actions</span>
              </a>
            </div>
          </form>
        </section>

        {/* Right Column: Step Guide + PWA */}
        <div className="space-y-6 lg:col-span-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
            <h3 className="text-base font-semibold text-slate-900">
              How Auto APK Build Works
            </h3>
            <ol className="mt-3 space-y-3 text-sm text-slate-600">
              <li className="flex gap-3">
                <span className="font-mono text-xs font-bold text-teal-700 pt-0.5">01.</span>
                <span>
                  Click <strong>Create GitHub Token (Auto-Scoped)</strong>—it opens GitHub with both{' '}
                  <code className="font-mono text-xs text-slate-900">repo</code> and{' '}
                  <code className="font-mono text-xs text-slate-900">workflow</code> already ticked.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-xs font-bold text-teal-700 pt-0.5">02.</span>
                <span>
                  Paste the token and click <strong>Push Project Files to GitHub</strong>. Username is detected automatically from your token, and missing repos are created for you.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-xs font-bold text-teal-700 pt-0.5">03.</span>
                <span>
                  GitHub Actions runs <code className="font-mono text-xs text-slate-900">.github/workflows/build-apk.yml</code> and compiles both the signed{' '}
                  <code className="font-mono text-xs text-slate-900">app-release.apk</code> and Google Play Store{' '}
                  <code className="font-mono text-xs text-slate-900">app-release.aab</code>.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-xs font-bold text-teal-700 pt-0.5">04.</span>
                <span>
                  <strong>Google Play Store Publishing:</strong> Download <strong className="font-mono text-slate-900">payroll-playstore-aab</strong> (`.aab`) from Artifacts and upload it to{' '}
                  <a
                    href="https://play.google.com/console"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-teal-700 underline"
                  >
                    Google Play Console
                  </a>{' '}
                  (Internal Testing / Production). Apps installed via Play Store are verified by Play App Signing with no Play Protect sideload warning.
                </span>
              </li>
            </ol>
            <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-[11px] text-amber-900 leading-relaxed space-y-1">
              <div>
                <strong>Permanent Play Store Upload Key (Optional Secrets):</strong> Add <code className="font-mono">ANDROID_KEYSTORE_BASE64</code>, <code className="font-mono">KEYSTORE_PASSWORD</code>, <code className="font-mono">KEY_ALIAS</code>, and <code className="font-mono">KEY_PASSWORD</code> under GitHub Repo Settings → Secrets; otherwise, the workflow generates a release keystore and SHA-256 artifact automatically.
              </div>
              <div>
                <strong>Sideload Note:</strong> When installing a direct APK outside the Play Store, Android prompts once with <em>Install anyway</em>.
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <Smartphone className="h-5 w-5 text-teal-700 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-slate-900">
                  Instant Offline Mobile Install (PWA)
                </h3>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                  Install directly on your Android home screen right now for full offline access without Play Protect warnings or waiting for an APK build.
                </p>
                <div className="mt-3">
                  <PWAInstallButton variant="card" />
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Terminal Git Push Alternative + Workflow File */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Terminal Git Push Commands &amp; Workflow File
            </h3>
            <p className="text-xs text-slate-500">
              Optional command-line push or download .github/workflows/build-apk.yml
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => copyText('git', gitPushScript)}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            >
              {copiedId === 'git' ? (
                <>
                  <Check className="h-3.5 w-3.5 text-teal-700" />
                  <span>Copied Commands</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-slate-500" />
                  <span>Copy Git Commands</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={downloadWorkflowFile}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5 text-teal-700" />
              <span>Download build-apk.yml</span>
            </button>
          </div>
        </div>
        <pre className="overflow-x-auto rounded-xl bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-100">
          {gitPushScript}
        </pre>
      </section>
    </div>
  );
};
