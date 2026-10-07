'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export type SegmentOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** A count or marker after the label. */
  badge?: React.ReactNode;
  /** Accessible name, required when the label is only an icon. */
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
};

/**
 * Sliding segmented control: a short set of mutually exclusive choices with a
 * thumb that slides to the chosen one.
 *
 * `semantics` decides what assistive technology hears, because the same look
 * serves two different jobs:
 *
 *   radio  A setting or mode — grid/list, device preview, breakpoint. The group
 *          is a `radiogroup` and each segment a `radio`.
 *   tabs   Switches which panel is shown. The group is a `tablist`, each
 *          segment a `tab` controlling `panelId(value)` when given.
 *
 * Either way only the chosen segment is in the tab order, the arrow keys (and
 * Home/End) move and select, and the strip scrolls inside itself when it has
 * more segments than room, so labels never overlap or wrap into each other.
 *
 * `variant="underline"` is the same control drawn as a tab strip with a
 * sliding underline — for the longer tab rows on edit screens.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  semantics = 'radio',
  variant = 'pill',
  size = 'md',
  fullWidth = false,
  idPrefix,
  panelId,
  className,
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<SegmentOption<T>>;
  /** Accessible name of the group. */
  label: string;
  semantics?: 'radio' | 'tabs';
  variant?: 'pill' | 'underline';
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  /** Ids become `${idPrefix}${value}`; tabs need stable ids for their panels. */
  idPrefix?: string;
  /** The panel each tab controls. */
  panelId?: (value: T) => string;
  className?: string;
}) {
  const generated = React.useId();
  const prefix = idPrefix ?? `${generated}-seg-`;
  const trackRef = React.useRef<HTMLDivElement>(null);
  const buttons = React.useRef(new Map<T, HTMLButtonElement | null>());
  const [thumb, setThumb] = React.useState<{ left: number; width: number } | null>(null);

  const measure = React.useCallback(() => {
    const node = buttons.current.get(value);
    if (!node) return setThumb(null);
    setThumb({ left: node.offsetLeft, width: node.offsetWidth });
  }, [value]);

  React.useLayoutEffect(() => {
    measure();
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(track);
    buttons.current.forEach((node) => node && observer.observe(node));
    return () => observer.disconnect();
  }, [measure, options.length]);

  // Keep the chosen segment visible when the strip scrolls.
  React.useEffect(() => {
    const node = buttons.current.get(value);
    const track = trackRef.current?.parentElement;
    if (!node || !track || track.scrollWidth <= track.clientWidth) return;
    const left = node.offsetLeft - 16;
    const right = node.offsetLeft + node.offsetWidth + 16;
    if (left < track.scrollLeft) track.scrollLeft = left;
    else if (right > track.scrollLeft + track.clientWidth)
      track.scrollLeft = right - track.clientWidth;
  }, [value]);

  const enabled = options.filter((option) => !option.disabled);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = enabled.findIndex((option) => option.value === value);
    let next: SegmentOption<T> | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
      next = enabled[(index + 1) % enabled.length];
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (event.key === 'Home') next = enabled[0];
    else if (event.key === 'End') next = enabled[enabled.length - 1];
    if (!next) return;
    event.preventDefault();
    onChange(next.value);
    buttons.current.get(next.value)?.focus();
  };

  const pill = variant === 'pill';
  const small = size === 'sm';
  const groupRole = semantics === 'tabs' ? 'tablist' : 'radiogroup';

  return (
    <div
      className={cn(
        'scroll-x max-w-full',
        pill ? 'ui-segmented rounded-[0.8rem] p-[3px]' : 'ui-tabstrip border-b border-hairline',
        fullWidth ? 'flex w-full' : pill ? 'inline-flex' : 'flex',
        className,
      )}
    >
      <div
        ref={trackRef}
        role={groupRole}
        aria-label={label}
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        className={cn(
          'relative flex min-w-max items-stretch',
          fullWidth && 'w-full',
          pill ? 'gap-0.5' : 'gap-1',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute transition-[transform,width] duration-200 ease-out motion-reduce:transition-none',
            pill
              ? 'ui-segmented-thumb inset-y-0 rounded-[0.65rem]'
              : 'ui-tabstrip-thumb -bottom-px h-0.5 rounded-full bg-brand',
            !thumb && 'opacity-0',
          )}
          style={
            thumb ? { width: thumb.width, transform: `translateX(${thumb.left}px)` } : undefined
          }
        />
        {options.map((option) => {
          const selected = option.value === value;
          const id = `${prefix}${option.value}`;
          return (
            <button
              key={option.value}
              ref={(node) => {
                buttons.current.set(option.value, node);
              }}
              id={id}
              type="button"
              role={semantics === 'tabs' ? 'tab' : 'radio'}
              aria-selected={semantics === 'tabs' ? selected : undefined}
              aria-checked={semantics === 'radio' ? selected : undefined}
              aria-controls={semantics === 'tabs' && panelId ? panelId(option.value) : undefined}
              aria-label={option.ariaLabel}
              title={option.title ?? option.ariaLabel}
              tabIndex={selected ? 0 : -1}
              disabled={option.disabled}
              data-selected={selected || undefined}
              onClick={() => onChange(option.value)}
              className={cn(
                'relative flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap font-medium',
                'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/70',
                'disabled:cursor-not-allowed disabled:opacity-40',
                fullWidth && 'flex-1',
                pill
                  ? cn(
                      'rounded-[0.65rem]',
                      small ? 'min-h-7 px-2.5 text-xs' : 'min-h-8 px-3 text-[0.8125rem]',
                      selected ? 'text-content' : 'text-muted hover:text-content',
                      // Until the thumb is measured, the chosen segment paints its own fill.
                      selected && !thumb && 'ui-segmented-thumb',
                    )
                  : cn(
                      'rounded-t-lg px-3 py-2.5 text-sm',
                      selected ? 'text-content' : 'font-normal text-muted hover:text-content',
                    ),
              )}
            >
              {option.icon}
              {option.label}
              {option.badge !== undefined && option.badge !== null ? (
                <span className="ui-segmented-badge rounded-full px-1.5 text-[0.6875rem] font-semibold tabular-nums">
                  {option.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
