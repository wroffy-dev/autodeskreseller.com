import { describe, it, expect, afterEach } from 'vitest';
import {
  addDays,
  addMonths,
  addYears,
  compareDays,
  daysInMonth,
  endOfWeek,
  formatDisplayDay,
  formatIsoDay,
  formatLocalDateTime,
  formatLongDay,
  inRange,
  isLeapYear,
  isOutOfBounds,
  monthGrid,
  parseIsoDay,
  parseLocalDateTime,
  parseTypedDay,
  parseTypedTime,
  startOfWeek,
  today,
  type CalendarDay,
} from '@/lib/ui/calendar-date';

/**
 * The admin date pickers' arithmetic.
 *
 * Date-only fields name a wall-calendar day, so these never go through UTC.
 * The time-zone block below runs the same checks under zones far either side
 * of Greenwich, where a UTC round trip is exactly what shifts a day.
 */

const day = (iso: string): CalendarDay => parseIsoDay(iso)!;

describe('ISO day strings', () => {
  it('round-trips the native date input format', () => {
    expect(formatIsoDay(day('2026-03-01'))).toBe('2026-03-01');
    expect(formatIsoDay({ year: 2026, month: 0, day: 9 })).toBe('2026-01-09');
  });

  it('rejects impossible and malformed dates instead of rolling them over', () => {
    expect(parseIsoDay('2026-02-29')).toBeNull();
    expect(parseIsoDay('2026-02-30')).toBeNull();
    expect(parseIsoDay('2026-13-01')).toBeNull();
    expect(parseIsoDay('2026-1-1')).toBeNull();
    expect(parseIsoDay('')).toBeNull();
    expect(parseIsoDay(null)).toBeNull();
  });
});

describe('leap years', () => {
  it('follows the Gregorian rule', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(daysInMonth(2028, 1)).toBe(29);
    expect(daysInMonth(2027, 1)).toBe(28);
  });

  it('accepts 29 February only in a leap year', () => {
    expect(parseIsoDay('2028-02-29')).toEqual({ year: 2028, month: 1, day: 29 });
    expect(parseTypedDay('29/02/2028')).toEqual({ year: 2028, month: 1, day: 29 });
    expect(parseTypedDay('29/02/2027')).toBeNull();
  });
});

describe('month and year boundaries', () => {
  it('steps days across months and years', () => {
    expect(formatIsoDay(addDays(day('2026-01-31'), 1))).toBe('2026-02-01');
    expect(formatIsoDay(addDays(day('2026-12-31'), 1))).toBe('2027-01-01');
    expect(formatIsoDay(addDays(day('2026-03-01'), -1))).toBe('2026-02-28');
    expect(formatIsoDay(addDays(day('2028-03-01'), -1))).toBe('2028-02-29');
  });

  it('clamps the day when a month is shorter, rather than spilling into the next', () => {
    expect(formatIsoDay(addMonths(day('2026-01-31'), 1))).toBe('2026-02-28');
    expect(formatIsoDay(addMonths(day('2028-01-31'), 1))).toBe('2028-02-29');
    expect(formatIsoDay(addMonths(day('2026-03-31'), -1))).toBe('2026-02-28');
    expect(formatIsoDay(addMonths(day('2026-12-15'), 1))).toBe('2027-01-15');
    expect(formatIsoDay(addYears(day('2028-02-29'), 1))).toBe('2029-02-28');
  });

  it('draws a six-week, Monday-first grid with the neighbouring days', () => {
    const grid = monthGrid(2026, 1); // February 2026 starts on a Sunday
    expect(grid).toHaveLength(42);
    expect(formatIsoDay(grid[0]!)).toBe('2026-01-26');
    expect(grid[0]!.inMonth).toBe(false);
    expect(formatIsoDay(grid[6]!)).toBe('2026-02-01');
    expect(grid.filter((cell) => cell.inMonth)).toHaveLength(28);
  });

  it('finds the week a day sits in', () => {
    expect(formatIsoDay(startOfWeek(day('2026-10-07')))).toBe('2026-10-05');
    expect(formatIsoDay(endOfWeek(day('2026-10-07')))).toBe('2026-10-11');
    expect(formatLongDay(day('2026-10-07'))).toBe('Wednesday, 7 October 2026');
  });
});

