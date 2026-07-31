/**
 * Ghostscript-WASM bindings.
 *
 * Ghostscript is GPL and ~10 MB, so it is not bundled. The user points the app
 * at a build they host (or a CDN they trust) and the URL is remembered locally.
 * This mirrors how the previous build handled it.
 */

const STORAGE_KEY = 'bentopdf.wasm.ghostscript';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GsInstance = any;

let cached: GsInstance | null = null;
let cachedFor: string | null = null;

export function getGhostscriptUrl(): string {
  if (typeof localStorage === 'undefined') return '';
  return (
    localStorage.getItem(STORAGE_KEY) ??
    (import.meta.env.VITE_GHOSTSCRIPT_URL as string | undefined) ??
    ''
  );
}

export function setGhostscriptUrl(url: string) {
  if (typeof localStorage === 'undefined') return;
  const trimmed = url.trim();
  if (trimmed) localStorage.setItem(STORAGE_KEY, trimmed);
  else localStorage.removeItem(STORAGE_KEY);
  // A different build means the cached module is stale.
  cached = null;
  cachedFor = null;
}

export function isGhostscriptConfigured(): boolean {
  return getGhostscriptUrl().length > 0;
}

/**
 * Load `gs.js` from the configured base URL and instantiate it.
 * The script is fetched, then imported from a blob URL so the module resolves
 * even when the host serves it without the right MIME type.
 */
async function loadGhostscript(
  baseUrl: string,
  onProgress?: (message: string) => void
): Promise<GsInstance> {
  if (cached && cachedFor === baseUrl) return cached;

  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  onProgress?.('Downloading Ghostscript');

  let response: Response;
  try {
    response = await fetch(`${base}gs.js`);
  } catch {
    throw new Error(
      `Could not reach ${base}gs.js. Check the URL and that the server allows cross-origin requests.`
    );
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch gs.js: HTTP ${response.status}`);
  }

  const source = await response.text();
  const blobUrl = URL.createObjectURL(
    new Blob([source], { type: 'text/javascript' })
  );
  try {
    const mod = await import(/* @vite-ignore */ blobUrl);
    const factory = mod.default ?? mod;
    if (typeof factory !== 'function') {
      throw new Error('gs.js did not export a module factory');
    }
    onProgress?.('Starting Ghostscript');
    const instance = await factory({
      locateFile: (path: string) =>
        path.endsWith('.wasm') ? `${base}gs.wasm` : `${base}${path}`,
      noExitRuntime: true,
      print: () => {},
      printErr: () => {},
    });
    cached = instance;
    cachedFor = baseUrl;
    return instance;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/**
 * Convert all text to vector outlines.
 *
 * `-dNoOutputFonts` makes Ghostscript emit glyphs as filled paths instead of
 * font references, which is exactly what "flatten fonts" means. The result
 * renders identically anywhere but is no longer selectable or searchable.
 */
export async function fontsToOutlines(
  file: File,
  onProgress?: (message: string) => void
): Promise<Uint8Array> {
  const baseUrl = getGhostscriptUrl();
  if (!baseUrl) {
    throw new Error(
      'No Ghostscript build configured. Paste the URL of a Ghostscript-WASM build (a folder containing gs.js and gs.wasm) in the field above.'
    );
  }

  const gs = await loadGhostscript(baseUrl, onProgress);
  const input = '/input.pdf';
  const output = '/output.pdf';

  onProgress?.('Converting fonts to outlines');
  gs.FS.writeFile(input, new Uint8Array(await file.arrayBuffer()));

  try {
    const args = [
      '-dNOPAUSE',
      '-dBATCH',
      '-dSAFER',
      '-sDEVICE=pdfwrite',
      '-dNoOutputFonts',
      '-dCompressPages=true',
      '-dAutoRotatePages=/None',
      `-sOutputFile=${output}`,
      input,
    ];

    let code: number;
    try {
      code = gs.callMain(args);
    } catch (e) {
      throw new Error(
        `Ghostscript failed: ${e instanceof Error ? e.message : 'unknown error'}`,
        { cause: e }
      );
    }
    if (code !== 0) {
      throw new Error(
        `Ghostscript exited with code ${code} — the PDF may be encrypted or damaged.`
      );
    }

    const result = gs.FS.readFile(output);
    if (!result || result.length === 0) {
      throw new Error('Ghostscript produced an empty file');
    }
    return new Uint8Array(result);
  } finally {
    for (const path of [input, output]) {
      try {
        gs.FS.unlink(path);
      } catch {
        // Already gone.
      }
    }
  }
}
