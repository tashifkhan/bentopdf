import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

// Audit HTTP responses from the same production server used by Docker. Reading
// the old root dist/ or only the offline SPA shell misses route metadata and 404s.
const root = fileURLToPath(new URL('../', import.meta.url));
const site = (process.env.VITE_SITE_URL || 'https://pdf.taf.sh').replace(
  /\/+$/,
  ''
);
const catalog = JSON.parse(
  await readFile(
    new URL('../web/src/data/tools.generated.json', import.meta.url),
    'utf8'
  )
);
const routes = new Set([
  '/',
  ...catalog.flatMap((category) =>
    category.tools.map((tool) => `/tools/${tool.slug}`)
  ),
]);
const failures = [];
const titles = new Set();
const descriptions = new Set();
const links = new Set();
const images = new Set();

// Let the OS choose a free port, so local audits don't collide with development.
const socket = createServer();
socket.listen(0, '127.0.0.1');
await once(socket, 'listening');
const port = socket.address().port;
await new Promise((resolve, reject) =>
  socket.close((error) => (error ? reject(error) : resolve()))
);
const origin = `http://127.0.0.1:${port}`;
const server = spawn('bun', ['.output/server/index.mjs'], {
  cwd: `${root}web`,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (data) => {
  serverLog += data;
});
server.stderr.on('data', (data) => {
  serverLog += data;
});
server.on('error', (error) => {
  serverLog += error.message;
});
const deadline = setTimeout(() => server.kill('SIGKILL'), 120_000);
const response = (path) =>
  fetch(new URL(path, origin), {
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });

function check(condition, message) {
  if (!condition) failures.push(message);
}

function one(document, selector, path) {
  const nodes = document.querySelectorAll(selector);
  check(
    nodes.length === 1,
    `${path}: expected one ${selector}, found ${nodes.length}`
  );
  return nodes[0];
}

async function auditPage(path) {
  const res = await response(path);
  check(res.status === 200, `${path}: HTTP ${res.status}`);
  check(
    res.headers.get('content-type')?.includes('text/html'),
    `${path}: not HTML`
  );
  const dom = new JSDOM(await res.text());
  try {
    const { document } = dom.window;
    check(
      document.documentElement.lang === 'en',
      `${path}: missing English language declaration`
    );
    const title = one(document, 'head > title', path)?.textContent.trim();
    check(
      title && !titles.has(title),
      `${path}: empty or duplicate title: ${title}`
    );
    titles.add(title);
    const description = one(
      document,
      'meta[name="description"]',
      path
    )?.content.trim();
    check(
      description && !descriptions.has(description),
      `${path}: empty or duplicate description`
    );
    descriptions.add(description);
    const canonical = one(
      document,
      'link[rel="canonical"]',
      path
    )?.getAttribute('href');
    check(
      canonical === `${site}${path}`,
      `${path}: canonical ${canonical} != ${site}${path}`
    );
    check(
      !/noindex|none/i.test(res.headers.get('x-robots-tag') || ''),
      `${path}: HTTP header blocks indexing`
    );
    for (const robots of document.querySelectorAll(
      'meta[name="robots"], meta[name="googlebot"]'
    )) {
      check(
        !/noindex|none/i.test(robots.content),
        `${path}: metadata blocks indexing`
      );
    }
    const heading = one(document, 'h1', path);
    check(heading?.textContent.trim(), `${path}: empty main heading`);
    check(
      one(document, 'meta[property="og:url"]', path)?.content === canonical,
      `${path}: og:url differs from canonical`
    );
    for (const selector of [
      'meta[property="og:title"]',
      'meta[property="og:description"]',
      'meta[name="twitter:card"]',
    ]) {
      check(
        one(document, selector, path)?.content.trim(),
        `${path}: empty ${selector}`
      );
    }
    for (const selector of [
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
    ]) {
      const value = one(document, selector, path)?.content;
      if (value) {
        const url = new URL(value);
        check(
          url.origin === new URL(site).origin,
          `${path}: social image has wrong origin`
        );
        images.add(url.pathname);
      }
    }
    for (const anchor of document.querySelectorAll('a[href]')) {
      const url = new URL(anchor.getAttribute('href'), `${site}${path}`);
      if (url.origin === new URL(site).origin) links.add(url.pathname);
    }
    for (const script of document.querySelectorAll(
      'script[type="application/ld+json"]'
    )) {
      const json = JSON.parse(script.textContent);
      check(
        !JSON.stringify(json).includes('"aggregateRating"'),
        `${path}: unsupported aggregate rating`
      );
    }
  } finally {
    dom.window.close();
  }
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) break;
    try {
      await response('/');
      ready = true;
      break;
    } catch {
      await delay(250);
    }
  }
  assert(ready, `Production server did not start:\n${serverLog}`);

  // Sequential parsing keeps the audit's memory bounded, including the catalog.
  for (const path of routes) await auditPage(path);
  for (const path of links) {
    if (routes.has(path)) continue;
    const res = await response(path);
    check(res.status === 200, `Internal link ${path}: HTTP ${res.status}`);
    await res.body?.cancel();
  }
  for (const path of images) {
    const res = await response(path);
    check(
      res.status === 200 &&
        res.headers.get('content-type')?.startsWith('image/'),
      `Social image ${path}: missing or invalid image`
    );
    await res.body?.cancel();
  }

  const sitemap = await response('/sitemap.xml');
  check(sitemap.status === 200, `Sitemap: HTTP ${sitemap.status}`);
  const xml = new JSDOM(await sitemap.text(), {
    contentType: 'application/xml',
  });
  try {
    const entries = [...xml.window.document.querySelectorAll('url > loc')].map(
      (node) => node.textContent
    );
    const expected = new Set([...routes].map((path) => `${site}${path}`));
    check(entries.length <= 50_000, 'Sitemap exceeds 50,000 URLs');
    check(
      entries.length === expected.size &&
        new Set(entries).size === entries.length,
      'Sitemap has missing or duplicate URLs'
    );
    for (const url of entries)
      check(expected.has(url), `Sitemap: unexpected URL ${url}`);
    for (const url of expected)
      check(entries.includes(url), `Sitemap: missing ${url}`);
  } finally {
    xml.window.close();
  }
  const robots = await response('/robots.txt');
  const text = await robots.text();
  check(
    robots.status === 200 &&
      robots.headers.get('content-type')?.startsWith('text/plain'),
    'robots.txt: missing text response'
  );
  check(
    text.includes(`Sitemap: ${site}/sitemap.xml`),
    'robots.txt: missing sitemap URL'
  );
  check(
    !/^Disallow:\s*\/\s*$/im.test(text),
    'robots.txt: blocks the entire site'
  );

  for (const path of [
    '/seo-audit-missing-page',
    '/tools/seo-audit-missing-tool',
  ]) {
    const res = await response(path);
    check(res.status === 404, `${path}: expected HTTP 404, got ${res.status}`);
    const dom = new JSDOM(await res.text());
    check(
      /noindex/.test(
        dom.window.document.querySelector('meta[name="robots"]')?.content || ''
      ),
      `${path}: missing noindex`
    );
    dom.window.close();
  }
  if (failures.length)
    throw new Error(
      `SEO audit failed with ${failures.length} issues:\n${failures.join('\n')}`
    );
  console.log(
    `SEO audit: ${routes.size} production pages passed; internal links, social images, sitemap, robots.txt, and 404s passed.`
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  server.kill();
}
