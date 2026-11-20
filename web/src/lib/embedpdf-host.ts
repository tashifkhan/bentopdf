/** BentoPDF palette mapped into EmbedPDF's theme tokens. */
export function bentoPdfTheme(preference: 'light' | 'dark') {
  return {
    preference,
    light: {
      background: {
        app: '#f2f0eb',
        surface: '#fffcf8',
        surfaceAlt: '#f6f3ed',
        elevated: '#fffcf8',
        overlay: 'rgb(21 27 24 / 0.45)',
        input: '#f6f3ed',
      },
      foreground: {
        primary: '#151b18',
        secondary: '#3f4843',
        muted: '#6a746e',
        disabled: '#939c96',
        onAccent: '#ffffff',
      },
      border: {
        default: '#e4dfd5',
        subtle: '#ebe7df',
        strong: '#cfc8bb',
      },
      accent: {
        primary: '#d24a33',
        primaryHover: '#b83f2c',
        primaryActive: '#a33726',
        primaryLight: 'rgb(210 74 51 / 0.12)',
        primaryForeground: '#ffffff',
      },
      interactive: {
        hover: 'rgb(26 61 53 / 0.06)',
        active: 'rgb(26 61 53 / 0.1)',
        selected: 'rgb(210 74 51 / 0.12)',
        focus: '#d24a33',
        focusRing: 'rgb(210 74 51 / 0.3)',
      },
      state: {
        error: '#c93b2c',
        errorLight: 'rgb(201 59 44 / 0.12)',
        warning: '#d97706',
        warningLight: 'rgb(217 119 6 / 0.12)',
        success: '#2d8f62',
        successLight: 'rgb(45 143 98 / 0.12)',
        info: '#1a3d35',
        infoLight: 'rgb(26 61 53 / 0.1)',
      },
      scrollbar: {
        track: '#f6f3ed',
        thumb: '#cfc8bb',
        thumbHover: '#939c96',
      },
      tooltip: {
        background: '#151b18',
        foreground: '#f7f4ee',
      },
    },
    dark: {
      background: {
        app: '#0d110f',
        surface: '#161c19',
        surfaceAlt: '#1c231f',
        elevated: '#1c231f',
        overlay: 'rgb(0 0 0 / 0.55)',
        input: '#1c231f',
      },
      foreground: {
        primary: '#f1eee7',
        secondary: '#c5ccc7',
        muted: '#8f9892',
        disabled: '#66706a',
        onAccent: '#ffffff',
      },
      border: {
        default: '#2a342f',
        subtle: '#252e29',
        strong: '#3c4a43',
      },
      accent: {
        primary: '#ff7a5c',
        primaryHover: '#ff8f77',
        primaryActive: '#e86a4f',
        primaryLight: 'rgb(255 122 92 / 0.14)',
        primaryForeground: '#ffffff',
      },
      interactive: {
        hover: 'rgb(125 207 182 / 0.08)',
        active: 'rgb(125 207 182 / 0.14)',
        selected: 'rgb(255 122 92 / 0.14)',
        focus: '#ff7a5c',
        focusRing: 'rgb(255 122 92 / 0.35)',
      },
      state: {
        error: '#e85d4c',
        errorLight: 'rgb(232 93 76 / 0.14)',
        warning: '#fbbf24',
        warningLight: 'rgb(251 191 36 / 0.14)',
        success: '#4ecf8c',
        successLight: 'rgb(78 207 140 / 0.14)',
        info: '#7dcfb6',
        infoLight: 'rgb(125 207 182 / 0.12)',
      },
      scrollbar: {
        track: '#1c231f',
        thumb: '#3c4a43',
        thumbHover: '#66706a',
      },
      tooltip: {
        background: '#f1eee7',
        foreground: '#0d110f',
      },
    },
  } as const;
}

