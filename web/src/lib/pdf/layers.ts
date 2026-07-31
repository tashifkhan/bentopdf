/**
 * Optional content groups ("layers"). Viewers show these as toggles; this
 * module lists them, changes their default visibility, and can permanently
 * drop a layer's content.
 */
import { PDFArray, PDFDict, PDFName, PDFHexString, PDFString } from 'pdf-lib';
import type { PDFRef } from 'pdf-lib';
import { loadPdf } from './core';

export type LayerInfo = {
  /** Stable identifier: the OCG's object reference, as a string. */
  id: string;
  name: string;
  visible: boolean;
};

function decodeName(value: unknown, fallback: string): string {
  if (value instanceof PDFString || value instanceof PDFHexString) {
    return value.decodeText();
  }
  return fallback;
}

/** List every optional content group and whether it starts visible. */
export async function listLayers(file: File): Promise<LayerInfo[]> {
  const doc = await loadPdf(file);
  const props = doc.catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict);
  if (!props) return [];

  const groups = props.lookupMaybe(PDFName.of('OCGs'), PDFArray);
  if (!groups) return [];

  // The default configuration's /OFF array lists groups that start hidden.
  const config = props.lookupMaybe(PDFName.of('D'), PDFDict);
  const off = config?.lookupMaybe(PDFName.of('OFF'), PDFArray);
  const hidden = new Set<string>();
  if (off) {
    for (let i = 0; i < off.size(); i++) hidden.add(String(off.get(i)));
  }

  const out: LayerInfo[] = [];
  for (let i = 0; i < groups.size(); i++) {
    const ref = groups.get(i);
    const group = groups.lookupMaybe(i, PDFDict);
    if (!group) continue;
    out.push({
      id: String(ref),
      name: decodeName(group.get(PDFName.of('Name')), `Layer ${i + 1}`),
      visible: !hidden.has(String(ref)),
    });
  }
  return out;
}

/**
 * Set which layers are visible when the document opens. This only changes the
 * default configuration — the content stays in the file and viewers can still
 * toggle it back on.
 */
export async function setLayerVisibility(
  file: File,
  hiddenIds: string[]
): Promise<Uint8Array> {
  const doc = await loadPdf(file);
  const props = doc.catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict);
  if (!props) throw new Error('This PDF has no optional content layers');

  const groups = props.lookupMaybe(PDFName.of('OCGs'), PDFArray);
  if (!groups) throw new Error('This PDF has no optional content layers');

  let config = props.lookupMaybe(PDFName.of('D'), PDFDict);
  if (!config) {
    config = PDFDict.withContext(doc.context);
    props.set(PDFName.of('D'), config);
  }

  const hidden = new Set(hiddenIds);
  const offArray = PDFArray.withContext(doc.context);
  const onArray = PDFArray.withContext(doc.context);
  for (let i = 0; i < groups.size(); i++) {
    const ref = groups.get(i) as PDFRef;
    if (hidden.has(String(ref))) offArray.push(ref);
    else onArray.push(ref);
  }

  config.set(PDFName.of('OFF'), offArray);
  config.set(PDFName.of('ON'), onArray);
  // BaseState must stay ON, otherwise /OFF is interpreted the other way round.
  config.set(PDFName.of('BaseState'), PDFName.of('ON'));
  return doc.save();
}

/**
 * Permanently remove the marked content belonging to the given layers.
 *
 * PDF marks layer content inline in the page stream with BDC/EMC operators, so
 * this rewrites each content stream and drops the matching blocks.
 */
