import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { defineConfig } from 'vite';
import viteReact from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { nitro } from 'nitro/vite';

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
    viteReact(),
    nitro(headers ? { routeRules: { '/**': { headers } } } : {}),
  ],
});
