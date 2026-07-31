import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { defineConfig, type Plugin } from 'vite';
import viteReact from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { nitro } from 'nitro/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Cross-origin isolation, required by the LibreOffice-wasm Office converters
 * (pthreads → SharedArrayBuffer).
 *
 * It is opt-in because it is a real trade-off: with COEP enabled, pdf.js cannot
 * start its render worker and silently falls back to the main thread, which
 * makes every render-based tool (PDF→image, compress, OCR, compare, deskew, …)
 * slower and janky. Most deployments want the fast path.
 *
 * Set VITE_CROSS_ORIGIN_ISOLATION=true when you need Office conversion, and
 * make sure any reverse proxy or CDN forwards these headers untouched.
 */
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

const headers =
  process.env.VITE_CROSS_ORIGIN_ISOLATION === 'true'
    ? crossOriginIsolation
    : undefined;

/**
 * Nitro sets `builder.sharedConfigBuild: true`, so vite-plugin-pwa would otherwise
 * generate the service worker once per environment (client, ssr, nitro). Later
 * regenerations grow sw.js after Nitro has already recorded its size/etag, which
 * truncates the served script and breaks SW install.
 *
 * Generate SW only on the `client` environment so the file exists before Nitro
 * snapshots public assets. Keep generateBundle (manifest emission) on all envs.
 *
 * @see https://github.com/vite-pwa/vite-plugin-pwa/issues/940
 */
function pwaOnceOnClient(plugins: Plugin[]): Plugin[] {
  return plugins.map((plugin) => {
    const closeBundle = plugin.closeBundle;
    if (!closeBundle) return plugin;

    const originalHandler =
      typeof closeBundle === 'function'
        ? closeBundle
        : typeof closeBundle === 'object' &&
            closeBundle &&
            typeof closeBundle.handler === 'function'
          ? closeBundle.handler
          : null;

    if (!originalHandler) return plugin;

    const order =
      typeof closeBundle === 'object' && closeBundle && 'order' in closeBundle
        ? closeBundle.order
        : 'pre';

    const sequential =
      typeof closeBundle === 'object' &&
      closeBundle &&
      'sequential' in closeBundle
        ? Boolean(closeBundle.sequential)
        : true;

    return {
      ...plugin,
      closeBundle: {
        order: order ?? 'pre',
        sequential,
        async handler(
          this: { environment?: { name?: string } },
          error?: Error
        ) {
          const envName = this?.environment?.name;
          // Client is first in TanStack Start + Nitro; later envs must not
          // regenerate sw.js after Nitro records public asset metadata.
          if (envName && envName !== 'client') return;
          return originalHandler.call(this as never, error);
        },
      },
    } satisfies Plugin;
  });
}

export default defineConfig({
  server: {
    port: 3000,
    host: '127.0.0.1',
    ...(headers ? { headers } : {}),
  },
  ...(headers ? { preview: { headers } } : {}),
  resolve: {
    tsconfigPaths: true,
  },
  optimizeDeps: {
    /**
     * EmbedPDF ships its PDFium engine as a web worker. Vite's dep pre-bundling
     * rewrites the main module and the worker chunk separately, so the two end
     * up with different copies of the request/response bridge and every call
     * comes back as "Received response for unknown request" — the viewer then
     * hangs on "Loading document…". Leaving it unbundled keeps both halves on
     * one module instance.
     */
    exclude: ['embedpdf-snippet'],
  },
  plugins: [
    tailwindcss(),
    tanstackStart({
      srcDirectory: 'src',
      // Client-only PDF toolkit — SPA shell enables true offline navigation.
      spa: {
        enabled: true,
      },
    }),
    // TanStack Start requires the React plugin after tanstackStart().
    viteReact(),
    ...pwaOnceOnClient(
      VitePWA({
        registerType: 'autoUpdate',
        // Register via virtual:pwa-register in src/client.tsx (client-only).
        injectRegister: false,
        // Useful with TanStack Start's multi-environment build.
        integration: {
          closeBundleOrder: 'pre',
        },
        // Nitro serves static files from this directory.
        outDir: '.output/public',
        includeAssets: [
          'favicon.ico',
          'favicon.png',
          'favicon-16x16.png',
          'favicon-32x32.png',
          'apple-touch-icon.png',
          'images/taf-pdf-mark.svg',
          // Core offline engines (LibreOffice is runtime-cached — too large).
          'qpdf.wasm',
        ],
        manifest: {
          name: 'BentoPDF — private PDF toolkit',
          short_name: 'BentoPDF',
          description:
            'Merge, split, convert, and edit PDFs in your browser. Files never leave your device. Works offline.',
          id: '/',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'any',
          theme_color: '#1a3d35',
          background_color: '#0d110f',
          categories: ['productivity', 'utilities'],
          icons: [
            {
              src: '/android-chrome-192x192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: '/android-chrome-512x512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: '/android-chrome-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // App shell, UI, and mid-size engines (pdf.js worker, qpdf, pdfium).
          globPatterns: [
            '**/*.{js,mjs,css,html,svg,png,ico,webp,woff,woff2,json,wasm}',
          ],
          // LibreOffice is ~75MB — too large to precache; cached on first use.
          globIgnores: ['**/libreoffice-wasm/**', '**/*.{gz}'],
          // pdfium.wasm is ~4.3MB; default Workbox cap is 2MB.
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          // SPA shell from TanStack Start — offline navigations fall back here.
          navigateFallback: '/_shell.html',
          navigateFallbackDenylist: [
            /^\/api\//,
            /^\/_serverFn\//,
            /^\/sw\.js$/,
            /^\/workbox-/,
            /^\/manifest\.webmanifest$/,
          ],
          // Shell is prerendered after the PWA asset scan — list it explicitly.
          additionalManifestEntries: [
            {
              url: '/_shell.html',
              revision: String(Date.now()),
            },
          ],
          runtimeCaching: [
            {
              // Office converter + any other large engine blobs (first-use cache).
              urlPattern: ({ url }) =>
                url.pathname.includes('/libreoffice-wasm/') ||
                url.pathname.endsWith('.gz') ||
                (url.pathname.endsWith('.wasm') &&
                  url.pathname.includes('libreoffice')),
              handler: 'CacheFirst',
              options: {
                cacheName: 'pdf-engines-large',
                expiration: {
                  maxEntries: 12,
                  maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              // Chunks / workers that may be requested after install.
              urlPattern: ({ request, url }) =>
                request.destination === 'script' ||
                request.destination === 'worker' ||
                url.pathname.startsWith('/assets/'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'app-assets',
                expiration: {
                  maxEntries: 200,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: ({ request }) => request.destination === 'font',
              handler: 'CacheFirst',
              options: {
                cacheName: 'fonts',
                expiration: {
                  maxEntries: 20,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: ({ request }) => request.destination === 'image',
              handler: 'CacheFirst',
              options: {
                cacheName: 'images',
                expiration: {
                  maxEntries: 60,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          // Keep SW off in dev; test with production builds.
          enabled: false,
        },
      }) as Plugin[]
    ),
    nitro(headers ? { routeRules: { '/**': { headers } } } : {}),
  ],
});
