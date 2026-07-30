> **UI fork of [alam00000/bentopdf](https://github.com/alam00000/bentopdf)** for
> [pdf.taf.sh](https://pdf.taf.sh). AGPL-3.0-only.

# BentoPDF (TanStack UI)

Client-side PDF toolkit on **TanStack Start + beUI + reicon**. Every catalog
tool runs a real in-browser processor (pdf-lib / pdf.js) — no iframes.

## Quick start

```bash
bun install
bun run dev
```

→ **http://127.0.0.1:3000**

```bash
cd web && bun install && bun run dev
```

## Stack

| Layer | Tech |
|-------|------|
| App | TanStack Start (Vite + Router + Nitro) |
| UI | Tailwind v4, beUI, reicon |
| PDF | pdf-lib, pdfjs-dist, jszip |

## Tools

- **PDF Multi Tool** — full page organizer UI
- **Merge PDF** — dedicated merge UI
- **All other catalog tools** — shared `ToolWorkspace` + processors

## Scripts

| Command | Purpose |
|---------|---------|
| `bun run dev` | TanStack app on :3000 |
| `bun run build` | Production build |
| `bun run html:dev` | Optional legacy HTML app on :5173 |

## License

AGPL-3.0-only.
