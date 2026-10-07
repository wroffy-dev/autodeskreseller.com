'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Building2,
  ClipboardList,
  CornerDownLeft,
  FileText,
  Image as ImageIcon,
  Inbox,
  MapPin,
  Newspaper,
  Package,
  Plus,
  RotateCw,
  Search,
  UserCog,
  X,
  type LucideIcon,
} from 'lucide-react';
import { adminSearch } from '@/lib/actions/admin-search';
import {
  SEARCH_GROUP_LABEL,
  SEARCH_MAX_QUERY,
  SEARCH_MIN_QUERY,
  type SearchHit,
} from '@/lib/admin/search';
import { visibleModules } from '@/lib/admin/nav';
import { hasUnsavedChanges } from '@/lib/admin/unsaved-changes';
import type { PermissionKey } from '@/lib/auth/permissions';
import { ConfirmDialog } from '@/components/ui/dialog';
import { useMediaQuery } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/icons';
import { cn } from '@/lib/utils/cn';

type Command = {
  id: string;
  label: string;
  /** Secondary detail: a record's email or path, a section's module. */
  detail?: string;
  href: string;
  group: string;
  kind: 'action' | 'nav' | 'record';
  badge?: SearchHit['type'];
};

const QUICK_ACTIONS: Array<{ label: string; href: string; permission: PermissionKey }> = [
  { label: 'Create page', href: '/admin/pages/new', permission: 'pages.create' },
  { label: 'Create product', href: '/admin/products/new', permission: 'products.create' },
  { label: 'Create form', href: '/admin/forms/new', permission: 'forms.create' },
  { label: 'Add lead', href: '/admin/leads/new', permission: 'leads.create' },
  { label: 'Create blog post', href: '/admin/blog/new', permission: 'blog.create' },
  { label: 'Add city', href: '/admin/cities/new', permission: 'pages.create' },
  { label: 'Upload media', href: '/admin/media', permission: 'media.upload' },
];

const DEBOUNCE_MS = 200;

/** The same icon each module has in the sidebar, so a result says where it lives. */
const TYPE_ICON: Record<SearchHit['type'], LucideIcon> = {
  Lead: Inbox,
  Customer: Building2,
  Page: FileText,
  City: MapPin,
  Product: Package,
  Post: Newspaper,
  Form: ClipboardList,
  Media: ImageIcon,
  Staff: UserCog,
};

type Status = 'idle' | 'loading' | 'done' | 'error';

/** "⌘K" on Apple platforms, "Ctrl K" elsewhere — known only after mount. */
function useShortcutLabel(): string | null {
  const [label, setLabel] = React.useState<string | null>(null);
  React.useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent;
    setLabel(/mac|iphone|ipad|ipod/i.test(platform) ? '⌘K' : 'Ctrl K');
  }, []);
  return label;
}

/**
 * Topbar search.
 *
 * A compact field in the topbar with a results panel anchored beneath it. It
 * finds three kinds of thing: admin sections (from ADMIN_NAV, so it cannot
 * drift from the sidebar), common create actions, and records — leads,
 * customers, pages, cities, products, posts, forms, media and staff — through
 * the `adminSearch` Server Action, which enforces permissions and market
 * access on the server.
 *
 * - ⌘K on macOS, Ctrl+K elsewhere, focuses it from anywhere in the admin.
 * - ↑/↓ move through the results, Enter opens one, Escape closes the panel
 *   (and a second Escape clears the field).
 * - Record lookups are debounced, and a response that arrives after a newer
 *   query has been sent is dropped, so results never flash back to an older
 *   search.
 * - Below 640px the field becomes a button that opens a full-screen sheet.
 * - Leaving a screen with unsaved edits asks first.
 *
 * Ordinary list filtering stays where it is: this never changes a page's own
 * search box.
 */
