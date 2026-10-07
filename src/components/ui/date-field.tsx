'use client';

import * as React from 'react';
import { CalendarDays, Clock, X } from 'lucide-react';
import { Calendar, type CalendarEvent } from './calendar';
import { Popover } from './popover';
import { inputClasses } from './field';
import {
  DISPLAY_FORMAT,
  compareDays,
  formatDisplayDay,
  formatIsoDay,
  formatLocalDateTime,
  formatTime,
  isOutOfBounds,
  localTimeZone,
  parseIsoDay,
  parseLocalDateTime,
  parseTypedDay,
  parseTypedTime,
  type CalendarDay,
} from '@/lib/ui/calendar-date';
import { cn } from '@/lib/utils/cn';
import { announceEdit } from '@/lib/admin/unsaved-changes';

/*
 * Date fields for the admin.
 *
 * Each one replaces an `<input type="date">` or `<input type="datetime-local">`
 * without changing what the form receives:
 *
 *   DateField       value `yyyy-mm-dd` or ''           (onChange or `name`)
 *   DateTimeField   value `yyyy-mm-ddThh:mm` or ''     (onChange or `name`)
 *
 * With `name`, a hidden input carries that exact string, so a form posted
 * through FormData or a Server Action sees what the native input sent. The
 * visible text box has no name; it carries `required` and a custom validity
 * message instead, so the browser's own validation still stops a submit with
 * an empty or unreadable date.
 */

type BaseProps = {
  id?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  /** `yyyy-mm-dd` bounds, as the native input's min/max attributes took. */
  min?: string;
  max?: string;
  className?: string;
  /** Marks the field invalid from outside (a server-side error). */
  invalid?: boolean;
  'aria-describedby'?: string;
  /** Shown on the phone sheet, where the field's own label is out of view. */
  label?: string;
  /** Real scheduled items to list beside the calendar. Omit for plain fields. */
  events?: CalendarEvent[];
  size?: 'sm' | 'md';
};

function useControllable(
  value: string | undefined,
  defaultValue: string | undefined,
  onChange: ((next: string) => void) | undefined,
): [string, (next: string) => void] {
  const [inner, setInner] = React.useState(defaultValue ?? '');
  const controlled = value !== undefined;
  const current = controlled ? value : inner;
  const set = React.useCallback(
    (next: string) => {
      if (!controlled) setInner(next);
      onChange?.(next);
    },
    [controlled, onChange],
  );
  return [current ?? '', set];
}

function boundsMessage(min: CalendarDay | null, max: CalendarDay | null): string {
  if (min && max)
    return `Choose a date between ${formatDisplayDay(min)} and ${formatDisplayDay(max)}.`;
  if (min) return `Choose a date on or after ${formatDisplayDay(min)}.`;
  return `Choose a date on or before ${formatDisplayDay(max!)}.`;
}

/**
 * The text box, calendar button and clear button shared by both fields.
 * Returns the parsed day on commit, or an error message.
 */
