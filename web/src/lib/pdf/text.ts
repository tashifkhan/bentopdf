import { openWithPdfjs } from './render';

export type TextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
};

export type PageText = {
  pageNumber: number;
  width: number;
  height: number;
  items: TextItem[];
};

/** Positioned text for every page, in pdf.js user space. */
export async function extractPageText(file: File): Promise<PageText[]> {
  const doc = await openWithPdfjs(file);
  const pages: PageText[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: TextItem[] = [];
    for (const raw of content.items) {
      // Marked-content items carry no `str`.
      if (!('str' in raw) || typeof raw.str !== 'string') continue;
      if (!raw.str) continue;
      const t = raw.transform as number[];
      items.push({
        str: raw.str,
        x: t[4] ?? 0,
        y: t[5] ?? 0,
        width: raw.width ?? 0,
        height: Math.abs(t[3] ?? raw.height ?? 0),
        fontName: (raw as { fontName?: string }).fontName ?? '',
      });
    }
    pages.push({
      pageNumber: i,
      width: viewport.width,
      height: viewport.height,
      items,
    });
  }
  return pages;
}

/**
 * Group items into visual lines by y position, then order left-to-right.
 * `tolerance` is in points — items within it are treated as the same baseline.
 */
export function groupIntoLines(page: PageText, tolerance = 2): TextItem[][] {
  const sorted = [...page.items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: TextItem[][] = [];
  for (const item of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0]!.y - item.y) <= tolerance) {
      last.push(item);
    } else {
      lines.push([item]);
    }
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);
  return lines;
}

/** Join a line's items, inserting a space where there is a visible gap. */
function joinLine(line: TextItem[]): string {
  let out = '';
  for (let i = 0; i < line.length; i++) {
    const item = line[i]!;
    if (i > 0) {
      const prev = line[i - 1]!;
      const gap = item.x - (prev.x + prev.width);
      const spaceish = Math.max(1, prev.height * 0.2);
      if (gap > spaceish && !out.endsWith(' ') && !item.str.startsWith(' ')) {
        out += ' ';
      }
    }
    out += item.str;
  }
  return out.replace(/\s+/g, ' ').trim();
}

export function pageToPlainText(page: PageText): string {
  return groupIntoLines(page)
    .map(joinLine)
    .filter((l) => l.length > 0)
    .join('\n');
}

export async function pdfToPlainText(file: File): Promise<string> {
  const pages = await extractPageText(file);
  return pages.map(pageToPlainText).join('\n\n');
}

/**
 * Heuristic markdown: the dominant body font size becomes paragraph text and
 * anything meaningfully larger becomes a heading, scaled by how much larger.
 */
export async function pdfToMarkdown(file: File): Promise<string> {
  const pages = await extractPageText(file);
  const heights = pages
    .flatMap((p) => p.items.map((i) => Math.round(i.height)))
    .filter((h) => h > 0);
  const body = modeOf(heights) || 10;
  const out: string[] = [];

  for (const page of pages) {
    for (const line of groupIntoLines(page)) {
      const text = joinLine(line);
      if (!text) continue;
      const size = Math.max(...line.map((i) => i.height));
      const ratio = size / body;
      if (ratio >= 1.15) {
        const level = ratio >= 1.8 ? 1 : ratio >= 1.45 ? 2 : 3;
        out.push(`${'#'.repeat(level)} ${text}`);
      } else if (/^[-•*·]\s+/.test(text)) {
        out.push(`- ${text.replace(/^[-•*·]\s+/, '')}`);
      } else {
        out.push(text);
      }
      out.push('');
    }
    out.push('---', '');
  }
  // Drop the trailing rule.
  while (
    out.length &&
    (out[out.length - 1] === '' || out[out.length - 1] === '---')
  ) {
    out.pop();
  }
  return out.join('\n');
}

function modeOf(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = 0;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/**
 * Detect columns by clustering item x-positions, then emit one row per visual
 * line. Good enough for ruled/grid tables; genuinely irregular layouts will not
 * round-trip and that is inherent to text-layer extraction.
 */
export function pageToRows(page: PageText, columnTolerance = 12): string[][] {
  const lines = groupIntoLines(page);
  const starts: number[] = [];
  for (const line of lines) {
    for (const item of line) {
      if (!starts.some((s) => Math.abs(s - item.x) < columnTolerance)) {
        starts.push(item.x);
      }
    }
  }
  starts.sort((a, b) => a - b);
  if (starts.length === 0) return [];

  const rows: string[][] = [];
  for (const line of lines) {
    const cells = new Array<string>(starts.length).fill('');
    for (const item of line) {
      let idx = 0;
      let bestDist = Infinity;
      for (let c = 0; c < starts.length; c++) {
        const d = Math.abs(starts[c]! - item.x);
        if (d < bestDist) {
          bestDist = d;
          idx = c;
        }
      }
      cells[idx] = (cells[idx]! + ' ' + item.str).trim();
    }
    if (cells.some((c) => c)) rows.push(cells);
  }
  return rows;
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export async function pdfToCsv(file: File): Promise<string> {
  const pages = await extractPageText(file);
  const lines: string[] = [];
  for (const page of pages) {
    for (const row of pageToRows(page)) {
      lines.push(row.map(csvEscape).join(','));
    }
  }
  if (lines.length === 0) {
    throw new Error(
      'No extractable text — this PDF is likely scanned. Try OCR first.'
    );
  }
  return lines.join('\n');
}

export async function pdfToJson(file: File): Promise<string> {
  const pages = await extractPageText(file);
  return JSON.stringify(
    {
      pageCount: pages.length,
      pages: pages.map((p) => ({
        page: p.pageNumber,
        width: p.width,
        height: p.height,
        lines: groupIntoLines(p).map(joinLine).filter(Boolean),
      })),
    },
    null,
    2
  );
}

/** Flat, chunk-friendly text with page markers, for feeding into an LLM. */
export async function pdfToAiText(file: File): Promise<string> {
  const pages = await extractPageText(file);
  const parts = pages.map(
    (p) =>
      `<!-- page ${p.pageNumber} of ${pages.length} -->\n${pageToPlainText(p)}`
  );
  const body = parts.join('\n\n');
  if (!body.replace(/<!--.*?-->/g, '').trim()) {
    throw new Error(
      'No extractable text — this PDF is likely scanned. Try OCR first.'
    );
  }
  return body;
}
