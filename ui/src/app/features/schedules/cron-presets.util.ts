/**
 * The recurring-schedule presets of the schedule dialog (M27.6.5): each writes a 5-field cron expression
 * (`minute hour day-of-month month day-of-week`), which the server normalizes to its 6-field form by prepending the
 * seconds. Everything else is the "Advanced" cron text; next-run previews come from the server, so cron semantics
 * (DST, field counts) live in one place.
 */

export type CronPresetKind = 'hourly' | 'daily' | 'weekdays' | 'weekly';

export interface CronPreset {
  kind: CronPresetKind;
  /** `HH:mm`; for `hourly` only the minutes count. */
  time: string;
  /** Day of week for `weekly`: 0 = Sunday … 6 = Saturday. */
  weekday: number;
}

export const CRON_PRESET_OPTIONS: readonly { kind: CronPresetKind; label: string }[] = [
  { kind: 'hourly', label: 'Every hour' },
  { kind: 'daily', label: 'Every day' },
  { kind: 'weekdays', label: 'Every weekday (Mon–Fri)' },
  { kind: 'weekly', label: 'Every week' },
];

export const WEEKDAYS: readonly { value: number; label: string }[] = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
];

function timeParts(time: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  const hour = match ? Math.min(23, Number(match[1])) : 0;
  const minute = match ? Math.min(59, Number(match[2])) : 0;
  return { hour, minute };
}

/** The cron expression of a preset. */
export function presetCron(preset: CronPreset): string {
  const { hour, minute } = timeParts(preset.time);
  switch (preset.kind) {
    case 'hourly':
      return `${minute} * * * *`;
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekdays':
      return `${minute} ${hour} * * 1-5`;
    case 'weekly':
      return `${minute} ${hour} * * ${preset.weekday}`;
  }
}

const DAY_NAMES: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

/**
 * The preset a cron expression was made from — 5 fields, or the server's 6-field form with seconds `0` — or `null`
 * when it is anything else (then the dialog opens on "Advanced").
 */
export function parsePresetCron(cron: string | null | undefined): CronPreset | null {
  if (!cron) {
    return null;
  }
  let fields = cron.trim().split(/\s+/);
  if (fields.length === 6) {
    if (fields[0] !== '0') {
      return null;
    }
    fields = fields.slice(1);
  }
  if (fields.length !== 5 || fields[2] !== '*' || fields[3] !== '*') {
    return null;
  }
  const [minuteField, hourField, , , dayField] = fields;
  if (!/^\d{1,2}$/.test(minuteField) || Number(minuteField) > 59) {
    return null;
  }
  const minute = Number(minuteField);
  const pad = (value: number) => String(value).padStart(2, '0');
  if (hourField === '*' && dayField === '*') {
    return { kind: 'hourly', time: `00:${pad(minute)}`, weekday: 1 };
  }
  if (!/^\d{1,2}$/.test(hourField) || Number(hourField) > 23) {
    return null;
  }
  const time = `${pad(Number(hourField))}:${pad(minute)}`;
  if (dayField === '*' || dayField === '?') {
    return { kind: 'daily', time, weekday: 1 };
  }
  if (dayField === '1-5' || dayField.toUpperCase() === 'MON-FRI') {
    return { kind: 'weekdays', time, weekday: 1 };
  }
  const day = /^\d$/.test(dayField) ? Number(dayField) % 7 : DAY_NAMES[dayField.toUpperCase()];
  return day === undefined ? null : { kind: 'weekly', time, weekday: day };
}

/** "Every weekday at 09:00" — a preset in words, for the Schedules list. */
export function describeCron(cron: string | null | undefined): string {
  const preset = parsePresetCron(cron);
  if (!preset) {
    return cron ? `Cron ${cron}` : '';
  }
  const { minute } = timeParts(preset.time);
  switch (preset.kind) {
    case 'hourly':
      return `Every hour at :${String(minute).padStart(2, '0')}`;
    case 'daily':
      return `Every day at ${preset.time}`;
    case 'weekdays':
      return `Every weekday at ${preset.time}`;
    case 'weekly':
      return `Every ${WEEKDAYS.find((day) => day.value === preset.weekday)?.label ?? 'week'} at ${preset.time}`;
  }
}
