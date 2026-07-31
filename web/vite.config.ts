import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { defineConfig } from 'vite';
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
  plugins: [
    tailwindcss(),
    tanstackStart({
      srcDirectory: 'src',
    }),
    // TanStack Start requires the React plugin after tanstackStart().
    viteReact(),
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
      ],
      manifest: {
        name: 'BentoPDF — private PDF toolkit',
        short_name: 'BentoPDF',
        description:
          'Merge, split, convert, and edit PDFs in your browser. Files never leave your device.',
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
        // App shell + UI assets. Large WASM binaries use runtime caching below.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webp,woff,woff2,json}'],
        // Skip huge Office/PDF engine blobs from the precache manifest.
        globIgnores: [
          '**/libreoffice-wasm/**',
          '**/qpdf.wasm',
          '**/*.{wasm,gz}',
        ],
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.endsWith('.wasm') ||
              url.pathname.includes('/libreoffice-wasm/') ||
              url.pathname.endsWith('.gz'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'pdf-engines',
              expiration: {
                maxEntries: 24,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
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
        ],
      },
      devOptions: {
        // Keep SW off in dev; test with production builds.
        enabled: false,
      },
    }),
    nitro(headers ? { routeRules: { '/**': { headers } } } : {}),
  ],
});
