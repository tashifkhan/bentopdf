import { PDFDocument } from 'pdf-lib';
import type { OutFile } from './core';
import { canvasToBytes, newCanvas, openWithPdfjs, renderPage } from './render';
import { extractPageText, groupIntoLines } from './text';

export type PageDiff = {
  page: number;
  changedPixels: number;
  totalPixels: number;
  ratio: number;
};

export type CompareResult = {
  report: OutFile;
  visual?: OutFile;
  pages: PageDiff[];
  identical: boolean;
};

/**
 * Pixel-level comparison. Pages are rendered at a common size and diffed with
 * pixelmatch; the output PDF highlights changed regions in magenta.
 */
export async function comparePdfsVisually(
  a: File,
  b: File,
  opts: { scale?: number; threshold?: number } = {}
): Promise<{ visual: OutFile; pages: PageDiff[] }> {
  const { scale = 1.5, threshold = 0.1 } = opts;
  const pixelmatch = (await import('pixelmatch')).default;
  const docA = await openWithPdfjs(a);
  const docB = await openWithPdfjs(b);
  const pageCount = Math.max(docA.numPages, docB.numPages);

  const out = await PDFDocument.create();
  const diffs: PageDiff[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const canvasA =
      i <= docA.numPages ? await renderPage(docA, i, scale) : null;
    const canvasB =
      i <= docB.numPages ? await renderPage(docB, i, scale) : null;

    const width = Math.max(canvasA?.width ?? 0, canvasB?.width ?? 0) || 600;
    const height = Math.max(canvasA?.height ?? 0, canvasB?.height ?? 0) || 800;

    // Normalise both sides onto identically sized white canvases so pixelmatch
    // can compare them even when page geometry differs.
    const left = padTo(canvasA, width, height);
    const right = padTo(canvasB, width, height);

    const { canvas: diffCanvas, ctx: diffCtx } = newCanvas(width, height);
    const diffData = diffCtx.createImageData(width, height);

    const changed = pixelmatch(
      left.data,
      right.data,
      diffData.data,
      width,
      height,
      { threshold, diffColor: [255, 0, 255], alpha: 0.35 }
    );
    diffCtx.putImageData(diffData, 0, 0);

    diffs.push({
      page: i,
      changedPixels: changed,
      totalPixels: width * height,
      ratio: changed / (width * height),
    });

    const bytes = await canvasToBytes(diffCanvas, 'image/jpeg', 0.85);
    const img = await out.embedJpg(bytes);
    const page = out.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }

  return {
    visual: {
      name: 'comparison-visual.pdf',
      bytes: await out.save(),
      mime: 'application/pdf',
    },
    pages: diffs,
  };
}

function padTo(
  source: HTMLCanvasElement | null,
  width: number,
  height: number
): ImageData {
  const { canvas, ctx } = newCanvas(width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  if (source) ctx.drawImage(source, 0, 0);
  void canvas;
  return ctx.getImageData(0, 0, width, height);
}

/** Line-level textual diff between two documents. */
export async function comparePdfsTextually(
  a: File,
  b: File
): Promise<{ report: string; identical: boolean }> {
  const [pagesA, pagesB] = await Promise.all([
    extractPageText(a),
    extractPageText(b),
  ]);
  const linesOf = (pages: Awaited<ReturnType<typeof extractPageText>>) =>
    pages.flatMap((p) =>
      groupIntoLines(p)
        .map((line) =>
          line
            .map((i) => i.str)
            .join('')
            .replace(/\s+/g, ' ')
            .trim()
        )
        .filter(Boolean)
        .map((text) => ({ page: p.pageNumber, text }))
    );

  const left = linesOf(pagesA);
  const right = linesOf(pagesB);
  const ops = diffLines(
    left.map((l) => l.text),
    right.map((l) => l.text)
  );

  const report: string[] = [
    `Comparing:`,
    `  A: ${a.name} (${pagesA.length} pages)`,
    `  B: ${b.name} (${pagesB.length} pages)`,
    '',
  ];
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === 'equal') continue;
    if (op.type === 'add') {
      added++;
      report.push(`+ ${op.text}`);
    } else {
      removed++;
      report.push(`- ${op.text}`);
    }
  }
  const identical = added === 0 && removed === 0;
  report.splice(
    3,
    0,
    identical
      ? 'The extracted text is identical.'
      : `${removed} line(s) removed, ${added} line(s) added.`,
    ''
  );
  return { report: report.join('\n'), identical };
}

type DiffOp = { type: 'equal' | 'add' | 'remove'; text: string };

/** Classic LCS diff — fine for document-sized inputs. */
function diffLines(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  // Guard against pathological memory use on very large documents.
  if (n * m > 4_000_000) {
    const setB = new Set(b);
    const setA = new Set(a);
    return [
      ...a
        .filter((l) => !setB.has(l))
        .map((text) => ({ type: 'remove' as const, text })),
      ...b
        .filter((l) => !setA.has(l))
        .map((text) => ({ type: 'add' as const, text })),
    ];
  }

  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      ops.push({ type: 'remove', text: a[i]! });
      i++;
    } else {
      ops.push({ type: 'add', text: b[j]! });
      j++;
    }
  }
  while (i < n) ops.push({ type: 'remove', text: a[i++]! });
  while (j < m) ops.push({ type: 'add', text: b[j++]! });
  return ops;
}
