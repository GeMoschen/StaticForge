import '@angular/compiler';
import { provideFavoritesStub } from '../../core/assets/testing/favorites.testing';
import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { TreeClipboardService } from '../../shared/services/tree-clipboard.service';
import { stubReleaseBar } from '../release/testing/release-bar.stub';
import { SfAssetUrlsComponent } from '../settings/asset-urls.component';
import { FolderDetailComponent } from './folder-detail.component';
import { FolderNodeComponent } from './folder-node.component';
import { PageNavNodeComponent } from './page-nav-node.component';
import { PageEditorSectionsService } from './page-editor-sections.service';
import { PageEditorStore } from './page-editor.store';
import { SectionPaletteService } from './section-palette.service';
import { restoreSection } from './section-undo.util';
import type { SectionInstance } from './types';

/** The undo of the destructive page-area operations (M35.13): folders, sections, paste. */

const FOLDER = { uuid: 'folder-a', uid: 'alpha', displayName: 'Alpha', path: '/a/', revision: 4 };
const HERO: SectionInstance = { instanceId: 'inst-1', templateRef: 'tpl-hero', content: { title: 'Welcome' } };

function apiStub(overrides: Record<string, unknown> = {}) {
  return {
    deleteFolder: vi.fn().mockReturnValue(of(undefined)),
    restoreFolder: vi.fn().mockReturnValue(of({})),
    renameFolder: vi.fn().mockReturnValue(of({ revision: 5 })),
    moveAsset: vi.fn().mockReturnValue(of({})),
    pageDetail: vi.fn().mockReturnValue(of({ uuid: 'page-1', revision: 12, bodies: { main: [HERO] }, template: {} })),
    templateDetail: vi.fn().mockReturnValue(of({ effectiveDefinition: { editors: [], bodies: [{ name: 'main' }] } })),
    deleteSection: vi.fn().mockReturnValue(of({ revision: 11 })),
    addSection: vi.fn().mockReturnValue(of({ revision: 13 })),
    ...overrides,
  };
}

const lastToast = (toasts: ToastService) => toasts.toasts().at(-1)!;

