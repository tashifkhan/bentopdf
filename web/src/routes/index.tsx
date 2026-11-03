import { Link, createFileRoute } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { CloseCircle, Search } from 'reicon-react';
import { Input } from '~/components/beui/input';
import { FadeUp, Stagger } from '~/components/Motion';
import { ToolIcon } from '~/components/icons';
import { categories, searchTools, type Tool } from '~/data/tools';
import { cn } from '~/lib/utils';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  const results = useMemo(() => searchTools(query), [query]);
  const isSearching = query.trim().length > 0;

  const visibleCategories = useMemo(() => {
    if (isSearching) return [];
    if (filter === 'all') return categories;
    return categories.filter((c) => c.name === filter);
  }, [filter, isSearching]);

  return (
    <div className="page-head">
      <Stagger className="mb-5 max-w-2xl sm:mb-6" delay={0.05} stagger={0.06}>
        <FadeUp>
          <h1 className="text-[clamp(1.55rem,6.5vw,2.4rem)] font-bold leading-[1.15] tracking-tight text-foreground">
            Every PDF tool you need,{' '}
            <span className="text-accent">in the browser</span>
          </h1>
        </FadeUp>
        <FadeUp>
          <p className="mt-3 max-w-xl text-[0.95rem] leading-relaxed text-muted-foreground sm:text-base">
            Merge, split, convert, sign, and edit. Files never leave this
            device.
          </p>
        </FadeUp>
      </Stagger>

      <FadeUp className="surface-card sticky top-[calc(var(--app-header-h)+env(safe-area-inset-top,0px)+0.5rem)] z-20 p-2.5 sm:static sm:p-4">
        <div className="relative">
          <Input
            value={query}
            onChange={setQuery}
            placeholder="Search tools…"
            aria-label="Search tools"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            leftIcon={<Search size={18} color="currentColor" />}
            rightIcon={
              query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="text-ink-4 transition-colors hover:text-foreground"
                >
                  <CloseCircle size={16} color="currentColor" />
                </button>
              ) : undefined
            }
            classNames={{
              root: 'gap-0',
              field:
                'h-11 rounded-full border-input bg-secondary sm:h-12 focus-within:bg-card',
              input: 'text-base font-medium sm:text-sm',
            }}
          />
        </div>

        {!isSearching ? (
          <div
            className="h-scroll h-scroll-fade chips-wrap mt-2.5 -mx-0.5 px-0.5 pb-0.5 sm:mt-3"
            role="tablist"
            aria-label="Tool categories"
          >
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'all'}
              className={cn('chip', filter === 'all' && 'is-active')}
              onClick={() => setFilter('all')}
            >
              All tools
            </button>
            {categories.map((c) => (
              <button
                key={c.name}
                type="button"
                role="tab"
                aria-selected={filter === c.name}
                className={cn('chip', filter === c.name && 'is-active')}
                onClick={() => setFilter(c.name)}
              >
                {c.name}
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 px-1 sm:mt-3">
            <p className="text-xs font-semibold text-ink-4">
              {results.length} match{results.length === 1 ? '' : 'es'}
            </p>
            {results.length === 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {['merge', 'compress', 'sign', 'convert'].map((hint) => (
                  <button
                    key={hint}
                    type="button"
                    className="chip is-active !h-7 !text-[0.7rem]"
                    onClick={() => setQuery(hint)}
                  >
                    {hint}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </FadeUp>

      <div className="mt-6 space-y-7 sm:mt-8 sm:space-y-8">
        {isSearching ? (
          results.length === 0 ? (
            <FadeUp className="rounded-lg border border-dashed border-line-strong px-4 py-12 text-center text-muted-foreground">
              <p className="font-semibold text-foreground">
                No tools match "{query}"
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
            <Stagger key={category.name} delay={0.05 + i * 0.03} stagger={0.03}>
              <FadeUp>
                <h2 className="section-title">
                  {category.name}
                  <span className="count-badge">{category.tools.length}</span>
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
  );
}

function ToolCard({ tool }: { tool: Tool }) {
  return (
    <Link
      to="/tools/$slug"
      params={{ slug: tool.slug }}
      className="block touch-manipulation"
    >
      <motion.div
        className="tool-card h-full"
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
  );
}
