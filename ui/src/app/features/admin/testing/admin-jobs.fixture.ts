import type { components } from '../../../core/api/generated/schema.d.ts';

type S = components['schemas'];
type JsonNode = S['JsonNode'];

/** `JsonNode` members generate as `Record<string, never>`; the fixtures carry the JSON the API really sends. */
export function json(value: unknown): JsonNode {
  return value as JsonNode;
}

/** Spec fixtures in the shape of `GET /admin/jobs` (`AdminJobView`, M29.1.2). */
export const blobSweep: S['AdminJobView'] = {
  key: 'blob-sweep',
  name: 'Blob sweep',
  description: 'Removes stored bytes no version references any more.',
  enabled: true,
  cron: '30 3 * * *',
  zone: 'UTC',
  settings: json({ grace: 'PT24H', batchSize: 500, deleteOrphanBytes: true }),
  defaults: {
    enabled: true,
    cron: '30 3 * * *',
    zone: 'UTC',
    settings: json({ grace: 'PT24H', batchSize: 500, deleteOrphanBytes: true }),
  },
  nextRunAt: '2026-09-28T03:30:00Z',
  running: false,
  supportsDryRun: true,
  orphaned: false,
  version: 3,
  updatedAt: '2026-09-20T10:00:00Z',
  lastRun: {
    id: 40,
    outcome: 'SUCCEEDED',
    trigger: 'SCHEDULE',
    dryRun: false,
    startedAt: '2026-09-27T03:30:00Z',
    finishedAt: '2026-09-27T03:30:02Z',
    durationMs: 2150,
    itemsExamined: 1200,
    itemsAffected: 3,
    bytesFreed: 4_404_019,
    message: 'Examined 1200, affected 3, freed 4.2 MB.',
  },
};

export const runRecovery: S['AdminJobView'] = {
  key: 'generation-run-recovery',
  name: 'Interrupted-run recovery',
  description: 'Marks generation runs left QUEUED or RUNNING by a crash as failed.',
  enabled: true,
  cron: '*/5 * * * *',
  zone: 'UTC',
  settings: json({ staleAfter: 'PT5M' }),
  defaults: { enabled: true, cron: '*/5 * * * *', zone: 'UTC', settings: json({ staleAfter: 'PT5M' }) },
  nextRunAt: '2026-09-27T12:05:00Z',
  running: true,
  startedAt: '2026-09-27T12:00:00Z',
  currentRunId: 41,
  progress: 'Checking 2 runs',
  supportsDryRun: false,
  orphaned: false,
  version: 1,
  updatedAt: '2026-09-20T10:00:00Z',
};

export const orphanedJob: S['AdminJobView'] = {
  key: 'legacy-cleanup',
  enabled: false,
  cron: '0 1 * * *',
  zone: 'UTC',
  settings: json({}),
  running: false,
  supportsDryRun: false,
  orphaned: true,
  version: 7,
  updatedAt: '2026-01-01T00:00:00Z',
};

/** `POST /admin/jobs/{key}/run` → `202`: the run as it started. */
export function startedRun(dryRun: boolean): S['AdminJobRunView'] {
  return {
    id: 77,
    jobKey: 'blob-sweep',
    trigger: 'MANUAL',
    dryRun,
    startedAt: '2026-09-27T12:00:00Z',
    itemsExamined: 0,
    itemsAffected: 0,
    bytesFreed: 0,
    startedBy: { id: 1, username: 'root' },
    sample: json([]),
    sampleTotal: 0,
  };
}

/** `GET /admin/jobs/{key}/runs/{id}` once finished: the full report. */
export function finishedRun(dryRun: boolean): S['AdminJobRunView'] {
  return {
    ...startedRun(dryRun),
    finishedAt: '2026-09-27T12:00:03Z',
    durationMs: 3100,
    outcome: 'SUCCEEDED',
    itemsExamined: 1200,
    itemsAffected: 2,
    bytesFreed: 2048,
    message: 'Examined 1200, affected 2, freed 2.0 KB.',
    sample: json([
      { sha: 'ab12', size: 1024 },
      { sha: 'cd34', size: 1024 },
    ]),
    sampleTotal: 2,
    report: json({
      sample: [
        { sha: 'ab12', size: 1024 },
        { sha: 'cd34', size: 1024 },
      ],
      sampleTotal: 2,
      orphanObjects: 1,
    }),
  };
}
