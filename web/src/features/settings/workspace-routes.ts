/**
 * Tools that take over the whole viewport with their own chrome.
 * AppShell hides its header/footer on these routes so users get one toolbar.
 */
export const WORKSPACE_SLUGS = new Set([
  'pdf-multi-tool',
  'organize-pdf',
  'edit-pdf',
  'form-creator',
  'pdf-workflow',
]);

export function isWorkspacePath(pathname: string): boolean {
  const match = pathname.match(/^\/tools\/([^/]+)\/?$/);
  if (!match?.[1]) return false;
  return WORKSPACE_SLUGS.has(match[1]);
}
