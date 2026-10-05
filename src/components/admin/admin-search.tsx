'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Search, CornerDownLeft, Plus, ArrowRight } from 'lucide-react';
import { adminSearch, type SearchHit } from '@/lib/actions/admin-search';
import { visibleModules } from '@/lib/admin/nav';
import type { PermissionKey } from '@/lib/auth/permissions';
import { Spinner } from '@/components/ui/icons';
import { cn } from '@/lib/utils/cn';

const TYPE_TONE: Record<SearchHit['type'], string> = {
  Lead: 'bg-brand/10 text-brand',
  Customer: 'bg-violet-50 text-violet-700',
  Page: 'bg-sky-50 text-sky-700',
  Product: 'bg-emerald-50 text-emerald-700',
  Post: 'bg-amber-50 text-amber-700',
  Media: 'bg-muted/15 text-muted',
  Staff: 'bg-rose-50 text-rose-700',
  Form: 'bg-teal-50 text-teal-700',
};

type Command = {
  id: string;
  label: string;
  hint?: string;
  href: string;
  group: 'Actions' | 'Go to' | 'Results';
  badge?: SearchHit['type'];
  icon?: 'plus' | 'arrow';
};

const QUICK_ACTIONS: Array<{
  label: string;
  href: string;
  permission: PermissionKey;
}> = [
  {
    label: 'Create page',
    href: '/admin/pages/new',
    permission: 'pages.create',
  },
  {
    label: 'Create product',
    href: '/admin/products/new',
    permission: 'products.create',
  },
  {
    label: 'Create form',
    href: '/admin/forms/new',
    permission: 'forms.create',
  },
  { label: 'Add lead', href: '/admin/leads/new', permission: 'leads.create' },
  {
    label: 'Create blog post',
    href: '/admin/blog/new',
    permission: 'blog.create',
  },
  { label: 'Upload media', href: '/admin/media', permission: 'media.upload' },
];

/**
 * Command palette.
 *
 * One surface for three things an admin wants from a search box: jump to a
 * section, start a common task, or find a specific record. Navigation entries
 * come from ADMIN_NAV and record search reuses the existing `adminSearch`
 * action, so nothing here maintains a second list that can drift.
 */
