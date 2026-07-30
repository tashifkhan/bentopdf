const THEME_KEY = 'taf-pdf-theme';
const RECENT_TOOLS_KEY = 'taf-pdf-recent-tools';
const FILTER_KEY = 'taf-pdf-category-filter';
const MAX_RECENT_TOOLS = 6;

type RecentTool = {
  href: string;
  name: string;
};

type Theme = 'light' | 'dark';

function getStoredTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem(THEME_KEY, theme);

  const toggle = document.getElementById('theme-toggle');
  if (toggle) {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    toggle.setAttribute('aria-label', `Switch to ${nextTheme} theme`);
    toggle.setAttribute('title', `Switch to ${nextTheme} theme`);
  }

  // Keep native form controls and scrollbars in sync
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) {
    meta.setAttribute('content', theme);
  }
}

function readRecentTools(): RecentTool[] {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_TOOLS_KEY) || '[]');
    if (!Array.isArray(stored)) return [];
    return stored.filter(
      (tool): tool is RecentTool =>
        typeof tool?.href === 'string' && typeof tool?.name === 'string'
    );
  } catch {
    localStorage.removeItem(RECENT_TOOLS_KEY);
    return [];
  }
}

function writeRecentTools(tools: RecentTool[]) {
  localStorage.setItem(
    RECENT_TOOLS_KEY,
    JSON.stringify(tools.slice(0, MAX_RECENT_TOOLS))
  );
}

function rememberTool(tool: RecentTool) {
  const recent = readRecentTools().filter((item) => item.href !== tool.href);
  recent.unshift(tool);
  writeRecentTools(recent);
}

function rememberCurrentTool() {
  if (document.body.classList.contains('workspace-home')) return;

  const heading = document.querySelector('h1');
  const name = heading?.textContent?.trim();
  if (!name) return;

  rememberTool({
    href: window.location.pathname,
    name,
  });
}

function renderRecentTools() {
  const container = document.getElementById('recent-tools');
  if (!container) return;

  const recent = readRecentTools();
  container.textContent = '';
  container.classList.toggle('hidden', recent.length === 0);

  if (recent.length === 0) return;

  const label = document.createElement('span');
  label.className = 'recent-tools-label';
  label.textContent = 'Recent';
  container.appendChild(label);

  recent.forEach((tool) => {
    const link = document.createElement('a');
    link.className = 'recent-tool-link';
    link.href = tool.href;
    link.textContent = tool.name;
    container.appendChild(link);
  });
}

function bindToolCards() {
  document
    .querySelectorAll<HTMLAnchorElement>('.tool-card[href]')
    .forEach((card) => {
      card.addEventListener('click', () => {
        const name = card.querySelector('h3')?.textContent?.trim();
        if (!name) return;
        rememberTool({ href: card.pathname, name });
      });
    });
}

function countVisibleTools(): number {
  const cards = document.querySelectorAll('.category-group .tool-card');
  // Unique by name to avoid double-counting across categories
  const names = new Set<string>();
  cards.forEach((card) => {
    const name = card.querySelector('h3')?.textContent?.trim();
    if (name) names.add(name);
  });
  return names.size;
}

function updateResultCount(visible?: number) {
  const el = document.getElementById('tool-result-count');
  if (!el) return;

  const total = countVisibleTools();
  const count = visible ?? total;

  if (count === total) {
    el.textContent = `${total} tools`;
  } else {
    el.textContent = `${count} of ${total} tools`;
  }
}

function getCategoryName(group: Element): string {
  const header = group.querySelector('.category-header span, .category-header');
  // Prefer first text span (title), fall back to full header text without chevron
  const titleSpan = group.querySelector('.category-header > span:first-child');
  if (titleSpan) {
    // Strip count badge text if present
    const clone = titleSpan.cloneNode(true) as HTMLElement;
    clone.querySelector('.category-count')?.remove();
    return clone.textContent?.trim() || '';
  }
  return header?.textContent?.trim() || '';
}

function decorateCategoryCounts() {
  document.querySelectorAll('.category-group').forEach((group) => {
    const header = group.querySelector('.category-header');
    if (!header) return;

    let titleSpan = header.querySelector(':scope > span:first-child');
    if (!titleSpan) {
      // Wrap title text if structure is flat
      const first = header.childNodes[0];
      if (first && first.nodeType === Node.TEXT_NODE) {
        titleSpan = document.createElement('span');
        titleSpan.textContent = first.textContent;
        header.replaceChild(titleSpan, first);
      }
    }

    if (!titleSpan) return;

    let badge = titleSpan.querySelector('.category-count') as HTMLElement | null;
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'category-count';
      titleSpan.appendChild(badge);
    }

    const count = group.querySelectorAll('.tool-card').length;
    badge.textContent = String(count);
  });
}

