> **UI fork of [alam00000/bentopdf](https://github.com/alam00000/bentopdf)** for
> [pdf.taf.sh](https://pdf.taf.sh). AGPL-3.0-only. Image:
> `ghcr.io/tashifkhan/bentopdf-ui`.

# BentoPDF (Taf PDF UI)

Privacy-first, browser-side PDF tools. The app lives in **`web/`**
(TanStack Start + Tailwind v4 + beUI + reicon). Files never leave the device.

**Package manager: [Bun](https://bun.sh)** (`packageManager`: `bun@1.3.9`).

## Quick start

```bash
# Install Bun if needed: https://bun.sh
cd web
bun install
bun run dev
```

Open **http://127.0.0.1:3000**

From the repo root:

```bash
bun install --cwd web
bun run dev      # → web
bun run build
bun run start
```

## Docker

```bash
docker compose up --build
# → http://localhost:3000
```

```bash
docker build -t bentopdf-ui .
docker run --rm -p 3000:3000 bentopdf-ui
```

Published images are available at
`ghcr.io/tashifkhan/bentopdf-ui`. The `edge` tag tracks `main`; version tags
are immutable release points.

## What’s included

| Area | Status |
|------|--------|
| App shell, theme (light/dark), settings | Done |
| Tool catalog (~127 tools) | Done |
| Merge PDF | Done (client-side) |
| PDF Multi Tool | Done (select / rotate / export) |
| Other tool processors | Shell routes — port in progress |

## Update automation

- Dependabot checks Bun/npm packages, GitHub Actions, and Docker every week.
- Patch-only dependency pull requests auto-merge after the required build.
- Minor and major updates stay open for review and notify repository watchers.
- A weekly upstream release check opens one issue per new BentoPDF release.
- CodeQL and Trivy scan source, dependencies, images, and Docker configuration.

## Project layout

```
web/                 # Primary app (only frontend)
  src/
    components/      # AppShell, beUI, icons
    features/        # theme, Merge, Multi Tool
    routes/          # TanStack file routes
    styles/app.css   # design tokens + Tailwind
  bun.lock           # Bun lockfile
Dockerfile           # builds web/ with Bun → Nitro server
docs/                # product / self-host docs (upstream)
```

## License

AGPL-3.0-only — see [LICENSE](./LICENSE). Upstream BentoPDF remains the
source of many processing algorithms; this fork focuses on the new UI stack.
