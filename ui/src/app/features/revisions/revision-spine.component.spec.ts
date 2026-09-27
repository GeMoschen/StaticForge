import { render, screen } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { RevisionSpineComponent } from './revision-spine.component';
import type { components } from '../../core/api/generated/schema.d.ts';

type RevisionView = components['schemas']['RevisionView'];

function apiStub() {
  return {
    listMembers: vi.fn().mockReturnValue(of([])),
  };
}

function storeStub() {
  return {
    refreshRevision: vi.fn(),
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

describe('RevisionSpineComponent', () => {
  it('shows the plain comment/changeType label for a revision touching exactly one asset', async () => {
    await render(RevisionSpineComponent, {
      componentInputs: { revisions: [singleAssetRevision], currentRevision: 5 },
      providers: [
        { provide: ApiClient, useValue: apiStub() },
        { provide: ProjectContextStore, useValue: storeStub() },
      ],
    });

    expect(screen.getByText(/Revision 5 · .* · UPDATE ·/)).toBeTruthy();
    expect(screen.queryByText(/assets/)).toBeNull();
  });

  it('appends an asset-count affordance for a revision touching more than one asset', async () => {
    await render(RevisionSpineComponent, {
      componentInputs: { revisions: [multiAssetRevision], currentRevision: 6 },
      providers: [
        { provide: ApiClient, useValue: apiStub() },
        { provide: ProjectContextStore, useValue: storeStub() },
      ],
    });

    expect(screen.getByText(/8 assets/)).toBeTruthy();
  });

  it('marks a compacted revision with an icon and the compacted tooltip, and leaves the others plain', async () => {
    // `GET /revisions` after compaction: revision 4's own changes were absorbed (RevisionView.compacted).
    const compacted: RevisionView = { ...singleAssetRevision, revisionId: 4, compacted: true };
    const exact: RevisionView = { ...singleAssetRevision, revisionId: 5, compacted: false };
    await render(RevisionSpineComponent, {
      componentInputs: { revisions: [compacted, exact], currentRevision: 5 },
      providers: [
        { provide: ApiClient, useValue: apiStub() },
        { provide: ProjectContextStore, useValue: storeStub() },
      ],
    });

    expect(screen.getAllByTestId('spine-compacted')).toHaveLength(1);
    const tick = screen.getByRole('button', { name: /Revision 4 ·/ });
    expect(tick.textContent).toContain('Exact changes compacted — end-of-day state kept');
    expect(tick.querySelector('[data-testid="spine-compacted"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: /Revision 5 ·/ }).textContent).not.toContain('compacted');
  });
});
