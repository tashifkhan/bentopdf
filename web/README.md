# BentoPDF Web

Primary frontend for this fork — **TanStack Start** + Vite + Tailwind v4 + beUI + reicon.

**Package manager: Bun** (`bun@1.3.9`).

## Develop

From repo root:

```bash
bun run dev
```

Or:

```bash
cd web
bun install
bun run dev
```

App: **http://127.0.0.1:3000**

## Build / start

```bash
bun run build   # → web/.output
bun run start   # bun .output/server/index.mjs
```

## Stack

| Piece               | Library                                |
| ------------------- | -------------------------------------- |
| Framework           | TanStack Start (Vite + Router + Nitro) |
| Styling             | Tailwind CSS v4                        |
| Motion UI           | [beUI](https://beui.dev/)              |
| Icons               | [reicon](https://reicon.dev/)          |
| PDF                 | pdf-lib + pdfjs-dist (client)          |
| Encryption / repair | qpdf-wasm                              |
| OCR                 | tesseract.js                           |
| Office formats      | LibreOffice-wasm                       |
| Signing             | node-forge + zgapdfsigner              |
| Package manager     | Bun                                    |

## Ported tools

112 of the 116 catalog slugs have a real implementation, exposing 307 options
between them. Everything runs in the browser; no file is uploaded anywhere.

The remaining 4 render an explicit **"Not available in this build"** panel with
the reason and no run button — all of them need a large interactive canvas or a
font engine that is not bundled:

`edit-pdf`, `form-creator`, `pdf-workflow`, `font-to-outline`

### Notes on the trickier conversions

| Tool           | How it works                                                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pages-to-pdf` | iWork bundles are ZIPs containing a full-fidelity `QuickLook/Preview.pdf` rendered by Pages itself — that is what gets extracted.                                             |
| `psd-to-pdf`   | Decodes the flattened composite Photoshop stores in every PSD (8-bit RGB/greyscale, raw or RLE). Layers are not preserved.                                                    |
| `mobi-to-pdf`  | Reads the PalmDOC text stream from DRM-free MOBI/AZW files. HUFF/CDIC-compressed and DRM'd books are rejected with a clear message.                                           |
| `pdf-to-svg`   | pdf.js removed its vector SVG backend, so each page becomes a real SVG with the artwork embedded as an image plus a selectable `<text>` layer.                                |
| `pdf-to-pdfa`  | Adds an embedded sRGB ICC OutputIntent, PDF/A XMP and a document ID, and strips forbidden constructs. **Best effort — no validator runs**, so it is not certified compliance. |
| `pdf-layers`   | Lists optional content groups, changes their default visibility, or permanently strips their `BDC…EMC` content blocks.                                                        |

> A tool that cannot do its job must say so. Nothing falls back to a different
> operation — handing back a plausible-looking wrong file is worse than an error.

## Cross-origin isolation (Office conversion)

The LibreOffice-wasm converters (`word-to-pdf`, `excel-to-pdf`, `pdf-to-docx`, …)
need `SharedArrayBuffer`, which requires a cross-origin-isolated page. That is
**off by default**, because enabling COEP stops pdf.js from starting its render
worker — it falls back to the main thread and every rendering tool gets slower.

To enable Office conversion:

```bash
VITE_CROSS_ORIGIN_ISOLATION=true bun run build
```

Any reverse proxy or CDN must forward `Cross-Origin-Opener-Policy` and
`Cross-Origin-Embedder-Policy` untouched. Without it, the Office tools fail
immediately with an explanatory message rather than hanging.

## Optional environment variables

| Variable                      | Purpose                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `VITE_CROSS_ORIGIN_ISOLATION` | `true` enables COOP/COEP for Office conversion (see above)         |
| `VITE_LIBREOFFICE_PATH`       | Override the LibreOffice asset path (default `/libreoffice-wasm/`) |
| `VITE_TESSERACT_LANG_PATH`    | Serve OCR language models locally instead of the tesseract.js CDN  |
| `VITE_CORS_PROXY_URL`         | Proxy for certificate chain lookup when digitally signing          |

## Large assets

`public/qpdf.wasm` (1.3 MB) and `public/libreoffice-wasm/` (74 MB) are binary
runtime assets. Consider keeping the LibreOffice directory out of git and
fetching it at deploy time.