export function AdminSearch({
  permissions = [],
  isSuperAdmin = false,
}: {
  permissions?: string[];
  isSuperAdmin?: boolean;
}) {
  const router = useRouter();
  const compact = useMediaQuery('(max-width: 639px)');
  const shortcut = useShortcutLabel();
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [pendingHref, setPendingHref] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const sheetTriggerRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'k')
        return;
      event.preventDefault();
      if (window.matchMedia('(max-width: 639px)').matches) {
        setSheetOpen(true);
      } else {
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // A sheet left open while the window grows becomes the inline field again.
  React.useEffect(() => {
    if (!compact) setSheetOpen(false);
  }, [compact]);

  const navigate = React.useCallback(
    (href: string) => {
      setSheetOpen(false);
      if (hasUnsavedChanges()) {
        setPendingHref(href);
        return;
      }
      router.push(href);
    },
    [router],
  );

  return (
    <>
      {/* Phones: a button that opens the sheet. */}
      <button
        ref={sheetTriggerRef}
        type="button"
        onClick={() => setSheetOpen(true)}
        aria-label="Search"
        aria-haspopup="dialog"
        title="Search"
        className="admin-focus flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-admin-nav/70 transition-colors hover:bg-admin-nav/[0.06] hover:text-admin-nav sm:hidden"
      >
        <Search className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />
      </button>

      {/* Everything wider: the field itself. */}
      <div className="hidden min-w-0 sm:block">
        <SearchCombobox
          variant="inline"
          inputRef={inputRef}
          shortcut={shortcut}
          permissions={permissions}
          isSuperAdmin={isSuperAdmin}
          onNavigate={navigate}
        />
      </div>

      {sheetOpen ? (
        <SearchSheet
          onClose={() => {
            setSheetOpen(false);
            sheetTriggerRef.current?.focus();
          }}
        >
          <SearchCombobox
            variant="sheet"
            permissions={permissions}
            isSuperAdmin={isSuperAdmin}
            onNavigate={navigate}
            onCancel={() => {
              setSheetOpen(false);
              sheetTriggerRef.current?.focus();
            }}
          />
        </SearchSheet>
      ) : null}

      <ConfirmDialog
        open={pendingHref !== null}
        onClose={() => setPendingHref(null)}
        onConfirm={() => {
          const href = pendingHref;
          setPendingHref(null);
          if (href) router.push(href);
        }}
        title="Leave without saving?"
        message="This screen has changes that have not been saved. Leaving now discards them."
        confirmLabel="Leave page"
      />
    </>
  );
}

function SearchSheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  React.useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  // Only ever opened by a press, so it always renders in the browser — no
  // mount guard, and no frame in which typing could miss the field.
  return createPortal(
    <div
      className="fixed inset-0 z-modal flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      // Escape from anywhere in the sheet, not only the field.
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div
        className="admin-scrim absolute inset-0 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="glass-menu relative m-2 flex max-h-[96dvh] min-h-0 flex-col overflow-hidden rounded-[var(--radius-dialog)] animate-slide-up">
        {children}
      </div>
    </div>,
    document.body,
  );
}

