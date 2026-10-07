'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils/cn';

const GAP = 6;
const EDGE = 8;
const SHEET_QUERY = '(max-width: 639px)';

/**
 * Where a floating panel is mounted.
 *
 * Inside a dialog or drawer the panel goes into that overlay's own element, so
 * it shares the overlay's stacking context (it paints above it with an ordinary
 * `z-dropdown`), sits inside its focus trap, and is not mistaken for an outside
 * click that should close it. Everywhere else it goes to <body>, out of every
 * `overflow: hidden` and scroll container, which is what keeps a calendar in a
 * table toolbar or a narrow card from being clipped.
 */
function portalTarget(anchor: HTMLElement | null): HTMLElement {
  return (anchor?.closest('[role="dialog"]') as HTMLElement | null) ?? document.body;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(false);
  React.useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

type Position = { top: number; left: number; maxHeight: number; placement: 'below' | 'above' };

function measure(anchor: HTMLElement, panel: HTMLElement, align: 'start' | 'end'): Position {
  const rect = anchor.getBoundingClientRect();
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight;

  const spaceBelow = viewportHeight - rect.bottom - GAP - EDGE;
  const spaceAbove = rect.top - GAP - EDGE;
  // Prefer below; flip only when it does not fit there and fits better above.
  const placement = height <= spaceBelow || spaceBelow >= spaceAbove ? 'below' : 'above';
  const maxHeight = Math.max(160, placement === 'below' ? spaceBelow : spaceAbove);
  const shown = Math.min(height, maxHeight);
  const top = placement === 'below' ? rect.bottom + GAP : rect.top - GAP - shown;

  let left = align === 'end' ? rect.right - width : rect.left;
  left = Math.min(left, viewportWidth - width - EDGE);
  left = Math.max(EDGE, left);

  return { top, left, maxHeight, placement };
}

/**
 * A panel anchored to a trigger: date pickers, the range picker and other
 * small floating editors.
 *
 * - Positioned with `fixed` coordinates from the anchor, flipped above it when
 *   there is no room below, clamped inside the viewport, and re-measured while
 *   any ancestor scrolls or the window resizes.
 * - Below 640px it becomes a bottom sheet over a scrim instead, which is the
 *   only placement that reliably fits a calendar on a phone.
 * - Escape closes it — and only it: the key is consumed in the capture phase
 *   so a dialog underneath stays open. Focus returns to `returnFocusRef`.
 * - A press outside both the panel and the anchor closes it without moving
 *   focus, so whatever was pressed keeps it.
 */
export function Popover({
  open,
  onClose,
  anchorRef,
  returnFocusRef,
  label,
  align = 'start',
  className,
  sheetTitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** The element the panel hangs from. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Focused again when the panel closes by Escape. Defaults to the anchor. */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  label: string;
  align?: 'start' | 'end';
  className?: string;
  /** Heading shown on the phone sheet, where the field label is out of view. */
  sheetTitle?: string;
  children: React.ReactNode;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [position, setPosition] = React.useState<Position | null>(null);
  const [target, setTarget] = React.useState<HTMLElement | null>(null);
  const asSheet = useMediaQuery(SHEET_QUERY);

  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  });

  React.useEffect(() => {
    if (open) setTarget(portalTarget(anchorRef.current));
    else setPosition(null);
  }, [open, anchorRef]);

  // Position before paint, then follow scrolling and resizing.
  React.useLayoutEffect(() => {
    if (!open || asSheet || !target) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (anchorRef.current && panelRef.current) {
          setPosition(measure(anchorRef.current, panelRef.current, align));
        }
      });
    };
    if (anchorRef.current && panelRef.current) {
      setPosition(measure(anchorRef.current, panelRef.current, align));
    }
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    const observer =
      typeof ResizeObserver !== 'undefined' && panelRef.current ? new ResizeObserver(update) : null;
    if (observer && panelRef.current) observer.observe(panelRef.current);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [open, asSheet, target, anchorRef, align]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Consumed here so the dialog or drawer underneath does not close too.
      event.stopPropagation();
      event.preventDefault();
      onCloseRef.current();
      (returnFocusRef?.current ?? anchorRef.current)?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const node = event.target as Node;
      if (panelRef.current?.contains(node) || anchorRef.current?.contains(node)) return;
      onCloseRef.current();
    };
    // Tabbing away to another control closes it too. Focus landing on <body>
    // (Safari does not focus a clicked button) is not a move away.
    const onFocusIn = (event: FocusEvent) => {
      const node = event.target as Node;
      if (node === document.body) return;
      if (panelRef.current?.contains(node) || anchorRef.current?.contains(node)) return;
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open, anchorRef, returnFocusRef]);

  if (!open || !target) return null;

  // Inside a dialog the panel shares its stacking context; on <body> a sheet
  // must clear the topbar and the sidebar drawer, so it takes the modal layer.
  const inOverlay = target !== document.body;

  if (asSheet) {
    return createPortal(
      <div className={cn('fixed inset-0 flex items-end', inOverlay ? 'z-dropdown' : 'z-modal')}>
        <div
          className="admin-scrim absolute inset-0 animate-fade-in bg-black/30"
          aria-hidden="true"
        />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className={cn(
            'ui-popover ui-popover-sheet relative max-h-[88dvh] w-full animate-slide-up overflow-y-auto',
            'rounded-t-[var(--radius-dialog,1.25rem)] border-t border-hairline bg-surface',
            'px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2',
          )}
        >
          <div aria-hidden="true" className="mx-auto mb-2 h-1 w-9 rounded-full bg-muted/30" />
          {sheetTitle ? (
            <p className="mb-2 text-center text-sm font-semibold text-content">{sheetTitle}</p>
          ) : null}
          {children}
        </div>
      </div>,
      target,
    );
  }

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      style={{
        position: 'fixed',
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        maxHeight: position?.maxHeight,
        // Measured invisibly on the first frame so it never flashes at 0,0.
        // Opacity rather than visibility, so focus can move in immediately.
        opacity: position ? undefined : 0,
        pointerEvents: position ? undefined : 'none',
      }}
      data-placement={position?.placement}
      className={cn(
        'ui-popover glass-menu z-dropdown overflow-y-auto rounded-2xl border border-hairline bg-surface p-3 shadow-xl',
        position ? 'animate-pop-in' : null,
        className,
      )}
    >
      {children}
    </div>,
    target,
  );
}
