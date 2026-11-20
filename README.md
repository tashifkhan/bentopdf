> **UI fork of [alam00000/bentopdf](https://github.com/alam00000/bentopdf)** for
> [pdf.taf.sh](https://pdf.taf.sh). AGPL-3.0-only.

<details>
<summary>Upstream BentoPDF sponsors</summary>

<h3 align="center">💖 Thank You to Our Sponsors</h3>
<p align="center"><sub>Organizational Supporters</sub></p>
<p align="center">
  <a href="https://vercel.com/open-source-program">
    <img alt="Vercel OSS Program" src="https://vercel.com/oss/program-badge-2026.svg" height="30" />
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://www.digitalocean.com/?refcode=d93c189ef6d0&utm_campaign=Referral_Invite&utm_medium=Referral_Program&utm_source=badge">
    <img src="https://web-platforms.sfo2.cdn.digitaloceanspaces.com/WWW/Badge%203.svg" alt="DigitalOcean Referral Badge" height="44">
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://www.nvidia.com/en-us/startups/">
    <img alt="NVIDIA Inception Program" src="public/images/nvidia-inception.svg" height="44" />
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://www.vultr.com/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="public/images/vultr-logo-dark.svg" />
      <img alt="Vultr" src="public/images/vultr-logo-light.svg" height="30" />
    </picture>
  </a>
</p>
<p align="center"><sub>Individual Supporters</sub></p>
<p align="center"><!-- sponsors --><a href="https://github.com/gaedeke"><img src="https:&#x2F;&#x2F;github.com&#x2F;gaedeke.png" width="60px" alt="User avatar: " /></a><a href="https://github.com/stiflerbox"><img src="https:&#x2F;&#x2F;github.com&#x2F;stiflerbox.png" width="60px" alt="User avatar: " /></a><a href="https://github.com/shollyethan"><img src="https:&#x2F;&#x2F;github.com&#x2F;shollyethan.png" width="60px" alt="User avatar: Ethan Sholly" /></a><a href="https://github.com/KnudH"><img src="https:&#x2F;&#x2F;github.com&#x2F;KnudH.png" width="60px" alt="User avatar: Knud Hollander" /></a><a href="https://github.com/mohannadhussain"><img src="https:&#x2F;&#x2F;github.com&#x2F;mohannadhussain.png" width="60px" alt="User avatar: Mohannad Hussain" /></a><a href="https://github.com/chaoscastle"><img src="https:&#x2F;&#x2F;github.com&#x2F;chaoscastle.png" width="60px" alt="User avatar: " /></a><a href="https://github.com/RobertGonzales1"><img src="https:&#x2F;&#x2F;github.com&#x2F;RobertGonzales1.png" width="60px" alt="User avatar: Robert Gonzales" /></a><a href="https://github.com/michivonah"><img src="https:&#x2F;&#x2F;github.com&#x2F;michivonah.png" width="60px" alt="User avatar: Michi" /></a><a href="https://github.com/bmikaili"><img src="https:&#x2F;&#x2F;github.com&#x2F;bmikaili.png" width="60px" alt="User avatar: Berzan" /></a><a href="https://github.com/Thanyanit-J"><img src="https:&#x2F;&#x2F;github.com&#x2F;Thanyanit-J.png" width="60px" alt="User avatar: Thanyanit Jongjitragan" /></a><a href="https://github.com/AceofSpades5757"><img src="https:&#x2F;&#x2F;github.com&#x2F;AceofSpades5757.png" width="60px" alt="User avatar: Kyle L. Davis" /></a><a href="https://github.com/Jacco011"><img src="https:&#x2F;&#x2F;github.com&#x2F;Jacco011.png" width="60px" alt="User avatar: " /></a><a href="https://github.com/Pallandos"><img src="https:&#x2F;&#x2F;github.com&#x2F;Pallandos.png" width="60px" alt="User avatar: " /></a><a href="https://github.com/haritvsmurali"><img src="https:&#x2F;&#x2F;github.com&#x2F;haritvsmurali.png" width="60px" alt="User avatar: Hari Haran" /></a><a href="https://github.com/mrtoadie"><img src="https:&#x2F;&#x2F;github.com&#x2F;mrtoadie.png" width="60px" alt="User avatar: Toadie" /></a><a href="https://github.com/sam12dr21"><img src="https:&#x2F;&#x2F;github.com&#x2F;sam12dr21.png" width="60px" alt="User avatar: " /></a><a href="https://github.com/BGauthier2020"><img src="https:&#x2F;&#x2F;github.com&#x2F;BGauthier2020.png" width="60px" alt="User avatar: " /></a><!-- sponsors --></p>
<p align="center">
  <a href="https://github.com/sponsors/alam00000"><img alt="Become a Sponsor" src="https://img.shields.io/badge/Become%20a%20Sponsor-%E2%9D%A4-ff69b4?style=for-the-badge" /></a>
  <a href="https://ko-fi.com/alio01"><img alt="Buy me a Coffee" src="https://img.shields.io/badge/Buy%20me%20a%20Coffee-yellow?style=for-the-badge&logo=kofi" /></a>
</p>

</details>

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
| `npm run seo-audit` | Audit every route on the built production server |

Build with `bun run build` before running the SEO audit. The audit needs the
root dependencies and `web/` dependencies installed. It starts and stops its
own Nitro server, checks the home page and every catalog tool, and verifies
canonicals, descriptions, social images, internal links, sitemap, robots.txt,
and missing-page responses.

Set `VITE_SITE_URL` at build time for a different public origin. It defaults
to `https://pdf.taf.sh`. Use the same value when running the audit.
`npm run seo-audit:legacy` retains the old audit for optional root Vite builds.

## License

AGPL-3.0-only.
