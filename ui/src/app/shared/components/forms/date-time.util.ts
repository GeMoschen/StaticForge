/**
 * Dates and times for the date/time picker (M35.6). Values are the wire strings the API uses — `yyyy-MM-dd` and
 * `HH:mm` (local, no zone) — and everything here is pure, so the picker's parsing and calendar maths are tested apart
 * from the component.
 *
 * Typed dates follow the active locale's own order and separator (`31.12.2026` in de, `12/31/2026` in en-US,
 * `31/12/2026` in en-GB); ISO `2026-12-31` is always accepted too.
 */

/** A calendar day: `month` is 1–12. */
export interface Day {
  year: number;
  month: number;
  day: number;
}

export interface DatePattern {
  /** The order of the parts, e.g. `['day', 'month', 'year']`. */
  order: readonly ('day' | 'month' | 'year')[];
  separator: string;
  /** 31 December of the current pattern, written in it — a format hint for the user. */
  example: string;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIME = /^(\d{2}):(\d{2})$/;

// ── ISO strings ──────────────────────────────────────────────────────────────

export function parseIsoDate(value: string | null | undefined): Day | null {
  const match = value ? ISO_DATE.exec(value) : null;
  if (!match) {
    return null;
  }
  const day = { year: +match[1], month: +match[2], day: +match[3] };
  return isValidDay(day) ? day : null;
}

export function toIsoDate(day: Day): string {
  return `${pad(day.year, 4)}-${pad(day.month)}-${pad(day.day)}`;
}

/** Minutes since midnight of an `HH:mm` string, `null` when it isn't one. */
export function parseIsoTime(value: string | null | undefined): number | null {
  const match = value ? ISO_TIME.exec(value) : null;
  if (!match || +match[1] > 23 || +match[2] > 59) {
    return null;
  }
  return +match[1] * 60 + +match[2];
}

export function toIsoTime(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

// ── Calendar maths ───────────────────────────────────────────────────────────

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isValidDay({ year, month, day }: Day): boolean {
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function compareDays(a: Day, b: Day): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

export function sameDay(a: Day | null, b: Day | null): boolean {
  return !!a && !!b && compareDays(a, b) === 0;
}

export function addDays(day: Day, amount: number): Day {
  const date = new Date(Date.UTC(day.year, day.month - 1, day.day + amount));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** `amount` months later, keeping the day of month where it exists (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(day: Day, amount: number): Day {
  const index = day.year * 12 + (day.month - 1) + amount;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return { year, month, day: Math.min(day.day, daysInMonth(year, month)) };
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(day: Day): number {
  return new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
}

/** `day` limited to `[min, max]` (either may be null). */
export function clampDay(day: Day, min: Day | null, max: Day | null): Day {
  if (min && compareDays(day, min) < 0) {
    return min;
  }
  if (max && compareDays(day, max) > 0) {
    return max;
  }
  return day;
}

/** The weeks shown for a month: full weeks starting on `weekStart` (0 = Sunday), padded with the neighbour months. */
export function monthWeeks(year: number, month: number, weekStart: number): Day[][] {
  const first = { year, month, day: 1 };
  let cursor = addDays(first, -((weekday(first) - weekStart + 7) % 7));
  const weeks: Day[][] = [];
  do {
    const week: Day[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(cursor);
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  } while (cursor.month === month && cursor.year === year);
  return weeks;
}

/** The first day of the week in `locale` (0 = Sunday, 1 = Monday, …). */
export function weekStartOf(locale: string): number {
  try {
    const info = new Intl.Locale(locale) as Intl.Locale & {
      weekInfo?: { firstDay: number };
      getWeekInfo?: () => { firstDay: number };
    };
    const firstDay = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay;
    if (firstDay) {
      return firstDay % 7; // Intl uses 1 = Monday … 7 = Sunday
    }
  } catch {
    // fall through
  }
  // Engines without week info: Sunday in the regions that start the week on it (plain `en` counts as US), else
  // Monday (ISO 8601).
  const region = locale.split('-')[1]?.toUpperCase() ?? (locale.toLowerCase() === 'en' ? 'US' : null);
  return region && SUNDAY_REGIONS.has(region) ? 0 : 1;
}

const SUNDAY_REGIONS = new Set(['US', 'CA', 'JP', 'BR', 'MX', 'IL', 'KR', 'TW', 'PH', 'AU', 'IN']);

// ── Locale formats ───────────────────────────────────────────────────────────

export function datePattern(locale: string): DatePattern {
  const parts = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    new Date(Date.UTC(2026, 11, 31, 12)),
  );
  const order = parts
    .filter((part) => part.type === 'day' || part.type === 'month' || part.type === 'year')
    .map((part) => part.type as 'day' | 'month' | 'year');
  const separator = parts.find((part) => part.type === 'literal')?.value.trim() || '/';
  const example = order.map((part) => ({ day: '31', month: '12', year: '2026' })[part]).join(separator);
  return { order: order.length === 3 ? order : ['year', 'month', 'day'], separator, example };
}

/** `day` written in `pattern` (numeric, zero-padded). */
export function formatDay(day: Day, pattern: DatePattern): string {
  return pattern.order
    .map((part) => (part === 'year' ? pad(day.year, 4) : pad(part === 'month' ? day.month : day.day)))
    .join(pattern.separator);
}

/**
 * A typed date: ISO, or three numbers in the pattern's order separated by any of `. / - space`. A two-digit year means
 * 20xx. `null` when it isn't a real date.
 */
export function parseTypedDate(text: string, pattern: DatePattern): Day | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const iso = parseIsoDate(trimmed);
  if (iso) {
    return iso;
  }
  const numbers = trimmed.split(/[./\-\s]+/).filter(Boolean);
  if (numbers.length !== 3 || numbers.some((part) => !/^\d+$/.test(part))) {
    return null;
  }
  const values: Partial<Record<'day' | 'month' | 'year', number>> = {};
  pattern.order.forEach((part, index) => (values[part] = +numbers[index]));
  let year = values.year!;
  if (numbers[pattern.order.indexOf('year')].length <= 2) {
    year += 2000;
  }
  const day = { year, month: values.month!, day: values.day! };
  return isValidDay(day) ? day : null;
}

/** Whether `locale` writes times on a 12-hour clock. */
export function uses12HourClock(locale: string): boolean {
  const cycle = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle;
  return cycle === 'h11' || cycle === 'h12';
}

/** Minutes since midnight as shown to the user: `14:30` or `2:30 PM`. */
export function formatTime(minutes: number, twelveHour: boolean): string {
  const hours = Math.floor(minutes / 60);
  const mins = pad(minutes % 60);
  if (!twelveHour) {
    return `${pad(hours)}:${mins}`;
  }
  return `${hours % 12 || 12}:${mins} ${hours < 12 ? 'AM' : 'PM'}`;
}

/**
 * A typed time: `14:30`, `14.30`, `1430`, `9`, `9:05`, `2:30 pm`, `2pm`, `12am`. Minutes since midnight, or `null`.
 */
export function parseTypedTime(text: string): number | null {
  const match = /^(\d{1,2})(?:[:.h]?(\d{2}))?\s*([ap])?\.?\s*m?\.?$/i.exec(text.trim());
  if (!match) {
    return null;
  }
  let hours = +match[1];
  const minutes = match[2] ? +match[2] : 0;
  const meridiem = match[3]?.toLowerCase();
  if (minutes > 59) {
    return null;
  }
  if (meridiem) {
    if (hours < 1 || hours > 12) {
      return null;
    }
    hours = (hours % 12) + (meridiem === 'p' ? 12 : 0);
  } else if (hours > 23) {
    return null;
  }
  return hours * 60 + minutes;
}

/** Today in the browser's time zone. */
export function today(now: Date = new Date()): Day {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}
