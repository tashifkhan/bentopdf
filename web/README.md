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

| Piece | Library |
|--------|---------|
| Framework | TanStack Start (Vite + Router + Nitro) |
| Styling | Tailwind CSS v4 |
| Motion UI | [beUI](https://beui.dev/) |
| Icons | [reicon](https://reicon.dev/) |
| PDF | pdf-lib + pdfjs-dist (client) |
| Package manager | Bun |

## Ported tools

- **Merge PDF** — client-side merge + ranges
- **PDF Multi Tool** — pick pages, rotate, export
- Other catalog routes — shell until each processor is ported
