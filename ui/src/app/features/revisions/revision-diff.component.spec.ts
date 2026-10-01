import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
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
    // A typed confirmation: the button stays disabled until ROLLBACK is typed.
    const rollBack = await screen.findByRole('button', { name: 'Roll back' });
    expect(rollBack).toBeDisabled();
    fireEvent.input(screen.getByRole('textbox', { name: 'Type ROLLBACK to confirm' }), {
      target: { value: 'ROLLBACK' },
    });
    await waitFor(() => expect(rollBack).toBeEnabled());
    fireEvent.click(rollBack);

    await waitFor(() => expect(api.restoreProject).toHaveBeenCalledWith('proj', { toRevision: 1 }));
  });

  describe('compacted revision', () => {
    const MESSAGE = 'Exact changes of this revision were compacted; the state at the end of the day is kept';

    /** `GET /revisions/{r}/diff` of a compacted revision (M29.4.3): one absorbed asset, one exact. */
    function compactedDiff(): RevisionDiff {
      return {
        projectId: 1,
        revisionId: 12,
        compacted: true,
        message: MESSAGE,
        assets: [
          { uuid: 'uuid-a', uid: 'home', type: 'PAGE', action: 'UPDATE', changes: [], compacted: true },
          {
            uuid: 'uuid-b',
            uid: 'about',
            type: 'PAGE',
            action: 'UPDATE',
            changes: [{ path: 'title', before: 'Old' as never, after: 'New' as never }],
            compacted: false,
          },
        ],
      };
    }

    it('shows the compacted message for the absorbed asset instead of an empty diff', async () => {
      const api = apiStub({ revisionDiff: vi.fn().mockReturnValue(of(compactedDiff())) });
      await render(RevisionDiffComponent, {
        componentInputs: { projectKey: 'proj', revisionId: '12' },
        providers: [{ provide: ApiClient, useValue: api }],
      });

      expect((await screen.findByTestId('diff-compacted')).textContent).toContain(MESSAGE);
      const perAsset = screen.getAllByTestId('asset-compacted');
      expect(perAsset).toHaveLength(1);
      const home = perAsset[0].closest('section') as HTMLElement;
      expect(home.textContent).toContain('home');
      expect(perAsset[0].textContent).toContain(MESSAGE);
      expect(home.querySelector('sf-visual-diff')).toBeNull();
      // The exact asset keeps its visual diff.
      const sections = Array.from(document.querySelectorAll('section.diff__asset'));
      const about = sections.find((section) => section.textContent?.includes('about')) as HTMLElement;
      expect(about.querySelector('sf-visual-diff')).not.toBeNull();
    });

    it('says in the roll-back confirmation that the end-of-day state will be restored', async () => {
      const api = apiStub({ revisionDiff: vi.fn().mockReturnValue(of(compactedDiff())) });
      await render(RevisionDiffComponent, {
        componentInputs: { projectKey: 'proj', revisionId: '12' },
        providers: [{ provide: ApiClient, useValue: api }],
      });

      fireEvent.click(await screen.findByRole('button', { name: 'Roll back project' }));

      const dialog = await screen.findByRole('dialog', { name: 'Roll back to revision 12' });
      expect(dialog.textContent).toContain('the state at the end of its day will be restored');
    });

    it('restoring a compacted asset asks first, saying the end-of-day state will be restored', async () => {
      const api = apiStub({
        revisionDiff: vi.fn().mockReturnValue(of(compactedDiff())),
        restoreAsset: vi.fn().mockReturnValue(of({ uuid: 'uuid-a', compacted: true })),
      });
      await render(RevisionDiffComponent, {
        componentInputs: { projectKey: 'proj', revisionId: '12' },
        providers: [{ provide: ApiClient, useValue: api }],
      });

      const [home] = await screen.findAllByRole('button', { name: 'Restore this asset' });
      fireEvent.click(home);

      const dialog = await screen.findByRole('dialog', { name: 'Restore home?' });
      expect(dialog.textContent).toContain('the state at the end of that day will be restored');
      expect(api.restoreAsset).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(api.restoreAsset).not.toHaveBeenCalled();

      fireEvent.click(home);
      fireEvent.click(await screen.findByRole('button', { name: 'Restore end-of-day state' }));
      expect(api.restoreAsset).toHaveBeenCalledWith('proj', 'uuid-a', { fromRevision: 12 });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('restoring an exact asset of a compacted revision stays one click', async () => {
      const api = apiStub({ revisionDiff: vi.fn().mockReturnValue(of(compactedDiff())) });
      await render(RevisionDiffComponent, {
        componentInputs: { projectKey: 'proj', revisionId: '12' },
        providers: [{ provide: ApiClient, useValue: api }],
      });

      const buttons = await screen.findAllByRole('button', { name: 'Restore this asset' });
      fireEvent.click(buttons[1]);

      expect(api.restoreAsset).toHaveBeenCalledWith('proj', 'uuid-b', { fromRevision: 12 });
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('an exact revision says nothing about compaction', async () => {
      const api = apiStub();
      await render(RevisionDiffComponent, {
        componentInputs: { projectKey: 'proj', revisionId: '1' },
        providers: [{ provide: ApiClient, useValue: api }],
      });

      fireEvent.click(await screen.findByRole('button', { name: 'Roll back project' }));

      const dialog = await screen.findByRole('dialog', { name: 'Roll back to revision 1' });
      expect(dialog.textContent).not.toContain('compacted');
      expect(screen.queryByTestId('diff-compacted')).toBeNull();
      expect(screen.queryByTestId('asset-compacted')).toBeNull();
    });
  });
});
