# BentoPDF web app (TanStack Start + Nitro)
# The deployed UI is built from web/ and runs on the internal port expected by
# Nginx Proxy Manager (3000). PDF processing remains client-side in the browser.

FROM oven/bun:1.3.9 AS builder
WORKDIR /app

COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile

COPY web/ ./

ARG VITE_CROSS_ORIGIN_ISOLATION=true
ENV VITE_CROSS_ORIGIN_ISOLATION=${VITE_CROSS_ORIGIN_ISOLATION}
RUN bun run build

FROM oven/bun:1.3.9-alpine AS runner
WORKDIR /app

RUN apk upgrade --no-cache

LABEL org.opencontainers.image.source="https://github.com/tashifkhan/bentopdf"
LABEL org.opencontainers.image.url="https://pdf.taf.sh"
LABEL org.opencontainers.image.description="BentoPDF browser-first PDF toolkit with the redesigned document workspace"

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY --from=builder /app/.output ./.output
COPY --from=builder /app/package.json ./package.json

USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:3000/').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"]
CMD ["bun", ".output/server/index.mjs"]
