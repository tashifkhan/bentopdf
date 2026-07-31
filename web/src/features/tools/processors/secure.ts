import * as pdf from '~/lib/pdf/core';
import * as qpdf from '~/lib/pdf/qpdf';
import * as struct from '~/lib/pdf/structure';
import * as sign from '~/lib/pdf/sign';
import { ocrPdf, ocrToText, OCR_LANGUAGES } from '~/lib/pdf/ocr';
import { deskewPdf } from '~/lib/pdf/enhance';
import type { ToolField, ToolProcessor } from '../types';
import {
  PDF,
  checkbox,
  derive,
  first,
  num,
  onePdf,
  passwordField,
  processor,
  rangeSlider,
  selectField,
  str,
  textResult,
} from './common';

const permissionFields: ToolField[] = [
  selectField(
    'print',
    'Printing',
    [
      { value: 'full', label: 'Allowed' },
      { value: 'low', label: 'Low resolution only' },
      { value: 'none', label: 'Not allowed' },
    ],
    'full'
  ),
  selectField(
    'modify',
    'Modification',
    [
      { value: 'all', label: 'Allowed' },
      { value: 'annotate', label: 'Comments and form filling' },
      { value: 'form', label: 'Form filling only' },
      { value: 'assembly', label: 'Page assembly only' },
      { value: 'none', label: 'Not allowed' },
    ],
    'all'
  ),
  checkbox('extract', 'Allow copying text and images', true),
  checkbox('accessibility', 'Allow screen readers', true),
  checkbox('annotate', 'Allow adding comments and annotations', true),
  checkbox('fillForms', 'Allow filling in form fields', true),
  checkbox('assemble', 'Allow page assembly (insert, rotate, delete)', true),
  checkbox('modifyOther', 'Allow other modifications', true),
];

function readPermissions(values: Record<string, string>): qpdf.Permissions {
  return {
    print: (values.print ?? 'full') as qpdf.Permissions['print'],
    modify: (values.modify ?? 'all') as qpdf.Permissions['modify'],
    extract: values.extract !== 'false',
    accessibility: values.accessibility !== 'false',
    annotate: values.annotate !== 'false',
    fillForms: values.fillForms !== 'false',
    assemble: values.assemble !== 'false',
    modifyOther: values.modifyOther !== 'false',
  };
}

