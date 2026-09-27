import { InjectionToken } from '@angular/core';
import type { components } from '../../core/api/generated/schema.d.ts';
import { describeCron } from '../schedules/cron-presets.util';
import {
  formatDuration,
  formatInstant,
  utcToZoned,
  viewerZone,
  zoneAbbreviation,
  zoneOffsetMs,
} from '../schedules/zoned-time.util';

export type AdminJobView = components['schemas']['AdminJobView'];
export type AdminJobRunView = components['schemas']['AdminJobRunView'];
export type JobRunSummary = components['schemas']['JobRunSummary'];
export type UpdateJobRequest = components['schemas']['UpdateJobRequest'];

/** How often the detail page polls a run it started (or found running) until it has finished. */
export const JOB_RUN_POLL_MS = new InjectionToken<number>('JOB_RUN_POLL_MS', { factory: () => 1000 });
/** How often the jobs list re-reads itself while any job is running. */
export const JOB_LIST_REFRESH_MS = new InjectionToken<number>('JOB_LIST_REFRESH_MS', { factory: () => 5000 });

type JsonObject = Record<string, unknown>;

/** A `JsonNode` member as a plain object; anything else (missing, an array, a scalar) as `{}`. */
export function jsonObject(node: unknown): JsonObject {
  return node !== null && typeof node === 'object' && !Array.isArray(node) ? (node as JsonObject) : {};
}

// ── Schedule and times ────────────────────────────────────────────────────────

/**
 * A job's cron in words: the shapes the default schedules use ("Every 5 minutes", "Every day at 03:30", "Every hour
 * at :15", "Every Sunday at 03:00"); anything else falls back to the raw expression. Next-run times come from the
 * server, so this is text only, not a second cron parser.
 */
export function describeJobCron(cron: string | null | undefined): string {
  if (!cron || cron.trim() === '') {
    return '';
  }
  let fields = cron.trim().split(/\s+/);
  if (fields.length === 6 && fields[0] === '0') {
    fields = fields.slice(1);
  }
  if (fields.length === 5) {
    const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
    const everyDay = dayOfMonth === '*' && month === '*' && (dayOfWeek === '*' || dayOfWeek === '?');
    const minuteStep = /^\*\/(\d+)$/.exec(minute);
    if (everyDay && hour === '*' && (minute === '*' || minuteStep)) {
      const step = minuteStep ? Number(minuteStep[1]) : 1;
      return step === 1 ? 'Every minute' : `Every ${step} minutes`;
    }
    const hourStep = /^\*\/(\d+)$/.exec(hour);
    if (everyDay && hourStep && /^\d{1,2}$/.test(minute) && Number(minute) <= 59) {
      const step = Number(hourStep[1]);
      const at = `:${minute.padStart(2, '0')}`;
      return step === 1 ? `Every hour at ${at}` : `Every ${step} hours at ${at}`;
    }
  }
  return describeCron(cron);
}

/** "Every day at 03:30 (UTC)": the schedule in words, always with the zone its cron is read in. */
export function scheduleText(cron: string | null | undefined, zone: string | null | undefined): string {
  const text = describeJobCron(cron);
  return text && zone ? `${text} (${zone})` : text;
}

/** "Tue 29 Sep 2026, 05:30 CEST": an instant in the viewer's zone, labelled with that zone. */
export function viewerTime(iso: string | null | undefined): string {
  const text = formatInstant(iso);
  if (!text) {
    return '';
  }
  const zone = viewerZone();
  return `${text} ${zoneAbbreviation(zone, new Date(iso!)) || zone}`;
}

/**
 * An instant for the jobs pages: in the viewer's zone (labelled), plus the wall-clock time in the job's own zone when
 * that zone has a different offset at that instant — the default job zone (UTC) and the viewer's usually differ, and a
 * silent mismatch would mislead.
 */
