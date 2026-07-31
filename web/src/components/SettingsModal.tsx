import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react'
import { ShieldCheck } from 'reicon-react'
import { BottomSheet } from '~/components/beui/bottom-sheet'
import { Button } from '~/components/beui/button'
import { Switch } from '~/components/beui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/beui/tabs'
import { useSettings } from '~/features/settings/settings'
import { useTheme } from '~/features/theme/theme'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function SettingsModal({
  open,
  onClose,
  returnFocusRef,
}: {
  open: boolean
  onClose: () => void
  /** Element to restore focus to on close (typically the settings gear). */
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const { fullWidth, compact, setFullWidth, setCompact } = useSettings()
  const { theme, setTheme } = useTheme()
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()

  // Focus first control when opened; restore focus when closed.
  useEffect(() => {
    if (!open) return

    const previouslyFocused =
      (document.activeElement as HTMLElement | null) ?? null

    const frame = requestAnimationFrame(() => {
      const root = panelRef.current
      if (!root) return
      const focusables = root.querySelectorAll<HTMLElement>(FOCUSABLE)
      const first = focusables[0]
      first?.focus()
    })

    return () => {
      cancelAnimationFrame(frame)
      const target = returnFocusRef?.current ?? previouslyFocused
      if (target && typeof target.focus === 'function') {
        // Defer so BottomSheet unmount doesn't steal focus back.
        requestAnimationFrame(() => target.focus())
      }
    }
  }, [open, returnFocusRef])

  // Focus trap while open (BottomSheet does not include one).
  useEffect(() => {
    if (!open) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab') return

      const root = panelRef.current
      if (!root) return
      const focusables = [
        ...root.querySelectorAll<HTMLElement>(FOCUSABLE),
      ].filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1)
      if (focusables.length === 0) return

      const first = focusables[0]!
      const last = focusables[focusables.length - 1]!
      const active = document.activeElement as HTMLElement | null

      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last || !root.contains(active)) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Settings"
      description="Display and layout preferences"
      snapPoints={['auto', 0.92]}
      defaultSnap={0}
      className="sm:max-w-lg"
    >
      <div
        ref={panelRef}
        role="document"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="pb-[max(0.5rem,env(safe-area-inset-bottom,0px))]"
      >
        <span id={titleId} className="sr-only">
          Settings
        </span>
        <span id={descId} className="sr-only">
          Display and layout preferences for BentoPDF
        </span>

        <Tabs defaultValue="preferences" variant="segment">
          <TabsList className="mb-4 w-full bg-secondary">
            <TabsTrigger value="preferences" className="flex-1">
              Preferences
            </TabsTrigger>
            <TabsTrigger value="about" className="flex-1">
              About
            </TabsTrigger>
          </TabsList>

          <TabsContent value="preferences" className="space-y-3">
            <SettingRow
              title="Full width mode"
              description="Stretch tool layouts across the screen."
            >
              <Switch
                checked={fullWidth}
                onCheckedChange={setFullWidth}
                ariaLabel="Full width mode"
              />
            </SettingRow>

            <SettingRow
              title="Compact mode"
              description="Denser tool list on the home page."
            >
              <Switch
                checked={compact}
                onCheckedChange={setCompact}
                ariaLabel="Compact mode"
              />
            </SettingRow>

            <SettingRow
              title="Dark mode"
              description="Match your eyes, not a server."
            >
              <Switch
                checked={theme === 'dark'}
                onCheckedChange={(v) => setTheme(v ? 'dark' : 'light')}
                ariaLabel="Dark mode"
              />
            </SettingRow>
          </TabsContent>

          <TabsContent
            value="about"
            className="space-y-3 text-sm text-muted-foreground"
          >
            <div className="rounded-2xl border border-border bg-secondary p-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-success/15 text-success">
                  <ShieldCheck size={18} color="currentColor" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Private by design
                  </p>
                  <p className="mt-1 text-xs leading-relaxed">
                    Every tool runs in your browser. Files are not uploaded to a
                    server — processing stays on this device.
                  </p>
                </div>
              </div>
            </div>

            <p>
              TanStack Start rewrite of the BentoPDF toolkit for private,
              browser-side PDF work.
            </p>
            <ul className="space-y-1.5 text-xs text-ink-4">
              <li>· Offline-capable PWA after the first visit (production build)</li>
              <li>· Theme transitions use the View Transition API</li>
              <li>· Controls from beUI · icons from Reicon</li>
            </ul>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClose}
              >
                Done
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </BottomSheet>
  )
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-secondary p-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