/**
 * Resolve the public pdfium.wasm URL.
 *
 * Served from /public (like qpdf.wasm). Do not use `new URL(bare, import.meta.url)`
 * — Vite does not rewrite that for package paths and it 404s. Also avoid naive
 * string concat + `.replace('//', '/')`, which corrupts absolute BASE_URLs.
 */
export function pdfiumWasmUrl(): string {
  const base = import.meta.env.BASE_URL || '/';
  // BASE_URL always ends with `/` in Vite; keep a defensive join anyway.
  const path = base.endsWith('/')
    ? `${base}pdfium.wasm`
    : `${base}/pdfium.wasm`;
  if (typeof window === 'undefined') return path;
  return new URL(path, window.location.origin).href;
}

/**
 * Wait until `el` has a non-zero box. EmbedPDF virtualises pages from the
 * measured viewport — init while still `display:none` / 0×0 lays out nothing
 * and never recovers without a resize.
 */
export function waitForLaidOut(
  el: HTMLElement,
  signal: { cancelled: boolean }
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let ro: ResizeObserver | null = null;

    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      ro?.disconnect();
      resolve(ok);
    };

    const hasSize = () => el.clientWidth > 0 && el.clientHeight > 0;

    if (signal.cancelled) {
      done(false);
      return;
    }
    if (hasSize()) {
      done(true);
      return;
    }

    ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            if (signal.cancelled) done(false);
            else if (hasSize()) done(true);
          })
        : null;
    ro?.observe(el);

    // rAF fallback for environments without ResizeObserver / first paint race.
    let frames = 0;
    const tick = () => {
      if (settled) return;
      if (signal.cancelled) {
        done(false);
        return;
      }
      if (hasSize()) {
        done(true);
        return;
      }
      frames += 1;
      if (frames > 120) {
        done(false); // ~2s @ 60fps
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

type SizedHost = HTMLElement & {
  __sizeObserver?: ResizeObserver;
  __shadowObserver?: MutationObserver;
};

/**
 * Pin an EmbedPDF custom-element host (and its shadow content root) to the
 * container's pixel box. Percentage heights do not resolve against the host,
 * so without this the virtualised page list never paints. Same approach as
 * the PDF editor.
 */
export function pinHostSize(viewer: unknown, container: HTMLElement) {
  if (!(viewer instanceof HTMLElement)) return;
  const host = viewer as SizedHost;
  let syncing = false;
  const sync = () => {
    if (syncing) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w <= 0 || h <= 0) return;
    syncing = true;
    try {
      host.style.display = 'block';
      host.style.boxSizing = 'border-box';
      host.style.width = `${w}px`;
      host.style.height = `${h}px`;
      const root = host.shadowRoot;
      if (!root) return;
      for (const el of root.children) {
        if (!(el instanceof HTMLElement) || el.tagName === 'STYLE') continue;
        const want = `${h}px`;
        if (el.style.height !== want) {
          el.style.setProperty('box-sizing', 'border-box', 'important');
          el.style.setProperty('width', `${w}px`, 'important');
          el.style.setProperty('height', want, 'important');
          el.style.setProperty('min-height', want, 'important');
        }
      }
    } finally {
      syncing = false;
    }
  };
  sync();
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(sync);
    ro.observe(container);
    host.__sizeObserver = ro;
  }
  if (host.shadowRoot && typeof MutationObserver !== 'undefined') {
    const mo = new MutationObserver(sync);
    mo.observe(host.shadowRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style'],
    });
    host.__shadowObserver = mo;
  }
}

/** Disconnect observers and remove/destroy an EmbedPDF viewer. */
export function destroyHost(viewer: unknown) {
  try {
    if (viewer instanceof HTMLElement) {
      const host = viewer as SizedHost;
      host.__sizeObserver?.disconnect();
      host.__shadowObserver?.disconnect();
      host.remove();
    } else {
      (viewer as { destroy?: () => void } | null)?.destroy?.();
    }
  } catch {
    // Nothing to clean up.
  }
}
