import { describe, expect, it } from 'vitest';
import { auditActionLabel } from './admin-audit.util';
import {
  cronError,
  describeJobCron,
  durationText,
  isDuration,
  jobFormOf,
  jobInstant,
  jobUpdate,
  mapJobErrors,
  reportError,
  reportExtras,
  runDuration,
  sampleTable,
  scheduleText,
  settingError,
  settingFields,
  settingLabel,
  zoneOptions,
} from './admin-jobs.util';
import { blobSweep, finishedRun, json, orphanedJob } from './testing/admin-jobs.fixture';

describe('job schedule text', () => {
  it('describes the default schedules of the jobs and falls back to the raw cron', () => {
    expect(describeJobCron('*/5 * * * *')).toBe('Every 5 minutes');
    expect(describeJobCron('*/10 * * * *')).toBe('Every 10 minutes');
    expect(describeJobCron('* * * * *')).toBe('Every minute');
    expect(describeJobCron('10 3 * * *')).toBe('Every day at 03:10');
    expect(describeJobCron('15 * * * *')).toBe('Every hour at :15');
    expect(describeJobCron('0 */6 * * *')).toBe('Every 6 hours at :00');
    expect(describeJobCron('0 3 * * 0')).toBe('Every Sunday at 03:00');
    expect(describeJobCron('0 30 3 * * *')).toBe('Every day at 03:30');
    expect(describeJobCron('0 3 1 * *')).toBe('Cron 0 3 1 * *');
    expect(describeJobCron('')).toBe('');
  });

  it('always names the zone the cron is read in', () => {
    expect(scheduleText('30 3 * * *', 'UTC')).toBe('Every day at 03:30 (UTC)');
    expect(scheduleText('0 3 * * 0', 'Europe/Berlin')).toBe('Every Sunday at 03:00 (Europe/Berlin)');
  });

  it('labels times with the viewer zone and adds the job zone where its offset differs', () => {
    // UTC+14 is nobody's desk zone: it always differs from the viewer's.
    const far = jobInstant('2026-09-28T03:30:00Z', 'Pacific/Kiritimati');
    expect(far.viewer).toMatch(/2026, \d\d:\d\d \S+$/);
    expect(far.job).toBe('17:30 Pacific/Kiritimati');

    const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(jobInstant('2026-09-28T03:30:00Z', viewerZone).job).toBeNull();
    expect(jobInstant(undefined, 'UTC')).toEqual({ viewer: '', job: null });
  });

  it('formats run durations', () => {
    expect(runDuration(850)).toBe('850 ms');
    expect(runDuration(2150)).toBe('2 s');
    expect(runDuration(185_000)).toBe('3 min');
    expect(runDuration(undefined)).toBe('—');
  });

  it('offers UTC and the current zone explicitly among the zones', () => {
    const zones = zoneOptions('Mars/Olympus', undefined, 'UTC');
    expect(zones[0]).toBe('UTC');
    expect(zones).toContain('Mars/Olympus');
    expect(new Set(zones).size).toBe(zones.length);
  });
});

