import { describe, expect, it } from 'vitest';
import { becauseOf, entryName, rebuiltView, viaGroups } from './run-rebuilt.util';
import {
  GenerationRunView,
  durationSeconds,
  findingTotals,
  formatBytes,
  formatDuration,
  isActiveRun,
  isPromotable,
  runModeOf,
  runStatusOf,
  runTriggerOf,
} from './runs.util';

const run = (over: Partial<GenerationRunView> = {}): GenerationRunView => ({ id: 1, status: 'SUCCESS', mode: 'FULL', ...over });

describe('run status helpers', () => {
  it('reads the server enums', () => {
    expect(runStatusOf(run({ status: 'RUNNING' }))).toBe('running');
    expect(runStatusOf(run({ status: 'PARTIAL' }))).toBe('partial');
    expect(runStatusOf(run({ status: 'SOMETHING_NEW' }))).toBe('failed');
    expect(runModeOf(run({ mode: 'INCREMENTAL' }))).toBe('incremental');
    expect(runModeOf(run({ mode: undefined }))).toBe('full');
    expect(runTriggerOf(run({ trigger: 'RELEASE' }))).toBe('release');
    expect(runTriggerOf(run({ trigger: undefined }))).toBe('manual');
    expect(runTriggerOf(run({ trigger: 'WEBHOOK' }))).toBe('manual');
  });

  it('knows which runs are active and which can be promoted', () => {
    expect(isActiveRun(run({ status: 'QUEUED' }))).toBe(true);
    expect(isActiveRun(run({ status: 'RUNNING' }))).toBe(true);
    expect(isActiveRun(run({ status: 'FAILED' }))).toBe(false);
    expect(isPromotable(run({ status: 'SUCCESS' }))).toBe(true);
    expect(isPromotable(run({ status: 'PARTIAL' }))).toBe(true);
    expect(isPromotable(run({ status: 'CANCELLED' }))).toBe(false);
  });

  it('measures the duration of a finished run only', () => {
    expect(durationSeconds(run({ startedAt: '2026-10-09T10:00:00Z', finishedAt: '2026-10-09T10:03:24Z' }))).toBe(204);
    expect(durationSeconds(run({ startedAt: '2026-10-09T10:00:00Z' }))).toBeNull();
    expect(formatDuration(204)).toBe('3 min 24 s');
    expect(formatDuration(41)).toBe('41 s');
  });

  it('has no findings for a run whose checks never ran', () => {
    expect(findingTotals(run())).toBeNull();
    expect(findingTotals(run({ findingCounts: { errors: 2 } }))).toEqual({ errors: 2, warnings: 0 });
  });

  it('formats sizes', () => {
    expect(formatBytes(812)).toBe('812 B');
    expect(formatBytes(4_404_019)).toBe('4.2 MB');
    expect(formatBytes(48 * 1024)).toBe('48 KB');
  });
});

describe('rebuilt tab helpers', () => {
  it('picks the view from the plan state', () => {
    const summary = { entryCount: 3, planAvailable: true };
    expect(rebuiltView(run({ planState: 'PENDING' }))).toBe('pending');
    expect(rebuiltView(run({ planState: 'NONE' }))).toBe('none');
    expect(rebuiltView(run({ planState: 'PRUNED', planSummary: summary }))).toBe('pruned');
    expect(rebuiltView(run({ planState: 'STORED', planSummary: summary }))).toBe('plan');
    expect(rebuiltView(run({ planState: 'STORED', planSummary: { entryCount: 0 } }))).toBe('nothing');
  });

  it('reads a run without a plan state from its summary', () => {
    expect(rebuiltView(run())).toBe('none');
    expect(rebuiltView(run({ planSummary: { entryCount: 2, planAvailable: false } }))).toBe('pruned');
    expect(rebuiltView(run({ planSummary: { entryCount: 2, planAvailable: true } }))).toBe('plan');
  });

  it('names the change a file was rebuilt because of', () => {
    expect(becauseOf({ rootKind: 'ASSET_CHANGED', rootAsset: { type: 'MEDIA', uid: 'hero' }, rootRevision: 1842 })).toBe('media:hero · r1842');
    expect(becauseOf({ rootKind: 'FULL_BUILD' })).toBe('');
  });

  it('names pages by display name and other assets by type and uid', () => {
    expect(entryName({ assetType: 'PAGE', uid: 'about', displayName: 'About us' })).toBe('About us');
    expect(entryName({ assetType: 'MEDIA', uid: 'hero' })).toBe('media:hero');
  });

  it('lists the via groups with their asset and count', () => {
    expect(viaGroups({ via: [{ assetType: 'SECTION_TEMPLATE', uid: 'teaser', count: 412, assetUuid: 'u1' }] })).toEqual([
      { key: 'u1|', asset: 'section_template:teaser', icon: 'code', count: 412 },
    ]);
  });
});
