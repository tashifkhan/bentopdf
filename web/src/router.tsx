import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { DefaultCatchBoundary } from './components/DefaultCatchBoundary'
import { NotFound } from './components/NotFound'

function DefaultPending() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center p-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div
          className="size-8 animate-spin rounded-full border-2 border-brand border-t-transparent"
          aria-hidden
        />
        <p className="text-sm font-medium text-muted-foreground">Loading…</p>
      </div>
    </div>
  )
}

export function getRouter() {
  const router = createRouter({
    routeTree,
    defaultPreload: 'intent',
    defaultPendingComponent: DefaultPending,
    defaultErrorComponent: DefaultCatchBoundary,
    defaultNotFoundComponent: () => <NotFound />,
    scrollRestoration: true,
  })
  return router
}
