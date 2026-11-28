import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

function collectProjectFiles(rootDir: string) {
  const entries: { path: string; content: string; encoding: 'utf-8' | 'base64' }[] = [];
  const binaryExts = new Set(['.png', '.jpg', '.jpeg', '.ico', '.webp']);

  const addFile = (relPath: string) => {
    const absPath = path.resolve(rootDir, relPath);
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) return;
    const ext = path.extname(relPath).toLowerCase();
    const isBinary = binaryExts.has(ext);
    entries.push({
      path: relPath.replace(/\\/g, '/'),
      content: isBinary
        ? fs.readFileSync(absPath).toString('base64')
        : fs.readFileSync(absPath, 'utf-8'),
      encoding: isBinary ? 'base64' : 'utf-8',
    });
  };

  const walkDir = (relDir: string, ignoreSubdirs: string[] = []) => {
    const absDir = path.resolve(rootDir, relDir);
    if (!fs.existsSync(absDir)) return;
    for (const item of fs.readdirSync(absDir, { withFileTypes: true })) {
      const childRel = path.posix.join(relDir, item.name);
      if (item.isDirectory()) {
        if (ignoreSubdirs.includes(childRel) || ignoreSubdirs.includes(item.name)) {
          continue;
        }
        walkDir(childRel, ignoreSubdirs);
      } else if (item.isFile()) {
        addFile(childRel);
      }
    }
  };

  [
    'package.json',
    'tsconfig.json',
    'vite.config.ts',
    'index.html',
    'metadata.json',
    'capacitor.config.json',
    '.gitignore',
    '.env.example',
    '.github/workflows/build-apk.yml',
  ].forEach(addFile);

  walkDir('src');
  walkDir('public', ['assets']);

  return entries;
}

function projectFilesVirtualModulePlugin(): Plugin {
  const virtualId = 'virtual:project-files';
  const resolvedId = '\0' + virtualId;
  return {
    name: 'project-files-virtual-module',
    resolveId(id) {
      if (id === virtualId) return resolvedId;
      return null;
    },
    load(id) {
      if (id === resolvedId) {
        const files = collectProjectFiles(__dirname);
        return `export default ${JSON.stringify(files)};`;
      }
      return null;
    },
  };
}

function disabledHmrGuardPlugin(): Plugin {
  return {
    name: 'disabled-hmr-guard',
    apply: 'serve',
    transform(code, id) {
      if (process.env.DISABLE_HMR !== 'true') return null;

      if (id.includes('vite/dist/client/client.mjs') || id.includes('/@vite/client')) {
        if (code.includes('ws.send(JSON.stringify(data));')) {
          return {
            code: code.replace(
              'ws.send(JSON.stringify(data));',
              'if (ws && ws.readyState === 1) { ws.send(JSON.stringify(data)); }'
            ),
            map: null,
          };
        }
      }

      if (id.includes('pwa-entry-point-loaded') && code.includes('import.meta.hot.send(')) {
        return {
          code: 'export default function registerDevSW() {}',
          map: null,
        };
      }

      return null;
    },
    transformIndexHtml(html) {
      if (process.env.DISABLE_HMR !== 'true') return html;
      const cleanupScript = `<script>if('serviceWorker'in navigator){navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(reg){var sw=reg.active||reg.waiting||reg.installing;if(sw&&sw.scriptURL&&sw.scriptURL.indexOf('dev-sw.js')!==-1){reg.unregister();}});}).catch(function(){});}</script>`;
      return html.replace('</head>', `${cleanupScript}\n  </head>`);
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      disabledHmrGuardPlugin(),
      projectFilesVirtualModulePlugin(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['apple-touch-icon.png', 'icon.svg'],
        manifest: {
          id: '/',
          name: 'Payroll',
          short_name: 'Payroll',
          description:
            '15-day biweekly salary, overtime, loan ledger, and offline PDF salary slip generator.',
          theme_color: '#0F766E',
          background_color: '#F8FAFC',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,jpg,svg,woff,woff2}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: process.env.DISABLE_HMR !== 'true',
          type: 'module',
        },
      }),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, { recursive: true, force: true });
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      target: 'es2020',
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/jspdf')) return 'vendor-pdf';
            if (id.includes('node_modules/jszip')) return 'vendor-zip';
            if (id.includes('node_modules/lucide-react')) return 'vendor-icons';
            if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
              return 'vendor-react';
            }
            return undefined;
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