export function jobInstant(
  iso: string | null | undefined,
  jobZone: string | null | undefined,
): { viewer: string; job: string | null } {
  const viewer = viewerTime(iso);
  if (!viewer || !jobZone) {
    return { viewer, job: null };
  }
  const at = Date.parse(iso!);
  let sameOffset: boolean;
  try {
    sameOffset = zoneOffsetMs(jobZone, at) === zoneOffsetMs(viewerZone(), at);
  } catch {
    return { viewer, job: null };
  }
  return { viewer, job: sameOffset ? null : `${utcToZoned(iso!, jobZone).time} ${jobZone}` };
}

/** "850 ms", "12 s", "3 min" — how long a run took; "—" when unknown. */
export function runDuration(ms: number | null | undefined): string {
  if (ms == null || ms < 0) {
    return '—';
  }
  return ms < 1000 ? `${ms} ms` : formatDuration(ms);
}

/**
 * The zone select's options: UTC, the given zones (the job's, its default and the viewer's, so the current value is
 * always an explicit option) and every zone the platform knows.
 */
export function zoneOptions(...zones: (string | null | undefined)[]): string[] {
  let known: string[] = [];
  try {
    known = Intl.supportedValuesOf('timeZone');
  } catch {
    known = [];
  }
  return Array.from(new Set(['UTC', ...zones.filter((z): z is string => !!z), ...known]));
}

// ── Runs ──────────────────────────────────────────────────────────────────────

const OUTCOMES: Record<string, { label: string; chip: string }> = {
  SUCCEEDED: { label: 'Succeeded', chip: 'chip chip--ok' },
  PARTIAL: { label: 'Partial', chip: 'chip chip--warn' },
  FAILED: { label: 'Failed', chip: 'chip chip--danger' },
  SKIPPED: { label: 'Skipped', chip: 'chip' },
};

export function outcomeLabel(outcome: string | null | undefined): string {
  return outcome ? (OUTCOMES[outcome]?.label ?? outcome) : 'Running';
}

export function outcomeChipClass(outcome: string | null | undefined): string {
  return outcome ? (OUTCOMES[outcome]?.chip ?? 'chip') : 'chip chip--signal';
}

const TRIGGERS: Record<string, string> = { SCHEDULE: 'Scheduled', MANUAL: 'Manual', STARTUP: 'Startup' };

export function triggerLabel(trigger: string | null | undefined): string {
  return trigger ? (TRIGGERS[trigger] ?? trigger) : '—';
}

/** A run's report sample as a table: one "Item" column for plain values, one column per key for objects. */
export interface SampleTable {
  columns: string[];
  rows: string[][];
}

export function sampleTable(sample: unknown): SampleTable {
  const items = Array.isArray(sample) ? (sample as unknown[]) : [];
  const keys: string[] = [];
  let plain = false;
  for (const item of items) {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      for (const key of Object.keys(item)) {
        if (!keys.includes(key)) {
          keys.push(key);
        }
      }
    } else {
      plain = true;
    }
  }
  const columns = plain ? ['Item', ...keys] : keys;
  const cell = (value: unknown): string =>
    value === null || value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const rows = items.map((item) => {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const record = item as JsonObject;
      return [...(plain ? [''] : []), ...keys.map((key) => cell(record[key]))];
    }
    return [cell(item), ...keys.map(() => '')];
  });
  return { columns, rows };
}

/** The run's structured report without the runner's own keys (`sample`, `sampleTotal`, `error`); `null` when empty. */
export function reportExtras(report: unknown): JsonObject | null {
  const { sample: _sample, sampleTotal: _total, error: _error, ...rest } = jsonObject(report);
  return Object.keys(rest).length > 0 ? rest : null;
}

/** The error the runner recorded in the report of a failed run, if any. */
export function reportError(report: unknown): string | null {
  const error = jsonObject(report)['error'];
  if (error === null || error === undefined || error === '') {
    return null;
  }
  return typeof error === 'string' ? error : JSON.stringify(error);
}

// ── Settings form ─────────────────────────────────────────────────────────────

export type SettingKind = 'integer' | 'number' | 'duration' | 'boolean' | 'text';
export type SettingValue = string | boolean;