describe('job settings form', () => {
  it('types the fields from the JSON values and labels them', () => {
    expect(settingFields(blobSweep)).toEqual([
      { key: 'grace', label: 'Grace', kind: 'duration', defaultText: 'PT24H' },
      { key: 'batchSize', label: 'Batch size', kind: 'integer', defaultText: '500' },
      { key: 'deleteOrphanBytes', label: 'Delete orphan bytes', kind: 'boolean', defaultText: 'true' },
    ]);
    expect(settingFields(orphanedJob)).toEqual([]);
    expect(settingLabel('keep-per-project')).toBe('Keep per project');
  });

  it('accepts the duration forms the server accepts', () => {
    for (const ok of ['PT24H', 'PT5M', 'P365D', 'P1DT12H', 'PT0.5S', '30m', '365d', '24h']) {
      expect(isDuration(ok)).toBe(true);
    }
    for (const bad of ['P', 'PT', 'P1DT', '24', 'soon', 'P1Y', '']) {
      expect(isDuration(bad)).toBe(false);
    }
    expect(durationText('PT24H')).toBe('1 d');
    expect(durationText('90m')).toBe('1 h 30 min');
  });

  it('checks values on the client before the server does', () => {
    const [grace, batch, flag] = settingFields(blobSweep);
    expect(settingError(grace, 'tomorrow')).toBe('Enter a duration such as PT24H, PT30M or 30m.');
    expect(settingError(grace, ' PT48H ')).toBeNull();
    expect(settingError(batch, '12.5')).toBe('Enter a whole number.');
    expect(settingError(batch, '')).toBe('Required.');
    expect(settingError(flag, false)).toBeNull();
    expect(cronError('')).toBe('Enter a cron expression.');
    expect(cronError('30 3 * *')).toContain('5 fields');
    expect(cronError('0 30 3 * * *')).toBeNull();
  });

  it('sends only what changed, and nothing when the form equals the job', () => {
    const fields = settingFields(blobSweep);
    const form = jobFormOf(blobSweep, fields);
    expect(form).toEqual({
      enabled: true,
      cron: '30 3 * * *',
      zone: 'UTC',
      settings: { grace: 'PT24H', batchSize: '500', deleteOrphanBytes: true },
    });
    expect(jobUpdate(blobSweep, fields, form)).toBeNull();
    expect(jobUpdate(blobSweep, fields, { ...form, cron: ' 30  3 * * * ' })).toBeNull();
    expect(jobUpdate(blobSweep, fields, { ...form, settings: { ...form.settings, batchSize: '0500' } })).toBeNull();

    expect(
      jobUpdate(blobSweep, fields, {
        ...form,
        zone: 'Europe/Berlin',
        settings: { ...form.settings, batchSize: '1000', deleteOrphanBytes: false },
      }),
    ).toEqual({ zone: 'Europe/Berlin', settings: { batchSize: 1000, deleteOrphanBytes: false } });
  });

  it("sorts the server's messages to the fields they name", () => {
    const errors = mapJobErrors(
      [
        "Setting 'grace' must be at least PT1H.",
        "Invalid cron expression '61 3 * * *': Minute out of range",
        "Unknown time zone 'Mars/Olympus'.",
        "Unknown setting 'colour'.",
        'Settings must be a JSON object.',
      ],
      ['grace', 'batchSize'],
    );
    expect(errors.settings).toEqual({ grace: ["Setting 'grace' must be at least PT1H."] });
    expect(errors.cron).toEqual(["Invalid cron expression '61 3 * * *': Minute out of range"]);
    expect(errors.zone).toEqual(["Unknown time zone 'Mars/Olympus'."]);
    expect(errors.general).toEqual(["Unknown setting 'colour'.", 'Settings must be a JSON object.']);
  });
});

describe('job run report', () => {
  it('tabulates a sample of objects, of plain values, or of both', () => {
    expect(sampleTable(finishedRun(true).sample)).toEqual({
      columns: ['sha', 'size'],
      rows: [
        ['ab12', '1024'],
        ['cd34', '1024'],
      ],
    });
    expect(sampleTable(json(['builds/41', 'builds/42']))).toEqual({ columns: ['Item'], rows: [['builds/41'], ['builds/42']] });
    expect(sampleTable(json(['a', { id: 3 }]))).toEqual({ columns: ['Item', 'id'], rows: [['a', ''], ['', '3']] });
    expect(sampleTable(undefined)).toEqual({ columns: [], rows: [] });
  });

  it("keeps the job's own report keys apart from the runner's", () => {
    expect(reportExtras(finishedRun(false).report)).toEqual({ orphanObjects: 1 });
    expect(reportExtras(json({ sample: [], sampleTotal: 0 }))).toBeNull();
    expect(reportError(json({ error: 'Store unavailable' }))).toBe('Store unavailable');
    expect(reportError(undefined)).toBeNull();
  });
});

describe('audit labels (M29)', () => {
  it('names the job and compaction actions and leaves the others to their code', () => {
    expect(auditActionLabel('JOB_SETTINGS_SET')).toBe('Job schedule or settings changed');
    expect(auditActionLabel('JOB_RUN')).toBe('Job run started manually');
    expect(auditActionLabel('COMPACTION_POLICY_SET')).toBe('Revision compaction policy changed');
    expect(auditActionLabel('REVISIONS_COMPACTED')).toBe('Revisions compacted');
    expect(auditActionLabel('USER_CREATED')).toBeNull();
  });
});
