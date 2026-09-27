import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { render, screen } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { RevisionsListComponent } from './revisions-list.component';
import { RevisionsService } from './revisions.service';
import type { components } from '../../core/api/generated/schema.d.ts';

type RevisionView = components['schemas']['RevisionView'];

function apiStub() {
  return {
    listMembers: vi.fn().mockReturnValue(of([])),
  };
}

function serviceStub(revisions: RevisionView[]) {
  return {
    revisions: signal(revisions),
    loading: signal(false),
    load: vi.fn(),
    setFilter: vi.fn(),
  };
}

const singleAssetRevision: RevisionView = {
  revisionId: 5,
  projectId: 1,
  createdBy: 1,
  createdAt: new Date().toISOString(),
  changeType: 'UPDATE',
  comment: undefined,
  summary: { assets: [{ uuid: 'a-1', type: 'PAGE', action: 'UPDATE' }] } as never,
};

const multiAssetRevision: RevisionView = {
  revisionId: 6,
  projectId: 1,
  createdBy: 1,
  createdAt: new Date().toISOString(),
  changeType: 'CREATE',
  comment: undefined,
  summary: {
    assets: Array.from({ length: 8 }, (_, i) => ({
      uuid: `asset-${i}`,
      type: 'FOLDER',
      action: 'CREATE',
    })),
  } as never,
};

describe('RevisionsListComponent', () => {
  it('shows the plain comment/changeType label for a revision touching exactly one asset', async () => {
    await render(RevisionsListComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: ApiClient, useValue: apiStub() },
        { provide: RevisionsService, useValue: serviceStub([singleAssetRevision]) },
        provideRouter([]),
      ],
    });

    expect(screen.queryByText(/assets/)).toBeNull();
  });

  it('appends an asset-count affordance for a revision touching more than one asset', async () => {
    await render(RevisionsListComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: ApiClient, useValue: apiStub() },
        { provide: RevisionsService, useValue: serviceStub([multiAssetRevision]) },
        provideRouter([]),
      ],
    });

    expect(screen.getByText(/8 assets/)).toBeTruthy();
  });

  it('marks a compacted revision with an icon and the compacted tooltip', async () => {
    const compacted: RevisionView = { ...singleAssetRevision, revisionId: 4, compacted: true };
    const exact: RevisionView = { ...multiAssetRevision, compacted: false };
    await render(RevisionsListComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: ApiClient, useValue: apiStub() },
        { provide: RevisionsService, useValue: serviceStub([exact, compacted]) },
        provideRouter([]),
      ],
    });

    const row = screen.getByRole('link', { name: 'Revision 4 — Exact changes compacted — end-of-day state kept' });
    const mark = screen.getByTestId('list-compacted');
    expect(row.contains(mark)).toBe(true);
    expect(mark.getAttribute('title')).toBe('Exact changes compacted — end-of-day state kept');
    expect(screen.getByRole('link', { name: 'Revision 6' }).querySelector('[data-testid="list-compacted"]')).toBeNull();
  });
});
