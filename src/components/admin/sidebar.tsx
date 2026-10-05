'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { X, ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import {
  visibleModules,
  isItemActive,
  type AdminNavItem,
  type AdminNavModule,
} from '@/lib/admin/nav';
import type { PermissionKey } from '@/lib/auth/permissions';
import { NavIcon } from './nav-icon';
import { cn } from '@/lib/utils/cn';

export type SidebarProps = {
  permissions: string[];
  isSuperAdmin: boolean;
  siteName: string;
  logoUrl: string | null;
  /** Swapped in by CSS while the admin is in dark mode. */
  logoDarkUrl?: string | null;
  /** Mobile drawer state. */
  open: boolean;
  onClose: () => void;
  /** Desktop icon-only state, owned by AdminShell so the content can offset. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

type VisibleGroup = AdminNavModule & { items: AdminNavItem[] };

/**
 * Admin navigation: a floating glass rail.
 *
 * Modules sit under section headings, collapse and expand, and the group owning
 * the current route opens automatically. On desktop the rail can shrink to
 * icons, where every entry shows its label (and a group its children) in a
 * fly-out. Expanded groups and the collapsed state persist in localStorage, so
 * the layout survives a refresh. Below `lg` the rail is an off-canvas drawer.
 */
export function AdminSidebar({
  permissions,
  isSuperAdmin,
  siteName,
  logoUrl,
  logoDarkUrl,
  open,
  onClose,
  collapsed,
  onToggleCollapsed,
}: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  const can = React.useCallback(
    (permission: PermissionKey) => isSuperAdmin || permissions.includes(permission),
    [isSuperAdmin, permissions],
  );

  const modules = React.useMemo(() => visibleModules(can, isSuperAdmin), [can, isSuperAdmin]);

  const activeModuleId = React.useMemo(() => {
    for (const group of modules) {
      if (group.href && isItemActive(group, pathname, search)) return group.id;
      if (group.items.some((item) => isItemActive(item, pathname, search))) return group.id;
      // Detail routes (/admin/pages/abc) keep their group open too.
      if (group.items.some((item) => pathname.startsWith(`${item.href.split('?')[0]}/`)))
        return group.id;
    }
    return null;
  }, [modules, pathname, search]);

  const [manuallyClosed, setManuallyClosed] = React.useState<string[]>([]);
  const [extraOpen, setExtraOpen] = React.useState<string[]>([]);

  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Restore the admin's own expand/collapse choices.
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem('admin:nav');
      if (!raw) return;
      const saved = JSON.parse(raw) as { closed?: string[]; open?: string[] };
      if (Array.isArray(saved.closed)) setManuallyClosed(saved.closed);
      if (Array.isArray(saved.open)) setExtraOpen(saved.open);
    } catch {
      // A corrupt or unavailable store simply means default expansion.
    }
  }, []);

  const persist = React.useCallback((closed: string[], opened: string[]) => {
    try {
      window.localStorage.setItem('admin:nav', JSON.stringify({ closed, open: opened }));
    } catch {
      // Private mode — the nav still works, it just will not remember.
    }
  }, []);

  const asideRef = React.useRef<HTMLElement | null>(null);

  /**
   * Drawer behaviour on small screens: Escape closes it, the page behind stops
   * scrolling, and focus moves into the drawer and returns to the trigger on
   * close. None of this applies to the docked desktop rail, which is part of
   * the page rather than an overlay.
   */
  React.useEffect(() => {
    if (!open) return;

    const trigger = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      // Trap Tab inside the drawer while it covers the page.
      const focusable = asideRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    asideRef.current?.querySelector<HTMLElement>('a[href], button:not([disabled])')?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      trigger?.focus?.();
    };
    // `onClose` is read through a ref rather than listed here. It arrives as an
    // inline arrow, so it changes identity on every render of the shell, and
    // with it in the dependencies this effect tore down and set up again on
    // each one — restoring focus to the trigger and then moving it to the
    // drawer's first link, while the drawer just sat there open. It belongs to
    // opening and closing, and now runs only for those.
  }, [open]);

  const isExpanded = (moduleId: string) =>
    moduleId === activeModuleId ? !manuallyClosed.includes(moduleId) : extraOpen.includes(moduleId);

  const toggleModule = (moduleId: string) => {
    if (moduleId === activeModuleId) {
      const next = manuallyClosed.includes(moduleId)
        ? manuallyClosed.filter((id) => id !== moduleId)
        : [...manuallyClosed, moduleId];
      setManuallyClosed(next);
      persist(next, extraOpen);
      return;
    }
    const next = extraOpen.includes(moduleId)
      ? extraOpen.filter((id) => id !== moduleId)
      : [...extraOpen, moduleId];
    setExtraOpen(next);
    persist(manuallyClosed, next);
  };

  // Adjacent modules that share a section are listed under one heading.
  const sections = React.useMemo(() => {
    const out: Array<{ key: string; label?: string; groups: VisibleGroup[] }> = [];
    for (const group of modules) {
      const last = out[out.length - 1];
      if (last && last.label === group.section) last.groups.push(group);
      else out.push({ key: group.section ?? group.id, label: group.section, groups: [group] });
    }
    return out;
  }, [modules]);

  return (
    <>
      {open ? (
        <div
          className="admin-scrim fixed inset-0 z-backdrop animate-fade-in lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      ) : null}

      <aside
        ref={asideRef}
        id="admin-sidebar"
        className={cn(
          // A drawer flush to the edge on small screens; a rail floating 12px
          // in from the top, bottom and left on large ones.
          'glass-rail fixed inset-y-0 left-0 flex flex-col text-admin-nav',
          'rounded-r-[var(--radius-shell)] lg:inset-y-3 lg:left-3 lg:rounded-[var(--radius-shell)]',
          'transition-[transform,width] duration-200 ease-out lg:translate-x-0',
          collapsed ? 'w-72 lg:w-[4.75rem]' : 'w-72 lg:w-64',
          open ? 'translate-x-0' : '-translate-x-[105%]',
          // One element, two roles: an off-canvas drawer on small screens (so
          // it must clear the backdrop and the top bar) and a docked rail on
          // large ones.
          'z-drawer lg:z-sidebar',
        )}
        aria-label="Admin navigation"
        aria-modal={open ? true : undefined}
        role={open ? 'dialog' : undefined}
      >
        <div
          className={cn(
            'flex shrink-0 items-center gap-2 px-4 pb-2 pt-4',
            collapsed && 'lg:flex-col lg:gap-2 lg:px-0',
          )}
        >
          <Link
            href="/admin"
            onClick={onClose}
            className="admin-focus flex min-w-0 flex-1 items-center gap-2.5 rounded-xl"
            aria-label={`${siteName} — dashboard`}
          >
            <BrandMark
              siteName={siteName}
              logoUrl={logoUrl}
              logoDarkUrl={logoDarkUrl}
              collapsed={collapsed}
            />
          </Link>

          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-expanded={!collapsed}
            aria-controls="admin-sidebar-nav"
            className={cn(
              'nav-item admin-focus hidden h-8 w-8 shrink-0 items-center justify-center rounded-[10px]',
              'text-admin-nav/60 transition-colors hover:text-admin-nav lg:flex',
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-[1.05rem] w-[1.05rem]" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-[1.05rem] w-[1.05rem]" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="nav-item admin-focus flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-admin-nav/60 transition-colors hover:text-admin-nav lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav
          id="admin-sidebar-nav"
          className={cn(
            'admin-scroll flex-1 overflow-y-auto overflow-x-hidden pb-4 pt-1',
            collapsed ? 'px-3 lg:px-2.5' : 'px-3',
          )}
        >
          {sections.map((section, index) => (
            <div key={section.key} className={cn(index > 0 && 'mt-4', collapsed && 'lg:mt-2')}>
              {section.label ? (
                <>
                  <p
                    className={cn(
                      'px-3 pb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-admin-nav/45',
                      collapsed && 'lg:hidden',
                    )}
                  >
                    {section.label}
                  </p>
                  {/* Icon-only mode has no room for a heading; a hairline keeps
                      the grouping visible. */}
                  {collapsed ? (
                    <div
                      aria-hidden="true"
                      className="mx-3 mb-2 hidden h-px bg-[var(--nav-guide)] lg:block"
                    />
                  ) : null}
                </>
              ) : null}
              <ul className="space-y-0.5">
                {section.groups.map((group) => (
                  <li key={group.id}>
                    {group.href ? (
                      <SidebarLink
                        href={group.href}
                        label={group.label}
                        icon={group.icon}
                        active={isItemActive(group, pathname, search)}
                        collapsed={collapsed}
                        onNavigate={onClose}
                      />
                    ) : (
                      <SidebarModule
                        group={group}
                        expanded={isExpanded(group.id)}
                        isActiveModule={group.id === activeModuleId}
                        collapsed={collapsed}
                        pathname={pathname}
                        search={search}
                        onToggle={() => toggleModule(group.id)}
                        onNavigate={onClose}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}

/**
 * The site's logo, or its initial in a rounded square. When a dark-surface
 * logo exists both are rendered and CSS shows the one for the current theme,
 * so switching theme never waits on a re-render.
 */
function BrandMark({
  siteName,
  logoUrl,
  logoDarkUrl,
  collapsed,
}: {
  siteName: string;
  logoUrl: string | null;
  logoDarkUrl?: string | null;
  collapsed: boolean;
}) {
  const initial = (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[rgb(var(--primary))] text-sm font-bold text-[rgb(var(--primary-fg))]">
      {siteName.charAt(0).toUpperCase()}
    </span>
  );

  const light = logoUrl || logoDarkUrl;
  const dark = logoDarkUrl || logoUrl;

  return (
    <>
      {/* Collapsed: the mark only. */}
      <span className={cn('hidden', collapsed && 'lg:flex')}>{initial}</span>

      <span className={cn('flex min-w-0 items-center gap-2.5', collapsed && 'lg:hidden')}>
        {light ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- storage URL, may be any host */}
            <img
              src={light}
              alt=""
              className={cn(
                'h-7 w-auto max-w-[9rem] object-contain',
                dark !== light && 'logo-light',
              )}
            />
            {dark !== light ? (
              // eslint-disable-next-line @next/next/no-img-element -- storage URL, may be any host
              <img
                src={dark!}
                alt=""
                className="logo-dark h-7 w-auto max-w-[9rem] object-contain"
              />
            ) : null}
            <span className="sr-only">{siteName}</span>
          </>
        ) : (
          <>
            {initial}
            <span className="truncate text-[0.9375rem] font-semibold tracking-tight text-admin-nav">
              {siteName}
            </span>
          </>
        )}
      </span>
    </>
  );
}

/**
 * Hover and focus state for an icon-only entry's fly-out.
 *
 * The fly-out is portalled to <body> and positioned `fixed` against the
 * viewport: inside the rail it would be clipped by the nav's scroller and sit
 * under the topbar, whatever its z-index. Leaving is debounced so the pointer
 * can cross the gap between the rail and the fly-out.
 */
function useFlyout() {
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const [position, setPosition] = React.useState<{ top: number; left: number } | null>(null);
  const closeTimer = React.useRef<number | undefined>(undefined);

  const show = React.useCallback(() => {
    window.clearTimeout(closeTimer.current);
    const row = anchorRef.current?.getBoundingClientRect();
    const rail = anchorRef.current?.closest('aside')?.getBoundingClientRect();
    if (!row || !rail) return;
    setPosition({ top: row.top, left: rail.right + 8 });
  }, []);

  const hide = React.useCallback(() => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setPosition(null), 120);
  }, []);

  const hideNow = React.useCallback(() => {
    window.clearTimeout(closeTimer.current);
    setPosition(null);
  }, []);

  React.useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  // Scrolling the nav moves the row out from under its fly-out.
  React.useEffect(() => {
    if (!position) return;
    window.addEventListener('scroll', hideNow, true);
    return () => window.removeEventListener('scroll', hideNow, true);
  }, [position, hideNow]);

  const handlers = {
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: (event: React.FocusEvent) => {
      // Focus moving into the fly-out (a portal, but still this React subtree)
      // keeps it open.
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      hide();
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') hideNow();
    },
  };

  return { anchorRef, position, handlers, hideNow };
}

function Flyout({
  position,
  onMouseEnter,
  onMouseLeave,
  children,
  id,
}: {
  position: { top: number; left: number } | null;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  children: React.ReactNode;
  id?: string;
}) {
  if (!position || typeof document === 'undefined') return null;
  return createPortal(
    <div
      id={id}
      style={{ top: position.top, left: position.left }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="glass-menu fixed z-tooltip hidden animate-fade-in text-admin-nav lg:block"
    >
      {children}
    </div>,
    document.body,
  );
}

function SidebarModule({
  group,
  expanded,
  isActiveModule,
  collapsed,
  pathname,
  search,
  onToggle,
  onNavigate,
}: {
  group: VisibleGroup;
  expanded: boolean;
  isActiveModule: boolean;
  collapsed: boolean;
  pathname: string;
  search: string;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const panelId = `nav-group-${group.id}`;
  const { anchorRef, position, handlers, hideNow } = useFlyout();

  // Icon-only mode has no room for a sub-list, so the group becomes a single
  // link that flies its children out on hover or focus.
  if (collapsed) {
    return (
      <>
        <div ref={anchorRef} {...handlers} className="hidden lg:block">
          <Link
            href={group.items[0]!.href}
            onClick={() => {
              hideNow();
              onNavigate();
            }}
            aria-label={group.label}
            data-active={isActiveModule}
            className={cn(
              'nav-item admin-focus relative flex h-10 w-full items-center justify-center rounded-xl transition-colors',
              isActiveModule ? 'text-admin-nav' : 'text-admin-nav/65 hover:text-admin-nav',
            )}
          >
            {isActiveModule ? <ActiveBar /> : null}
            <NavIcon name={group.icon} className="h-[1.15rem] w-[1.15rem]" />
          </Link>

          <Flyout
            position={position}
            onMouseEnter={handlers.onMouseEnter}
            onMouseLeave={handlers.onMouseLeave}
          >
            <div className="w-56 p-1.5">
              <p className="px-2.5 pb-1 pt-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-admin-nav/50">
                {group.label}
              </p>
              <ul>
                {group.items.map((item) => {
                  const active = isItemActive(item, pathname, search);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => {
                          hideNow();
                          onNavigate();
                        }}
                        aria-current={active ? 'page' : undefined}
                        data-active={active}
                        className={cn(
                          'nav-item admin-focus block truncate rounded-[10px] px-2.5 py-2 text-sm transition-colors',
                          active
                            ? 'font-medium text-admin-nav'
                            : 'text-admin-nav/75 hover:text-admin-nav',
                        )}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </Flyout>
        </div>

        {/* Below `lg` the rail is a full-width drawer, never icon-only. */}
        <div className="lg:hidden">
          <ExpandedModule
            group={group}
            panelId={panelId}
            expanded={expanded}
            isActiveModule={isActiveModule}
            pathname={pathname}
            search={search}
            onToggle={onToggle}
            onNavigate={onNavigate}
          />
        </div>
      </>
    );
  }

  return (
    <ExpandedModule
      group={group}
      panelId={panelId}
      expanded={expanded}
      isActiveModule={isActiveModule}
      pathname={pathname}
      search={search}
      onToggle={onToggle}
      onNavigate={onNavigate}
    />
  );
}

function ExpandedModule({
  group,
  panelId,
  expanded,
  isActiveModule,
  pathname,
  search,
  onToggle,
  onNavigate,
}: {
  group: VisibleGroup;
  panelId: string;
  expanded: boolean;
  isActiveModule: boolean;
  pathname: string;
  search: string;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className={cn(
          'nav-item admin-focus flex h-9 w-full items-center gap-2.5 rounded-xl px-3 text-sm transition-colors',
          isActiveModule ? 'font-medium text-admin-nav' : 'text-admin-nav/80 hover:text-admin-nav',
        )}
      >
        <NavIcon
          name={group.icon}
          className={cn(
            'h-[1.1rem] w-[1.1rem] shrink-0 transition-colors',
            isActiveModule ? 'text-admin-nav' : 'text-admin-nav/55',
          )}
        />
        <span className="flex-1 truncate text-left">{group.label}</span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-admin-nav/45 transition-transform duration-200',
            expanded && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>

      <div
        id={panelId}
        // Animating grid-template-rows keeps the transition smooth without
        // measuring the panel's height.
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <ul className="nav-guide ml-[1.3rem] space-y-0.5 overflow-hidden border-l pl-2.5">
          {group.items.map((item, index) => {
            const active = isItemActive(item, pathname, search);
            return (
              <li key={item.href} className={cn(!expanded && 'invisible', index === 0 && 'pt-0.5')}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  tabIndex={expanded ? undefined : -1}
                  aria-current={active ? 'page' : undefined}
                  data-active={active}
                  className={cn(
                    'nav-item admin-focus relative block truncate rounded-[10px] px-2.5 py-1.5 text-[0.8125rem] transition-colors',
                    active
                      ? 'font-medium text-admin-nav'
                      : 'text-admin-nav/70 hover:text-admin-nav',
                  )}
                >
                  {/* Sits over the guide line beside the nested list. */}
                  {active ? <ActiveBar className="-left-3" /> : null}
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

/** A 3px accent bar, so "active" is not carried by a background tint alone. */
function ActiveBar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[rgb(var(--accent))]',
        className,
      )}
    />
  );
}

function SidebarLink({
  href,
  label,
  icon,
  active,
  collapsed,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: string;
  active?: boolean;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const { anchorRef, position, handlers, hideNow } = useFlyout();

  return (
    <div ref={anchorRef} {...(collapsed ? handlers : {})}>
      <Link
        href={href}
        onClick={() => {
          hideNow();
          onNavigate();
        }}
        aria-current={active ? 'page' : undefined}
        aria-label={collapsed ? label : undefined}
        data-active={Boolean(active)}
        className={cn(
          'nav-item admin-focus relative flex h-9 items-center gap-2.5 rounded-xl px-3 text-sm transition-colors',
          active ? 'font-medium text-admin-nav' : 'text-admin-nav/80 hover:text-admin-nav',
          collapsed && 'lg:h-10 lg:justify-center lg:px-0',
        )}
      >
        {active ? <ActiveBar /> : null}
        <NavIcon
          name={icon}
          className={cn(
            'h-[1.1rem] w-[1.1rem] shrink-0 transition-colors',
            active ? 'text-admin-nav' : 'text-admin-nav/55',
            collapsed && 'lg:h-[1.15rem] lg:w-[1.15rem]',
          )}
        />
        <span className={cn('truncate', collapsed && 'lg:hidden')}>{label}</span>
      </Link>

      {collapsed ? (
        <Flyout
          position={position}
          onMouseEnter={handlers.onMouseEnter}
          onMouseLeave={handlers.onMouseLeave}
        >
          <p role="tooltip" className="whitespace-nowrap px-3 py-1.5 text-sm font-medium">
            {label}
          </p>
        </Flyout>
      ) : null}
    </div>
  );
}
