/**
 * PDF/A conversion (best effort).
 *
 * This performs the structural work PDF/A requires — an sRGB OutputIntent with
 * an embedded ICC profile, PDF/A identification XMP, a document ID, and removal
 * of the constructs the standard forbids (encryption, JavaScript, embedded
 * files for A-1/A-2, external actions).
 *
 * It deliberately does NOT claim compliance: font embedding and transparency
 * rules cannot be fully guaranteed from the browser, and nothing here runs a
 * validator. Rasterizing first (the "flatten" option) sidesteps the font rules
 * at the cost of selectable text.
 */
import { PDFDict, PDFHexString, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { loadPdf } from './core';
import { rasterizePdf } from './render';

/* ------------------------------------------------------- ICC profile ---- */

function s15Fixed16(value: number): number {
  return Math.round(value * 65536);
}

function writeTag(view: DataView, offset: number, tag: string) {
  for (let i = 0; i < 4; i++) view.setUint8(offset + i, tag.charCodeAt(i));
}

/**
 * Build a minimal but valid ICC v2 RGB display profile describing sRGB
 * (D50-adapted primaries, gamma 2.2). Small enough to embed without shipping a
 * binary asset.
 */
export function buildSrgbIccProfile(): Uint8Array {
  const description = 'sRGB IEC61966-2.1';
  const copyright = 'Public Domain';

  // desc: 4 sig + 4 pad + 4 count + string + 4 + 4 + 2 + 1 + 67
  const descSize = 4 + 4 + 4 + (description.length + 1) + 4 + 4 + 2 + 1 + 67;
  const textSize = 4 + 4 + (copyright.length + 1);
  const xyzSize = 4 + 4 + 12;
  const curvSize = 4 + 4 + 4 + 2;

  const tags: { sig: string; size: number }[] = [
    { sig: 'desc', size: descSize },
    { sig: 'wtpt', size: xyzSize },
    { sig: 'rXYZ', size: xyzSize },
    { sig: 'gXYZ', size: xyzSize },
    { sig: 'bXYZ', size: xyzSize },
    { sig: 'rTRC', size: curvSize },
    { sig: 'gTRC', size: curvSize },
    { sig: 'bTRC', size: curvSize },
    { sig: 'cprt', size: textSize },
  ];

  const headerSize = 128;
  const tableSize = 4 + tags.length * 12;
  const align = (n: number) => (n + 3) & ~3;

  let cursor = align(headerSize + tableSize);
  const placed = tags.map((t) => {
    const offset = cursor;
    cursor = align(cursor + t.size);
    return { ...t, offset };
  });
  const total = cursor;

  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);

  // --- header ---
  view.setUint32(0, total);
  writeTag(view, 4, 'none');
  view.setUint32(8, 0x02100000); // v2.1
  writeTag(view, 12, 'mntr');
  writeTag(view, 16, 'RGB ');
  writeTag(view, 20, 'XYZ ');
  view.setUint16(24, 2026); // date: year
  view.setUint16(26, 1);
  view.setUint16(28, 1);
  writeTag(view, 36, 'acsp');
  view.setUint32(64, 0); // perceptual rendering intent
  // PCS illuminant is always D50.
  view.setInt32(68, s15Fixed16(0.9642));
  view.setInt32(72, s15Fixed16(1.0));
  view.setInt32(76, s15Fixed16(0.8249));

  // --- tag table ---
  view.setUint32(headerSize, placed.length);
  placed.forEach((tag, i) => {
    const entry = headerSize + 4 + i * 12;
    writeTag(view, entry, tag.sig);
    view.setUint32(entry + 4, tag.offset);
    view.setUint32(entry + 8, tag.size);
  });

  const xyzValues: Record<string, [number, number, number]> = {
    wtpt: [0.9642, 1.0, 0.8249],
    rXYZ: [0.436, 0.2225, 0.0139],
    gXYZ: [0.3851, 0.7169, 0.0971],
    bXYZ: [0.1431, 0.0606, 0.7141],
  };

  for (const tag of placed) {
    const o = tag.offset;
    if (tag.sig === 'desc') {
      writeTag(view, o, 'desc');
      view.setUint32(o + 8, description.length + 1);
      for (let i = 0; i < description.length; i++) {
        view.setUint8(o + 12 + i, description.charCodeAt(i));
      }
    } else if (tag.sig === 'cprt') {
      writeTag(view, o, 'text');
      for (let i = 0; i < copyright.length; i++) {
        view.setUint8(o + 8 + i, copyright.charCodeAt(i));
      }
    } else if (tag.sig.endsWith('TRC')) {
      writeTag(view, o, 'curv');
      view.setUint32(o + 8, 1);
      view.setUint16(o + 12, Math.round(2.2 * 256)); // u8Fixed8 gamma
    } else {
      const xyz = xyzValues[tag.sig]!;
      writeTag(view, o, 'XYZ ');
      view.setInt32(o + 8, s15Fixed16(xyz[0]));
      view.setInt32(o + 12, s15Fixed16(xyz[1]));
      view.setInt32(o + 16, s15Fixed16(xyz[2]));
    }
  }

  return new Uint8Array(buffer);
}