export async function deleteLayers(
  file: File,
  layerIds: string[]
): Promise<{ bytes: Uint8Array; removed: number }> {
  const doc = await loadPdf(file);
  const props = doc.catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict);
  if (!props) throw new Error('This PDF has no optional content layers');
  const groups = props.lookupMaybe(PDFName.of('OCGs'), PDFArray);
  if (!groups) throw new Error('This PDF has no optional content layers');

  const targetRefs = new Set(layerIds);
  if (targetRefs.size === 0) throw new Error('Select at least one layer');

  // Map each page's /Properties name (e.g. /MC0) back to the OCG reference.
  let removed = 0;
  for (const page of doc.getPages()) {
    const resources = page.node.lookupMaybe(PDFName.of('Resources'), PDFDict);
    const properties = resources?.lookupMaybe(
      PDFName.of('Properties'),
      PDFDict
    );
    if (!properties) continue;

    const targetNames = new Set<string>();
    for (const key of properties.keys()) {
      const ref = properties.get(key);
      if (targetRefs.has(String(ref))) targetNames.add(key.asString());
    }
    if (targetNames.size === 0) continue;

    const contents = page.node.Contents();
    if (!contents) continue;

    const raw = await readContentStream(doc, page.node);
    if (!raw) continue;
    const { text, count } = stripMarkedContent(raw, targetNames);
    if (count === 0) continue;
    removed += count;

    const stream = doc.context.flateStream(text);
    page.node.set(PDFName.of('Contents'), doc.context.register(stream));
  }

  // Drop the removed groups from the OCG list so viewers stop showing them.
  const keep = PDFArray.withContext(doc.context);
  for (let i = 0; i < groups.size(); i++) {
    const ref = groups.get(i);
    if (!targetRefs.has(String(ref))) keep.push(ref);
  }
  if (keep.size() === 0) {
    doc.catalog.delete(PDFName.of('OCProperties'));
  } else {
    props.set(PDFName.of('OCGs'), keep);
    const config = props.lookupMaybe(PDFName.of('D'), PDFDict);
    if (config) {
      config.delete(PDFName.of('OFF'));
      config.delete(PDFName.of('ON'));
    }
  }

  return { bytes: await doc.save(), removed };
}

/** Page contents may be one stream or an array of them. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readContentStream(
  doc: any,
  pageNode: any
): Promise<string | null> {
  const decode = (candidate: unknown): string | null => {
    const stream = candidate as { getContents?: () => Uint8Array } | null;
    if (!stream || typeof stream.getContents !== 'function') return null;
    return new TextDecoder('latin1').decode(stream.getContents());
  };

  try {
    const contents = pageNode.Contents();
    if (contents instanceof PDFArray) {
      const parts: string[] = [];
      for (let i = 0; i < contents.size(); i++) {
        const piece = decode(contents.lookup(i));
        if (piece !== null) parts.push(piece);
      }
      return parts.length > 0 ? parts.join('\n') : null;
    }
    return decode(doc.context.lookup(pageNode.get(PDFName.of('Contents'))));
  } catch {
    // Streams we cannot decode are left untouched.
    return null;
  }
}

/**
 * Remove `/OC /Name BDC … EMC` blocks whose name is in `targets`.
 * Nesting is tracked so an inner BDC does not close the outer block early.
 */
export function stripMarkedContent(
  source: string,
  targets: Set<string>
): { text: string; count: number } {
  const token = /\/OC\s*\/([A-Za-z0-9._-]+)\s+BDC|\bBDC\b|\bEMC\b/g;
  let out = '';
  let cursor = 0;
  let count = 0;
  let match: RegExpExecArray | null;

  while ((match = token.exec(source)) !== null) {
    const name = match[1];
    if (!name || !targets.has(name)) continue;

    // Found the start of a target block; walk forward to its matching EMC.
    out += source.slice(cursor, match.index);
    let depth = 1;
    const scanner = /\bBDC\b|\bBMC\b|\bEMC\b/g;
    scanner.lastIndex = token.lastIndex;
    let end = source.length;
    let inner: RegExpExecArray | null;
    while ((inner = scanner.exec(source)) !== null) {
      if (inner[0] === 'EMC') {
        depth--;
        if (depth === 0) {
          end = inner.index + 3;
          break;
        }
      } else {
        depth++;
      }
    }
    cursor = end;
    token.lastIndex = end;
    count++;
  }

  out += source.slice(cursor);
  return { text: out, count };
}
