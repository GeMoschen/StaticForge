import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  clampDay,
  datePattern,
  formatDay,
  formatTime,
  monthWeeks,
  parseIsoDate,
  parseIsoTime,
  parseTypedDate,
  parseTypedTime,
  toIsoDate,
  toIsoTime,
  uses12HourClock,
  weekStartOf,
} from './date-time.util';

describe('date-time util', () => {
  it('reads and writes ISO dates and times, rejecting impossible ones', () => {
    expect(parseIsoDate('2026-02-28')).toEqual({ year: 2026, month: 2, day: 28 });
    expect(parseIsoDate('2026-02-29')).toBeNull();
    expect(parseIsoDate('2028-02-29')).not.toBeNull();
    expect(parseIsoDate('26-2-1')).toBeNull();
    expect(toIsoDate({ year: 2026, month: 3, day: 7 })).toBe('2026-03-07');
    expect(parseIsoTime('09:05')).toBe(545);
    expect(parseIsoTime('24:00')).toBeNull();
    expect(toIsoTime(545)).toBe('09:05');
  });

  it('adds days and months across boundaries, keeping the day of month where it exists', () => {
    expect(addDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({ year: 2027, month: 1, day: 1 });
    expect(addDays({ year: 2026, month: 3, day: 1 }, -1)).toEqual({ year: 2026, month: 2, day: 28 });
    expect(addMonths({ year: 2026, month: 1, day: 31 }, 1)).toEqual({ year: 2026, month: 2, day: 28 });
    expect(addMonths({ year: 2026, month: 1, day: 15 }, -1)).toEqual({ year: 2025, month: 12, day: 15 });
    expect(addMonths({ year: 2024, month: 2, day: 29 }, 12)).toEqual({ year: 2025, month: 2, day: 28 });
  });

  it('clamps a day into a range', () => {
    const min = { year: 2026, month: 1, day: 10 };
    const max = { year: 2026, month: 1, day: 20 };
    expect(clampDay({ year: 2026, month: 1, day: 5 }, min, max)).toEqual(min);
    expect(clampDay({ year: 2026, month: 1, day: 25 }, min, max)).toEqual(max);
    expect(clampDay({ year: 2026, month: 1, day: 15 }, null, null)).toEqual({ year: 2026, month: 1, day: 15 });
  });

  it('lays out a month in full weeks from the locale week start', () => {
    // October 2026 starts on a Thursday.
    const monday = monthWeeks(2026, 10, 1);
    expect(monday[0][0]).toEqual({ year: 2026, month: 9, day: 28 });
    expect(monday[0][3]).toEqual({ year: 2026, month: 10, day: 1 });
    expect(monday.at(-1)!.at(-1)).toEqual({ year: 2026, month: 11, day: 1 });
    expect(monday.every((week) => week.length === 7)).toBe(true);
    const sunday = monthWeeks(2026, 10, 0);
    expect(sunday[0][0]).toEqual({ year: 2026, month: 9, day: 27 });
  });

  it('knows where the week starts', () => {
    expect(weekStartOf('de')).toBe(1);
    expect(weekStartOf('en-GB')).toBe(1);
    expect(weekStartOf('en-US')).toBe(0);
  });

  it('writes and reads dates in the locale order', () => {
    const de = datePattern('de');
    const us = datePattern('en-US');
    const gb = datePattern('en-GB');
    expect(de).toMatchObject({ order: ['day', 'month', 'year'], separator: '.', example: '31.12.2026' });
    expect(us).toMatchObject({ order: ['month', 'day', 'year'], separator: '/', example: '12/31/2026' });
    expect(gb.order).toEqual(['day', 'month', 'year']);

    const day = { year: 2026, month: 3, day: 7 };
    expect(formatDay(day, de)).toBe('07.03.2026');
    expect(formatDay(day, us)).toBe('03/07/2026');
    expect(parseTypedDate('7.3.2026', de)).toEqual(day);
    expect(parseTypedDate('3/7/26', us)).toEqual(day);
    expect(parseTypedDate('07 03 2026', gb)).toEqual(day);
    expect(parseTypedDate('2026-03-07', us)).toEqual(day);
    expect(parseTypedDate('31.02.2026', de)).toBeNull();
    expect(parseTypedDate('7.3', de)).toBeNull();
    expect(parseTypedDate('soon', de)).toBeNull();
  });

  it('reads typed times in 24 h and 12 h forms', () => {
    expect(parseTypedTime('14:30')).toBe(870);
    expect(parseTypedTime('14.30')).toBe(870);
    expect(parseTypedTime('1430')).toBe(870);
    expect(parseTypedTime('9')).toBe(540);
    expect(parseTypedTime('2:30 pm')).toBe(870);
    expect(parseTypedTime('2pm')).toBe(840);
    expect(parseTypedTime('12am')).toBe(0);
    expect(parseTypedTime('12:15 PM')).toBe(735);
    expect(parseTypedTime('25:00')).toBeNull();
    expect(parseTypedTime('13pm')).toBeNull();
    expect(parseTypedTime('10:75')).toBeNull();
    expect(parseTypedTime('noon')).toBeNull();
  });

  it('writes times on the locale clock', () => {
    expect(uses12HourClock('en-US')).toBe(true);
    expect(uses12HourClock('de')).toBe(false);
    expect(formatTime(870, false)).toBe('14:30');
    expect(formatTime(870, true)).toBe('2:30 PM');
    expect(formatTime(5, true)).toBe('12:05 AM');
  });
});
