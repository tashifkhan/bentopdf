import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import * as React from 'react'
import { useRef, useState } from 'react'
import { DefaultCatchBoundary } from '~/components/DefaultCatchBoundary'
import { NotFound } from '~/components/NotFound'
import { AppShell } from '~/components/AppShell'
import { SettingsModal } from '~/components/SettingsModal'
import {
  SETTINGS_BOOT_SCRIPT,
  SettingsProvider,
} from '~/features/settings/settings'
import { ThemeProvider } from '~/features/theme/theme'
import appCss from '~/styles/app.css?url'

const THEME_BOOT_SCRIPT = `(function(){try{var k='taf-pdf-theme';var s=localStorage.getItem(k);var t=s==='light'||s==='dark'?s:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t;document.documentElement.classList.toggle('dark',t==='dark');document.documentElement.style.colorScheme=t;}catch(e){}})();`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content:
          'width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=5',
      },
      { name: 'format-detection', content: 'telephone=no' },
      {
        title: 'PDF Tools — private browser toolkit',
      },
      {
        name: 'description',
        content:
          'Merge, split, convert, and edit PDFs in your browser. Files never leave your device.',
      },
      { name: 'theme-color', content: '#1a3d35' },
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      {
        name: 'apple-mobile-web-app-status-bar-style',
        content: 'black-translucent',
      },
      { name: 'apple-mobile-web-app-title', content: 'BentoPDF' },
      { name: 'application-name', content: 'BentoPDF' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/svg+xml', href: '/images/taf-pdf-mark.svg' },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '32x32',
        href: '/favicon-32x32.png',
      },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '16x16',
        href: '/favicon-16x16.png',
      },
      {
        rel: 'apple-touch-icon',
        sizes: '180x180',
        href: '/apple-touch-icon.png',
      },
      { rel: 'manifest', href: '/manifest.webmanifest' },
    ],
    scripts: [
      { children: THEME_BOOT_SCRIPT },
      { children: SETTINGS_BOOT_SCRIPT },
    ],
  }),
  errorComponent: DefaultCatchBoundary,
  notFoundComponent: () => <NotFound />,
  shellComponent: RootDocument,
  component: RootComponent,
})

function RootComponent() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <ThemeProvider>
      <SettingsProvider>
        <AppShell
          onOpenSettings={() => setSettingsOpen(true)}
          settingsButtonRef={settingsButtonRef}
        >
          <Outlet />
        </AppShell>
        <SettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          returnFocusRef={settingsButtonRef}
        />
      </SettingsProvider>
    </ThemeProvider>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