/** One job-specific setting, typed from its current (or default) JSON value. */
export interface SettingField {
  key: string;
  label: string;
  kind: SettingKind;
  /** The property default, as text, for the field's hint; `null` when the job declares none. */
  defaultText: string | null;
}

const ISO_DURATION = /^[-+]?P(?:[-+]?\d+D)?(?:T(?:[-+]?\d+H)?(?:[-+]?\d+M)?(?:[-+]?\d+(?:[.,]\d{1,9})?S)?)?$/i;
const SHORT_DURATION = /^\d+(ns|us|ms|s|m|h|d)$/i;

/** ISO-8601 (`PT24H`, `P365D`) or the short form of Spring properties (`30m`, `365d`), like the server accepts. */
export function isDuration(text: string): boolean {
  const value = text.trim();
  if (SHORT_DURATION.test(value)) {
    return true;
  }
  return ISO_DURATION.test(value) && !/^[-+]?PT?$/i.test(value) && !/T$/i.test(value);
}

const UNIT_MS: Record<string, number> = { ns: 1e-6, us: 1e-3, ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** A duration's length in milliseconds, or `null` when the text is not a duration. */
export function durationMs(text: string): number | null {
  const value = text.trim();
  if (!isDuration(value)) {
    return null;
  }
  const short = SHORT_DURATION.exec(value);
  if (short) {
    return Number.parseInt(value, 10) * UNIT_MS[short[1].toLowerCase()];
  }
  const match = /^([-+]?)P(?:([-+]?\d+)D)?(?:T(?:([-+]?\d+)H)?(?:([-+]?\d+)M)?(?:([-+]?\d+(?:[.,]\d+)?)S)?)?$/i.exec(value)!;
  const [, sign, d, h, m, s] = match;
  const total =
    Number(d ?? 0) * 86_400_000 +
    Number(h ?? 0) * 3_600_000 +
    Number(m ?? 0) * 60_000 +
    Number((s ?? '0').replace(',', '.')) * 1000;
  return sign === '-' ? -total : total;
}

/** "24 h" for `PT24H` — a duration setting in words, for the field hint. */
export function durationText(text: string): string {
  const ms = durationMs(text);
  return ms === null ? '' : ms === 0 ? '0' : ms > 0 ? runDuration(ms) : '';
}

/** `graceMinutes` / `keep-per-project` → "Grace minutes" / "Keep per project". */
export function settingLabel(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_.]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function kindOf(value: unknown): SettingKind {
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  if (typeof value === 'string' && isDuration(value)) {
    return 'duration';
  }
  return 'text';
}

/** The job's settings as form fields, in the order the server lists them (keys only in the defaults last). */
export function settingFields(job: AdminJobView | null | undefined): SettingField[] {
  const settings = jsonObject(job?.settings);
  const defaults = jsonObject(job?.defaults?.settings);
  const keys = Array.from(new Set([...Object.keys(settings), ...Object.keys(defaults)]));
  return keys.map((key) => {
    const value = key in settings ? settings[key] : defaults[key];
    const fallback = defaults[key];
    return {
      key,
      label: settingLabel(key),
      kind: kindOf(value),
      defaultText: fallback === undefined || fallback === null ? null : String(fallback),
    };
  });
}

function formValue(field: SettingField, raw: unknown): SettingValue {
  if (field.kind === 'boolean') {
    return raw === true;
  }
  return raw === undefined || raw === null ? '' : String(raw);
}

/** What the form edits. */
export interface JobForm {
  enabled: boolean;
  cron: string;
  zone: string;
  settings: Record<string, SettingValue>;
}

/** The form as the job stands on the server (explicit values; nothing waits for a change event to be set). */
export function jobFormOf(job: AdminJobView | null | undefined, fields: SettingField[]): JobForm {
  const settings = jsonObject(job?.settings);
  const defaults = jsonObject(job?.defaults?.settings);
  return {
    enabled: job?.enabled === true,
    cron: job?.cron ?? '',
    zone: job?.zone ?? '',
    settings: Object.fromEntries(
      fields.map((field) => [field.key, formValue(field, field.key in settings ? settings[field.key] : defaults[field.key])]),
    ),
  };
}

/** A setting's client-side problem (a quick hint; the server's validation is the authority), or `null`. */
export function settingError(field: SettingField, value: SettingValue | undefined): string | null {
  if (field.kind === 'boolean') {
    return null;
  }
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') {
    return 'Required.';
  }
  switch (field.kind) {
    case 'integer':
      return /^-?\d+$/.test(text) ? null : 'Enter a whole number.';
    case 'number':
      return Number.isFinite(Number(text)) ? null : 'Enter a number.';
    case 'duration':
      return isDuration(text) ? null : 'Enter a duration such as PT24H, PT30M or 30m.';
    default:
      return null;
  }
}

