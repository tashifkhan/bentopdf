# Full BentoPDF toolkit (SIMPLE_MODE) — 100+ tools, all processors
ARG BASE_URL=

FROM public.ecr.aws/docker/library/node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json bun.lock* ./
COPY vendor ./vendor
ENV HUSKY=0
RUN npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 60000 && \
    npm config set fetch-retry-maxtimeout 300000 && \
    npm ci || npm install

COPY . .

ARG SIMPLE_MODE=true
ENV SIMPLE_MODE=$SIMPLE_MODE
ARG COMPRESSION_MODE=all
ENV COMPRESSION_MODE=$COMPRESSION_MODE
ARG BASE_URL
ENV BASE_URL=$BASE_URL
ARG SITE_URL=https://pdf.taf.sh
ENV SITE_URL=$SITE_URL
ARG VITE_BRAND_NAME=Taf PDF
ENV VITE_BRAND_NAME=$VITE_BRAND_NAME
ARG VITE_BRAND_LOGO=images/taf-pdf-mark.svg
ENV VITE_BRAND_LOGO=$VITE_BRAND_LOGO
ARG VITE_FOOTER_TEXT=Private PDF tools powered by BentoPDF.
ENV VITE_FOOTER_TEXT=$VITE_FOOTER_TEXT
ENV NODE_OPTIONS="--max-old-space-size=3072"

# Generate the Nginx policy files from the same origins used by the frontend,
# then build the deployed static application.
RUN node scripts/generate-security-headers.mjs && npx vite build

FROM quay.io/nginx/nginx-unprivileged:alpine-slim
LABEL org.opencontainers.image.source="https://github.com/tashifkhan/bentopdf"
LABEL org.opencontainers.image.description="BentoPDF full toolkit — private browser PDF tools"

ARG BASE_URL
USER root
RUN apk upgrade --no-cache
USER nginx

COPY --chown=nginx:nginx --from=builder /app/dist /usr/share/nginx/html${BASE_URL%/}
COPY --chown=nginx:nginx --from=builder /app/security-headers.conf /etc/nginx/security-headers.conf
COPY --chown=nginx:nginx nginx.conf /etc/nginx/nginx.conf
COPY --chown=nginx:nginx security-headers-docs.conf /etc/nginx/security-headers-docs.conf
COPY --chown=nginx:nginx --chmod=755 nginx-ipv6.sh /docker-entrypoint.d/99-disable-ipv6.sh
COPY --chown=nginx:nginx --chmod=755 nginx-noindex.sh /docker-entrypoint.d/98-noindex.sh
RUN mkdir -p /etc/nginx/tmp && chown -R nginx:nginx /etc/nginx/tmp || true

ENV DISABLE_IPV6=false
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["wget", "--spider", "-q", "http://127.0.0.1:8080/"]
CMD ["nginx", "-g", "daemon off;"]