export const secureProcessors: Record<string, ToolProcessor> = {
  'encrypt-pdf': processor({
    accept: PDF,
    multiple: false,
    fields: [
      {
        key: 'userPassword',
        label: 'Open password (user password)',
        type: 'password',
        defaultValue: '',
        help: 'Required to open the document. Leave blank to allow opening without a password.',
      },
      {
        key: 'ownerPassword',
        label: 'Permissions password (owner password)',
        type: 'password',
        defaultValue: '',
        help: 'Required to change permissions. Defaults to the open password if left blank.',
      },
      checkbox('restrict', 'Apply usage restrictions', false),
      ...permissionFields.map((f) => ({
        ...f,
        showWhen: { key: 'restrict', equals: ['true'] },
      })),
    ],
    note: 'Encrypts with 256-bit AES using qpdf. Restrictions are only meaningful when the owner password differs from the open password.',
    async process(ctx) {
      const file = first(ctx);
      ctx.onProgress('Encrypting');
      const bytes = await qpdf.encryptPdf(
        file,
        str(ctx, 'userPassword'),
        str(ctx, 'ownerPassword'),
        ctx.values.restrict === 'true' ? readPermissions(ctx.values) : undefined
      );
      return {
        ...onePdf(bytes, derive(file, 'encrypted')),
        message: 'Encrypted with 256-bit AES.',
      };
    },
  }),

  'decrypt-pdf': processor({
    accept: PDF,
    multiple: false,
    fields: [
      {
        ...passwordField,
        label: 'Current password',
        help: 'The password needed to open the file.',
      },
    ],
    note: 'Removes encryption from a PDF you can already open. This is not a password recovery tool.',
    async process(ctx) {
      const file = first(ctx);
      ctx.onProgress('Decrypting');
      const bytes = await qpdf.decryptPdf(file, str(ctx, 'password'));
      return {
        ...onePdf(bytes, derive(file, 'decrypted')),
        message: 'Encryption removed.',
      };
    },
  }),

  'change-permissions': processor({
    accept: PDF,
    multiple: false,
    fields: [
      { ...passwordField, key: 'current', label: 'Current password (if any)' },
      {
        key: 'userPassword',
        label: 'New open password',
        type: 'password',
        defaultValue: '',
      },
      {
        key: 'ownerPassword',
        label: 'New owner password',
        type: 'password',
        defaultValue: '',
        help: 'Required — permissions are enforced by the owner password.',
      },
      ...permissionFields,
    ],
    async process(ctx) {
      const file = first(ctx);
      ctx.onProgress('Applying permissions');
      const bytes = await qpdf.changePermissions(
        file,
        str(ctx, 'current'),
        str(ctx, 'userPassword'),
        str(ctx, 'ownerPassword'),
        readPermissions(ctx.values)
      );
      return onePdf(bytes, derive(file, 'permissions'));
    },
  }),

  'remove-restrictions': processor({
    accept: PDF,
    multiple: false,
    fields: [
      { ...passwordField, label: 'Password (if the file needs one to open)' },
    ],
    note: 'Clears owner-password restrictions on files that open without a password. It cannot bypass an unknown open password.',
    async process(ctx) {
      const file = first(ctx);
      ctx.onProgress('Removing restrictions');
      const bytes = await qpdf.removeRestrictions(file, str(ctx, 'password'));
      return onePdf(bytes, derive(file, 'unrestricted'));
    },
  }),

  'sanitize-pdf': processor({
    accept: PDF,
    multiple: false,
    fields: [
      checkbox('javascript', 'Remove JavaScript and automatic actions', true),
      checkbox('embeddedFiles', 'Remove embedded files and attachments', true),
      checkbox(
        'launchActions',
        'Remove launch and external-file actions',
        true
      ),
      checkbox('links', 'Remove hyperlinks', false),
      checkbox('annotations', 'Remove all annotations and form fields', false),
      checkbox(
        'flattenForms',
        'Flatten form fields (keep values, drop interactivity)',
        false
      ),
      checkbox('layers', 'Remove optional content layers', false),
      checkbox('structureTree', 'Remove tagging / structure tree', false),
      checkbox('metadata', 'Remove document metadata', false),
    ],
    note: 'Strips active content that can execute when the document is opened.',
    async process(ctx) {
      const file = first(ctx);
      const opts = {
        javascript: ctx.values.javascript !== 'false',
        embeddedFiles: ctx.values.embeddedFiles !== 'false',
        launchActions: ctx.values.launchActions !== 'false',
        links: ctx.values.links === 'true',
        annotations: ctx.values.annotations === 'true',
        flattenForms: ctx.values.flattenForms === 'true',
        layers: ctx.values.layers === 'true',
        structureTree: ctx.values.structureTree === 'true',
        metadata: ctx.values.metadata === 'true',
      };
      if (!Object.values(opts).some(Boolean)) {
        throw new Error('Select at least one thing to remove');
      }
      const bytes = await struct.sanitizePdf(file, opts);
      return onePdf(bytes, derive(file, 'sanitized'));
    },
  }),

  'remove-metadata': processor({
    accept: PDF,
    multiple: false,
    async process(ctx) {
      const file = first(ctx);
      return onePdf(
        await pdf.removeMetadata(file),
        derive(file, 'no-metadata')
      );
    },
  }),

  /* --------------------------------------------------------- signing */

  'digital-sign-pdf': processor({
    accept: PDF,
    multiple: false,
    fields: [
      {
        key: 'certificate',
        label: 'Certificate (.p12 / .pfx / .pem)',
        type: 'file',
        accept: '.p12,.pfx,.pem,.crt,.cer',
      },
      { ...passwordField, label: 'Certificate password' },
      {
        key: 'reason',
        label: 'Reason',
        type: 'text',
        defaultValue: '',
        placeholder: 'e.g. I approve this document',
      },
      { key: 'location', label: 'Location', type: 'text', defaultValue: '' },
      { key: 'contact', label: 'Contact', type: 'text', defaultValue: '' },
      {
        key: 'tsaUrl',
        label: 'Timestamp authority URL (optional)',
        type: 'text',
        defaultValue: '',
        placeholder: 'https://freetsa.org/tsr',
        help: 'An RFC 3161 TSA adds a trusted signing time. Requires the server to allow browser requests.',
      },
    ],
    note: 'Applies a cryptographic PAdES-style signature. Certificates needing chain lookup over the network may require a CORS proxy (VITE_CORS_PROXY_URL).',
    async process(ctx) {
      const file = first(ctx);
      const certFile = ctx.extraFiles.certificate?.[0];
      if (!certFile) throw new Error('Choose a certificate file');
      const password = str(ctx, 'password');

      ctx.onProgress('Reading certificate');
      const name = certFile.name.toLowerCase();
      const credential =
        name.endsWith('.pem') || name.endsWith('.crt') || name.endsWith('.cer')
          ? await sign.loadCombinedPem(await certFile.text(), password)
          : await sign.loadPkcs12(certFile, password);

      ctx.onProgress('Signing');
      const bytes = await sign.digitallySign(file, credential, {
        reason: str(ctx, 'reason'),
        location: str(ctx, 'location'),
        contact: str(ctx, 'contact'),
        tsaUrl: str(ctx, 'tsaUrl'),
      });
      return {
        ...onePdf(bytes, derive(file, 'signed')),
        message: `Signed with ${credential.subject || 'the supplied certificate'}.`,
      };
    },
  }),

  'validate-signature-pdf': processor({
    accept: PDF,
    multiple: false,
    note: 'Checks cryptographic integrity and reports the embedded certificate. Supply an issuer certificate to also check the signer chains up to it.',
    fields: [
      {
        key: 'trustCert',
        label: 'Trusted issuer certificate (optional)',
        type: 'file',
        accept: '.pem,.crt,.cer,.der',
        help: 'PEM or DER. Used to check that the signing certificate was issued by this authority.',
      },
    ],
    async process(ctx) {
      const file = first(ctx);
      ctx.onProgress('Verifying signatures');
      const trustCert = ctx.extraFiles.trustCert?.[0];
      const signatures = await sign.verifySignatures(
        file,
        trustCert ? await trustCert.text() : undefined
      );
      const report = sign.formatVerificationReport(file, signatures);
      const summary =
        signatures.length === 0
          ? 'No digital signatures found.'
          : signatures.every((s) => s.digestValid)
            ? `${signatures.length} signature(s): all intact.`
            : 'One or more signatures could not be verified — see the report.';
      return {
        files: [report],
        message: summary,
        preview: {
          title: 'Signature report',
          text: new TextDecoder().decode(report.bytes),
        },
      };
    },
  }),

  'timestamp-pdf': processor({
    accept: PDF,
    multiple: false,
    fields: [
      {
        key: 'certificate',
        label: 'Certificate (.p12 / .pfx)',
        type: 'file',
        accept: '.p12,.pfx',
      },
      { ...passwordField, label: 'Certificate password' },
      {
        key: 'tsaUrl',
        label: 'Timestamp authority URL',
        type: 'text',
        defaultValue: 'https://freetsa.org/tsr',
        help: 'The TSA must send CORS headers for a browser to reach it.',
      },
    ],
    async process(ctx) {
      const file = first(ctx);
      const certFile = ctx.extraFiles.certificate?.[0];
      if (!certFile) throw new Error('Choose a certificate file');
      const credential = await sign.loadPkcs12(certFile, str(ctx, 'password'));
      ctx.onProgress('Requesting timestamp');
      const bytes = await sign.timestampPdf(
        file,
        credential,
        str(ctx, 'tsaUrl')
      );
      return onePdf(bytes, derive(file, 'timestamped'));
    },
  }),
};

