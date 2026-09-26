/**
 * Time-zone arithmetic for schedules (M27.6.5, epic decision 24) on the platform `Intl` API only: the UI takes and
 * shows times in the viewer's zone, one-off actions travel as UTC instants, recurring ones carry an IANA zone id.
 */

/** The viewer's IANA time zone (`Europe/Berlin`); `UTC` when the platform can't tell. */
export function viewerZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = partsFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatters.set(zone, formatter);
  }
  return formatter;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(instantMs: number, zone: string): WallClock {
  const values: Record<string, number> = {};
  for (const part of partsFormatter(zone).formatToParts(new Date(instantMs))) {
    if (part.type !== 'literal') {
      values[part.type] = Number(part.value);
    }
  }
  return {
    year: values['year'],
    month: values['month'],
    day: values['day'],
    hour: values['hour'] === 24 ? 0 : values['hour'],
    minute: values['minute'],
    second: values['second'],
  };
}

/** How far `zone`'s wall clock is ahead of UTC at `instantMs`, in milliseconds (`+7_200_000` for CEST). */
export function zoneOffsetMs(zone: string, instantMs: number): number {
  const clock = wallClock(instantMs, zone);
  const asUtc = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * The UTC instant (ISO string) of a wall-clock time in `zone`. `date` is `YYYY-MM-DD`, `time` `HH:mm`. A time that
 * occurs twice (the hour repeated when clocks go back) resolves to the first occurrence; a time that doesn't exist
 * (skipped when clocks go forward) to the instant the same distance after the gap starts — the local time the clock
 * shows then is one hour later, the same rule `java.time` applies. `null` for malformed input.
 */
export function zonedToUtc(date: string, time: string, zone: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) {
    return null;
  }
  const naive = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  const check = new Date(naive);
  // Date.UTC rolls a 13th month or a 25th hour over instead of refusing it.
  if (
    Number.isNaN(naive) ||
    check.getUTCMonth() !== Number(d[2]) - 1 ||
    check.getUTCDate() !== Number(d[3]) ||
    check.getUTCHours() !== Number(t[1])
  ) {
    return null;
  }
  // The offsets just before and just after the wall time: equal except around a transition.
  const before = zoneOffsetMs(zone, naive - 12 * 3_600_000);
  const after = zoneOffsetMs(zone, naive + 12 * 3_600_000);
  const candidates = [naive - before, naive - after]
    .filter((instant) => naive - zoneOffsetMs(zone, instant) === instant)
    .sort((a, b) => a - b);
  // A gap: neither offset maps back to the wall time; the earlier offset gives the instant after the gap.
  const instant = candidates.length > 0 ? candidates[0] : naive - before;
  return new Date(instant).toISOString();
}

/** The wall-clock date (`YYYY-MM-DD`) and time (`HH:mm`) of an instant in `zone`. */
export function utcToZoned(iso: string, zone: string): { date: string; time: string } {
  const clock = wallClock(Date.parse(iso), zone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    date: `${clock.year}-${pad(clock.month)}-${pad(clock.day)}`,
    time: `${pad(clock.hour)}:${pad(clock.minute)}`,
  };
}

/** The zone's abbreviation at an instant: `CEST`, `EST`, or `GMT+2` where no abbreviation is known. */
export function zoneAbbreviation(zone: string, at: Date = new Date()): string {
  for (const locale of ['en-US', 'en-GB']) {
    try {
      const name = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' })
        .formatToParts(at)
        .find((part) => part.type === 'timeZoneName')?.value;
      if (name && !/^(GMT|UTC)[+-]/.test(name)) {
        return name;
      }
      if (name && locale === 'en-GB') {
        return name;
      }
    } catch {
      return '';
    }
  }
  return '';
}

/** "Europe/Berlin (CEST)" — how the schedule dialog labels a zone. */
export function zoneLabel(zone: string, at: Date = new Date()): string {
  const abbreviation = zoneAbbreviation(zone, at);
  return abbreviation && abbreviation !== zone ? `${zone} (${abbreviation})` : zone;
}

/** "Tue 29 Sep 2026, 09:00" in `zone` (default: the viewer's). Empty for a missing instant. */
export function formatInstant(iso: string | null | undefined, zone: string = viewerZone()): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

/**
 * An instant for a list: in the viewer's zone, plus the schedule's own zone when that differs
 * ("Tue 29 Sep 2026, 09:00 · 03:00 America/New_York").
 */
export function formatInstantWithZone(iso: string | null | undefined, scheduleZone: string | null | undefined): string {
  const local = formatInstant(iso);
  const viewer = viewerZone();
  if (!local || !scheduleZone || scheduleZone === viewer || zoneOffsetMs(scheduleZone, Date.parse(iso!)) === zoneOffsetMs(viewer, Date.parse(iso!))) {
    return local;
  }
  return `${local} · ${utcToZoned(iso!, scheduleZone).time} ${scheduleZone}`;
}

/** "3 min", "2 h 5 min", "1 d 4 h" — for "late by". Empty for nothing or less than a second. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || ms < 1000) {
    return '';
  }
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) {
    return `${Math.round(ms / 1000)} s`;
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
  }
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days} d` : `${days} d ${hours % 24} h`;
}
