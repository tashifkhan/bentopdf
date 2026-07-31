import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export const FULL_WIDTH_KEY = 'fullWidthMode'
export const COMPACT_KEY = 'compactMode'

export type AppSettings = {
  /** Stretch main content toward the full shell width (default true). */
  fullWidth: boolean
  /** Denser home tool cards (default: true on small screens when unset). */
  compact: boolean
}

type SettingsContextValue = AppSettings & {
  setFullWidth: (value: boolean) => void
  setCompact: (value: boolean) => void
  ready: boolean
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(max-width: 639px)').matches
}

/** Default true; only `'false'` in storage opts out. */
export function readFullWidth(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return localStorage.getItem(FULL_WIDTH_KEY) !== 'false'
  } catch {
    return true
  }
}

/**
 * Explicit true/false from storage; when unset, compact on narrow viewports
 * so the catalog is scannable on phones.
 */
export function readCompact(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const stored = localStorage.getItem(COMPACT_KEY)
    if (stored === 'true') return true
    if (stored === 'false') return false
    return isMobileViewport()
  } catch {
    return false
  }
}

/** Apply layout tokens on <html> (safe for FOUC head script + React). */
export function applyLayoutClasses(settings: AppSettings) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.layout = settings.fullWidth ? 'wide' : 'narrow'
  root.classList.toggle('density-compact', settings.compact)
  root.dataset.density = settings.compact ? 'compact' : 'comfortable'
}

/**
 * Inline FOUC bootstrap for <head>. Keep in sync with readFullWidth / readCompact.
 * Applies to documentElement only (body may not exist yet).
 */
export const SETTINGS_BOOT_SCRIPT = `(function(){try{var r=document.documentElement;var fw=localStorage.getItem('${FULL_WIDTH_KEY}');r.dataset.layout=fw==='false'?'narrow':'wide';var c=localStorage.getItem('${COMPACT_KEY}');var compact=c==='true'||(c!=='false'&&window.matchMedia('(max-width: 639px)').matches);r.classList.toggle('density-compact',compact);r.dataset.density=compact?'compact':'comfortable';}catch(e){}})();`

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [fullWidth, setFullWidthState] = useState(true)
  const [compact, setCompactState] = useState(false)
  const [ready, setReady] = useState(false)
  const settingsRef = useRef<AppSettings>({ fullWidth: true, compact: false })

  useEffect(() => {
    const next: AppSettings = {
      fullWidth: readFullWidth(),
      compact: readCompact(),
    }
    settingsRef.current = next
    setFullWidthState(next.fullWidth)
    setCompactState(next.compact)
    applyLayoutClasses(next)
    setReady(true)
  }, [])

  const setFullWidth = useCallback((value: boolean) => {
    const next = { ...settingsRef.current, fullWidth: value }
    settingsRef.current = next
    setFullWidthState(value)
    applyLayoutClasses(next)
    try {
      localStorage.setItem(FULL_WIDTH_KEY, String(value))
    } catch {
      // Private mode / quota — still apply for the session.
    }
  }, [])

  const setCompact = useCallback((value: boolean) => {
    const next = { ...settingsRef.current, compact: value }
    settingsRef.current = next
    setCompactState(value)
    applyLayoutClasses(next)
    try {
      localStorage.setItem(COMPACT_KEY, String(value))
    } catch {
      // ignore
    }
  }, [])

  const value = useMemo(
    () => ({
      fullWidth,
      compact,
      setFullWidth,
      setCompact,
      ready,
    }),
    [fullWidth, compact, setFullWidth, setCompact, ready],
  )

  return (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  )
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}