function useDayText(day: CalendarDay | null) {
  const [text, setText] = React.useState(day ? formatDisplayDay(day) : '');
  const [editing, setEditing] = React.useState(false);
  const key = day ? formatIsoDay(day) : '';
  // Re-sync from the value whenever it changes from outside, unless the person
  // is mid-way through typing into the box.
  React.useEffect(() => {
    if (!editing) setText(day ? formatDisplayDay(day) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the value string
  }, [key, editing]);
  return { text, setText, editing, setEditing };
}

export function DateField({
  value,
  defaultValue,
  onChange,
  placeholder = DISPLAY_FORMAT,
  ...rest
}: BaseProps & {
  value?: string;
  defaultValue?: string;
  onChange?: (next: string) => void;
  placeholder?: string;
  withCalendar?: boolean;
}) {
  const [current, setCurrent] = useControllable(value, defaultValue, onChange);
  const day = parseIsoDay(current);

  return (
    <DayInput
      {...rest}
      day={day}
      placeholder={placeholder}
      hiddenValue={current}
      onDay={(next) => setCurrent(next ? formatIsoDay(next) : '')}
    />
  );
}

function DayInput({
  id,
  name,
  required,
  disabled,
  min,
  max,
  className,
  invalid,
  label,
  events,
  size = 'md',
  placeholder,
  day,
  hiddenValue,
  onDay: emitDay,
  trailing,
  withCalendar = true,
  'aria-describedby': describedBy,
}: BaseProps & {
  day: CalendarDay | null;
  placeholder: string;
  hiddenValue: string;
  onDay: (next: CalendarDay | null) => void;
  /** Extra control inside the same frame (the time box). */
  trailing?: React.ReactNode;
  /** False for a typed-only box that sits beside a calendar already open. */
  withCalendar?: boolean;
}) {
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  const formatId = `${inputId}-format`;
  const errorId = `${inputId}-error`;
  const minDay = parseIsoDay(min);
  const maxDay = parseIsoDay(max);

  const { text, setText, setEditing } = useDayText(day);
  const inputRef = React.useRef<HTMLInputElement>(null);
  // Every value change counts as an edit for the unsaved-changes guard, whether
  // it was typed, picked on the calendar or cleared.
  const onDay = (next: CalendarDay | null) => {
    announceEdit(inputRef.current);
    emitDay(next);
  };
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const [focusGrid, setFocusGrid] = React.useState(false);
  const frameRef = React.useRef<HTMLDivElement>(null);

  // A value out of bounds is reported like a typo would be.
  const boundsError =
    day && isOutOfBounds(day, { min: minDay, max: maxDay }) ? boundsMessage(minDay, maxDay) : null;
  const message = error ?? boundsError;

  React.useEffect(() => {
    inputRef.current?.setCustomValidity(message ?? '');
  }, [message]);

  const commit = (raw: string) => {
    setEditing(false);
    if (!raw.trim()) {
      setError(null);
      if (day) onDay(null);
      return;
    }
    const parsed = parseTypedDay(raw);
    if (!parsed) {
      setError(`Enter a date as ${DISPLAY_FORMAT}.`);
      return;
    }
    if (isOutOfBounds(parsed, { min: minDay, max: maxDay })) {
      setError(boundsMessage(minDay, maxDay));
      setText(formatDisplayDay(parsed));
      return;
    }
    setError(null);
    setText(formatDisplayDay(parsed));
    if (!day || compareDays(parsed, day) !== 0) onDay(parsed);
  };

  const openCalendar = (withGridFocus: boolean) => {
    if (disabled || !withCalendar) return;
    setFocusGrid(withGridFocus);
    setOpen(true);
  };

  const pick = (next: CalendarDay) => {
    setError(null);
    setText(formatDisplayDay(next));
    onDay(next);
    setOpen(false);
    inputRef.current?.focus();
  };

  const showInvalid = invalid || !!message;

  return (
    <div className={cn('min-w-0', className)}>
      <div
        ref={frameRef}
        className={cn(
          inputClasses,
          'ui-date-field flex items-center gap-1 px-0 py-0',
          size === 'sm' ? 'h-9' : 'h-10',
          'focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/25',
          disabled && 'cursor-not-allowed opacity-70',
          showInvalid && 'border-red-500',
        )}
        data-invalid={showInvalid || undefined}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          value={text}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          aria-invalid={showInvalid || undefined}
          aria-describedby={cn(formatId, message && errorId, describedBy) || undefined}
          onChange={(event) => {
            setEditing(true);
            setText(event.target.value);
            if (error) setError(null);
          }}
          onBlur={(event) => commit(event.target.value)}
          onClick={() => openCalendar(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              // Commit the typed date rather than submitting a half-typed one.
              event.preventDefault();
              commit(event.currentTarget.value);
            } else if (event.key === 'ArrowDown' && (event.altKey || open)) {
              event.preventDefault();
              openCalendar(true);
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent pl-3 text-sm text-content tabular-nums outline-none placeholder:text-muted focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed"
        />
        <span id={formatId} className="sr-only">
          Format {DISPLAY_FORMAT}.
          {withCalendar ? ' Press Alt and Down arrow to open the calendar.' : ''}
        </span>
        {trailing}
        {day && !required && !disabled ? (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setText('');
              onDay(null);
              inputRef.current?.focus();
            }}
            aria-label="Clear date"
            title="Clear date"
            className="admin-focus-ring flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-muted/10 hover:text-content"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
        {withCalendar ? (
          <button
            type="button"
            onClick={() => (open ? setOpen(false) : openCalendar(true))}
            disabled={disabled}
            aria-label={open ? 'Close calendar' : 'Choose date'}
            aria-haspopup="dialog"
            aria-expanded={open}
            title="Choose date"
            className="admin-focus-ring mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-muted/10 hover:text-content disabled:cursor-not-allowed"
          >
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
        {name ? <input type="hidden" name={name} value={hiddenValue} /> : null}
      </div>
      {message ? (
        <p id={errorId} className="mt-1 text-xs font-medium text-red-600" role="alert">
          {message}
        </p>
      ) : null}

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={frameRef}
        returnFocusRef={inputRef}
        label={label ? `Choose ${label.toLowerCase()}` : 'Choose a date'}
        sheetTitle={label}
      >
        <Calendar
          selected={day}
          onSelect={pick}
          min={minDay}
          max={maxDay}
          autoFocus={focusGrid}
          events={events}
        />
        <p className="mt-2 border-t border-hairline pt-2 text-xs text-muted">
          Or type a date as <span className="font-medium text-content">{DISPLAY_FORMAT}</span>
        </p>
      </Popover>
    </div>
  );
}

/**
 * A date and a 24-hour time, read and written as the `yyyy-mm-ddThh:mm` local
 * wall-clock string `<input type="datetime-local">` used. The time zone the
 * browser will apply is named under the field, so a scheduled publish time
 * says which clock it is on.
 */
export function DateTimeField({
  value,
  defaultValue,
  onChange,
  defaultTime = '09:00',
  showTimeZone = true,
  ...rest
}: BaseProps & {
  value?: string;
  defaultValue?: string;
  onChange?: (next: string) => void;
  /** Used when a day is picked before any time is set. */
  defaultTime?: string;
  showTimeZone?: boolean;
}) {
  const [current, setCurrent] = useControllable(value, defaultValue, onChange);
  const parsed = parseLocalDateTime(current);
  // A day may be chosen before a time; hold it until both exist.
  const [pendingDay, setPendingDay] = React.useState<CalendarDay | null>(null);
  const day = parsed?.day ?? pendingDay;
  const [timeText, setTimeText] = React.useState(parsed ? formatTime(parsed.time) : '');
  const [timeError, setTimeError] = React.useState<string | null>(null);
  const [zone, setZone] = React.useState<string | null>(null);
  const generatedId = React.useId();
  const timeId = `${rest.id ?? generatedId}-time`;

  React.useEffect(() => setZone(localTimeZone()), []);

  const timeKey = parsed ? formatTime(parsed.time) : '';
  React.useEffect(() => {
    if (timeKey) setTimeText(timeKey);
  }, [timeKey]);

  const emit = (nextDay: CalendarDay | null, nextTime: string) => {
    if (!nextDay) {
      setPendingDay(null);
      setCurrent('');
      return;
    }
    const time = parseTypedTime(nextTime);
    if (!time) {
      setPendingDay(nextDay);
      setCurrent('');
      return;
    }
    setPendingDay(null);
    setCurrent(formatLocalDateTime(nextDay, time));
  };

  const timeBox = (
    <span className="flex shrink-0 items-center gap-1 border-l border-hairline pl-2">
      <Clock className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
      <label htmlFor={timeId} className="sr-only">
        Time, 24-hour, HH:MM
      </label>
      <input
        id={timeId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={timeText}
        placeholder="HH:MM"
        disabled={rest.disabled}
        required={rest.required}
        aria-invalid={!!timeError || undefined}
        onChange={(event) => {
          setTimeText(event.target.value);
          setTimeError(null);
        }}
        onBlur={(event) => {
          const raw = event.target.value.trim();
          if (!raw) {
            if (day) emit(day, '');
            return;
          }
          const time = parseTypedTime(raw);
          if (!time) {
            setTimeError('Enter a time as HH:MM, 24-hour.');
            event.target.setCustomValidity('Enter a time as HH:MM, 24-hour.');
            return;
          }
          event.target.setCustomValidity('');
          setTimeText(formatTime(time));
          emit(day, formatTime(time));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
            event.currentTarget.focus();
          }
        }}
        className="h-full w-[3.25rem] bg-transparent text-sm tabular-nums text-content outline-none placeholder:text-muted focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
      />
    </span>
  );

  return (
    <div className="min-w-0">
      <DayInput
        {...rest}
        day={day}
        placeholder={DISPLAY_FORMAT}
        hiddenValue={current}
        trailing={timeBox}
        onDay={(next) => {
          if (!next) {
            setTimeText('');
            emit(null, '');
            return;
          }
          const time = timeText.trim() ? timeText : defaultTime;
          if (!timeText.trim()) setTimeText(defaultTime);
          emit(next, time);
        }}
      />
      {timeError ? (
        <p className="mt-1 text-xs font-medium text-red-600" role="alert">
          {timeError}
        </p>
      ) : showTimeZone && zone ? (
        <p className="mt-1 text-xs text-muted">Time in your time zone ({zone})</p>
      ) : null}
    </div>
  );
}

/**
 * A from/to pair on one calendar, for report and list filters. Values are
 * `yyyy-mm-dd` strings or '' — what the two native inputs it replaces held.
 */
export function DateRangeCalendar({
  from,
  to,
  onChange,
  min,
  max,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  min?: string;
  max?: string;
}) {
  const fromId = React.useId();
  const toId = React.useId();
  const fromDay = parseIsoDay(from);
  const toDay = parseIsoDay(to);
  return (
    // Held to the calendar's width so the two typed boxes never widen the panel.
    <div className="w-full space-y-3 sm:w-[17.5rem]">
      <Calendar
        mode="range"
        from={fromDay}
        to={toDay}
        min={parseIsoDay(min)}
        max={parseIsoDay(max)}
        onRangeChange={(start, end) => onChange(formatIsoDay(start), end ? formatIsoDay(end) : '')}
      />
      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0 space-y-1">
          <label htmlFor={fromId} className="block text-xs text-muted">
            Start date
          </label>
          <DateField
            id={fromId}
            value={from}
            min={min}
            max={to || max}
            size="sm"
            withCalendar={false}
            onChange={(next) => onChange(next, to)}
          />
        </div>
        <div className="min-w-0 space-y-1">
          <label htmlFor={toId} className="block text-xs text-muted">
            End date
          </label>
          <DateField
            id={toId}
            value={to}
            min={from || min}
            max={max}
            size="sm"
            withCalendar={false}
            onChange={(next) => onChange(from, next)}
          />
        </div>
      </div>
    </div>
  );
}