function SearchCombobox({
  variant,
  inputRef: externalRef,
  shortcut,
  permissions,
  isSuperAdmin,
  onNavigate,
  onCancel,
}: {
  variant: 'inline' | 'sheet';
  inputRef?: React.RefObject<HTMLInputElement | null>;
  shortcut?: string | null;
  permissions: string[];
  isSuperAdmin: boolean;
  onNavigate: (href: string) => void;
  onCancel?: () => void;
}) {
  const sheet = variant === 'sheet';
  const ownRef = React.useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? ownRef;
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const listId = React.useId();

  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(sheet);
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [status, setStatus] = React.useState<Status>('idle');
  const [highlight, setHighlight] = React.useState(0);
  const [attempt, setAttempt] = React.useState(0);
  const latest = React.useRef(0);

  const can = React.useCallback(
    (permission: PermissionKey) => isSuperAdmin || permissions.includes(permission),
    [isSuperAdmin, permissions],
  );

  React.useEffect(() => {
    if (sheet) inputRef.current?.focus();
  }, [sheet, inputRef]);

  // Close when focus or a press goes elsewhere.
  React.useEffect(() => {
    if (sheet || !open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open, sheet]);

  const term = query.trim();

  // Record search: debounced, and only the newest response is ever applied.
  React.useEffect(() => {
    const id = ++latest.current;
    if (term.length < SEARCH_MIN_QUERY) {
      setHits([]);
      setStatus('idle');
      return;
    }
    setStatus('loading');
    const timer = window.setTimeout(() => {
      adminSearch(term)
        .then((result) => {
          if (id !== latest.current) return;
          setHits(result);
          setStatus('done');
        })
        .catch(() => {
          if (id !== latest.current) return;
          setHits([]);
          setStatus('error');
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [term, attempt]);

  const commands = React.useMemo<Command[]>(() => {
    const needle = term.toLowerCase();
    const matches = (...texts: Array<string | undefined>) =>
      !needle || texts.some((text) => text?.toLowerCase().includes(needle));

    const destinations: Command[] = [];
    for (const group of visibleModules(can, isSuperAdmin)) {
      if (group.href && matches(group.label)) {
        destinations.push({
          id: `nav-${group.id}`,
          label: group.label,
          detail: 'Section',
          href: group.href,
          group: 'Go to',
          kind: 'nav',
        });
      }
      for (const item of group.items) {
        if (!matches(item.label, group.label, item.description)) continue;
        destinations.push({
          id: `nav-${item.href}`,
          label: item.label,
          detail: item.description ? `${group.label} · ${item.description}` : group.label,
          href: item.href,
          group: 'Go to',
          kind: 'nav',
        });
      }
    }

    const actions: Command[] = QUICK_ACTIONS.filter(
      (action) => can(action.permission) && matches(action.label),
    ).map((action) => ({
      id: `action-${action.label}`,
      label: action.label,
      href: action.href,
      group: 'Create',
      kind: 'action',
    }));

    const records: Command[] = hits.map((hit) => ({
      id: `hit-${hit.type}-${hit.id}`,
      label: hit.title,
      detail: hit.subtitle ?? undefined,
      href: hit.href,
      group: SEARCH_GROUP_LABEL[hit.type],
      kind: 'record',
      badge: hit.type,
    }));

    if (!needle) return [...destinations.slice(0, 6), ...actions.slice(0, 4)];
    // Records first once the query is specific enough to mean one.
    return [...records, ...destinations.slice(0, 8), ...actions];
  }, [term, hits, can, isSuperAdmin]);

  React.useEffect(() => {
    setHighlight((current) => Math.min(current, Math.max(commands.length - 1, 0)));
  }, [commands.length]);

  React.useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${highlight}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  const run = (command: Command) => {
    setOpen(sheet);
    setQuery('');
    inputRef.current?.blur();
    onNavigate(command.href);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      setHighlight((h) => (commands.length ? (h + 1) % commands.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((h) => (commands.length ? (h - 1 + commands.length) % commands.length : 0));
    } else if (event.key === 'Enter') {
      const command = commands[highlight];
      if (open && command) {
        event.preventDefault();
        run(command);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (sheet) {
        onCancel?.();
      } else if (open) {
        setOpen(false);
      } else if (query) {
        setQuery('');
      } else {
        inputRef.current?.blur();
      }
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  const recordsPending = status === 'loading' && term.length >= SEARCH_MIN_QUERY;
  const activeId = open && commands[highlight] ? `${listId}-${highlight}` : undefined;
  let lastGroup: string | null = null;

  const results = (
    <div
      ref={listRef}
      id={listId}
      role="listbox"
      aria-label="Search results"
      aria-busy={recordsPending || undefined}
      className={cn('min-h-0 flex-1 overflow-y-auto p-1.5', !sheet && 'max-h-[min(70dvh,32rem)]')}
    >
      {status === 'error' ? (
        <div
          role="alert"
          className="mx-1.5 my-1 flex items-center justify-between gap-3 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700"
        >
          <span>Record search is unavailable right now.</span>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="admin-focus-ring inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold hover:bg-red-100"
          >
            <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </button>
        </div>
      ) : null}

      {recordsPending && hits.length === 0 ? (
        <p className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted" role="status">
          <Spinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Searching records…
        </p>
      ) : null}

      {commands.length === 0 && !recordsPending && status !== 'error' ? (
        <div className="px-3 py-8 text-center" role="status">
          <p className="text-sm font-medium text-content">No results for “{term}”</p>
          <p className="mt-1 text-xs text-muted">Try a name, email, page title, slug or SKU.</p>
        </div>
      ) : null}

      {commands.map((command, index) => {
        const heading = command.group !== lastGroup ? command.group : null;
        lastGroup = command.group;
        const active = index === highlight;
        return (
          <React.Fragment key={command.id}>
            {heading ? (
              <div
                role="presentation"
                className="px-3 pb-1 pt-2.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted first:pt-1"
              >
                {heading}
              </div>
            ) : null}
            <div
              id={`${listId}-${index}`}
              role="option"
              aria-selected={active}
              data-index={index}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => run(command)}
              onMouseMove={() => setHighlight(index)}
              className={cn(
                'search-option flex min-h-11 cursor-pointer items-center gap-3 rounded-[0.6rem] px-3 py-1.5',
                active && 'search-option-active',
                recordsPending && command.kind === 'record' && 'opacity-60',
              )}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/[0.08] text-muted">
                <CommandIcon command={command} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-content">{command.label}</span>
                {command.detail ? (
                  <span className="block truncate text-xs text-muted">{command.detail}</span>
                ) : null}
              </span>
              {active ? (
                <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
              ) : null}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );

  const footer = (
    <div className="hidden shrink-0 items-center gap-4 border-t border-hairline px-4 py-2 text-[0.6875rem] text-muted sm:flex">
      <span className="flex items-center gap-1">
        <kbd className="search-kbd">↑</kbd>
        <kbd className="search-kbd">↓</kbd>
        to move
      </span>
      <span className="flex items-center gap-1">
        <kbd className="search-kbd">↵</kbd>
        to open
      </span>
      <span className="flex items-center gap-1">
        <kbd className="search-kbd">esc</kbd>
        to close
      </span>
    </div>
  );

  return (
    <div
      ref={rootRef}
      role="search"
      className={cn('relative', sheet && 'flex min-h-0 flex-1 flex-col')}
    >
      <div
        className={cn(
          'search-field flex items-center gap-2',
          sheet ? 'm-2 h-11 rounded-xl px-3' : 'h-9 rounded-[0.65rem] px-2.5',
        )}
      >
        {recordsPending ? (
          <Spinner className="h-4 w-4 shrink-0 animate-spin text-muted" aria-hidden="true" />
        ) : (
          <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        )}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-label="Search admin"
          autoComplete="off"
          spellCheck={false}
          maxLength={SEARCH_MAX_QUERY}
          value={query}
          placeholder={sheet ? 'Search leads, pages, products…' : 'Search'}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlight(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm text-content outline-none placeholder:text-muted focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            title="Clear search"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted/40 text-surface transition-colors hover:bg-muted/60"
          >
            <X className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
          </button>
        ) : !sheet && shortcut ? (
          <kbd className="search-kbd hidden shrink-0 md:block" aria-hidden="true">
            {shortcut}
          </kbd>
        ) : null}
        {sheet ? (
          <button
            type="button"
            onClick={onCancel}
            className="admin-focus-ring -mr-1 shrink-0 rounded-lg px-2 py-1 text-sm font-medium text-brand"
          >
            Cancel
          </button>
        ) : null}
      </div>

      {sheet ? (
        <>
          {results}
          {footer}
        </>
      ) : open ? (
        <div className="search-panel glass-menu absolute right-0 top-full z-dropdown mt-2 flex w-full min-w-[min(30rem,calc(100vw-2rem))] max-h-[70dvh] flex-col overflow-hidden animate-pop-in">
          {results}
          {footer}
        </div>
      ) : null}
    </div>
  );
}

function CommandIcon({ command }: { command: Command }) {
  const Icon =
    command.kind === 'action'
      ? Plus
      : command.kind === 'nav' || !command.badge
        ? ArrowRight
        : TYPE_ICON[command.badge];
  return <Icon className="h-4 w-4" aria-hidden="true" />;
}
