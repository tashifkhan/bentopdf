/**
 * Signature tooling: visible (drawn) signatures, cryptographic signing with a
 * PKCS#12 / PEM credential, and verification of existing signatures.
 */
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { loadPdf, parsePageRange, stem, type OutFile } from './core';
import { decodeImage } from './convert';
import { canvasToBytes } from './render';

/* --------------------------------------------------- visible signature */

export type SignaturePlacement = {
  page: number;
  /** 0-1 fractions of page width/height, measured from the bottom-left. */
  x: number;
  y: number;
  width: number;
  rotate?: number;
};

/** Stamp a signature image (PNG/JPG, e.g. a drawn signature) onto a page. */
export async function applyImageSignature(
  file: File,
  signature: File,
  placement: SignaturePlacement
): Promise<Uint8Array> {
  const doc = await loadPdf(file);
  const pageIndex =
    Math.min(Math.max(placement.page, 1), doc.getPageCount()) - 1;
  const page = doc.getPage(pageIndex);

  const canvas = await decodeImage(signature);
  const png = await canvasToBytes(canvas, 'image/png');
  const img = await doc.embedPng(png);

  const { width: pw, height: ph } = page.getSize();
  const w = pw * placement.width;
  const h = (img.height / img.width) * w;
  page.drawImage(img, {
    x: pw * placement.x,
    y: ph * placement.y,
    width: w,
    height: h,
    rotate: degrees(placement.rotate ?? 0),
  });
  return doc.save();
}

/** Stamp a typed signature using a script-like standard font. */
export async function applyTextSignature(
  file: File,
  text: string,
  placement: SignaturePlacement,
  opts: { size?: number; color?: string } = {}
): Promise<Uint8Array> {
  if (!text.trim()) throw new Error('Enter the text to sign with');
  const doc = await loadPdf(file);
  const pageIndex =
    Math.min(Math.max(placement.page, 1), doc.getPageCount()) - 1;
  const page = doc.getPage(pageIndex);
  const font = await doc.embedFont(StandardFonts.HelveticaOblique);
  const { width: pw, height: ph } = page.getSize();
  const size = opts.size ?? 24;
  page.drawText(text, {
    x: pw * placement.x,
    y: ph * placement.y,
    size,
    font,
    color: rgb(0.05, 0.1, 0.35),
    rotate: degrees(placement.rotate ?? 0),
  });
  return doc.save();
}

/* ----------------------------------------------------- credential load */

