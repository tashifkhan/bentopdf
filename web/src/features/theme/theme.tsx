import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/** Resolved theme actually painted on the page. */
export type Theme = 'light' | 'dark';
/** What the user picked. `system` follows prefers-color-scheme live. */
export type ThemePreference = Theme | 'system';

export const THEME_KEY = 'taf-pdf-theme';

/** Browser chrome color per theme. Keep in sync with --ws-bg in app.css. */
export const THEME_COLOR: Record<Theme, string> = {
  light: '#f3f1ec',
  dark: '#0c100e',
};

type ThemeContextValue = {
  /** Resolved light/dark (what consumers like the PDF editor should use). */
  theme: Theme;
  preference: ThemePreference;
  setTheme: (theme: Theme) => void;
  setPreference: (preference: ThemePreference) => void;
  toggleTheme: () => void;
  ready: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function readPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system')
      return stored;
  } catch {
    // storage blocked: fall through to system
  }
  return 'system';
}

function resolve(preference: ThemePreference): Theme {
  return preference === 'system' ? systemTheme() : preference;
}

/** Apply theme to <html> for CSS tokens, the Tailwind `dark:` variant and the browser chrome. */
export function applyThemeClass(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
  document
    .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((meta) => {
      meta.content = THEME_COLOR[theme];
    });
}

/**
 * Inline FOUC bootstrap for <head>. Mirrors readPreference + applyThemeClass.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var s=localStorage.getItem('${THEME_KEY}');var t=s==='light'||s==='dark'?s:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');var r=document.documentElement;r.dataset.theme=t;r.classList.toggle('dark',t==='dark');r.style.colorScheme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=t==='dark'?'${THEME_COLOR.dark}':'${THEME_COLOR.light}';}catch(e){}})();`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [theme, setThemeState] = useState<Theme>('dark');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const pref = readPreference();
    const next = resolve(pref);
    setPreferenceState(pref);
    setThemeState(next);
    applyThemeClass(next);
    setReady(true);
  }, []);

  // Follow the OS only while the preference is "system".
  useEffect(() => {
    if (preference !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystem = (e: MediaQueryListEvent) => {
      const sys: Theme = e.matches ? 'dark' : 'light';
      setThemeState(sys);
      applyThemeClass(sys);
    };
    mq.addEventListener('change', onSystem);
    return () => mq.removeEventListener('change', onSystem);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    const resolved = resolve(next);
    setPreferenceState(next);
    setThemeState(resolved);
    applyThemeClass(resolved);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // still applied for this session
    }
  }, []);

  const setTheme = useCallback(
    (next: Theme) => setPreference(next),
    [setPreference]
  );

  /** Plain toggle (no view transition). Prefer ThemeToggle for the animated switch. */
  const toggleTheme = useCallback(() => {
    setPreference(theme === 'dark' ? 'light' : 'dark');
  }, [setPreference, theme]);

  const value = useMemo(
    () => ({ theme, preference, setTheme, setPreference, toggleTheme, ready }),
    [theme, preference, setTheme, setPreference, toggleTheme, ready]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