describe('typed dates', () => {
  it('reads day-first numbers, ISO and month names', () => {
    expect(parseTypedDay('07/10/2026')).toEqual(day('2026-10-07'));
    expect(parseTypedDay('7-10-2026')).toEqual(day('2026-10-07'));
    expect(parseTypedDay('7.10.2026')).toEqual(day('2026-10-07'));
    expect(parseTypedDay('2026-10-07')).toEqual(day('2026-10-07'));
    expect(parseTypedDay('7 Oct 2026')).toEqual(day('2026-10-07'));
    expect(parseTypedDay('7 October 2026')).toEqual(day('2026-10-07'));
  });

  it('never reads a numeric date month-first', () => {
    // 3 April, not 4 March.
    expect(parseTypedDay('03/04/2026')).toEqual(day('2026-04-03'));
    expect(parseTypedDay('04/13/2026')).toBeNull();
  });

  it('rejects text that is not a date', () => {
    expect(parseTypedDay('soon')).toBeNull();
    expect(parseTypedDay('31/02/2026')).toBeNull();
    expect(parseTypedDay('7 Xyz 2026')).toBeNull();
  });

  it('shows dates in the same format it accepts', () => {
    expect(formatDisplayDay(day('2026-10-07'))).toBe('07/10/2026');
    expect(parseTypedDay(formatDisplayDay(day('2026-01-05')))).toEqual(day('2026-01-05'));
  });
});

describe('bounds and ranges', () => {
  it('honours min and max inclusively', () => {
    const bounds = { min: day('2026-10-01'), max: day('2026-10-31') };
    expect(isOutOfBounds(day('2026-10-01'), bounds)).toBe(false);
    expect(isOutOfBounds(day('2026-10-31'), bounds)).toBe(false);
    expect(isOutOfBounds(day('2026-09-30'), bounds)).toBe(true);
    expect(isOutOfBounds(day('2026-11-01'), bounds)).toBe(true);
  });

  it('treats a range as inclusive, in either order', () => {
    expect(inRange(day('2026-10-05'), day('2026-10-01'), day('2026-10-05'))).toBe(true);
    expect(inRange(day('2026-10-03'), day('2026-10-05'), day('2026-10-01'))).toBe(true);
    expect(inRange(day('2026-10-06'), day('2026-10-01'), day('2026-10-05'))).toBe(false);
    expect(inRange(day('2026-10-01'), day('2026-10-01'), null)).toBe(false);
  });
});

describe('date and time values', () => {
  it('keeps the datetime-local wall-clock string exactly', () => {
    const parsed = parseLocalDateTime('2026-10-07T09:05');
    expect(parsed).toEqual({ day: day('2026-10-07'), time: { hour: 9, minute: 5 } });
    expect(formatLocalDateTime(parsed!.day, parsed!.time)).toBe('2026-10-07T09:05');
    expect(parseLocalDateTime('2026-10-07T09:05:30')?.time).toEqual({ hour: 9, minute: 5 });
    expect(parseLocalDateTime('2026-10-07T24:00')).toBeNull();
    expect(parseLocalDateTime('2026-10-07')).toBeNull();
  });

  it('reads typed times in 24-hour form', () => {
    expect(parseTypedTime('09:30')).toEqual({ hour: 9, minute: 30 });
    expect(parseTypedTime('9:5')).toEqual({ hour: 9, minute: 5 });
    expect(parseTypedTime('0930')).toEqual({ hour: 9, minute: 30 });
    expect(parseTypedTime('930')).toEqual({ hour: 9, minute: 30 });
    expect(parseTypedTime('17')).toEqual({ hour: 17, minute: 0 });
    expect(parseTypedTime('25:00')).toBeNull();
    expect(parseTypedTime('noon')).toBeNull();
  });
});

describe('time zones', () => {
  const original = process.env.TZ;
  afterEach(() => {
    process.env.TZ = original;
  });

  // Far west, far east, and a zone whose DST change happens at midnight.
  for (const zone of [
    'America/Los_Angeles',
    'Pacific/Kiritimati',
    'America/Santiago',
    'Asia/Kolkata',
  ]) {
    it(`never shifts a day in ${zone}`, () => {
      process.env.TZ = zone;
      for (const iso of [
        '2026-01-01',
        '2026-03-01',
        '2026-04-05',
        '2026-09-06',
        '2026-12-31',
        '2028-02-29',
      ]) {
        expect(formatIsoDay(parseIsoDay(iso)!)).toBe(iso);
        expect(formatIsoDay(addDays(addDays(day(iso), 1), -1))).toBe(iso);
      }
      // Month boundaries across a midnight DST change still count every day once.
      const days = Array.from({ length: 40 }, (_, i) =>
        formatIsoDay(addDays(day('2026-03-20'), i)),
      );
      expect(new Set(days).size).toBe(40);
      expect(compareDays(day('2026-04-05'), day('2026-04-04'))).toBeGreaterThan(0);
    });
  }

  it("reads today from the local calendar, not UTC's", () => {
    process.env.TZ = 'Pacific/Kiritimati'; // UTC+14
    // 11:00 UTC on 7 October is already 01:00 on 8 October there.
    expect(today(new Date(Date.UTC(2026, 9, 7, 11, 0)))).toEqual(day('2026-10-08'));
    process.env.TZ = 'America/Los_Angeles';
    // 03:00 UTC on 8 October is still the evening of 7 October there.
    expect(today(new Date(Date.UTC(2026, 9, 8, 3, 0)))).toEqual(day('2026-10-07'));
  });
});
