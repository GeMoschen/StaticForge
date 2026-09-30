import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { describe, expect, it } from 'vitest';
import { revisionAssetCount, revisionSummaryAssets, revisionSummaryLabel } from './revision-summary.util';
import type { components } from '../core/api/generated/schema.d.ts';

type RevisionView = components['schemas']['RevisionView'];

const t = (key: string, params?: Record<string, unknown>) => TestBed.inject(TranslocoService).translate(key, params);

function rev(overrides: Partial<RevisionView>): RevisionView {
  return {
    revisionId: 1,
    projectId: 1,
    createdBy: 1,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('revision-summary.util', () => {
  it('counts a revision with no summary as touching exactly 1 asset', () => {
    const r = rev({ changeType: 'UPDATE', summary: undefined });
    expect(revisionSummaryAssets(r)).toEqual([]);
    expect(revisionAssetCount(r)).toBe(1);
    expect(revisionSummaryLabel(r, t)).toBe('UPDATE');
  });

  it('counts a revision with summary.assets.length === 1 as 1 and renders the plain label', () => {
    const r = rev({
      changeType: 'UPDATE',
      comment: undefined,
      summary: { assets: [{ uuid: 'a-1', type: 'PAGE', action: 'UPDATE' }] } as never,
    });
    expect(revisionAssetCount(r)).toBe(1);
    expect(revisionSummaryLabel(r, t)).toBe('UPDATE');
  });

  it('prefers comment over changeType for the base label when both are present', () => {
    const r = rev({
      changeType: 'UPDATE',
      comment: 'Fixed typo',
      summary: { assets: [{ uuid: 'a-1' }] } as never,
    });
    expect(revisionSummaryLabel(r, t)).toBe('Fixed typo');
  });

  it('appends an asset-count affordance for a revision touching 8 assets (project creation)', () => {
    const r = rev({
      changeType: 'CREATE',
      comment: undefined,
      summary: {
        assets: Array.from({ length: 8 }, (_, i) => ({ uuid: `asset-${i}`, action: 'CREATE' })),
      } as never,
    });
    expect(revisionAssetCount(r)).toBe(8);
    expect(revisionSummaryLabel(r, t)).toBe('CREATE · 8 assets');
  });
});
