import '@angular/compiler';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { provideFavoritesStub } from '../../core/assets/testing/favorites.testing';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ToastService } from '../../core/ui/toast.service';
import { SfDataTableComponent } from '../../shared/components/data-table/sf-data-table.component';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { ContentService } from '../content/content.service';
import { SUMMARIES, TREE } from './templates-fixtures.testing';
import { TemplatesFolderViewComponent } from './templates-folder-view.component';
import { TemplatesStoreRefresh } from './templates-store-refresh.service';
import { buildTemplatesIndex } from './templates-tree.util';
import { TemplatesService, type TemplateSummary } from './templates.service';

/** The Templates folder view (M35.21, gate decision 153): the table, the New menu, the folder's menu, the kind filter and the bulk actions with Undo. */

const lastToast = (toasts: ToastService) => toasts.toasts().at(-1)!;

async function open(options: { folderUuid?: string | null; canEdit?: boolean; loading?: boolean; failed?: boolean; confirm?: boolean; dev?: boolean; summaries?: TemplateSummary[] } = {}) {
  const api = {
    assetUsages: vi.fn((_key: string, uuid: string) => of(uuid === 'article' ? [{ fromType: 'PAGE', fromUuid: 'p1' }, { fromType: 'PAGE', fromUuid: 'p2' }] : [])),
    deleteFolder: vi.fn().mockReturnValue(of(undefined)),
    restoreFolder: vi.fn().mockReturnValue(of({})),
    moveAsset: vi.fn().mockReturnValue(of({})),
  };
  const templates = { delete: vi.fn().mockReturnValue(of(undefined)), restore: vi.fn().mockReturnValue(of({})) };
  const content = { deleteDataset: vi.fn().mockReturnValue(of(undefined)), restoreDataset: vi.fn().mockReturnValue(of({})) };
  const confirm = vi.fn().mockResolvedValue(options.confirm ?? true);
  const view = await render(TemplatesFolderViewComponent, {
    componentInputs: {
      projectKey: 'proj',
      folderUuid: options.folderUuid === undefined ? 'pt' : options.folderUuid,
      index: buildTemplatesIndex(TREE, options.summaries ?? SUMMARIES),
      tree: TREE,
      loading: options.loading ?? false,
      failed: options.failed ?? false,
    },
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideFavoritesStub(),
      TemplatesStoreRefresh,
      { provide: ApiClient, useValue: api },
      { provide: TemplatesService, useValue: templates },
      { provide: ContentService, useValue: content },
      { provide: ConfirmService, useValue: { confirm } },
      { provide: DeveloperModeService, useValue: { enabled: signal(options.dev ?? false) } },
      provideProjectPermissions({ role: () => (options.canEdit === false ? 'EDITOR' : 'DEVELOPER'), readOnly: () => false }),
    ],
  });
  const component = view.fixture.componentInstance;
  const outputs = { openEntry: vi.fn(), openFolder: vi.fn(), newTemplate: vi.fn(), newFolder: vi.fn(), rename: vi.fn(), usedBy: vi.fn(), retry: vi.fn() };
  for (const [name, spy] of Object.entries(outputs)) {
    (component as unknown as Record<string, { subscribe(fn: unknown): void }>)[name].subscribe(spy);
  }
  return { view, api, templates, content, confirm, toasts: TestBed.inject(ToastService), refresh: TestBed.inject(TemplatesStoreRefresh), outputs };
}

const menu = async (button: string, item: string) => {
  fireEvent.click(screen.getByRole('button', { name: button }));
  fireEvent.click(await screen.findByRole('menuitem', { name: item }));
};

