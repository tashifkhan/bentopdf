import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { CloseCircle } from 'reicon-react'
import { Button } from '~/components/beui/button'
import { Switch } from '~/components/beui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/beui/tabs'
import { cn } from '~/lib/utils'

export function SettingsModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const reduce = useReducedMotion()
  const [fullWidth, setFullWidth] = useState(
    () =>
      typeof window !== 'undefined' &&
      localStorage.getItem('fullWidthMode') !== 'false',
  )
  const [compact, setCompact] = useState(
    () =>
      typeof window !== 'undefined' &&
      localStorage.getItem('compactMode') === 'true',
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <motion.button
            type="button"
            aria-label="Close settings"
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            className={cn(
              'relative z-10 flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden border border-border bg-card text-card-foreground shadow-panel',
              'rounded-t-2xl sm:rounded-2xl',
            )}
            initial={
              reduce
                ? { opacity: 0 }
                : { opacity: 0, y: 28, scale: 0.97, filter: 'blur(8px)' }
            }
            animate={
              reduce
                ? { opacity: 1 }
                : { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }
            }
            exit={
              reduce
                ? { opacity: 0 }
                : { opacity: 0, y: 16, scale: 0.98, filter: 'blur(4px)' }
            }
            transition={
              reduce
                ? { duration: 0.12 }
                : { type: 'spring', stiffness: 320, damping: 28 }
            }
          >
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h2
                  id="settings-title"
                  className="text-base font-bold tracking-tight"
                >
                  Settings
                </h2>
                <p className="text-xs text-muted-foreground">
                  Display preferences
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onClose}
              >
                <CloseCircle size={18} color="currentColor" />
              </Button>
            </header>

            <div className="overflow-y-auto p-4">
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
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 }}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-secondary p-4"
                  >
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        Full width mode
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Stretch tool layouts across the screen.
                      </p>
                    </div>
                    <Switch
                      checked={fullWidth}
                      onCheckedChange={(v) => {
                        setFullWidth(v)
                        localStorage.setItem('fullWidthMode', String(v))
                      }}
                    />
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-secondary p-4"
                  >
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        Compact mode
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Denser tool list on the home page.
                      </p>
                    </div>
                    <Switch
                      checked={compact}
                      onCheckedChange={(v) => {
                        setCompact(v)
                        localStorage.setItem('compactMode', String(v))
                        document.body.classList.toggle('density-compact', v)
                      }}
                    />
                  </motion.div>
                </TabsContent>

                <TabsContent
                  value="about"
                  className="space-y-2 text-sm text-muted-foreground"
                >
                  <p>
                    TanStack Start rewrite of the BentoPDF toolkit for private,
                    browser-side PDF work.
                  </p>
                  <p className="text-xs text-ink-4">
                    Theme transitions use the View Transition API · page routes
                    animate with Motion · controls from beUI · icons from Reicon.
                  </p>
                </TabsContent>
              </Tabs>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  )
}