/** The cron field's client-side problem, or `null`. The server's validation is the authority. */
export function cronError(cron: string): string | null {
  const text = cron.trim();
  if (text === '') {
    return 'Enter a cron expression.';
  }
  const fields = text.split(/\s+/).length;
  return text.startsWith('@') || fields === 5 || fields === 6
    ? null
    : 'A cron expression has 5 fields: minute, hour, day of month, month, day of week.';
}

function settingJson(field: SettingField, value: SettingValue): unknown {
  switch (field.kind) {
    case 'boolean':
      return value === true;
    case 'integer':
    case 'number':
      return Number(String(value).trim());
    default:
      return String(value).trim();
  }
}

function sameSetting(field: SettingField, a: SettingValue | undefined, b: SettingValue | undefined): boolean {
  if (field.kind === 'boolean') {
    return a === b;
  }
  const left = String(a ?? '').trim();
  const right = String(b ?? '').trim();
  if (field.kind === 'integer' || field.kind === 'number') {
    return left === right || (left !== '' && right !== '' && Number(left) === Number(right));
  }
  return left === right;
}

/**
 * The `PATCH` body for what the form changed against the job, or `null` when nothing changed (Save stays disabled).
 * Only changed settings are sent: the server merges them into the stored ones.
 */
export function jobUpdate(job: AdminJobView | null | undefined, fields: SettingField[], form: JobForm): UpdateJobRequest | null {
  if (!job) {
    return null;
  }
  const base = jobFormOf(job, fields);
  const body: UpdateJobRequest = {};
  if (form.enabled !== base.enabled) {
    body.enabled = form.enabled;
  }
  const cron = form.cron.trim().replace(/\s+/g, ' ');
  if (cron !== base.cron.trim().replace(/\s+/g, ' ')) {
    body.cron = cron;
  }
  if (form.zone !== base.zone) {
    body.zone = form.zone;
  }
  const settings: JsonObject = {};
  for (const field of fields) {
    if (!sameSetting(field, form.settings[field.key], base.settings[field.key])) {
      settings[field.key] = settingJson(field, form.settings[field.key] ?? '');
    }
  }
  if (Object.keys(settings).length > 0) {
    body.settings = settings as UpdateJobRequest['settings'];
  }
  return Object.keys(body).length > 0 ? body : null;
}

/** The server's `422` messages, sorted to the fields they name; the rest is shown above the form. */
export interface JobFormErrors {
  cron: string[];
  zone: string[];
  settings: Record<string, string[]>;
  general: string[];
}

export const NO_JOB_ERRORS: JobFormErrors = { cron: [], zone: [], settings: {}, general: [] };

export function mapJobErrors(messages: string[], settingKeys: string[]): JobFormErrors {
  const out: JobFormErrors = { cron: [], zone: [], settings: {}, general: [] };
  for (const message of messages) {
    const named = /Setting '([^']+)'/.exec(message)?.[1];
    if (named !== undefined && settingKeys.includes(named)) {
      (out.settings[named] ??= []).push(message);
    } else if (/\bcron\b/i.test(message)) {
      out.cron.push(message);
    } else if (/time zone/i.test(message)) {
      out.zone.push(message);
    } else {
      out.general.push(message);
    }
  }
  return out;
}