export type Credential = {
  p12Buffer: ArrayBuffer;
  password: string;
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getForge(): Promise<any> {
  const mod = await import('node-forge');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod as any).default ?? mod;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function describeCert(cert: any): Omit<Credential, 'p12Buffer' | 'password'> {
  const attrText = (
    attrs: { name?: string; shortName?: string; value?: string }[]
  ) =>
    attrs
      .map((a) => `${a.shortName ?? a.name ?? '?'}=${a.value ?? ''}`)
      .join(', ');
  return {
    subject: attrText(cert.subject.attributes),
    issuer: attrText(cert.issuer.attributes),
    validFrom: cert.validity.notBefore.toISOString(),
    validTo: cert.validity.notAfter.toISOString(),
  };
}

/** Load a .p12 / .pfx credential. */
export async function loadPkcs12(
  file: File,
  password: string
): Promise<Credential> {
  const forge = await getForge();
  const buffer = await file.arrayBuffer();
  let p12;
  try {
    const asn1 = forge.asn1.fromDer(
      forge.util.createBuffer(new Uint8Array(buffer))
    );
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
  } catch {
    throw new Error('Could not open the certificate — check the password');
  }
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const cert = certBags[forge.pki.oids.certBag]?.[0]?.cert;
  if (!cert) throw new Error('No certificate found in this file');
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  if (!keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.length) {
    throw new Error(
      'No private key found in this file — it cannot be used to sign'
    );
  }
  return { p12Buffer: buffer, password, ...describeCert(cert) };
}

/** Load a PEM certificate + key pair, repackaging them as PKCS#12 for the signer. */
export async function loadPem(
  certPem: string,
  keyPem: string,
  keyPassword?: string
): Promise<Credential> {
  const forge = await getForge();
  const certificate = forge.pki.certificateFromPem(certPem);
  const privateKey = keyPem.includes('ENCRYPTED')
    ? (() => {
        if (!keyPassword)
          throw new Error('This private key is encrypted — enter its password');
        const key = forge.pki.decryptRsaPrivateKey(keyPem, keyPassword);
        if (!key)
          throw new Error(
            'Could not decrypt the private key — check the password'
          );
        return key;
      })()
    : forge.pki.privateKeyFromPem(keyPem);

  const password = keyPassword || crypto.randomUUID();
  const asn1 = forge.pkcs12.toPkcs12Asn1(privateKey, [certificate], password, {
    algorithm: '3des',
  });
  const der: string = forge.asn1.toDer(asn1).getBytes();
  const bytes = new Uint8Array(der.length);
  for (let i = 0; i < der.length; i++) bytes[i] = der.charCodeAt(i);

  return {
    p12Buffer: bytes.buffer,
    password,
    ...describeCert(certificate),
  };
}

/** Split a combined PEM blob holding both certificate and key. */
export async function loadCombinedPem(
  content: string,
  password?: string
): Promise<Credential> {
  const cert = content.match(
    /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/
  );
  const key = content.match(
    /-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----/
  );
  if (!cert) throw new Error('No certificate found in this PEM file');
  if (!key) throw new Error('No private key found in this PEM file');
  return loadPem(cert[0], key[0], password);
}

/* ------------------------------------------------------ digital signing */

export type DigitalSignOptions = {
  reason?: string;
  location?: string;
  contact?: string;
  /** RFC 3161 timestamp authority URL. */
  tsaUrl?: string;
};

/**
 * Apply a cryptographic signature. Note: certificates whose chain must be
 * fetched from an external AIA URL need a CORS-enabled proxy — set
 * VITE_CORS_PROXY_URL if your issuer requires it.
 */
export async function digitallySign(
  file: File,
  credential: Credential,
  opts: DigitalSignOptions = {}
): Promise<Uint8Array> {
  if (typeof window === 'undefined') {
    throw new Error('Signing is only available in the browser');
  }
  const { PdfSigner } = await import('zgapdfsigner');
  const signer = new PdfSigner({
    p12cert: credential.p12Buffer,
    pwd: credential.password,
    reason: opts.reason || undefined,
    location: opts.location || undefined,
    contact: opts.contact || undefined,
    signdate: new Date(),
    ...(opts.tsaUrl ? { signdate: 'tsa', tsa: { url: opts.tsaUrl } } : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  const input = new Uint8Array(await file.arrayBuffer());
  const signed = await signer.sign(input);
  return new Uint8Array(signed);
}

/* -------------------------------------------------------- verification */

export type SignatureInfo = {
  name: string;
  /** A document timestamp (/DocTimeStamp, ETSI.RFC3161) rather than a signature. */
  isTimestamp: boolean;
  /** Hash algorithm of the timestamp's messageImprint, e.g. SHA-256. */
  imprintAlgorithm?: string;
  /** MD5 or SHA-1 was used; such a result is never treated as intact. */
  usesInsecureDigest: boolean;
  reason: string;
  location: string;
  signedAt: string;
  signer: string;
  issuer: string;
  coversWholeDocument: boolean;
  digestValid: boolean;
  notes: string[];
};

const TST_INFO_OID = '1.2.840.113549.1.9.16.1.4';
const INSECURE_DIGESTS = new Set(['md5', 'sha1']);

/**
 * Verify embedded signatures: re-hash the signed byte ranges and check them
 * against the PKCS#7 message digest, then report what the signature covers.
 *
 * Document timestamps (/Type /DocTimeStamp, /SubFilter /ETSI.RFC3161) hold an
 * RFC 3161 token instead of a CMS signature over the document: the document
 * hash lives in the token's TSTInfo messageImprint, and the TSA signs the
 * TSTInfo. Both links are checked.
 */
export async function verifySignatures(
  file: File,
  trustedIssuerPem?: string
): Promise<SignatureInfo[]> {
  const forge = await getForge();
  // Parse the optional trust anchor once, up front.
  let trusted: unknown = null;
  if (trustedIssuerPem?.trim()) {
    try {
      trusted = forge.pki.certificateFromPem(trustedIssuerPem);
    } catch {
      throw new Error(
        'Could not read the trusted issuer certificate (PEM expected)'
      );
    }
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await loadPdf(file);

  const results: SignatureInfo[] = [];
  const raw = new TextDecoder('latin1').decode(bytes);

  // Locate every /ByteRange … /Contents pair in the raw file.
  const byteRangeRe = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = byteRangeRe.exec(raw)) !== null) {
    index++;
    const [a, b, c, d] = [
      parseInt(match[1]!, 10),
      parseInt(match[2]!, 10),
      parseInt(match[3]!, 10),
      parseInt(match[4]!, 10),
    ];
    const notes: string[] = [];
    const isTimestamp = isTimestampDictionary(raw, match.index);

    // The /Contents hex string is exactly the gap the ByteRange leaves out
    // (PDF 32000-1, 12.8.1); fall back to a nearby /Contents for odd files.
    const gapMatch = /^<([0-9A-Fa-f\s]+)>$/.exec(raw.slice(a + b, c).trim());
    const nearbyMatch = gapMatch
      ? null
      : /\/Contents\s*<([0-9A-Fa-f]+)>/.exec(
          raw.slice(match.index, match.index + 40000)
        );
    const contentsHex = (gapMatch?.[1] ?? nearbyMatch?.[1])?.replace(/\s/g, '');
    if (!contentsHex) {
      notes.push('Signature bytes could not be located');
      results.push(emptyInfo(index, notes, isTimestamp));
      continue;
    }

    const signedBytes = new Uint8Array(b + d);
    signedBytes.set(bytes.subarray(a, a + b), 0);
    signedBytes.set(bytes.subarray(c, c + d), b);

    const coversWholeDocument = c + d >= bytes.length - 64;

    let digestValid = false;
    let signer = '';
    let issuer = '';
    let signedAt = '';
    let imprintAlgorithm: string | undefined;
    let usesInsecureDigest = false;
    try {
      const der = forge.util.hexToBytes(contentsHex.replace(/(00)+$/, ''));
      const asn1 = forge.asn1.fromDer(der);
      const timestamp = isTimestamp ? unwrapTimestampToken(forge, asn1) : null;
      if (isTimestamp && !timestamp) {
        throw new Error('could not read the timestamp token');
      }
      const p7 = forge.pkcs7.messageFromAsn1(asn1);
      const cert = p7.certificates?.[0];
      if (cert) {
        const described = describeCert(cert);
        signer = described.subject;
        issuer = described.issuer;

        // Expiry is independent of the trust check and worth surfacing.
        const now = new Date();
        if (cert.validity.notAfter < now) {
          notes.push(
            `Signing certificate expired on ${cert.validity.notAfter.toISOString().slice(0, 10)}`
          );
        } else if (cert.validity.notBefore > now) {
          notes.push('Signing certificate is not valid yet');
        }

        if (trusted) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const issuedByTrusted = (trusted as any).verify(cert);
            notes.push(
              issuedByTrusted
                ? 'Chains to the supplied trusted issuer'
                : 'Does NOT chain to the supplied trusted issuer'
            );
          } catch {
            notes.push('Does NOT chain to the supplied trusted issuer');
          }
        }
      }

      // Compare the signed-attribute messageDigest with our own hash.
      const signerInfo = p7.rawCapture?.signature ? p7.rawCapture : null;
      const authAttrs = p7.rawCapture?.authenticatedAttributes as
        | { value?: unknown[] }[]
        | undefined;
      const digestAlgo =
        p7.rawCapture?.digestAlgorithm &&
        forge.pki.oids[forge.asn1.derToOid(p7.rawCapture.digestAlgorithm)];
      const algo = typeof digestAlgo === 'string' ? digestAlgo : 'sha256';
      if (INSECURE_DIGESTS.has(algo)) usesInsecureDigest = true;
      const md = forge.md[algo.replace('-', '')] ?? forge.md.sha256;
      const signedByteString = forge.util.createBuffer(signedBytes).getBytes();

      // A timestamp token signs its TSTInfo, which in turn holds the hash of
      // the document bytes (RFC 3161, 2.4.2).
      let imprintValid = true;
      if (timestamp) {
        imprintAlgorithm = timestamp.imprintAlgorithm.toUpperCase();
        if (INSECURE_DIGESTS.has(timestamp.imprintAlgorithm)) {
          usesInsecureDigest = true;
        }
        const imprintMd = forge.md[timestamp.imprintAlgorithm];
        if (!imprintMd) {
          imprintValid = false;
          notes.push(
            `Unsupported timestamp imprint algorithm ${timestamp.imprintAlgorithm}`
          );
        } else {
          const imprintHash = imprintMd.create();
          imprintHash.update(signedByteString);
          imprintValid = imprintHash.digest().getBytes() === timestamp.imprint;
          if (!imprintValid) {
            notes.push(
              'Document hash does not match the timestamp: PDF was modified after timestamping'
            );
          }
        }
        if (timestamp.genTime) signedAt = timestamp.genTime.toISOString();
      }

      const hash = md.create();
      hash.update(timestamp ? timestamp.tstInfo : signedByteString);
      const computed = hash.digest().toHex();

      const embedded = findMessageDigest(forge, authAttrs);
      if (embedded) {
        const attrValid = embedded.toLowerCase() === computed.toLowerCase();
        digestValid = attrValid && imprintValid;
        if (!attrValid) {
          notes.push(
            timestamp
              ? 'Timestamp token does not match its TSA signature'
              : 'Document has been modified since signing'
          );
        }
      } else if (signerInfo) {
        notes.push('Signature has no messageDigest attribute to check');
      }

      if (usesInsecureDigest) {
        digestValid = false;
        notes.push('Uses an insecure digest (MD5 / SHA-1)');
      }

      if (!signedAt) {
        const signingTime = findSigningTime(forge, authAttrs);
        if (signingTime) signedAt = signingTime;
      }
    } catch (e) {
      notes.push(
        `Could not parse the signature: ${e instanceof Error ? e.message : 'unknown error'}`
      );
    }

    if (!coversWholeDocument) {
      notes.push(
        'Signature does not cover the whole document (content was appended)'
      );
    }

    results.push({
      name: isTimestamp ? `Document Timestamp ${index}` : `Signature ${index}`,
      isTimestamp,
      imprintAlgorithm,
      usesInsecureDigest,
      reason: '',
      location: '',
      signedAt,
      signer,
      issuer,
      coversWholeDocument,
      digestValid,
      notes,
    });
  }

  // Enrich with field-level metadata where pdf-lib can see it.
  try {
    const fields = doc.getForm().getFields();
    results.forEach((info, i) => {
      const field = fields[i];
      if (field) info.name = field.getName();
    });
  } catch {
    // Signature fields are optional metadata; ignore when absent.
  }

  return results;
}

function emptyInfo(
  index: number,
  notes: string[],
  isTimestamp = false
): SignatureInfo {
  return {
    name: isTimestamp ? `Document Timestamp ${index}` : `Signature ${index}`,
    isTimestamp,
    usesInsecureDigest: false,
    reason: '',
    location: '',
    signedAt: '',
    signer: '',
    issuer: '',
    coversWholeDocument: false,
    digestValid: false,
    notes,
  };
}

/**
 * Whether the signature dictionary holding the /ByteRange at `at` is a
 * document timestamp. /Type is optional, so /SubFilter /ETSI.RFC3161 counts
 * too (ISO 32000-2, 12.8.5).
 */
function isTimestampDictionary(raw: string, at: number): boolean {
  const objStart = raw.lastIndexOf('obj', at);
  const start = objStart < 0 ? Math.max(0, at - 20000) : objStart;
  const endObj = raw.indexOf('endobj', at);
  const end = endObj < 0 ? Math.min(raw.length, at + 20000) : endObj;
  // Drop the (large) hex signature so the scan stays cheap.
  const dict = raw.slice(start, end).replace(/<[0-9A-Fa-f\s]+>/g, '<>');
  return (
    /\/Type\s*\/DocTimeStamp\b/.test(dict) ||
    /\/SubFilter\s*\/ETSI\.RFC3161\b/.test(dict)
  );
}

type TimestampToken = {
  /** DER-encoded TSTInfo as a binary string (what the TSA signed). */
  tstInfo: string;
  imprintAlgorithm: string;
  imprint: string;
  genTime?: Date;
};

/**
 * Read the TSTInfo out of an RFC 3161 timestamp token and relabel its
 * encapsulated content as id-data, since node-forge only parses SignedData
 * that wraps plain data. Mutates `contentInfo`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- node-forge ASN.1 nodes are untyped here */
function unwrapTimestampToken(
  forge: any,
  contentInfo: any
): TimestampToken | null {
  const children = (node: any): any[] | null =>
    node && Array.isArray(node.value) ? node.value : null;
  try {
    const signedData = children(children(contentInfo)?.[1])?.[0];
    const encapContentInfo = children(signedData)?.[2];
    const [typeNode, explicitContent] = children(encapContentInfo) ?? [];
    if (
      typeNode?.type !== forge.asn1.Type.OID ||
      forge.asn1.derToOid(typeNode.value) !== TST_INFO_OID
    ) {
      return null;
    }
    const octets = children(explicitContent)?.[0];
    if (!octets || octets.type !== forge.asn1.Type.OCTETSTRING) return null;
    const tstInfoDer: string =
      typeof octets.value === 'string'
        ? octets.value
        : octets.value.map((chunk: any) => chunk.value as string).join('');

    const tstInfo = children(forge.asn1.fromDer(tstInfoDer));
    const [hashAlgorithm, hashedMessage] = children(tstInfo?.[2]) ?? [];
    const imprintOidNode = children(hashAlgorithm)?.[0];
    if (
      imprintOidNode?.type !== forge.asn1.Type.OID ||
      hashedMessage?.type !== forge.asn1.Type.OCTETSTRING ||
      typeof hashedMessage.value !== 'string'
    ) {
      return null;
    }
    const imprintOid = forge.asn1.derToOid(imprintOidNode.value);
    const imprintName = forge.pki.oids[imprintOid];

    let genTime: Date | undefined;
    const genTimeNode = tstInfo?.[4];
    if (
      genTimeNode?.type === forge.asn1.Type.GENERALIZEDTIME &&
      typeof genTimeNode.value === 'string'
    ) {
      genTime = forge.asn1.generalizedTimeToDate(genTimeNode.value);
    }

    typeNode.value = forge.asn1.oidToDer(forge.pki.oids.data).getBytes();

    return {
      tstInfo: tstInfoDer,
      imprintAlgorithm:
        typeof imprintName === 'string' ? imprintName : imprintOid,
      imprint: hashedMessage.value,
      genTime,
    };
  } catch {
    return null;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findMessageDigest(forge: any, attrs: any): string | null {
  for (const attr of attrs ?? []) {
    try {
      const oid = forge.asn1.derToOid(attr.value[0].value);
      if (forge.pki.oids[oid] === 'messageDigest') {
        return forge.util.bytesToHex(attr.value[1].value[0].value);
      }
    } catch {
      // Attribute shapes vary; skip anything we cannot read.
    }
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findSigningTime(forge: any, attrs: any): string | null {
  for (const attr of attrs ?? []) {
    try {
      const oid = forge.asn1.derToOid(attr.value[0].value);
      if (forge.pki.oids[oid] === 'signingTime') {
        const value = attr.value[1].value[0].value;
        return new Date(value).toISOString();
      }
    } catch {
      // Same as above.
    }
  }
  return null;
}

export function formatVerificationReport(
  file: File,
  signatures: SignatureInfo[]
): OutFile {
  const lines = [`Signature report for ${file.name}`, ''];
  if (signatures.length === 0) {
    lines.push('This PDF contains no digital signatures.');
  }
  for (const sig of signatures) {
    const ts = sig.isTimestamp;
    lines.push(
      `${sig.name}`,
      `  Type:       ${ts ? 'document timestamp (RFC 3161)' : 'digital signature'}`,
      `  Integrity:  ${sig.digestValid ? `VALID — content matches the ${ts ? 'timestamp' : 'signature'}` : 'NOT VERIFIED'}`,
      `  Coverage:   ${sig.coversWholeDocument ? 'entire document' : 'partial'}`,
      `  ${ts ? 'TSA:   ' : 'Signer:'}     ${sig.signer || 'unknown'}`,
      `  Issuer:     ${sig.issuer || 'unknown'}`,
      `  ${ts ? 'Time:     ' : 'Signed at:'}  ${sig.signedAt || 'unknown'}`
    );
    if (sig.imprintAlgorithm) {
      lines.push(`  Imprint:    ${sig.imprintAlgorithm}`);
    }
    for (const note of sig.notes) lines.push(`  Note:       ${note}`);
    lines.push('');
  }
  lines.push(
    'Note: this checks cryptographic integrity and reports the embedded',
    'certificate. It does not validate the certificate chain against a trust',
    'store, so a VALID result does not by itself establish signer identity.'
  );
  return {
    name: `${stem(file.name)}-signature-report.txt`,
    bytes: new TextEncoder().encode(lines.join('\n')),
    mime: 'text/plain',
  };
}

/* --------------------------------------------------------- timestamping */

/** Apply a document-level RFC 3161 timestamp (a signature with no signer identity). */
export async function timestampPdf(
  file: File,
  credential: Credential,
  tsaUrl: string
): Promise<Uint8Array> {
  if (!tsaUrl) throw new Error('Enter a timestamp authority (TSA) URL');
  return digitallySign(file, credential, {
    reason: 'Timestamp',
    tsaUrl,
  });
}

/** Stamp a typed signature across a page range. */
export async function applyTextSignatureToPages(
  file: File,
  text: string,
  range: string,
  placement: Omit<SignaturePlacement, 'page'>,
  opts: { size?: number; color?: string } = {}
): Promise<Uint8Array> {
  if (!text.trim()) throw new Error('Enter the text to sign with');
  const doc = await loadPdf(file);
  const indices = parsePageRange(range, doc.getPageCount());
  const font = await doc.embedFont(StandardFonts.HelveticaOblique);
  const c = opts.color
    ? hexToRgbTuple(opts.color)
    : { r: 0.05, g: 0.1, b: 0.35 };
  const size = opts.size ?? 24;

  for (const i of indices) {
    const page = doc.getPage(i);
    const { width: pw, height: ph } = page.getSize();
    page.drawText(text, {
      x: pw * placement.x,
      y: ph * placement.y,
      size,
      font,
      color: rgb(c.r, c.g, c.b),
      rotate: degrees(placement.rotate ?? 0),
    });
  }
  return doc.save();
}

function hexToRgbTuple(hex: string) {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return { r: 0.05, g: 0.1, b: 0.35 };
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255,
  };
}

export async function applySignatureToPages(
  file: File,
  signature: File,
  range: string,
  placement: Omit<SignaturePlacement, 'page'>
): Promise<Uint8Array> {
  const doc = await loadPdf(file);
  const indices = parsePageRange(range, doc.getPageCount());
  const canvas = await decodeImage(signature);
  const png = await canvasToBytes(canvas, 'image/png');
  const img = await doc.embedPng(png);

  for (const i of indices) {
    const page = doc.getPage(i);
    const { width: pw, height: ph } = page.getSize();
    const w = pw * placement.width;
    const h = (img.height / img.width) * w;
    page.drawImage(img, {
      x: pw * placement.x,
      y: ph * placement.y,
      width: w,
      height: h,
      rotate: degrees(placement.rotate ?? 0),
    });
  }
  return doc.save();
}

export { PDFDocument };
