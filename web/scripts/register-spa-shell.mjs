/**
 * TanStack Start SPA mode writes `/_shell.html` during a post-build prerender
 * step — after Nitro has already snapshotted public assets into the server
 * bundle. Without this script, `/_shell.html` exists on disk but returns 404,
 * which breaks the PWA service worker's navigateFallback + precache install.
 *
 * Also ensures `qpdf.wasm` is listed if present (mid-size engine for offline
 * crypto/repair tools).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const publicDir = join(root, '.output/public');
const serverEntry = join(root, '.output/server/index.mjs');

if (!existsSync(serverEntry)) {
  console.error('[register-spa-shell] missing', serverEntry);
  process.exit(1);
}

function nitroEtag(buf) {
  const digest = createHash('sha1')
    .update(buf)
    .digest('base64')
    .replace(/=+$/, '');
  return `"${buf.length.toString(16)}-${digest}"`;
}

function assetEntry(urlPath, filePath, type) {
  const abs = join(publicDir, filePath);
  if (!existsSync(abs)) return null;
  const data = readFileSync(abs);
  const st = statSync(abs);
  return {
    urlPath,
    snippet: `${JSON.stringify(urlPath)}: {
"type": ${JSON.stringify(type)},
"etag": ${JSON.stringify(nitroEtag(data))},
"mtime": ${JSON.stringify(st.mtime.toISOString())},
"size": ${data.length},
"path": ${JSON.stringify(`../public/${filePath}`)}
}`,
  };
}

const extras = [
  assetEntry('/_shell.html', '_shell.html', 'text/html; charset=utf-8'),
].filter(Boolean);

let source = readFileSync(serverEntry, 'utf8');
const marker = 'var public_assets_data_default = {';

if (!source.includes(marker)) {
  console.error(
    '[register-spa-shell] public assets map not found in server bundle'
  );
  process.exit(1);
}

const toInject = [];
for (const asset of extras) {
  if (source.includes(JSON.stringify(asset.urlPath))) {
    console.log(`[register-spa-shell] already registered ${asset.urlPath}`);
    continue;
  }
  toInject.push(asset.snippet);
}

if (toInject.length === 0) {
  console.log('[register-spa-shell] nothing to inject');
  process.exit(0);
}

source = source.replace(marker, `${marker}\n${toInject.join(',\n')},`);
writeFileSync(serverEntry, source);
for (const asset of extras) {
  if (toInject.some((s) => s.includes(JSON.stringify(asset.urlPath)))) {
    console.log(`[register-spa-shell] registered ${asset.urlPath}`);
  }
}
