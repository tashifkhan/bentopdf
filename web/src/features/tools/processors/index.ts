import type { ToolEntry, ToolProcessor, WorkspaceKind } from '../types';
import { convertProcessors, rasterizeProcessor } from './convert';
import { editProcessors } from './edit';
import { organizeProcessors } from './organize';
import { formatProcessors } from './formats';
import { optimizeProcessors, secureProcessors } from './secure';

/** Every slug backed by a real, honest implementation. */
const processors: Record<string, ToolProcessor> = {
  ...organizeProcessors,
  ...editProcessors,
  ...convertProcessors,
  ...secureProcessors,
  ...optimizeProcessors,
  ...formatProcessors,
  'rasterize-pdf': rasterizeProcessor,
};

/** Slugs handled by a dedicated full-page UI rather than the generic form. */
const workspaces: Record<string, WorkspaceKind> = {
  'pdf-multi-tool': 'multi-tool',
  'organize-pdf': 'multi-tool',
  'edit-pdf': 'editor',
  'form-creator': 'form-creator',
  'pdf-workflow': 'workflow',
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
