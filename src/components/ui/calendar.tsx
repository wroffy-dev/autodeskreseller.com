'use client';

import * as React from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  MONTH_NAMES,
  MONTH_SHORT,
  WEEKDAY_LONG,
  WEEKDAY_SHORT,
  addDays,
  addMonths,
  addYears,
  clampDay,
  compareDays,
  endOfWeek,
  formatIsoDay,
  formatLongDay,
  inRange,
  isOutOfBounds,
  monthGrid,
  sameDay,
  startOfWeek,
  today as todayOf,
  type CalendarDay,
} from '@/lib/ui/calendar-date';
import { cn } from '@/lib/utils/cn';

export type CalendarEvent = {
  id: string;
  day: CalendarDay;
  title: string;
  /** "10:30 · Follow-up", shown under the title. */
  detail?: string;
  href?: string;
};

type Common = {
  min?: CalendarDay | null;
  max?: CalendarDay | null;
  /** Extra rule for days that cannot be picked (weekends, past days). */
  isDisabled?: (day: CalendarDay) => boolean;
  /** Moves focus into the grid on mount — for a picker opened from its button. */
  autoFocus?: boolean;
  /**
   * Real scheduled items to list beside the grid, as in the reference design.
   * Pass them only where such items exist; an ordinary date field shows the
   * compact calendar on its own.
   */
  events?: CalendarEvent[];
  /** Month shown first when nothing is selected. Defaults to today's. */
  defaultMonth?: CalendarDay | null;
  className?: string;
  label?: string;
};

type SingleProps = Common & {
  mode?: 'single';
  selected: CalendarDay | null;
  onSelect: (day: CalendarDay) => void;
};

type RangeProps = Common & {
  mode: 'range';
  from: CalendarDay | null;
  to: CalendarDay | null;
  /** Called with the new pair; `to` is null while the second end is pending. */
  onRangeChange: (from: CalendarDay, to: CalendarDay | null) => void;
};

export type CalendarProps = SingleProps | RangeProps;

/**
 * The admin calendar.
 *
 * A month grid with Monday-first weekday headings, a month/year heading that
 * opens a month and year chooser, and previous/next month controls.
 *
 * Keyboard (the grid follows the WAI-ARIA date picker pattern):
 *   ←/→ one day · ↑/↓ one week · Home/End start/end of the week
 *   PageUp/PageDown one month · Shift+PageUp/PageDown one year
 *   Enter/Space choose the focused day
 *
 * Only one day is in the tab order at a time, so Tab moves from the grid to
 * the next control rather than through 42 buttons.
 */
