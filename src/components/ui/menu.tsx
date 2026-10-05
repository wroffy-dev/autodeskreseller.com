'use client';

import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils/cn';

/**
 * Dropdown menu shared by the topbar, row actions and bulk bars.
 *
 * Closes on outside click, Escape and selection, restores focus to the trigger,
 * and supports arrow-key navigation between items.
 */
export function Menu({
  trigger,
  label,
  align = 'left',
  width = 'w-56',
  triggerClassName,
  children,
}: {
  trigger: React.ReactNode;
  label: string;
  align?: 'left' | 'right';
  width?: string;
  /**
   * Extra classes for the trigger button. The admin topbar uses it to offset
   * the focus ring against the dark chrome; on a light surface the default is
   * already correct.
   */
  triggerClassName?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

      const items = panelRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([disabled]),[role="menuitemradio"]:not([disabled])',
      );
      if (!items || items.length === 0) return;
      event.preventDefault();

      const list = Array.from(items);
      const index = list.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === 'ArrowDown'
          ? list[(index + 1 + list.length) % list.length]
          : list[(index - 1 + list.length) % list.length];
      next?.focus();
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className={cn(
          'block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
          triggerClassName,
        )}
      >
        {trigger}
      </button>

      {open ? (
        <div
          ref={panelRef}
          role="menu"
          aria-label={label}
          onClick={() => setOpen(false)}
          className={cn(
            'absolute top-full z-dropdown mt-1.5 animate-slide-up overflow-hidden rounded-xl border border-hairline',
            // `glass-menu` only takes effect inside the admin (`.admin-ui`); the
            // public site keeps the plain surface.
            'glass-menu bg-surface p-1.5 shadow-xl',
            width,
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({
  children,
  href,
  onClick,
  disabled,
  tone,
  icon,
  external,
  checked,
}: {
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'danger';
  icon?: React.ReactNode;
  external?: boolean;
  /** Makes the item one of a set of radio choices (a theme picker). */
  checked?: boolean;
}) {
  const className = cn(
    'flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-sm transition-colors',
    'focus-visible:outline-none focus-visible:bg-muted/10',
    tone === 'danger' ? 'text-red-600 hover:bg-red-50' : 'text-content hover:bg-muted/[0.08]',
    disabled && 'pointer-events-none opacity-50',
  );

  if (href && !disabled) {
    return (
      <Link
        href={href}
        role="menuitem"
        className={className}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {icon ? <span className="shrink-0 text-muted">{icon}</span> : null}
        <span className="min-w-0 flex-1 truncate">{children}</span>
      </Link>
    );
  }

  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      onClick={onClick}
      disabled={disabled}
      className={className}
    >
      {icon ? <span className="shrink-0 text-muted">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-hairline" role="separator" />;
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted">
      {children}
    </p>
  );
}
