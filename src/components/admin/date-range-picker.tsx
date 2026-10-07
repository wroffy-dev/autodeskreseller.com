'use client';

import * as React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { CalendarDays, ChevronDown, X } from 'lucide-react';
import { Popover } from '@/components/ui/popover';
import { DateRangeCalendar } from '@/components/ui/date-field';
import { Button } from '@/components/ui/button';
import {
  RANGE_PRESET_LABELS,
  formatRangeLabel,
  type DateRange,
  type RangePreset,
} from '@/lib/admin/date-range';
import { cn } from '@/lib/utils/cn';

const PRESET_ORDER: RangePreset[] = [
  'today',
  'yesterday',
  'last7',
  'last30',
  'thisMonth',
  'lastMonth',
  'thisQuarter',
  'thisYear',
];

/**
 * The range control for the CRM dashboard and reports.
 *
 * The choice lives in the query string, so refreshing keeps it, the back
 * button works and a filtered view can be shared. Nothing is filtered here —
 * the page re-renders on the server with the new bounds.
 */
export function DateRangePicker({ range }: { range: DateRange }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState({ from: range.from, to: range.to });
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => setDraft({ from: range.from, to: range.to }), [range.from, range.to]);

  const push = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    // A new range always returns to the first page of any list beneath it.
    next.delete('page');
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const choosePreset = (preset: RangePreset) => {
    close();
    push({ range: preset, from: null, to: null });
  };

  const applyCustom = () => {
    if (!draft.from) return;
    close();
    // One picked day is a one-day range.
    push({ range: null, from: draft.from, to: draft.to || draft.from });
  };

  const reset = () => {
    close();
    push({ range: null, from: null, to: null });
  };

  const label =
    range.preset === 'custom' ? formatRangeLabel(range) : RANGE_PRESET_LABELS[range.preset];

  return (
    <div ref={containerRef} className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          'ui-control flex h-10 max-w-full items-center gap-2 rounded-lg border bg-surface px-3 text-sm transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1',
          open ? 'border-brand text-content' : 'border-hairline text-content hover:bg-muted/[0.06]',
        )}
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        <span className="truncate font-medium">{label}</span>
        <span className="hidden truncate text-xs text-muted sm:inline">
          {formatRangeLabel(range)}
        </span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-muted transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={containerRef}
        returnFocusRef={buttonRef}
        align="end"
        label="Choose a date range"
        sheetTitle="Date range"
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="grid grid-cols-2 content-start gap-1 sm:w-36 sm:grid-cols-1">
            {PRESET_ORDER.map((preset) => {
              const active = range.preset === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => choosePreset(preset)}
                  aria-pressed={active}
                  className={cn(
                    'admin-focus-ring rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                    active
                      ? 'bg-brand/10 font-medium text-brand'
                      : 'text-content hover:bg-muted/[0.07]',
                  )}
                >
                  {RANGE_PRESET_LABELS[preset]}
                </button>
              );
            })}
          </div>

          <div className="border-hairline sm:border-l sm:pl-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              Custom range
            </p>
            <DateRangeCalendar
              from={draft.from}
              to={draft.to}
              onChange={(from, to) => setDraft({ from, to })}
            />
          </div>
        </div>

        <div className="mt-3 flex items-center justify-end gap-2 border-t border-hairline pt-3">
          <Button size="sm" variant="outline" onClick={reset}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Reset
          </Button>
          <Button size="sm" onClick={applyCustom} disabled={!draft.from}>
            Apply
          </Button>
        </div>
      </Popover>
    </div>
  );
}
