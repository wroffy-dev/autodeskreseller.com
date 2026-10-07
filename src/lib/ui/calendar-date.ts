/**
 * Calendar-day arithmetic for the admin's date pickers.
 *
 * A date-only field ("Starts on", a report's "From") names a day on the wall
 * calendar, not an instant, so nothing here ever goes through UTC:
 * `new Date('2026-03-01')` is midnight UTC and reads as 28 February anywhere
 * west of Greenwich, and `toISOString().slice(0, 10)` shifts the other way for
 * anyone east of it. Days are plain { year, month, day } triples and the
 * wire format is the same `yyyy-mm-dd` string a native `<input type="date">`
 * submits, so a field moved onto the custom picker posts exactly what it did
 * before.
 *
 * Date-and-time fields keep the `yyyy-mm-ddThh:mm` local wall-clock string of
 * `<input type="datetime-local">` for the same reason: whatever the server or
 * the form already did with that string, it still receives the same string.
 */

export type CalendarDay = { year: number; month: number; day: number };

/** Month is 0-based, like Date. */
export function makeDay(year: number, month: number, day: number): CalendarDay {
  // Normalise overflow (month 12 → January next year, day 0 → last of previous
  // month) through Date's local constructor, which never touches UTC.
  const date = new Date(year, month, day);
  // Years 0–99 are mapped to 1900–1999 by the constructor; undo that.
  if (year >= 0 && year < 100) date.setFullYear(year, month, day);
  return { year: date.getFullYear(), month: date.getMonth(), day: date.getDate() };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

/** `yyyy-mm-dd`, the native date input's value format. */
export function formatIsoDay(day: CalendarDay): string {
  return `${pad(day.year, 4)}-${pad(day.month + 1)}-${pad(day.day)}`;
}

/** Strict `yyyy-mm-dd` → day. Rejects impossible dates such as 2026-02-30. */
export function parseIsoDay(value: string | null | undefined): CalendarDay | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  return validDay(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function validDay(year: number, month: number, day: number): CalendarDay | null {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) return null;
  if (!Number.isInteger(month) || month < 0 || month > 11) return null;
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const MONTH_SHORT = MONTH_NAMES.map((name) => name.slice(0, 3));

/** Monday-first, matching the en-GB dates the admin already prints. */
export const WEEKDAY_SHORT = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
export const WEEKDAY_LONG = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

/** The format typed into, and shown by, every admin date field. */
export const DISPLAY_FORMAT = 'DD/MM/YYYY';

/** `dd/mm/yyyy` for the field's text box. */
export function formatDisplayDay(day: CalendarDay): string {
  return `${pad(day.day)}/${pad(day.month + 1)}/${pad(day.year, 4)}`;
}

/** "Wednesday, 7 October 2026" — for screen readers and the calendar's cells. */
export function formatLongDay(day: CalendarDay): string {
  const weekday = WEEKDAY_LONG[mondayIndex(day)];
  return `${weekday}, ${day.day} ${MONTH_NAMES[day.month]} ${day.year}`;
}

/**
 * Reads what someone typed.
 *
 * Accepts the displayed `dd/mm/yyyy` (with `/`, `-`, `.` or spaces), the ISO
 * `yyyy-mm-dd` a pasted value is likely to be in, and "7 Oct 2026" / "7 October
 * 2026". Day-first is the only numeric order accepted besides ISO, so
 * "03/04/2026" is always 3 April — never silently 4 March.
 */
export function parseTypedDay(input: string): CalendarDay | null {
  const value = input.trim();
  if (!value) return null;

  const iso = parseIsoDay(value);
  if (iso) return iso;

  const numeric = /^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{4})$/.exec(value);
  if (numeric) return validDay(Number(numeric[3]), Number(numeric[2]) - 1, Number(numeric[1]));

  const named = /^(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{4})$/i.exec(value);
  if (named) {
    const word = named[2]!.toLowerCase();
    const month = MONTH_NAMES.findIndex(
      (name) => name.toLowerCase() === word || name.slice(0, 3).toLowerCase() === word.slice(0, 3),
    );
    if (month === -1 || word.length < 3) return null;
    return validDay(Number(named[3]), month, Number(named[1]));
  }
  return null;
}

/** Negative when a is earlier, 0 when the same day. */
export function compareDays(a: CalendarDay, b: CalendarDay): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

export function sameDay(
  a: CalendarDay | null | undefined,
  b: CalendarDay | null | undefined,
): boolean {
  return !!a && !!b && compareDays(a, b) === 0;
}

export function addDays(day: CalendarDay, amount: number): CalendarDay {
  return makeDay(day.year, day.month, day.day + amount);
}

/**
 * Moves by whole months, clamping the day so 31 January + 1 month is
 * 28/29 February rather than rolling into March.
 */
export function addMonths(day: CalendarDay, amount: number): CalendarDay {
  const first = makeDay(day.year, day.month + amount, 1);
  return { ...first, day: Math.min(day.day, daysInMonth(first.year, first.month)) };
}

export function addYears(day: CalendarDay, amount: number): CalendarDay {
  return addMonths(day, amount * 12);
}

/** 0 = Monday … 6 = Sunday. */
export function mondayIndex(day: CalendarDay): number {
  return (new Date(day.year, day.month, day.day).getDay() + 6) % 7;
}

export function startOfWeek(day: CalendarDay): CalendarDay {
  return addDays(day, -mondayIndex(day));
}

export function endOfWeek(day: CalendarDay): CalendarDay {
  return addDays(day, 6 - mondayIndex(day));
}

export function today(now = new Date()): CalendarDay {
  return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
}

/**
 * The six-week grid for a month, Monday first, including the trailing days of
 * the previous month and the leading days of the next one. Always 42 cells so
 * the calendar's height never jumps between months.
 */
export function monthGrid(year: number, month: number): Array<CalendarDay & { inMonth: boolean }> {
  const first = { year, month, day: 1 };
  const start = addDays(first, -mondayIndex(first));
  return Array.from({ length: 42 }, (_, index) => {
    const day = addDays(start, index);
    return { ...day, inMonth: day.month === month && day.year === year };
  });
}

export type DayBounds = { min?: CalendarDay | null; max?: CalendarDay | null };

export function isOutOfBounds(day: CalendarDay, bounds: DayBounds): boolean {
  if (bounds.min && compareDays(day, bounds.min) < 0) return true;
  if (bounds.max && compareDays(day, bounds.max) > 0) return true;
  return false;
}

export function clampDay(day: CalendarDay, bounds: DayBounds): CalendarDay {
  if (bounds.min && compareDays(day, bounds.min) < 0) return bounds.min;
  if (bounds.max && compareDays(day, bounds.max) > 0) return bounds.max;
  return day;
}

/** True when the day falls inside the inclusive range, in either order. */
export function inRange(
  day: CalendarDay,
  from: CalendarDay | null,
  to: CalendarDay | null,
): boolean {
  if (!from || !to) return false;
  const [start, end] = compareDays(from, to) <= 0 ? [from, to] : [to, from];
  return compareDays(day, start) >= 0 && compareDays(day, end) <= 0;
}

/* ---------------------------------------------------------------------------
 * Date and time
 * ------------------------------------------------------------------------- */

export type WallTime = { hour: number; minute: number };

/** `yyyy-mm-ddThh:mm` (seconds tolerated) → its parts, read as wall-clock time. */
export function parseLocalDateTime(
  value: string | null | undefined,
): { day: CalendarDay; time: WallTime } | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value.trim());
  if (!match) return null;
  const day = parseIsoDay(match[1]);
  const time = validTime(Number(match[2]), Number(match[3]));
  return day && time ? { day, time } : null;
}

export function formatLocalDateTime(day: CalendarDay, time: WallTime): string {
  return `${formatIsoDay(day)}T${pad(time.hour)}:${pad(time.minute)}`;
}

function validTime(hour: number, minute: number): WallTime | null {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/** `hh:mm` 24-hour, also accepting `9:5`, `0930` and `9.30`. */
export function parseTypedTime(input: string): WallTime | null {
  const value = input.trim();
  const match =
    /^(\d{1,2})(?:[:.]?(\d{2}))?$/.exec(value) ?? /^(\d{1,2})[:.](\d{1,2})$/.exec(value);
  if (!match) return null;
  return validTime(Number(match[1]), Number(match[2] ?? 0));
}

export function formatTime(time: WallTime): string {
  return `${pad(time.hour)}:${pad(time.minute)}`;
}

/**
 * The browser's IANA zone ("Asia/Kolkata"), so a scheduled field can say which
 * clock its time is on. Null where Intl cannot tell.
 */
export function localTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
