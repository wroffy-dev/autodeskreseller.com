import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Wrapper that keeps wide tables scrollable instead of breaking the layout.
 *
 * `.scroll-x` sets `overflow-x: auto`, and per spec that makes `overflow-y`
 * compute to `auto` as well — so this element is a scroll container on both
 * axes. That matters for sticky headers: `position: sticky` resolves against
 * the nearest scrolling ancestor, which is this wrapper and *not* the viewport.
 * A sticky header inside therefore needs `top-0`; any larger offset pushes it
 * down over the first row instead of clearing the page chrome.
 *
 * `maxHeight` opts into vertical scrolling so a long table scrolls within the
 * card while its header stays put.
 */
export function TableWrap({
  className,
  maxHeight,
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { maxHeight?: string }) {
  return (
    <div
      className={cn('scroll-x -mx-4 sm:mx-0', maxHeight && 'overflow-y-auto', className)}
      style={maxHeight ? { maxHeight, ...style } : style}
      {...props}
    />
  );
}

export function Table({
  className,
  stickyHeader,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & { stickyHeader?: boolean }) {
  return (
    <table
      className={cn(
        'w-full min-w-[40rem] text-sm',
        // Collapsed borders are dropped from a stuck header by every engine, so
        // a sticky table separates them and draws the rule with a shadow
        // instead. Ordinary tables keep collapse, which looks tighter.
        stickyHeader ? 'border-separate border-spacing-0' : 'border-collapse',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Sticky table header.
 *
 * Opaque by design: a translucent header lets the row underneath show through
 * as it scrolls past, which is what makes a sticky header look broken. The
 * bottom rule is a shadow rather than a border because `border-separate` would
 * otherwise scroll away with the cells.
 */
export function StickyThead({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        'sticky top-0 z-sticky bg-surface',
        '[&_th]:bg-surface [&_th]:shadow-[inset_0_-1px_0_rgb(var(--brand-border))] [&_th]:border-b-0',
        className,
      )}
      {...props}
    />
  );
}

export function Th({
  className,
  align = 'left',
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-hairline bg-muted/[0.04] px-3 py-2.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  className,
  align = 'left',
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <td
      className={cn(
        'border-b border-hairline px-3 py-3 align-middle text-content',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
      {...props}
    />
  );
}

export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('transition-colors hover:bg-muted/[0.04]', className)} {...props} />;
}
