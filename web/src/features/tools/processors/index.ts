import type { ToolEntry, ToolProcessor } from '../types';
import { convertProcessors, rasterizeProcessor } from './convert';
import { editProcessors } from './edit';
import { organizeProcessors } from './organize';
import { optimizeProcessors, secureProcessors } from './secure';

/** Every slug backed by a real, honest implementation. */
const processors: Record<string, ToolProcessor> = {
  ...organizeProcessors,
  ...editProcessors,
  ...convertProcessors,
  ...secureProcessors,
  ...optimizeProcessors,
  'rasterize-pdf': rasterizeProcessor,
};

/** Slugs handled by a dedicated full-page UI rather than the generic form. */
const workspaces: Record<string, 'multi-tool' | 'merge'> = {
  'pdf-multi-tool': 'multi-tool',
  'organize-pdf': 'multi-tool',
};

/**
 * Tools that are genuinely not implemented yet.
 *
 * These render a clear "not available" state with no run button. Nothing here
 * silently falls back to a different operation — a tool that cannot do its job
 * must say so.
 */
const unavailable: Record<string, string> = {
  'pdf-workflow':
    'The visual pipeline builder has not been rebuilt on the new UI yet. Chain the individual tools in the meantime.',
  'edit-pdf':
    'The full page editor (freehand drawing, text boxes, redaction) has not been rebuilt yet. Annotation-adjacent tools such as Add Stamps, Sign PDF and Add Watermark work today.',
  'form-creator':
    'Designing new form fields needs an interactive canvas that has not been rebuilt yet. Form Filler can read and fill existing fields.',
  'pdf-layers':
    'Editing optional content groups (OCG layers) is not implemented. Flatten PDF removes layer interactivity if that is what you need.',
  'pdf-to-pdfa':
    'PDF/A conversion requires colour-profile embedding and compliance validation that this build does not ship.',
  'pdf-to-svg':
    'pdf.js removed its SVG renderer, so vector export is unavailable. PDF to PNG produces high-resolution raster output.',
  'font-to-outline':
    'Converting embedded fonts to vector outlines needs a font engine that is not bundled. Rasterize PDF removes font dependencies at the cost of selectable text.',
  'mobi-to-pdf':
    'MOBI is a proprietary Kindle format that the bundled conversion engine cannot read. Convert to EPUB first, then use EPUB to PDF.',
  'pages-to-pdf':
    'Apple Pages files are not readable by the bundled conversion engine. Export to DOCX or PDF from Pages instead.',
  'psd-to-pdf':
    'Photoshop documents need a layered-image decoder that is not bundled. Export a flattened PNG or TIFF first.',
};

export function getToolEntry(slug: string): ToolEntry {
  const workspace = workspaces[slug];
  if (workspace) return { status: 'workspace', kind: workspace };

  const processor = processors[slug];
  if (processor) return { status: 'ready', processor };

  const reason = unavailable[slug];
  if (reason) return { status: 'unavailable', reason };

  // An unknown slug is a gap in the catalog, not a licence to guess.
  return {
    status: 'unavailable',
    reason: 'This tool has no implementation in this build.',
  };
}

export function isImplemented(slug: string): boolean {
  return Boolean(processors[slug] || workspaces[slug]);
}

export const implementedSlugs = new Set([
  ...Object.keys(processors),
  ...Object.keys(workspaces),
]);

export const unavailableSlugs = new Set(Object.keys(unavailable));