function buildCategoryFilters() {
  const container = document.getElementById('category-filters');
  const toolGrid = document.getElementById('tool-grid');
  if (!container || !toolGrid) return;

  const groups = Array.from(toolGrid.querySelectorAll('.category-group'));
  if (groups.length === 0) return;

  container.textContent = '';

  const stored = localStorage.getItem(FILTER_KEY) || 'all';

  const makeChip = (id: string, label: string) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'workspace-filter-chip';
    chip.dataset.filter = id;
    chip.textContent = label;
    chip.setAttribute('aria-pressed', id === stored ? 'true' : 'false');
    if (id === stored) chip.classList.add('is-active');
    return chip;
  };

  container.appendChild(makeChip('all', 'All tools'));

  groups.forEach((group) => {
    const name = getCategoryName(group);
    if (!name) return;
    // Store raw category name from data attribute for stable matching
    group.setAttribute('data-category', name);
    container.appendChild(makeChip(name, name));
  });

  const applyFilter = (filterId: string) => {
    localStorage.setItem(FILTER_KEY, filterId);

    container.querySelectorAll('.workspace-filter-chip').forEach((chip) => {
      const active = (chip as HTMLElement).dataset.filter === filterId;
      chip.classList.toggle('is-active', active);
      chip.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    // Don't fight search mode
    const searchBar = document.getElementById(
      'search-bar'
    ) as HTMLInputElement | null;
    if (searchBar?.value.trim()) {
      return;
    }

    groups.forEach((group) => {
      const name = group.getAttribute('data-category') || getCategoryName(group);
      const show = filterId === 'all' || name === filterId;
      group.classList.toggle('is-filtered-out', !show);
      (group as HTMLElement).style.display = show ? '' : 'none';
    });

    const visibleCards = toolGrid.querySelectorAll(
      '.category-group:not(.is-filtered-out) .tool-card'
    ).length;
    updateResultCount(filterId === 'all' ? undefined : visibleCards);
  };

  container.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest(
      '.workspace-filter-chip'
    ) as HTMLElement | null;
    if (!target?.dataset.filter) return;
    applyFilter(target.dataset.filter);
  });

  // Apply stored filter after a tick so category groups exist
  applyFilter(stored);

  // Re-apply when search is cleared
  const searchBar = document.getElementById('search-bar');
  searchBar?.addEventListener('input', () => {
    const value = (searchBar as HTMLInputElement).value.trim();
    if (!value) {
      const active =
        (
          container.querySelector(
            '.workspace-filter-chip.is-active'
          ) as HTMLElement | null
        )?.dataset.filter || 'all';
      applyFilter(active);
    } else {
      // Search shows its own results; hide filter state from count
      const results = document.getElementById('search-results');
      const count = results?.querySelectorAll('.tool-card').length;
      if (count !== undefined) updateResultCount(count);
    }
  });
}

function syncShortcutHints() {
  const isMac = navigator.userAgent.toUpperCase().includes('MAC');
  const hint = document.getElementById('shortcut-hint');
  if (hint) {
    hint.textContent = isMac ? '⌘K' : 'Ctrl K';
  }
}

function watchSystemTheme() {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = (event: MediaQueryListEvent) => {
    // Only follow system if user hasn't explicitly chosen
    if (localStorage.getItem(THEME_KEY)) return;
    setTheme(event.matches ? 'dark' : 'light');
  };
  mq.addEventListener('change', handler);
}

function isHomePath(): boolean {
  const path = window.location.pathname;
  return (
    path.endsWith('/') ||
    path.endsWith('/index.html') ||
    path.endsWith('/simple-index.html')
  );
}

export function prepareWorkspaceUi() {
  const isHome = isHomePath();
  const root = document.documentElement;
  const theme = getStoredTheme();

  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.classList.add('workspace', isHome ? 'workspace-home' : 'workspace-tool');
  root.classList.remove(isHome ? 'workspace-tool' : 'workspace-home');

  // Keep body classes for legacy selectors during the transition.
  document.body.classList.add(
    'workspace-shell',
    isHome ? 'workspace-home' : 'workspace-tool'
  );
  document.body.classList.remove(isHome ? 'workspace-tool' : 'workspace-home');
}

export function initWorkspaceUi() {
  setTheme(getStoredTheme());
  // Enable smooth theme transitions only after first paint (avoids FOUC animation).
  requestAnimationFrame(() => {
    document.documentElement.classList.add('ws-ready');
  });
  watchSystemTheme();
  syncShortcutHints();

  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const current =
      document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    setTheme(current === 'light' ? 'dark' : 'light');
  });

  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    const isTyping =
      target?.tagName === 'INPUT' ||
      target?.tagName === 'TEXTAREA' ||
      target?.isContentEditable;

    if (event.key === '/' && !isTyping) {
      const search = document.getElementById('search-bar');
      if (search instanceof HTMLInputElement) {
        event.preventDefault();
        search.focus();
        search.select();
      }
    }
  });

  rememberCurrentTool();
  renderRecentTools();
  bindToolCards();

  // Category filters + counts need the tool grid to be rendered first.
  // main.ts renders tools then calls createIcons; we schedule after paint.
  if (
    document.documentElement.classList.contains('workspace-home') ||
    document.body.classList.contains('workspace-home')
  ) {
    const runHomeEnhancements = () => {
      decorateCategoryCounts();
      buildCategoryFilters();
      updateResultCount();
      bindToolCards();
    };

    // Tools may already be present, or arrive shortly after init
    if (document.querySelector('.category-group')) {
      runHomeEnhancements();
    } else {
      const observer = new MutationObserver(() => {
        if (document.querySelector('.category-group')) {
          observer.disconnect();
          runHomeEnhancements();
        }
      });
      const grid = document.getElementById('tool-grid');
      if (grid) {
        observer.observe(grid, { childList: true, subtree: true });
        // Safety timeout
        window.setTimeout(() => {
          observer.disconnect();
          runHomeEnhancements();
        }, 3000);
      }
    }
  }
}