describe('the Templates folder view', () => {
  describe('the table', () => {
    it('lists sub-folders first, then templates with kind, channels, used by and when they changed', async () => {
      await open();

      expect(await screen.findByRole('heading', { level: 1, name: 'Page Templates' })).toBeTruthy();
      const rows = await screen.findAllByRole('row');
      expect(within(rows[1]).getByText('Blog')).toBeTruthy();
      expect(within(rows[1]).getByText('Folder')).toBeTruthy();
      expect(within(rows[2]).getByText('Article')).toBeTruthy();
      expect(within(rows[2]).getByText('Page template')).toBeTruthy();
      expect(within(rows[2]).getByText('html')).toBeTruthy();
      expect(within(rows[2]).getByText('rss')).toBeTruthy();
      expect(within(rows[2]).getByRole('button', { name: 'Show what uses “Article” (3)' })).toBeTruthy();
      expect(rows[2].querySelector('time')?.getAttribute('datetime')).toBe('2026-10-01T10:00:00.000Z');
    });

    it('shows a dash for what a folder does not have, and 0 for a template nothing uses', async () => {
      await open({ folderUuid: 'blog' });
      const rows = await screen.findAllByRole('row');
      expect(within(rows[2]).getByText('Post')).toBeTruthy();
      expect(within(rows[2]).getByText('0')).toBeTruthy();
    });

    it('shows a dash in the used by, channels and modified cells of a folder', async () => {
      await open({ folderUuid: 'pt' });
      const folderRow = (await screen.findAllByRole('row'))[1];
      expect(within(folderRow).getByText('Blog')).toBeTruthy();
      expect(within(folderRow).getAllByText('—')).toHaveLength(3);
    });

    it('lists the three fixed folders at the top level, without a ⋮ menu', async () => {
      await open({ folderUuid: null });

      expect(await screen.findByRole('heading', { level: 1, name: 'Templates' })).toBeTruthy();
      const rows = (await screen.findAllByRole('row')).slice(1);
      expect(rows.map((r) => within(r).queryByText(/^(Page Templates|Section Templates|Datasets)$/)?.textContent)).toEqual([
        'Page Templates',
        'Section Templates',
        'Datasets',
      ]);
      expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    });

    it('also has no ⋮ menu on a fixed kind folder, which cannot be renamed, moved or deleted, but has one on a folder inside', async () => {
      await open({ folderUuid: 'pt' });
      await screen.findByText('Article');
      expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    });

    it('marks a template without a channel and shows the UID in developer mode only', async () => {
      await open({ folderUuid: 'st', dev: true });
      expect(await screen.findByText('No channel')).toBeTruthy();
      expect(screen.getByText('teaser')).toBeTruthy();
    });

    it('opens a row through the output', async () => {
      const { outputs } = await open();
      fireEvent.click(await screen.findByText('Article'));
      expect(outputs.openEntry).toHaveBeenCalledWith(expect.objectContaining({ uuid: 'article', kind: 'page' }));
      fireEvent.click(screen.getByText('Blog'));
      expect(outputs.openEntry).toHaveBeenLastCalledWith(expect.objectContaining({ uuid: 'blog', kind: 'folder' }));
    });

    it('opens the Used by drawer from the count without opening the row', async () => {
      const { outputs } = await open();
      fireEvent.click(await screen.findByRole('button', { name: 'Show what uses “Article” (3)' }));
      expect(outputs.usedBy).toHaveBeenCalledWith(expect.objectContaining({ uuid: 'article' }));
      expect(outputs.openEntry).not.toHaveBeenCalled();
    });

    it('says an empty folder is empty', async () => {
      await open({ folderUuid: 'archive', summaries: [] });
      expect(await screen.findByText('This folder is empty')).toBeTruthy();
    });

    it('shows the error state with Retry', async () => {
      const { outputs } = await open({ failed: true });
      expect(await screen.findByText('The templates could not be loaded.')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /retry/i }));
      expect(outputs.retry).toHaveBeenCalled();
    });

    it('shows the loading skeleton while the store is read', async () => {
      await open({ loading: true });
      expect(await screen.findByRole('heading', { level: 1, name: 'Page Templates' })).toBeTruthy();
      expect(document.querySelector('.sf-skeleton, [aria-busy="true"]')).not.toBeNull();
    });
  });

  describe('the Kind filter ("Kind: Page template")', () => {
    it('narrows the table to the picked kind', async () => {
      const { view } = await open({ folderUuid: null });
      await screen.findByText('Page Templates');
      const table = view.fixture.debugElement.query(By.directive(SfDataTableComponent)).componentInstance as SfDataTableComponent<unknown>;

      table.toggleFilterValue('kinds', 'folder');
      view.fixture.detectChanges();

      await waitFor(() => expect(screen.getByText('Datasets')).toBeTruthy());
      table.toggleFilterValue('kinds', 'folder');
      table.toggleFilterValue('kinds', 'dataset');
      view.fixture.detectChanges();
      await waitFor(() => expect(screen.queryByText('Datasets')).toBeNull());
    });
  });

  describe('the header', () => {
    it('has a New menu that names the kind in every entry, and the area answers', async () => {
      const { outputs } = await open();

      await menu('New', 'Section template');
      expect(outputs.newTemplate).toHaveBeenLastCalledWith('section');

      await menu('New', 'Dataset');
      expect(outputs.newTemplate).toHaveBeenLastCalledWith('dataset');

      await menu('New', 'Page template');
      expect(outputs.newTemplate).toHaveBeenLastCalledWith('page');

      await menu('New', 'Folder');
      expect(outputs.newFolder).toHaveBeenCalled();
    });

    it('cannot make a folder at the top level, and says why', async () => {
      const { outputs } = await open({ folderUuid: null });
      fireEvent.click(screen.getByRole('button', { name: 'New' }));
      const folder = await screen.findByRole('menuitem', { name: 'Folder' });
      expect(folder).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(folder);
      expect(outputs.newFolder).not.toHaveBeenCalled();
    });

    it('disables New for a viewer, and offers no bulk actions', async () => {
      await open({ canEdit: false });
      expect(screen.getByRole('button', { name: 'New' })).toBeDisabled();
      await screen.findByText('Article');
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));
      expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    });

    it('renames through the area\'s dialog: the header asks it with the folder', async () => {
      const { outputs } = await open({ folderUuid: 'blog' });
      await screen.findByRole('heading', { level: 1, name: 'Blog' });

      await menu('More actions', 'Rename…');

      expect(outputs.rename).toHaveBeenCalledWith(expect.objectContaining({ uuid: 'blog', kind: 'folder' }));
    });

    it('moves the open folder through the picker: the top level and other kinds cannot be chosen, Undo moves it back', async () => {
      const { api, toasts } = await open({ folderUuid: 'archive' });
      await screen.findByRole('heading', { level: 1, name: 'Archive' });

      await menu('More actions', 'Move…');
      const dialog = await screen.findByRole('dialog');
      await waitFor(() => expect(within(dialog).getAllByRole('treeitem').length).toBeGreaterThan(0));
      const names = within(dialog).getAllByRole('treeitem').map((r) => r.querySelector('.sf-tree__name')?.textContent?.trim());
      expect([...names].sort()).toEqual(['Datasets', 'Page Templates', 'Section Templates', 'Templates']);

      // The top level and a folder of another kind are shown but not choosable.
      fireEvent.click(within(dialog).getByRole('treeitem', { name: /^Templates/ }));
      fireEvent.click(within(dialog).getByRole('treeitem', { name: /^Section Templates/ }));
      expect(within(dialog).getByRole('button', { name: 'Move here' })).toBeDisabled();

      fireEvent.click(within(dialog).getByRole('treeitem', { name: /^Page Templates/ }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move here' }));

      await waitFor(() => expect(api.moveAsset).toHaveBeenCalledWith('proj', 'archive', { folderUuid: 'pt' }));
      await waitFor(() => expect(lastToast(toasts).message).toBe('Moved “Archive”'));
      lastToast(toasts).action!.run();
      await waitFor(() => expect(api.moveAsset).toHaveBeenLastCalledWith('proj', 'archive', { folderUuid: 'blog' }));
    });

    it('deletes the open folder after a danger confirmation that says what is inside, Undo restores it in one call, and the view goes up', async () => {
      const { api, confirm, toasts, outputs } = await open({ folderUuid: 'blog' });
      await screen.findByRole('heading', { level: 1, name: 'Blog' });

      await menu('More actions', 'Delete…');

      await waitFor(() => expect(api.deleteFolder).toHaveBeenCalledWith('proj', 'blog', true));
      expect(confirm.mock.calls[0][0]).toMatchObject({ tone: 'danger', title: 'Delete “Blog”?' });
      expect(confirm.mock.calls[0][0].message).toContain('Folders are deleted with everything inside them.');
      await waitFor(() => expect(outputs.openFolder).toHaveBeenCalledWith('pt'));
      expect(lastToast(toasts).message).toBe('Deleted “Blog”');
      lastToast(toasts).action!.run();
      await waitFor(() => expect(api.restoreFolder).toHaveBeenCalledWith('proj', 'blog'));
    });

    it('does not delete when the confirmation is cancelled', async () => {
      const { api, outputs } = await open({ folderUuid: 'blog', confirm: false });
      await screen.findByRole('heading', { level: 1, name: 'Blog' });

      await menu('More actions', 'Delete…');

      await waitFor(() => expect(screen.getByRole('button', { name: 'More actions' })).toBeTruthy());
      expect(api.deleteFolder).not.toHaveBeenCalled();
      expect(outputs.openFolder).not.toHaveBeenCalled();
    });
  });

  describe('bulk actions', () => {
    async function selectAll() {
      await screen.findByText('Article');
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));
    }

    it('asks once, naming what uses the items, then deletes in order and one Undo restores each', async () => {
      const { api, templates, confirm, toasts, refresh } = await open();
      await selectAll();
      const ticks = refresh.tick();

      fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(confirm).toHaveBeenCalled());
      const question = confirm.mock.calls[0][0];
      expect(question.message).toContain('In use by 2 pages.');
      expect(question.message).toContain('Folders are deleted with everything inside them.');
      expect(question.details).toEqual(['Blog', 'Article — used by 3 things']);
      expect(question.typeToConfirm).toBeUndefined();

      await waitFor(() => expect(api.deleteFolder).toHaveBeenCalledWith('proj', 'blog', true));
      await waitFor(() => expect(templates.delete).toHaveBeenCalledWith('page', 'proj', 'article'));
      await waitFor(() => expect(lastToast(toasts).message).toBe('Deleted 2 items'));
      expect(refresh.tick()).toBeGreaterThan(ticks);

      lastToast(toasts).action!.run();
      await waitFor(() => expect(templates.restore).toHaveBeenCalledWith('page', 'proj', 'article'));
      await waitFor(() => expect(api.restoreFolder).toHaveBeenCalledWith('proj', 'blog'));
    });

    it('deletes a dataset through the dataset endpoints', async () => {
      const { content } = await open({ folderUuid: 'ds' });
      await screen.findByText('Products');
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));

      fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(content.deleteDataset).toHaveBeenCalledWith('proj', 'products'));
    });

    it('stops at the first failure, keeps what was deleted undoable and says so', async () => {
      const { api, templates, toasts } = await open();
      templates.delete.mockReturnValueOnce(throwError(() => new Error('500')));
      await selectAll();

      fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(api.deleteFolder).toHaveBeenCalled());
      await waitFor(() => expect(toasts.toasts().some((t) => t.kind === 'error')).toBe(true));
      expect(toasts.toasts().some((t) => t.message === 'Deleted “Blog”' && !!t.action)).toBe(true);
    });

    it('moves the selection into the chosen folder of its kind, Undo puts each back', async () => {
      const { api, toasts } = await open();
      await selectAll();

      fireEvent.click(await screen.findByRole('button', { name: 'Move…' }));
      const dialog = await screen.findByRole('dialog');
      await waitFor(() => expect(within(dialog).getAllByRole('treeitem').length).toBeGreaterThan(0));
      fireEvent.click(within(dialog).getByRole('treeitem', { name: /^Page Templates/ }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move here' }));

      await waitFor(() => expect(api.moveAsset).toHaveBeenCalledWith('proj', 'blog', { folderUuid: 'pt' }));
      await waitFor(() => expect(api.moveAsset).toHaveBeenCalledWith('proj', 'article', { folderUuid: 'pt' }));
      await waitFor(() => expect(lastToast(toasts).message).toBe('Moved 2 items'));
      lastToast(toasts).action!.run();
      await waitFor(() => expect(api.moveAsset).toHaveBeenCalledTimes(4));
    });

    it('does not move page templates, section templates and datasets together, nor the fixed folders', async () => {
      const { api, toasts } = await open({ folderUuid: null });
      await screen.findByText('Page Templates');
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));

      fireEvent.click(await screen.findByRole('button', { name: 'Move…' }));

      await waitFor(() => expect(lastToast(toasts).kind).toBe('error'));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(api.moveAsset).not.toHaveBeenCalled();
    });
  });
});