export function AdminSearch({
  permissions = [],
  isSuperAdmin = false,
}: {
  permissions?: string[];
  isSuperAdmin?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [highlight, setHighlight] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  const can = React.useCallback(
    (permission: PermissionKey) => isSuperAdmin || permissions.includes(permission),
    [isSuperAdmin, permissions],
  );

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Reset each time the palette opens so it never shows a stale query.
  React.useEffect(() => {
    if (!open) return;
    setQuery('');
    setHits([]);
    setHighlight(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Record search is debounced — one request per pause in typing.
  React.useEffect(() => {
    if (!open || query.trim().length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      adminSearch(query)
        .then(setHits)
        .catch(() => setHits([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, open]);

  const commands = React.useMemo<Command[]>(() => {
    const term = query.trim().toLowerCase();
    const matches = (text: string) => !term || text.toLowerCase().includes(term);

    const actions: Command[] = QUICK_ACTIONS.filter(
      (action) => can(action.permission) && matches(action.label),
    ).map((action) => ({
      id: `action-${action.href}`,
      label: action.label,
      href: action.href,
      group: 'Actions',
      icon: 'plus',
    }));

    const destinations: Command[] = [];
    for (const group of visibleModules(can, isSuperAdmin)) {
      if (group.href && matches(group.label)) {
        destinations.push({
          id: `nav-${group.id}`,
          label: group.label,
          href: group.href,
          group: 'Go to',
          icon: 'arrow',
        });
      }
      for (const item of group.items) {
        if (!matches(item.label) && !matches(group.label)) continue;
        destinations.push({
          id: `nav-${item.href}`,
          label: item.label,
          hint: group.label,
          href: item.href,
          group: 'Go to',
          icon: 'arrow',
        });
      }
    }

    const results: Command[] = hits.map((hit) => ({
      id: `hit-${hit.type}-${hit.id}`,
      label: hit.title,
      hint: hit.subtitle ?? undefined,
      href: hit.href,
      group: 'Results',
      badge: hit.type,
    }));

    // Records first once the admin has typed enough to mean a specific thing.
    return term.length >= 2
      ? [...results, ...actions, ...destinations]
      : [...actions, ...destinations];
  }, [query, hits, can, isSuperAdmin]);

  React.useEffect(() => {
    setHighlight((current) => Math.min(current, Math.max(commands.length - 1, 0)));
  }, [commands.length]);

  // Keep the highlighted row inside the scroll area.
  React.useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${highlight}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  const run = (command: Command) => {
    setOpen(false);
    router.push(command.href);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      setOpen(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((h) => (commands.length ? (h + 1) % commands.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((h) => (commands.length ? (h - 1 + commands.length) % commands.length : 0));
    } else if (event.key === 'Enter' && commands[highlight]) {
      event.preventDefault();
      run(commands[highlight]!);
    }
  };

  let lastGroup: Command['group'] | null = null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={cn(
          'admin-focus flex h-9 w-full items-center gap-2 rounded-[var(--radius-control)] px-3',
          'border border-admin-nav/[0.08] bg-admin-nav/[0.04] text-sm text-admin-nav/55',
          'transition-colors hover:border-admin-nav/15 hover:bg-admin-nav/[0.06] hover:text-admin-nav/75',
        )}
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left">Search or jump to…</span>
        <kbd className="hidden shrink-0 rounded-md border border-admin-nav/10 bg-[rgb(var(--surface))] px-1.5 py-0.5 font-mono text-[0.625rem] text-admin-nav/60 shadow-sm sm:block">
          ⌘K
        </kbd>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-modal flex items-start justify-center p-4 pt-[10dvh] sm:pt-[15dvh]"
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
        >
          <div
            className="admin-scrim absolute inset-0"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          <div
            className="relative flex max-h-[70dvh] w-full max-w-xl flex-col overflow-hidden rounded-[var(--radius-dialog)] border border-hairline bg-surface shadow-[var(--shadow-lg)]"
            onKeyDown={onKeyDown}
          >
            <div className="flex shrink-0 items-center gap-3 border-b border-hairline px-4">
              {loading ? (
                <Spinner className="h-4 w-4 shrink-0 animate-spin text-muted" aria-hidden="true" />
              ) : (
                <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
              )}
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setHighlight(0);
                }}
                placeholder="Search leads, pages, products… or type a command"
                aria-label="Search or jump to"
                className="h-14 min-w-0 flex-1 border-0 bg-transparent text-sm text-content outline-none placeholder:text-muted/70"
              />
              <kbd className="hidden shrink-0 rounded border border-hairline px-1.5 py-0.5 font-mono text-[0.625rem] text-muted sm:block">
                esc
              </kbd>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {commands.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-muted">
                  {loading ? 'Searching…' : `No matches for “${query}”.`}
                </p>
              ) : (
                <ul ref={listRef}>
                  {commands.map((command, index) => {
                    const newGroup = command.group !== lastGroup;
                    lastGroup = command.group;
                    return (
                      <React.Fragment key={command.id}>
                        {newGroup ? (
                          <li
                            aria-hidden="true"
                            className="px-3 pb-1 pt-3 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted first:pt-1"
                          >
                            {command.group}
                          </li>
                        ) : null}
                        <li>
                          <button
                            type="button"
                            data-index={index}
                            onClick={() => run(command)}
                            onMouseMove={() => setHighlight(index)}
                            className={cn(
                              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                              index === highlight ? 'bg-brand/[0.08]' : 'hover:bg-muted/[0.05]',
                            )}
                          >
                            {command.badge ? (
                              <span
                                className={cn(
                                  'shrink-0 rounded px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide',
                                  TYPE_TONE[command.badge],
                                )}
                              >
                                {command.badge}
                              </span>
                            ) : (
                              <span className="shrink-0 text-muted">
                                {command.icon === 'plus' ? (
                                  <Plus className="h-4 w-4" aria-hidden="true" />
                                ) : (
                                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                                )}
                              </span>
                            )}

                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm text-content">
                                {command.label}
                              </span>
                              {command.hint ? (
                                <span className="block truncate text-xs text-muted">
                                  {command.hint}
                                </span>
                              ) : null}
                            </span>

                            {index === highlight ? (
                              <CornerDownLeft
                                className="h-3.5 w-3.5 shrink-0 text-muted"
                                aria-hidden="true"
                              />
                            ) : null}
                          </button>
                        </li>
                      </React.Fragment>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-4 border-t border-hairline bg-muted/[0.03] px-4 py-2 text-[0.6875rem] text-muted">
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-hairline bg-surface px-1 font-mono">↑</kbd>
                <kbd className="rounded border border-hairline bg-surface px-1 font-mono">↓</kbd>
                to navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-hairline bg-surface px-1 font-mono">↵</kbd>
                to open
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
