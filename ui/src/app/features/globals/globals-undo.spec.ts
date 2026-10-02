import '@angular/compiler';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { GlobalsComponent } from './globals.component';
import type { DeletedGlobalSet } from './global-set-detail.component';
import { GlobalsService } from './globals.service';

/** The undo of the Globals store's delete and drag-moves (M35.13). */

const FOLDERS = [
  {
    uuid: 'root',
    uid: 'globals_root',
    displayName: 'All Globals',
    path: '/globals_root/',
    protectedFolder: true,
    children: [
      { uuid: 'brand', uid: 'brand', displayName: 'Brand', path: '/globals_root/brand/', children: [] },
      { uuid: 'legal', uid: 'legal', displayName: 'Legal', path: '/globals_root/legal/', children: [] },
    ],
  },
];
const SETS = [
  { uuid: 'set-site', uid: 'site', displayName: 'Site', folderPath: '/globals_root/brand/', revision: 4 },
  { uuid: 'set-top', uid: 'top', displayName: 'Top', folderPath: '/globals_root/', revision: 2 },
];

function setup(api: Record<string, unknown> = {}) {
  const globals = {
    folders: vi.fn().mockReturnValue(of(FOLDERS)),
    list: vi.fn().mockReturnValue(of(SETS)),
    moveSet: vi.fn().mockReturnValue(of({})),
    moveFolder: vi.fn().mockReturnValue(of({})),
    renameFolder: vi.fn(),
  };
  const apiClient = {
    assetHistory: vi.fn().mockReturnValue(of([{ revision: 9, deleted: true }, { revision: 4, deleted: false }])),
    restoreAsset: vi.fn().mockReturnValue(of({})),
    renameAsset: vi.fn(),
    ...api,
  };
  return render(GlobalsComponent, {
    componentInputs: { projectKey: 'proj' },
    providers: [
      { provide: GlobalsService, useValue: globals },
      { provide: ApiClient, useValue: apiClient },
      { provide: ProjectContextStore, useValue: {} },
      { provide: TimeTravelStore, useValue: new TimeTravelStore() },
      provideProjectPermissions({ role: () => 'DEVELOPER', readOnly: () => false }),
    ],
  }).then((view) => ({ view, globals, apiClient, toasts: view.fixture.debugElement.injector.get(ToastService) }));
}

function drop(target: string, source: string): void {
  fireEvent.drop(screen.getByText(target).closest('[role="treeitem"]')!, {
    dataTransfer: { getData: () => source } as unknown as DataTransfer,
  });
}

describe('GlobalsComponent undo', () => {
  it('a set deleted in the detail panel offers Undo, which restores it from its last live revision and reloads', async () => {
    const { view, globals, apiClient, toasts } = await setup();
    await waitFor(() => expect(screen.getByText('Site')).toBeTruthy());
    const deleted: DeletedGlobalSet = { uuid: 'set-site', name: 'Site', online: false };

    (view.fixture.componentInstance as unknown as { onSetDeleted(d: DeletedGlobalSet): void }).onSetDeleted(deleted);
    expect(toasts.toasts().at(-1)?.message).toBe('Deleted “Site”.');
    const loads = globals.list.mock.calls.length;

    toasts.toasts().at(-1)!.action!.run();

    await waitFor(() => expect(apiClient.restoreAsset).toHaveBeenCalledWith('proj', 'set-site', { fromRevision: 4 }));
    await waitFor(() => expect(globals.list.mock.calls.length).toBeGreaterThan(loads));
  });

  it('mentions that a released set stays online until the deletion is released', async () => {
    const { view, toasts } = await setup();

    (view.fixture.componentInstance as unknown as { onSetDeleted(d: DeletedGlobalSet): void }).onSetDeleted({
      uuid: 'set-site',
      name: 'Site',
      online: true,
    });

    expect(toasts.toasts().at(-1)?.message).toBe('Deleted “Site”. It stays online until you release the deletion.');
  });

  it('shows the error toast when the restore fails', async () => {
    const { view, toasts } = await setup({ restoreAsset: vi.fn().mockReturnValue(throwError(() => new Error('409'))) });
    (view.fixture.componentInstance as unknown as { onSetDeleted(d: DeletedGlobalSet): void }).onSetDeleted({
      uuid: 'set-site',
      name: 'Site',
      online: false,
    });

    toasts.toasts().at(-1)!.action!.run();

    await waitFor(() => expect(toasts.toasts().at(-1)?.kind).toBe('error'));
    expect(toasts.toasts().at(-1)?.message).toMatch(/Could not undo/);
  });

  it('a set dragged onto a folder is moved back into its folder by Undo', async () => {
    const { globals, toasts } = await setup();
    await waitFor(() => expect(screen.getByText('Legal')).toBeTruthy());

    drop('Legal', 'set-site');
    await waitFor(() => expect(globals.moveSet).toHaveBeenCalledWith('proj', 'set-site', 'legal'));
    expect(toasts.toasts().at(-1)?.message).toBe('Moved “Site” to Legal.');

    toasts.toasts().at(-1)!.action!.run();
    await waitFor(() => expect(globals.moveSet).toHaveBeenLastCalledWith('proj', 'set-site', 'brand'));
  });

  it('a set that lived at the top is moved back to the root', async () => {
    const { globals, toasts } = await setup();
    await waitFor(() => expect(screen.getByText('Legal')).toBeTruthy());

    drop('Legal', 'set-top');
    await waitFor(() => expect(globals.moveSet).toHaveBeenCalledTimes(1));

    toasts.toasts().at(-1)!.action!.run();
    await waitFor(() => expect(globals.moveSet).toHaveBeenLastCalledWith('proj', 'set-top', undefined));
  });

  it('a folder move goes through the folder endpoint, back into its parent, and a failing undo shows the error toast', async () => {
    const { globals, toasts } = await setup();
    await waitFor(() => expect(screen.getByText('Legal')).toBeTruthy());

    drop('Legal', 'brand');
    await waitFor(() => expect(globals.moveFolder).toHaveBeenCalledWith('proj', 'brand', 'legal'));
    globals.moveFolder.mockReturnValue(throwError(() => new Error('422')));

    toasts.toasts().at(-1)!.action!.run();

    await waitFor(() => expect(globals.moveFolder).toHaveBeenCalledTimes(2));
    // The root folder stands for "no parent": the move back sends no folder.
    expect(globals.moveFolder).toHaveBeenLastCalledWith('proj', 'brand', undefined);
    await waitFor(() => expect(toasts.toasts().at(-1)?.kind).toBe('error'));
  });
});
