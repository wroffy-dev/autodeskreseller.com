'use client';

import * as React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover } from '@/components/ui/popover';
import { DateRangeCalendar } from '@/components/ui/date-field';
import { formatRangeLabel, toDayString } from '@/lib/admin/date-range';
import { cn } from '@/lib/utils/cn';

const PRESETS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
] as const;

/**
 * The reports screen's range: three quick spans and a custom range on the
 * shared calendar. The choice is applied to the query string, so the report
 * re-renders on the server with the new bounds.
 *
 * Days are built from local calendar fields (`toDayString`), never from
 * `toISOString()`, which would shift "today" by a day for anyone far enough
 * from UTC.
 */
export function DateRangeFilter({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [range, setRange] = React.useState({ from, to });
  const [open, setOpen] = React.useState(false);
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => setRange({ from, to }), [from, to]);

  function apply(next: { from: string; to: string }) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('from', next.from);
    params.set('to', next.to);
    router.push(`${pathname}?${params.toString()}`);
  }

  function preset(days: number) {
    const end = new Date();
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (days - 1));
    const next = { from: toDayString(start), to: toDayString(end) };
    setRange(next);
    apply(next);
  }

  const activeDays = PRESETS.find((option) => {
    const end = new Date();
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (option.days - 1));
    return from === toDayString(start) && to === toDayString(end);
  })?.days;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map((option) => (
        <Button
          key={option.days}
          variant="outline"
          size="sm"
          aria-pressed={activeDays === option.days}
          className={cn(activeDays === option.days && 'border-brand/40 bg-brand/[0.06] text-brand')}
          onClick={() => preset(option.days)}
        >
          {option.label}
        </Button>
      ))}
      <div ref={anchorRef} className="min-w-0">
        <Button
          ref={buttonRef}
          variant="outline"
          size="sm"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="max-w-full"
        >
          <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {from && to ? formatRangeLabel({ from, to }) : 'Custom range'}
          </span>
        </Button>
      </div>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        returnFocusRef={buttonRef}
        align="end"
        label="Choose a date range"
        sheetTitle="Date range"
      >
        <DateRangeCalendar
          from={range.from}
          to={range.to}
          onChange={(nextFrom, nextTo) => setRange({ from: nextFrom, to: nextTo })}
        />
        <div className="mt-3 flex justify-end gap-2 border-t border-hairline pt-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setRange({ from, to });
              setOpen(false);
              buttonRef.current?.focus();
            }}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!range.from}
            onClick={() => {
              const next = { from: range.from, to: range.to || range.from };
              setOpen(false);
              buttonRef.current?.focus();
              apply(next);
            }}
          >
            Apply
          </Button>
        </div>
      </Popover>
    </div>
  );
}
