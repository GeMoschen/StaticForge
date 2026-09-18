import { fireEvent, render, screen } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { RevisionDiffComponent } from './revision-diff.component';
import type { components } from '../../core/api/generated/schema.d.ts';

type RevisionDiff = components['schemas']['RevisionDiff'];
type AssetDiff = components['schemas']['AssetDiff'];

/**
 * Mirrors a real post-M15.2.1 project-creation revision: the project itself plus its 7
 * bootstrap folders (hidden root, All Templates, Page Templates, Section Templates, All
 * Navigation, All Pages, All Media), all as CREATE entries with no field changes.
 */
function projectCreationDiff(): RevisionDiff {
  const names = [
    'project',
    'hidden-root',
    'all-templates',
    'page-templates',
    'section-templates',
    'all-navigation',
    'all-pages',
    'all-media',
  ];
  const assets: AssetDiff[] = names.map((uid, i) => ({
    uuid: `uuid-${i}`,
    uid,
    type: i === 0 ? 'PROJECT' : 'FOLDER',
    action: 'CREATE',
    changes: [],
  }));
  return { projectId: 1, revisionId: 1, assets };
}

function apiStub(overrides: Record<string, unknown> = {}) {
  return {
    revisionDiff: vi.fn().mockReturnValue(of(projectCreationDiff())),
    restoreAsset: vi.fn().mockReturnValue(of({})),
    restoreProject: vi.fn().mockReturnValue(of({})),
    assetVersion: vi.fn().mockReturnValue(of({ payload: {} })),
    templateDetail: vi.fn().mockReturnValue(of({ compiledDefinition: null })),
    ...overrides,
  };
}

describe('RevisionDiffComponent', () => {
  it('renders all 8 assets of a project-creation revision, each with a correctly-scoped restore action', async () => {
    const api = apiStub();
    await render(RevisionDiffComponent, {
      componentInputs: { projectKey: 'proj', revisionId: '1' },
      providers: [{ provide: ApiClient, useValue: api }],
    });

    expect(api.revisionDiff).toHaveBeenCalledWith('proj', 1);

    const restoreButtons = await screen.findAllByRole('button', { name: 'Restore this asset' });
    expect(restoreButtons).toHaveLength(8);

    restoreButtons[3].click();
    expect(api.restoreAsset).toHaveBeenCalledWith('proj', 'uuid-3', { fromRevision: 1 });

    restoreButtons[7].click();
    expect(api.restoreAsset).toHaveBeenCalledWith('proj', 'uuid-7', { fromRevision: 1 });
  });

  it('rolls back the whole project via restoreProject, regardless of how many assets the revision touched', async () => {
    const api = apiStub();
    await render(RevisionDiffComponent, {
      componentInputs: { projectKey: 'proj', revisionId: '1' },
      providers: [{ provide: ApiClient, useValue: api }],
    });

    (await screen.findByRole('button', { name: 'Roll back project' })).click();
    // `fireEvent` runs change detection after the event — the confirm button stays `[disabled]`
    // until the typed token has been re-read into the template.
    fireEvent.input(await screen.findByPlaceholderText('Type ROLLBACK to confirm'), {
      target: { value: 'ROLLBACK' },
    });

    (await screen.findByRole('button', { name: 'Roll back' })).click();

    expect(api.restoreProject).toHaveBeenCalledWith('proj', { toRevision: 1 });
  });
});
