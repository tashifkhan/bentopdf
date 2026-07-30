import { Link, createFileRoute } from '@tanstack/react-router'
import { motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { Search, ShieldCheck } from 'reicon-react'
import { FadeUp, Stagger } from '~/components/Motion'
import { ToolIcon } from '~/components/icons'
import { categories, searchTools, type Tool } from '~/data/tools'
import { cn } from '~/lib/utils'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')

  const results = useMemo(() => searchTools(query), [query])
  const isSearching = query.trim().length > 0

  const visibleCategories = useMemo(() => {
    if (isSearching) return []
    if (filter === 'all') return categories
    return categories.filter((c) => c.name === filter)
  }, [filter, isSearching])

  return (
    <div className="pt-6 sm:pt-10">
      <Stagger className="mb-6 max-w-2xl" delay={0.05} stagger={0.06}>
        <FadeUp>
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-[0.7rem] font-bold uppercase tracking-wide text-brand">
            <ShieldCheck size={12} color="currentColor" />
            Private · Local · Instant
          </p>
        </FadeUp>
        <FadeUp>
          <h1 className="text-[clamp(1.7rem,3.8vw,2.4rem)] font-bold leading-tight tracking-tight text-foreground">
            Every PDF tool you need,{' '}
            <span className="text-accent">in the browser</span>
          </h1>
        </FadeUp>
        <FadeUp>
          <p className="mt-3 max-w-xl text-muted-foreground">
            Merge, split, convert, sign, and edit — files never leave this
            device. Search a tool or browse by category.
          </p>
        </FadeUp>
        <FadeUp>
          <ul className="mt-4 flex flex-wrap gap-2">
            {[
              ['70+', 'tools'],
              ['0', 'uploads'],
              ['100%', 'local'],
            ].map(([k, v]) => (
              <li
                key={v}
                className="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-card px-3 text-xs font-semibold text-muted-foreground"
              >
                <strong className="text-foreground">{k}</strong> {v}
              </li>
            ))}
          </ul>
        </FadeUp>
      </Stagger>

      <FadeUp className="surface-card p-3 sm:p-4">
        <div className="relative">
          <Search
            size={18}
            color="currentColor"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-4"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tools — merge, OCR, compress, sign…"
            className="h-12 w-full rounded-full border border-input bg-secondary pl-11 pr-4 text-sm font-medium text-foreground outline-none transition placeholder:text-ink-4 focus-visible:border-accent focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </div>

        {!isSearching ? (
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
            <button
              type="button"
              className={cn('chip', filter === 'all' && 'is-active')}
              onClick={() => setFilter('all')}
            >
              All tools
            </button>
            {categories.map((c) => (
              <button
                key={c.name}
                type="button"
                className={cn('chip', filter === c.name && 'is-active')}
                onClick={() => setFilter(c.name)}
              >
                {c.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs font-semibold text-ink-4">
            {results.length} match{results.length === 1 ? '' : 'es'}
          </p>
        )}
      </FadeUp>

      <div className="mt-8 space-y-8">
        {isSearching ? (
          results.length === 0 ? (
            <FadeUp className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-muted-foreground">
              <p className="font-semibold text-foreground">
                No tools match “{query}”
              </p>
              <p className="mt-1 text-sm">
                Try merge, compress, sign, or convert.
              </p>
            </FadeUp>
          ) : (
            <Stagger className="tool-grid" stagger={0.03}>
              {results.map((tool) => (
                <FadeUp key={tool.slug}>
                  <ToolCard tool={tool} />
                </FadeUp>
              ))}
            </Stagger>
          )
        ) : (
          visibleCategories.map((category, i) => (
            <Stagger
              key={category.name}
              delay={0.05 + i * 0.03}
              stagger={0.03}
            >
              <FadeUp>
                <h2 className="mb-3 border-b border-border pb-2 text-[0.95rem] font-bold tracking-tight text-foreground">
                  {category.name}
                  <span className="ml-2 inline-grid h-5 min-w-5 place-items-center rounded-full bg-surface-3 px-1.5 text-[0.68rem] font-bold text-ink-3">
                    {category.tools.length}
                  </span>
                </h2>
              </FadeUp>
              <div className="tool-grid">
                {category.tools.map((tool) => (
                  <FadeUp key={`${category.name}-${tool.slug}`}>
                    <ToolCard tool={tool} />
                  </FadeUp>
                ))}
              </div>
            </Stagger>
          ))
        )}
      </div>
    </div>
  )
}

function ToolCard({ tool }: { tool: Tool }) {
  return (
    <Link to="/tools/$slug" params={{ slug: tool.slug }} className="block">
      <motion.div
        className="tool-card h-full"
        whileHover={{ y: -3 }}
        whileTap={{ scale: 0.985 }}
        transition={{ type: 'spring', stiffness: 400, damping: 24 }}
      >
        <span className="tool-card-icon">
          <ToolIcon name={tool.icon} size={18} />
        </span>
        <span className="min-w-0">
          <h3>{tool.name}</h3>
          <p>{tool.subtitle}</p>
        </span>
      </motion.div>
    </Link>
  )
}