export const optimizeProcessors: Record<string, ToolProcessor> = {
  'compress-pdf': processor({
    accept: PDF,
    multiple: false,
    rasterizes: true,
    fields: [
      selectField(
        'quality',
        'Compression level',
        [
          { value: '0.85', label: 'Light — best quality' },
          { value: '0.65', label: 'Balanced' },
          { value: '0.45', label: 'Strong' },
          { value: '0.3', label: 'Maximum — smallest file' },
        ],
        '0.65'
      ),
      selectField(
        'dpi',
        'Target resolution',
        [
          { value: '0.75', label: '54 dpi — screen only' },
          { value: '1', label: '72 dpi — screen' },
          { value: '1.25', label: '90 dpi — balanced' },
          { value: '2', label: '144 dpi — print' },
          { value: '3', label: '216 dpi — high quality' },
        ],
        '1.25'
      ),
      checkbox('greyscale', 'Convert to greyscale (much smaller)', false),
      checkbox('stripMetadata', 'Remove document metadata', false),
    ],
    note: 'Pages are re-rendered as JPEG images, which shrinks scanned documents dramatically but makes text unselectable.',
    async process(ctx) {
      const file = first(ctx);
      ctx.onProgress('Compressing');
      const bytes = await pdf.compressPdfRaster(
        file,
        num(ctx, 'quality', 0.65),
        num(ctx, 'dpi', 1.25),
        {
          greyscale: ctx.values.greyscale === 'true',
          stripMetadata: ctx.values.stripMetadata === 'true',
        }
      );
      const saved = file.size - bytes.length;
      return {
        ...onePdf(bytes, derive(file, 'compressed')),
        message:
          saved > 0
            ? `Reduced by ${Math.round((saved / file.size) * 100)}% (${Math.round(saved / 1024)} KB).`
            : 'This file did not get smaller — it may already be optimised.',
      };
    },
  }),

  'repair-pdf': processor({
    accept: PDF,
    multiple: false,
    note: 'Rebuilds the cross-reference table and object streams. Tries qpdf first, then a lenient reparse for files qpdf rejects outright.',
    async process(ctx) {
      const file = first(ctx);
      ctx.onProgress('Rebuilding structure');
      try {
        return {
          ...onePdf(await qpdf.repairPdf(file), derive(file, 'repaired')),
          message: 'Rebuilt with qpdf.',
        };
      } catch (qpdfError) {
        // qpdf refuses some damage that lenient parsers can still recover from,
        // so fall back to reparsing and re-serialising the document.
        ctx.onProgress('qpdf declined — trying a lenient reparse');
        try {
          const doc = await pdf.loadPdf(file);
          if (doc.getPageCount() === 0) {
            throw new Error('No readable pages', { cause: qpdfError });
          }
          const rebuilt = await doc.save();
          return {
            ...onePdf(rebuilt, derive(file, 'repaired')),
            message:
              'qpdf could not process this file, so it was rebuilt by reparsing. Check the result carefully.',
          };
        } catch (fallbackError) {
          throw qpdfError instanceof Error
            ? new Error(qpdfError.message, { cause: fallbackError })
            : new Error('Repair failed — the file may be too badly damaged', {
                cause: fallbackError,
              });
        }
      }
    },
  }),

  'linearize-pdf': processor({
    accept: PDF,
    multiple: false,
    note: 'Reorders the file for "fast web view" so the first page renders before the whole file downloads.',
    async process(ctx) {
      const file = first(ctx);
      ctx.onProgress('Linearizing');
      return onePdf(await qpdf.linearizePdf(file), derive(file, 'linearized'));
    },
  }),

  'fix-page-size': processor({
    accept: PDF,
    multiple: false,
    fields: [
      selectField(
        'size',
        'Target size',
        [...struct.PAGE_SIZE_OPTIONS, { value: 'custom', label: 'Custom…' }],
        'a4'
      ),
      {
        key: 'customWidth',
        label: 'Custom width',
        type: 'number',
        defaultValue: '210',
        min: 1,
        showWhen: { key: 'size', equals: ['custom'] },
      },
      {
        key: 'customHeight',
        label: 'Custom height',
        type: 'number',
        defaultValue: '297',
        min: 1,
        showWhen: { key: 'size', equals: ['custom'] },
      },
      {
        ...selectField(
          'customUnit',
          'Custom units',
          [
            { value: 'mm', label: 'Millimetres' },
            { value: 'in', label: 'Inches' },
            { value: 'pt', label: 'Points' },
          ],
          'mm'
        ),
        showWhen: { key: 'size', equals: ['custom'] },
      },
      selectField(
        'orientation',
        'Orientation',
        [
          { value: 'auto', label: 'Match each page' },
          { value: 'portrait', label: 'Portrait' },
          { value: 'landscape', label: 'Landscape' },
        ],
        'auto'
      ),
      {
        key: 'background',
        label: 'Background colour',
        type: 'color',
        defaultValue: '#ffffff',
      },
    ],
    note: 'Scales every page to a uniform sheet size, centred, without distorting the aspect ratio.',
    async process(ctx) {
      const file = first(ctx);
      const bytes = await struct.fixPageSize(
        file,
        str(ctx, 'size', 'a4'),
        str(ctx, 'orientation', 'auto') as 'auto' | 'portrait' | 'landscape',
        {
          custom: {
            width: num(ctx, 'customWidth', 210),
            height: num(ctx, 'customHeight', 297),
            unit: str(ctx, 'customUnit', 'mm'),
          },
          background: str(ctx, 'background', '#ffffff'),
        }
      );
      return onePdf(bytes, derive(file, 'resized'));
    },
  }),

  'page-dimensions': processor({
    accept: PDF,
    multiple: false,
    fields: [
      selectField(
        'unit',
        'Units',
        [
          { value: 'pt', label: 'Points' },
          { value: 'mm', label: 'Millimetres' },
          { value: 'cm', label: 'Centimetres' },
          { value: 'in', label: 'Inches' },
          { value: 'px', label: 'Pixels (96 dpi)' },
        ],
        'mm'
      ),
    ],
    async process(ctx) {
      const file = first(ctx);
      const unit = str(ctx, 'unit', 'mm');
      const report = await struct.readPageDimensions(file, unit);
      return textResult(
        derive(file, 'dimensions', 'csv'),
        report,
        'text/csv',
        `Page dimensions (${unit})`
      );
    },
  }),

  'deskew-pdf': processor({
    accept: PDF,
    multiple: false,
    rasterizes: true,
    fields: [
      checkbox('auto', 'Detect the skew angle automatically', true),
      {
        key: 'angle',
        label: 'Manual angle (degrees)',
        type: 'number',
        defaultValue: '0',
        step: 0.1,
        showWhen: { key: 'auto', equals: ['false'] },
      },
    ],
    note: 'Straightens tilted scans. Detection scores candidate angles by how sharply text lines align.',
    async process(ctx) {
      const file = first(ctx);
      ctx.onProgress('Analysing page skew');
      const auto = ctx.values.auto !== 'false';
      const { bytes, angles } = await deskewPdf(file, {
        auto,
        angle: num(ctx, 'angle', 0),
      });
      const summary = auto
        ? `Corrected by ${angles.map((a) => `${a.toFixed(2)}°`).join(', ')}`
        : `Rotated every page by ${num(ctx, 'angle', 0)}°`;
      return { ...onePdf(bytes, derive(file, 'deskewed')), message: summary };
    },
  }),

  'ocr-pdf': processor({
    accept: PDF,
    multiple: false,
    fields: [
      selectField('language', 'Language', OCR_LANGUAGES, 'eng'),
      selectField(
        'output',
        'Output',
        [
          {
            value: 'pdf',
            label: 'Searchable PDF (adds an invisible text layer)',
          },
          { value: 'text', label: 'Plain text file' },
        ],
        'pdf'
      ),
      rangeSlider(
        'scale',
        'Render scale',
        1,
        4,
        0.5,
        2,
        'Higher values are slower but recognise small type better.'
      ),
      checkbox(
        'binarize',
        'Binarize before recognition',
        false,
        'Hard black/white conversion — helps on low-contrast or coloured scans.'
      ),
      selectField(
        'whitelist',
        'Restrict characters',
        [
          { value: '', label: 'No restriction' },
          { value: '0123456789', label: 'Digits only' },
          {
            value: '0123456789.,-$€£',
            label: 'Numbers and currency',
          },
          {
            value: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
            label: 'Letters only',
          },
          {
            value:
              'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
            label: 'Alphanumeric',
          },
        ],
        ''
      ),
    ],
    note: 'Recognition runs entirely in your browser. The language model (a few MB) is downloaded on first use.',
    async process(ctx) {
      const file = first(ctx);
      const language = str(ctx, 'language', 'eng');
      const scale = num(ctx, 'scale', 2);
      const onProgress = (message: string, fraction?: number) =>
        ctx.onProgress(message, fraction);

      const tuning = {
        binarize: ctx.values.binarize === 'true',
        whitelist: str(ctx, 'whitelist'),
      };

      if (str(ctx, 'output', 'pdf') === 'text') {
        const content = await ocrToText(file, language, {
          scale,
          onProgress,
          ...tuning,
        });
        if (!content.trim()) throw new Error('No text could be recognised');
        return textResult(
          derive(file, 'ocr', 'txt'),
          content,
          'text/plain',
          'Recognised text'
        );
      }

      const bytes = await ocrPdf(file, language, {
        scale,
        onProgress,
        ...tuning,
      });
      return {
        ...onePdf(bytes, derive(file, 'ocr')),
        message:
          'Added a searchable text layer — the original page content is unchanged.',
      };
    },
  }),
};
