import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export const LAYOUT_KEY = 'layoutMode';
/** Pre-2.9 boolean key. Read once for migration, then ignored. */
const LEGACY_FULL_WIDTH_KEY = 'fullWidthMode';
export const COMPACT_KEY = 'compactMode';

/**
 * fixed: centered column capped at --app-max-fixed (72rem). Reads well on any monitor.
 * wide:  fluid, uses the screen up to --app-max-wide (120rem) and adds grid columns.
 */
export type LayoutMode = 'fixed' | 'wide';

export type AppSettings = {
  layout: LayoutMode;
  /** Denser home tool cards (default: true on small screens when unset). */
  compact: boolean;
};

type SettingsContextValue = AppSettings & {
  setLayout: (value: LayoutMode) => void;
  setCompact: (value: boolean) => void;
  reset: () => void;
  ready: boolean;
  /** Opens the settings dialog from anywhere (shell header, workspace headers). */
  openSettings: () => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

const DEFAULTS: AppSettings = { layout: 'fixed', compact: false };

function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 639px)').matches;
}

export function readLayout(): LayoutMode {
  if (typeof window === 'undefined') return DEFAULTS.layout;
  try {
    const stored = localStorage.getItem(LAYOUT_KEY);
    if (stored === 'fixed' || stored === 'wide') return stored;
    // Only an explicit opt-in to the old "full width" maps to wide.
    if (localStorage.getItem(LEGACY_FULL_WIDTH_KEY) === 'true') return 'wide';
  } catch {
    // storage blocked
  }
  return DEFAULTS.layout;
}

/**
 * Explicit true/false from storage; when unset, compact on narrow viewports
 * so the catalog is scannable on phones.
 */
export function readCompact(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const stored = localStorage.getItem(COMPACT_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
    return isMobileViewport();
  } catch {
    return false;
  }
}

/** Apply layout tokens on <html> (shared by the FOUC head script and React). */
export function applyLayoutClasses(settings: AppSettings) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.layout = settings.layout;
  root.classList.toggle('density-compact', settings.compact);
  root.dataset.density = settings.compact ? 'compact' : 'comfortable';
}

/**
 * Inline FOUC bootstrap for <head>. Keep in sync with readLayout / readCompact.
 * Applies to documentElement only (body may not exist yet).
 */
export const SETTINGS_BOOT_SCRIPT = `(function(){try{var r=document.documentElement;var l=localStorage.getItem('${LAYOUT_KEY}');if(l!=='fixed'&&l!=='wide'){l=localStorage.getItem('${LEGACY_FULL_WIDTH_KEY}')==='true'?'wide':'fixed';}r.dataset.layout=l;var c=localStorage.getItem('${COMPACT_KEY}');var compact=c==='true'||(c!=='false'&&window.matchMedia('(max-width: 639px)').matches);r.classList.toggle('density-compact',compact);r.dataset.density=compact?'compact':'comfortable';}catch(e){}})();`;

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private mode / quota: still applied for the session.
  }
}

export function SettingsProvider({
  children,
  onOpenSettings,
}: {
  children: ReactNode;
  onOpenSettings: () => void;
}) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS);
  const [ready, setReady] = useState(false);
  const settingsRef = useRef<AppSettings>(DEFAULTS);

  const commit = useCallback((next: AppSettings) => {
    settingsRef.current = next;
    setSettings(next);
    applyLayoutClasses(next);
  }, []);

  useEffect(() => {
    commit({ layout: readLayout(), compact: readCompact() });
    setReady(true);
  }, [commit]);

  const setLayout = useCallback(
    (layout: LayoutMode) => {
      commit({ ...settingsRef.current, layout });
      store(LAYOUT_KEY, layout);
      store(LEGACY_FULL_WIDTH_KEY, null);
    },
    [commit]
  );

  const setCompact = useCallback(
    (compact: boolean) => {
      commit({ ...settingsRef.current, compact });
      store(COMPACT_KEY, String(compact));
    },
    [commit]
  );

  const reset = useCallback(() => {
    store(LAYOUT_KEY, null);
    store(LEGACY_FULL_WIDTH_KEY, null);
    store(COMPACT_KEY, null);
    commit({ layout: DEFAULTS.layout, compact: readCompact() });
  }, [commit]);

  const value = useMemo(
    () => ({
      ...settings,
      setLayout,
      setCompact,
      reset,
      ready,
      openSettings: onOpenSettings,
    }),
    [settings, setLayout, setCompact, reset, ready, onOpenSettings]
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
