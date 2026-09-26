import { describe, expect, it } from 'vitest';
import { describeCron, parsePresetCron, presetCron } from './cron-presets.util';
import { latenessFromIso, latenessToIso, scheduleRequest, type ScheduleForm } from './schedule.util';
import { formatDuration, utcToZoned, zoneOffsetMs, zonedToUtc } from './zoned-time.util';

const BERLIN = 'Europe/Berlin';

describe('zoned time', () => {
  it('sends a Berlin wall-clock time as the right UTC instant on both sides of the spring DST switch', () => {
    // 2026-03-29: clocks go from 02:00 CET to 03:00 CEST (01:00 UTC).
    expect(zonedToUtc('2026-03-29', '01:30', BERLIN)).toBe('2026-03-29T00:30:00.000Z');
    expect(zonedToUtc('2026-03-29', '03:30', BERLIN)).toBe('2026-03-29T01:30:00.000Z');
    // 02:30 doesn't exist that night: it runs at the next valid instant, 03:00 CEST — like a cron slot in the gap.
    expect(zonedToUtc('2026-03-29', '02:30', BERLIN)).toBe('2026-03-29T01:00:00.000Z');
  });

  it('takes the first occurrence of the repeated hour in autumn', () => {
    // 2026-10-25: clocks go from 03:00 CEST back to 02:00 CET (01:00 UTC); 02:30 happens twice.
    expect(zonedToUtc('2026-10-25', '02:30', BERLIN)).toBe('2026-10-25T00:30:00.000Z');
    expect(zonedToUtc('2026-10-25', '03:30', BERLIN)).toBe('2026-10-25T02:30:00.000Z');
    expect(zonedToUtc('2026-07-01', '09:00', BERLIN)).toBe('2026-07-01T07:00:00.000Z');
    expect(zonedToUtc('2026-01-15', '09:00', 'America/New_York')).toBe('2026-01-15T14:00:00.000Z');
  });

  it('reads an instant back as wall-clock date and time', () => {
    expect(utcToZoned('2026-10-25T00:30:00Z', BERLIN)).toEqual({ date: '2026-10-25', time: '02:30' });
    expect(utcToZoned('2026-10-25T01:30:00Z', BERLIN)).toEqual({ date: '2026-10-25', time: '02:30' });
    expect(utcToZoned('2026-12-31T23:30:00Z', BERLIN)).toEqual({ date: '2027-01-01', time: '00:30' });
    expect(zoneOffsetMs(BERLIN, Date.parse('2026-07-01T00:00:00Z'))).toBe(2 * 3_600_000);
  });

  it('rejects malformed input and formats durations', () => {
    expect(zonedToUtc('2026-13-01', '09:00', BERLIN)).toBeNull();
    expect(zonedToUtc('2026-02-30', '09:00', BERLIN)).toBeNull();
    expect(zonedToUtc('2026-02-01', '24:00', BERLIN)).toBeNull();
    expect(zonedToUtc('tomorrow', '09:00', BERLIN)).toBeNull();
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(90_000)).toBe('1 min');
    expect(formatDuration(3_720_000)).toBe('1 h 2 min');
    expect(formatDuration(26 * 3_600_000)).toBe('1 d 2 h');
  });
});

describe('cron presets', () => {
  it('writes the expected cron per preset', () => {
    expect(presetCron({ kind: 'hourly', time: '00:15', weekday: 1 })).toBe('15 * * * *');
    expect(presetCron({ kind: 'daily', time: '09:30', weekday: 1 })).toBe('30 9 * * *');
    expect(presetCron({ kind: 'weekdays', time: '07:00', weekday: 1 })).toBe('0 7 * * 1-5');
    expect(presetCron({ kind: 'weekly', time: '18:05', weekday: 0 })).toBe('5 18 * * 0');
  });

  it('recognizes a preset in the server’s 6-field form, and nothing else', () => {
    expect(parsePresetCron('0 30 9 * * *')).toEqual({ kind: 'daily', time: '09:30', weekday: 1 });
    expect(parsePresetCron('0 0 7 * * MON-FRI')).toEqual({ kind: 'weekdays', time: '07:00', weekday: 1 });
    expect(parsePresetCron('0 5 18 * * SUN')).toEqual({ kind: 'weekly', time: '18:05', weekday: 0 });
    expect(parsePresetCron('0 15 * * * *')?.kind).toBe('hourly');
    expect(parsePresetCron('0 */5 * * * *')).toBeNull();
    expect(parsePresetCron('30 0 9 * * *')).toBeNull();
    expect(describeCron('0 0 7 * * 1-5')).toBe('Every weekday at 07:00');
    expect(describeCron('*/5 * * * *')).toBe('Cron */5 * * * *');
  });
});

describe('schedule request', () => {
  const base: ScheduleForm = {
    type: 'RELEASE',
    date: '2026-10-25',
    time: '03:30',
    cron: '',
    zone: BERLIN,
    items: [{ assetUuid: 'page-1', locale: 'en' }],
    includeDependencies: [{ assetUuid: 'media-1', locale: 'en' }],
    pinPolicy: 'PINNED',
    thenGenerate: true,
    mode: 'FULL',
    targetId: 3,
    channels: [],
    missedPolicy: 'SKIP_IF_LATER_THAN',
    maxLatenessValue: 2,
    maxLatenessUnit: 'hours',
    comment: ' Autumn sale ',
  };

  it('builds a release with its instant, dependencies and then-generate', () => {
    expect(scheduleRequest(base)).toEqual({
      type: 'RELEASE',
      runAt: '2026-10-25T02:30:00.000Z',
      missedPolicy: 'SKIP_IF_LATER_THAN',
      maxLateness: 'PT2H',
      pinPolicy: 'PINNED',
      thenGenerate: { targetId: 3 },
      params: {
        items: [{ assetUuid: 'page-1', locale: 'en' }],
        includeDependencies: [{ assetUuid: 'media-1', locale: 'en' }],
        comment: 'Autumn sale',
      },
    });
  });

  it('builds a recurring generation with the cron and the creator’s zone, and keeps stored items on edit', () => {
    const recurring = scheduleRequest({ ...base, type: 'RECURRING_GENERATION', cron: '0 7 * * 1-5', missedPolicy: 'RUN_LATE', channels: ['html'] });
    expect(recurring).toEqual({
      type: 'RECURRING_GENERATION',
      cron: '0 7 * * 1-5',
      zoneId: BERLIN,
      missedPolicy: 'RUN_LATE',
      maxLateness: undefined,
      params: { mode: 'FULL', targetId: 3, channels: ['html'], comment: 'Autumn sale' },
    });
    expect(scheduleRequest(base, false).params).toBeUndefined();
  });

  it('round-trips the lateness limit', () => {
    expect(latenessToIso(15, 'minutes')).toBe('PT15M');
    expect(latenessFromIso('PT2H')).toEqual({ value: 2, unit: 'hours' });
    expect(latenessFromIso('PT1H30M')).toEqual({ value: 90, unit: 'minutes' });
  });
});