describe('folder detail panel', () => {
  beforeEach(() => {
    stubReleaseBar(FolderDetailComponent);
    TestBed.overrideComponent(FolderDetailComponent, {
      remove: { imports: [SfAssetUrlsComponent] },
      add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    });
  });

  async function open(api: ReturnType<typeof apiStub>, confirm = vi.fn().mockResolvedValue(true), counts = { pages: 1, folders: 1 }) {
    const view = await render(FolderDetailComponent, {
      componentInputs: { projectKey: 'proj', folder: FOLDER, pageCount: counts.pages, folderCount: counts.folders },
      providers: [provideFavoritesStub(), 
        { provide: ApiClient, useValue: api },
        { provide: ConfirmService, useValue: { confirm } },
      ],
    });
    return { view, confirm, toasts: view.fixture.debugElement.injector.get(ToastService) };
  }

  it('deletes after a danger confirmation naming the contents, and Undo restores the whole folder with one call', async () => {
    const api = apiStub();
    const { confirm, toasts } = await open(api);

    fireEvent.click(screen.getByRole('button', { name: 'Delete folder' }));

    await waitFor(() => expect(api.deleteFolder).toHaveBeenCalledWith('proj', 'folder-a', true));
    const options = confirm.mock.calls[0][0];
    expect(options.tone).toBe('danger');
    expect(options.irreversible).toBeUndefined();
    expect(options.typeToConfirm).toBeUndefined();
    expect(lastToast(toasts).message).toBe('Deleted “Alpha” and everything inside it.');

    lastToast(toasts).action!.run();
    await waitFor(() => expect(api.restoreFolder).toHaveBeenCalledWith('proj', 'folder-a'));
    expect(api.restoreFolder).toHaveBeenCalledTimes(1);
  });

  it('does not delete when the confirmation is declined', async () => {
    const api = apiStub();
    await open(api, vi.fn().mockResolvedValue(false));

    fireEvent.click(screen.getByRole('button', { name: 'Delete folder' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete folder' })).toBeTruthy());
    expect(api.deleteFolder).not.toHaveBeenCalled();
  });

  it('asks for the typed word when 25 or more items are inside', async () => {
    const api = apiStub();
    const { confirm } = await open(api, vi.fn().mockResolvedValue(false), { pages: 20, folders: 5 });

    fireEvent.click(screen.getByRole('button', { name: 'Delete folder' }));

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm.mock.calls[0][0].typeToConfirm).toBe('delete');
  });

  it('shows the error toast when the restore fails', async () => {
    const api = apiStub({ restoreFolder: vi.fn().mockReturnValue(throwError(() => new Error('409'))) });
    const { toasts } = await open(api);
    fireEvent.click(screen.getByRole('button', { name: 'Delete folder' }));
    await waitFor(() => expect(lastToast(toasts)?.action).toBeDefined());

    lastToast(toasts).action!.run();

    await waitFor(() => expect(lastToast(toasts).kind).toBe('error'));
    expect(lastToast(toasts).message).toMatch(/Could not undo/);
  });

  it('a rename offers Undo, which renames back with the revision the rename produced', async () => {
    const api = apiStub();
    const { toasts } = await open(api);

    fireEvent.click(screen.getByRole('button', { name: 'Rename folder' }));
    fireEvent.input(await screen.findByDisplayValue('Alpha'), { target: { value: 'Omega' } });
    const save = screen.getByRole('button', { name: 'Save' });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);

    await waitFor(() => expect(api.renameFolder).toHaveBeenCalledWith('proj', 'folder-a', { displayName: 'Omega' }, 4));
    expect(lastToast(toasts).message).toBe('Renamed “Alpha” to “Omega”.');

    lastToast(toasts).action!.run();
    await waitFor(() => expect(api.renameFolder).toHaveBeenLastCalledWith('proj', 'folder-a', { displayName: 'Alpha' }, 5));
  });
});

describe('folder node paste (cut)', () => {
  const TREE = [
    {
      uuid: 'root',
      path: '/',
      displayName: 'All Pages',
      protectedFolder: true,
      children: [
        { uuid: 'folder-a', path: '/a/', displayName: 'Alpha', children: [{ uuid: 'folder-sub', path: '/a/sub/', displayName: 'Sub' }] },
        { uuid: 'folder-b', path: '/b/', displayName: 'Beta', children: [] },
      ],
    },
  ];

  async function open(api: ReturnType<typeof apiStub>) {
    const view = await render(FolderNodeComponent, {
      componentInputs: { projectKey: 'proj', node: TREE[0].children[1] },
      providers: [provideFavoritesStub(), 
        { provide: ApiClient, useValue: api },
        { provide: ConfirmService, useValue: { confirm: vi.fn().mockResolvedValue(true) } },
        { provide: ProjectContextStore, useValue: { pageFolderTree: signal(TREE) } },
      ],
    });
    return { view, toasts: view.fixture.debugElement.injector.get(ToastService), clipboard: view.fixture.debugElement.injector.get(TreeClipboardService) };
  }

  it('moves a cut folder in and Undo moves it back into the folder that contained it', async () => {
    const api = apiStub();
    const { view, toasts, clipboard } = await open(api);
    clipboard.cut('FOLDER', 'folder-sub', 'Sub');

    (view.fixture.componentInstance as unknown as { paste(target: string): void }).paste('folder-b');

    await waitFor(() => expect(api.moveAsset).toHaveBeenCalledWith('proj', 'folder-sub', { folderUuid: 'folder-b' }));
    expect(lastToast(toasts).message).toBe('Moved “Sub” to Beta.');

    lastToast(toasts).action!.run();
    await waitFor(() => expect(api.moveAsset).toHaveBeenLastCalledWith('proj', 'folder-sub', { folderUuid: 'folder-a' }));
  });

  it('finds the folder of a cut page through the page itself', async () => {
    const api = apiStub({ pageDetail: vi.fn().mockReturnValue(of({ uuid: 'page-1', folderPath: '/' })) });
    const { view, toasts, clipboard } = await open(api);
    clipboard.cut('PAGE', 'page-1', 'Home');

    (view.fixture.componentInstance as unknown as { paste(target: string): void }).paste('folder-b');
    await waitFor(() => expect(toasts.toasts().length).toBeGreaterThan(0));

    lastToast(toasts).action!.run();
    // The page lived at the root: an empty body moves it back there.
    await waitFor(() => expect(api.moveAsset).toHaveBeenLastCalledWith('proj', 'page-1', {}));
  });

  it('deletes a folder from the tree after a confirmation, and Undo restores it', async () => {
    const api = apiStub();
    const { view, toasts } = await open(api);

    await (view.fixture.componentInstance as unknown as { deleteFolder(uuid: string): Promise<void> }).deleteFolder('folder-b');

    expect(api.deleteFolder).toHaveBeenCalledWith('proj', 'folder-b', true);
    lastToast(toasts).action!.run();
    await waitFor(() => expect(api.restoreFolder).toHaveBeenCalledWith('proj', 'folder-b'));
  });
});

describe('page sections', () => {
  it('restoreSection re-inserts the section identically at its index, with the page revision read now as etag', async () => {
    const api = apiStub();

    await new Promise<void>((done) =>
      restoreSection(api as never, 'proj', 'page-1', 'main', HERO, 2).subscribe({ complete: done }),
    );

    expect(api.addSection).toHaveBeenCalledWith(
      'proj',
      'page-1',
      'main',
      { templateUuid: 'tpl-hero', position: 2, instanceId: 'inst-1', content: { title: 'Welcome' } },
      12,
    );
  });

  async function openNode(api: ReturnType<typeof apiStub>, confirm = vi.fn().mockResolvedValue(true)) {
    const store = {
      pageMutated: signal(null),
      activePageUuid: signal(null),
      activeBodyName: signal(null),
      activeSectionInstanceId: signal(null),
      sectionTemplates: signal([{ uuid: 'tpl-hero', displayName: 'Hero' }]),
      notifyPageChanged: vi.fn(),
    };
    const view = await render(PageNavNodeComponent, {
      componentInputs: { projectKey: 'proj', summary: { uuid: 'page-1', uid: 'home', displayName: 'Home', revision: 9 } },
      providers: [provideFavoritesStub(), 
        { provide: ApiClient, useValue: api },
        { provide: ConfirmService, useValue: { confirm } },
        { provide: ProjectContextStore, useValue: store },
        provideRouter([]),
      ],
    });
    return { view, store, confirm, toasts: view.fixture.debugElement.injector.get(ToastService) };
  }

  it('deletes a section after a confirmation, and Undo puts it back at the same index', async () => {
    const api = apiStub();
    const { view, store, confirm, toasts } = await openNode(api);
    // Expand the node so the page (and its sections) is loaded.
    (view.fixture.componentInstance as unknown as { load(): void }).load();
    await waitFor(() => expect(api.pageDetail).toHaveBeenCalled());

    await (view.fixture.componentInstance as unknown as { deleteSection(body: string, s: SectionInstance): Promise<void> }).deleteSection('main', HERO);

    expect(confirm.mock.calls[0][0].tone).toBe('danger');
    expect(confirm.mock.calls[0][0].irreversible).toBeUndefined();
    expect(api.deleteSection).toHaveBeenCalledWith('proj', 'page-1', 'main', 'inst-1', 12);
    expect(lastToast(toasts).message).toBe('Deleted the section “Hero”.');

    lastToast(toasts).action!.run();
    await waitFor(() =>
      expect(api.addSection).toHaveBeenCalledWith(
        'proj',
        'page-1',
        'main',
        { templateUuid: 'tpl-hero', position: 0, instanceId: 'inst-1', content: { title: 'Welcome' } },
        12,
      ),
    );
    await waitFor(() => expect(store.notifyPageChanged).toHaveBeenCalledTimes(2));
  });

  it('shows the error toast when the section cannot be put back', async () => {
    const api = apiStub({ addSection: vi.fn().mockReturnValue(throwError(() => new Error('422'))) });
    const { view, toasts } = await openNode(api);
    (view.fixture.componentInstance as unknown as { load(): void }).load();
    await waitFor(() => expect(api.pageDetail).toHaveBeenCalled());
    await (view.fixture.componentInstance as unknown as { deleteSection(body: string, s: SectionInstance): Promise<void> }).deleteSection('main', HERO);

    lastToast(toasts).action!.run();

    await waitFor(() => expect(lastToast(toasts).kind).toBe('error'));
  });

  it('does not delete a section when the confirmation is declined', async () => {
    const api = apiStub();
    const { view } = await openNode(api, vi.fn().mockResolvedValue(false));

    await (view.fixture.componentInstance as unknown as { deleteSection(body: string, s: SectionInstance): Promise<void> }).deleteSection('main', HERO);

    expect(api.deleteSection).not.toHaveBeenCalled();
  });
});

describe('page editor sections: remove', () => {
  function setup(api: ReturnType<typeof apiStub>) {
    const editor = {
      readOnly: () => false,
      projectKey: () => 'proj',
      uuid: () => 'page-1',
      sectionsFor: () => [{ instanceId: 'inst-0', templateRef: 'tpl-hero', content: {} }, HERO],
      autosave: { revision: () => 6, flush: vi.fn().mockResolvedValue(true) },
      applyServerPage: vi.fn(),
    };
    const project = { sectionTemplates: signal([{ uuid: 'tpl-hero', displayName: 'Hero' }]), notifyPageChanged: vi.fn() };
    TestBed.configureTestingModule({
      providers: [provideFavoritesStub(), 
        PageEditorSectionsService,
        { provide: ApiClient, useValue: api },
        { provide: ProjectContextStore, useValue: project },
        { provide: PageEditorStore, useValue: editor },
        { provide: SectionPaletteService, useValue: {} },
      ],
    });
    return { editor, service: TestBed.inject(PageEditorSectionsService), toasts: TestBed.inject(ToastService) };
  }

  it('offers Undo, which puts the section back identically at its index and applies the restored page', async () => {
    const api = apiStub({ addSection: vi.fn().mockReturnValue(of({ revision: 14, uuid: 'page-1' })) });
    const { editor, service, toasts } = setup(api);

    service.remove('main', 'inst-1');

    expect(api.deleteSection).toHaveBeenCalledWith('proj', 'page-1', 'main', 'inst-1', 6);
    expect(lastToast(toasts).message).toBe('Removed the section “Hero”.');
    editor.applyServerPage.mockClear();

    lastToast(toasts).action!.run();

    await waitFor(() =>
      expect(api.addSection).toHaveBeenCalledWith(
        'proj',
        'page-1',
        'main',
        { templateUuid: 'tpl-hero', position: 1, instanceId: 'inst-1', content: { title: 'Welcome' } },
        12,
      ),
    );
    // Pending edits were written first, then the page re-read for its current revision.
    expect(editor.autosave.flush).toHaveBeenCalled();
    await waitFor(() => expect(editor.applyServerPage).toHaveBeenCalledWith({ revision: 14, uuid: 'page-1' }));
  });

  it('shows the error toast when the section cannot be put back', async () => {
    const api = apiStub({ addSection: vi.fn().mockReturnValue(throwError(() => new Error('422'))) });
    const { service, toasts } = setup(api);
    service.remove('main', 'inst-1');

    lastToast(toasts).action!.run();

    await waitFor(() => expect(lastToast(toasts).kind).toBe('error'));
  });
});