export function Calendar(props: CalendarProps) {
  const { min = null, max = null, isDisabled, autoFocus, events, defaultMonth, className } = props;
  const isRange = props.mode === 'range';

  const anchor: CalendarDay | null = isRange ? (props.from ?? props.to) : props.selected;
  const [now] = React.useState(() => todayOf());
  const [focused, setFocused] = React.useState<CalendarDay>(() =>
    clampDay(anchor ?? defaultMonth ?? now, { min, max }),
  );
  const [view, setView] = React.useState<'days' | 'months'>('days');
  const [hovered, setHovered] = React.useState<CalendarDay | null>(null);
  const [keyboardFocus, setKeyboardFocus] = React.useState(!!autoFocus);
  const gridRef = React.useRef<HTMLTableElement>(null);
  const headingId = React.useId();

  // Follow a selection made from outside (typing into the field).
  const anchorKey = anchor ? formatIsoDay(anchor) : '';
  React.useEffect(() => {
    if (anchor) setFocused(anchor);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the value, not the object
  }, [anchorKey]);

  React.useEffect(() => {
    if (autoFocus) setKeyboardFocus(true);
  }, [autoFocus]);

  React.useEffect(() => {
    if (!keyboardFocus || view !== 'days') return;
    gridRef.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
  }, [focused, keyboardFocus, view]);

  const disabled = React.useCallback(
    (day: CalendarDay) => isOutOfBounds(day, { min, max }) || !!isDisabled?.(day),
    [min, max, isDisabled],
  );

  const choose = (day: CalendarDay) => {
    if (disabled(day)) return;
    setFocused(day);
    if (!isRange) {
      props.onSelect(day);
      return;
    }
    const { from, to } = props;
    // First click, or a third click after a complete range, starts again.
    if (!from || to) {
      props.onRangeChange(day, null);
    } else if (compareDays(day, from) < 0) {
      props.onRangeChange(day, from);
    } else {
      props.onRangeChange(from, day);
    }
    setHovered(null);
  };

  const move = (next: CalendarDay) => {
    setKeyboardFocus(true);
    setFocused(clampDay(next, { min, max }));
  };

  const onGridKeyDown = (event: React.KeyboardEvent) => {
    const map: Record<string, () => CalendarDay> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      ArrowDown: () => addDays(focused, 7),
      Home: () => startOfWeek(focused),
      End: () => endOfWeek(focused),
      PageUp: () => (event.shiftKey ? addYears(focused, -1) : addMonths(focused, -1)),
      PageDown: () => (event.shiftKey ? addYears(focused, 1) : addMonths(focused, 1)),
    };
    const step = map[event.key];
    if (step) {
      event.preventDefault();
      move(step());
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(focused);
    }
  };

  const shiftMonth = (amount: number) => {
    setFocused((current) => clampDay(addMonths(current, amount), { min, max }));
  };

  const grid = monthGrid(focused.year, focused.month);
  const weeks = Array.from({ length: 6 }, (_, row) => grid.slice(row * 7, row * 7 + 7));

  const firstOfMonth = { year: focused.year, month: focused.month, day: 1 };
  const prevDisabled = !!min && compareDays(addDays(firstOfMonth, -1), min) < 0;
  const nextDisabled = !!max && compareDays(addMonths(firstOfMonth, 1), max) > 0;

  const rangeEnd = isRange ? (props.to ?? (props.from ? hovered : null)) : null;

  const monthEvents = (events ?? [])
    .filter((event) => event.day.year === focused.year && event.day.month === focused.month)
    .sort((a, b) => compareDays(a.day, b.day));
  const eventDays = new Set((events ?? []).map((event) => formatIsoDay(event.day)));
  const showEvents = !!events;

  return (
    <div
      className={cn(
        'ui-calendar flex flex-col gap-4',
        showEvents && 'sm:flex-row sm:items-stretch',
        className,
      )}
    >
      <div className="w-full min-w-0 sm:w-[17.5rem]">
        <div className="mb-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setView((value) => (value === 'days' ? 'months' : 'days'))}
            aria-expanded={view === 'months'}
            aria-label={`${MONTH_NAMES[focused.month]} ${focused.year}. Choose month and year`}
            className="ui-calendar-heading admin-focus-ring inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-[0.9375rem] font-semibold text-content transition-colors hover:bg-muted/[0.08]"
          >
            <span id={headingId} aria-live="polite">
              {MONTH_NAMES[focused.month]} {focused.year}
            </span>
            <ChevronDown
              className={cn(
                'h-4 w-4 text-muted transition-transform duration-150',
                view === 'months' && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </button>
          {view === 'days' ? (
            <div className="flex items-center gap-0.5">
              <NavButton
                label="Previous month"
                onClick={() => shiftMonth(-1)}
                disabled={prevDisabled}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </NavButton>
              <NavButton label="Next month" onClick={() => shiftMonth(1)} disabled={nextDisabled}>
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </NavButton>
            </div>
          ) : null}
        </div>

        {view === 'months' ? (
          <MonthYearChooser
            focused={focused}
            min={min}
            max={max}
            onPick={(year, month) => {
              setFocused((current) =>
                clampDay(
                  {
                    year,
                    month,
                    day: Math.min(current.day, new Date(year, month + 1, 0).getDate()),
                  },
                  { min, max },
                ),
              );
              setView('days');
              setKeyboardFocus(true);
            }}
          />
        ) : (
          // Fixed seven columns; the wrapper only matters at extreme zoom, where
          // the grid scrolls inside itself instead of widening the page.
          <div className="-m-1 overflow-x-auto p-1">
            <table
              ref={gridRef}
              role="grid"
              aria-labelledby={headingId}
              onKeyDown={onGridKeyDown}
              onMouseLeave={() => setHovered(null)}
              className="w-full table-fixed border-collapse"
            >
              <thead>
                <tr>
                  {WEEKDAY_SHORT.map((label, index) => (
                    <th
                      key={label}
                      scope="col"
                      abbr={WEEKDAY_LONG[index]}
                      className="pb-1 text-center text-[0.6875rem] font-semibold uppercase tracking-wide text-muted"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((week, row) => (
                  <tr key={row}>
                    {week.map((cell) => {
                      const day: CalendarDay = {
                        year: cell.year,
                        month: cell.month,
                        day: cell.day,
                      };
                      const isFocused = sameDay(day, focused);
                      const isToday = sameDay(day, now);
                      const isDisabledDay = disabled(day);
                      const start = isRange ? props.from : null;
                      const end = rangeEnd;
                      const isSelected = isRange
                        ? sameDay(day, start) || sameDay(day, props.to)
                        : sameDay(day, props.selected);
                      const within = isRange && inRange(day, start, end);
                      const [lo, hi] =
                        start && end && compareDays(start, end) > 0 ? [end, start] : [start, end];
                      const hasEvent = eventDays.has(formatIsoDay(day));

                      return (
                        <td
                          key={formatIsoDay(day)}
                          role="gridcell"
                          aria-selected={isSelected || within || undefined}
                          className={cn(
                            'p-0 text-center',
                            within && 'ui-calendar-range',
                            within && sameDay(day, lo) && 'ui-calendar-range-start',
                            within && sameDay(day, hi) && 'ui-calendar-range-end',
                          )}
                        >
                          <button
                            type="button"
                            tabIndex={isFocused ? 0 : -1}
                            aria-label={`${formatLongDay(day)}${isToday ? ', today' : ''}${isSelected ? ', selected' : ''}${hasEvent ? ', has scheduled items' : ''}`}
                            aria-disabled={isDisabledDay || undefined}
                            aria-current={isToday ? 'date' : undefined}
                            data-today={isToday || undefined}
                            data-selected={isSelected || undefined}
                            data-outside={!cell.inMonth || undefined}
                            onClick={() => {
                              setKeyboardFocus(false);
                              choose(day);
                            }}
                            onFocus={() => {
                              if (!isFocused) setFocused(day);
                            }}
                            onMouseEnter={() => isRange && setHovered(day)}
                            className={cn(
                              'ui-calendar-day relative mx-auto my-px flex h-9 w-9 items-center justify-center rounded-full text-sm tabular-nums',
                              'transition-colors duration-150 focus-visible:outline-none',
                              cell.inMonth ? 'text-content' : 'text-muted',
                              isDisabledDay
                                ? 'cursor-not-allowed text-muted/40 line-through decoration-muted/40'
                                : !isSelected && 'hover:bg-muted/[0.1]',
                              isToday && !isSelected && 'font-semibold',
                            )}
                          >
                            {cell.day}
                            {hasEvent ? (
                              <span
                                aria-hidden="true"
                                className="ui-calendar-dot absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full"
                              />
                            ) : null}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showEvents ? (
        <EventList month={focused} events={monthEvents} onPick={(day) => move(day)} />
      ) : null}
    </div>
  );
}

function NavButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="admin-focus-ring flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-muted/[0.08] hover:text-content disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function MonthYearChooser({
  focused,
  min,
  max,
  onPick,
}: {
  focused: CalendarDay;
  min: CalendarDay | null;
  max: CalendarDay | null;
  onPick: (year: number, month: number) => void;
}) {
  const [year, setYear] = React.useState(focused.year);
  const firstRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const monthOut = (month: number) => {
    const first = { year, month, day: 1 };
    const last = { year, month, day: new Date(year, month + 1, 0).getDate() };
    return (!!max && compareDays(first, max) > 0) || (!!min && compareDays(last, min) < 0);
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between rounded-xl bg-muted/[0.06] p-1">
        <NavButton
          label="Previous year"
          onClick={() => setYear((value) => value - 1)}
          disabled={!!min && year - 1 < min.year}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </NavButton>
        <span className="text-sm font-semibold tabular-nums text-content" aria-live="polite">
          {year}
        </span>
        <NavButton
          label="Next year"
          onClick={() => setYear((value) => value + 1)}
          disabled={!!max && year + 1 > max.year}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </NavButton>
      </div>
      <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={`Months of ${year}`}>
        {MONTH_SHORT.map((label, month) => {
          const current = month === focused.month && year === focused.year;
          const out = monthOut(month);
          return (
            <button
              key={label}
              ref={current ? firstRef : undefined}
              type="button"
              disabled={out}
              aria-pressed={current}
              aria-label={`${MONTH_NAMES[month]} ${year}`}
              onClick={() => onPick(year, month)}
              className={cn(
                'ui-calendar-month admin-focus-ring h-11 rounded-xl text-sm transition-colors',
                current ? 'font-semibold' : 'text-content hover:bg-muted/[0.08]',
                out && 'cursor-not-allowed opacity-35',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EventList({
  month,
  events,
  onPick,
}: {
  month: CalendarDay;
  events: CalendarEvent[];
  onPick: (day: CalendarDay) => void;
}) {
  return (
    <section
      aria-label={`Scheduled in ${MONTH_NAMES[month.month]} ${month.year}`}
      className="ui-calendar-events min-w-0 border-t border-hairline pt-3 sm:w-56 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0"
    >
      <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted">
        Scheduled · {MONTH_SHORT[month.month]}
      </p>
      {events.length === 0 ? (
        <p className="text-sm text-muted">Nothing scheduled this month.</p>
      ) : (
        <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
          {events.map((event) => (
            <li key={event.id}>
              <button
                type="button"
                onClick={() => onPick(event.day)}
                className="admin-focus-ring flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/[0.08]"
              >
                <span className="ui-calendar-event-date flex w-9 shrink-0 flex-col items-center rounded-md py-0.5 leading-tight">
                  <span className="text-[0.625rem] font-semibold uppercase">
                    {MONTH_SHORT[event.day.month]}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">{event.day.day}</span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-content">{event.title}</span>
                  {event.detail ? (
                    <span className="block truncate text-xs text-muted">{event.detail}</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