/* -------------------------------------------------------------- XMP ---- */

function xmpPacket(part: string, conformance: string, title: string): string {
  const now = new Date().toISOString();
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
        xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"
        xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <pdfaid:part>${part}</pdfaid:part>
      <pdfaid:conformance>${conformance}</pdfaid:conformance>
      <xmp:CreateDate>${now}</xmp:CreateDate>
      <xmp:ModifyDate>${now}</xmp:ModifyDate>
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')}</rdf:li></rdf:Alt></dc:title>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/* ------------------------------------------------------- conversion ---- */

export type PdfaOptions = {
  /** "1" | "2" | "3" — the PDF/A part to declare. */
  part: string;
  conformance: 'B' | 'A';
  /** Rasterize first, sidestepping font-embedding rules. */
  flatten: boolean;
  rasterScale: number;
};

export async function toPdfA(
  file: File,
  opts: PdfaOptions,
  onProgress?: (message: string) => void
): Promise<{ bytes: Uint8Array; notes: string[] }> {
  const notes: string[] = [];

  let source = file;
  if (opts.flatten) {
    onProgress?.('Rasterizing pages');
    const raster = await rasterizePdf(file, {
      scale: opts.rasterScale,
      format: 'jpeg',
      quality: 0.92,
    });
    source = new File(
      [new Uint8Array(raster).buffer as ArrayBuffer],
      file.name,
      {
        type: 'application/pdf',
      }
    );
    notes.push('Pages were rasterized, so no font embedding is required.');
  }

  onProgress?.('Applying PDF/A structure');
  const doc = await loadPdf(source);
  const context = doc.context;
  const catalog = doc.catalog;

  // PDF/A forbids these outright.
  catalog.delete(PDFName.of('OpenAction'));
  catalog.delete(PDFName.of('AA'));
  const names = catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  if (names) {
    names.delete(PDFName.of('JavaScript'));
    if (opts.part !== '3') {
      // Embedded files are only allowed from PDF/A-3 onwards.
      names.delete(PDFName.of('EmbeddedFiles'));
      notes.push('Embedded files were removed (not permitted before PDF/A-3).');
    }
  }

  // --- OutputIntent with an embedded sRGB profile ---
  const icc = buildSrgbIccProfile();
  const iccStream = context.flateStream(icc, {
    N: PDFNumber.of(3),
  });
  const iccRef = context.register(iccStream);

  const outputIntent = PDFDict.withContext(context);
  outputIntent.set(PDFName.of('Type'), PDFName.of('OutputIntent'));
  outputIntent.set(PDFName.of('S'), PDFName.of('GTS_PDFA1'));
  outputIntent.set(
    PDFName.of('OutputConditionIdentifier'),
    PDFString.of('sRGB IEC61966-2.1')
  );
  outputIntent.set(PDFName.of('Info'), PDFString.of('sRGB IEC61966-2.1'));
  outputIntent.set(
    PDFName.of('RegistryName'),
    PDFString.of('http://www.color.org')
  );
  outputIntent.set(PDFName.of('DestOutputProfile'), iccRef);

  const intents = context.obj([outputIntent]);
  catalog.set(PDFName.of('OutputIntents'), intents);

  // --- XMP identification ---
  const title = doc.getTitle() || file.name;
  const xmp = xmpPacket(opts.part, opts.conformance, title);
  const metadataStream = context.stream(xmp, {
    Type: PDFName.of('Metadata'),
    Subtype: PDFName.of('XML'),
  });
  catalog.set(PDFName.of('Metadata'), context.register(metadataStream));

  // --- document ID is mandatory ---
  const id = crypto.randomUUID().replace(/-/g, '').toUpperCase();
  const idHex = PDFHexString.of(id);
  context.trailerInfo.ID = context.obj([idHex, idHex]);

  doc.setProducer('BentoPDF');
  if (!doc.getCreationDate()) doc.setCreationDate(new Date());
  doc.setModificationDate(new Date());

  if (!opts.flatten) {
    notes.push(
      'Fonts were not re-embedded. If the source PDF references non-embedded fonts, a validator will still flag it — re-run with flattening enabled.'
    );
  }
  if (opts.conformance === 'A') {
    notes.push(
      'Level A additionally requires a tagged structure tree, which this build does not generate. Level B is the safe choice.'
    );
  }

  return { bytes: await doc.save(), notes };
}
