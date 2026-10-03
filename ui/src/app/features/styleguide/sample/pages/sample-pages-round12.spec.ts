import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from '../../../../core/ui/toast.service';
import { ContextMenuService } from '../../../../shared/services/context-menu.service';
import { SampleScreenComponent } from '../sample-screen.component';

async function setup(query: Record<string, string> = {}, tree = true) {
  const result = await render(SampleScreenComponent, {
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
    ],
  });
  if (tree) {
    await screen.findAllByRole('treeitem');
  }
  return result;
}

const bulk = () => screen.findByRole('group', { name: /bulk/i });

/** Pages sample, gate round 12: what M35.18 built beyond the signed-off sample. */
describe('pages sample: round 12 additions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete document.documentElement.dataset['theme'];
    delete document.documentElement.dataset['density'];
  });

  describe('folder table states', () => {
    it('shows a skeleton while the folder loads', async () => {
      await setup({ view: 'folder', fstate: 'loading' });
      await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).not.toBeNull());
      expect(screen.queryByRole('row', { name: /Spring harvest arrives/ })).toBeNull();
    });

    it('shows an error with Retry that brings the rows back', async () => {
      await setup({ view: 'folder', fstate: 'error' });
      expect(await screen.findByText('The contents of this folder could not be loaded.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
      expect(await screen.findByRole('row', { name: /Spring harvest arrives/ })).toBeInTheDocument();
    });

    it('explains an empty folder', async () => {
      await setup({ view: 'folder', fstate: 'empty' });
      expect(await screen.findByText('This folder is empty')).toBeInTheDocument();
      expect(screen.getByText(/Create a page or a folder here/)).toBeInTheDocument();
    });
  });

  describe('read-only (archived project, time travel)', () => {
    it('disables creating and releasing in the folder header and offers no bulk actions', async () => {
      await setup({ view: 'folder', access: 'archived' });
      expect(screen.getByRole('button', { name: 'New page' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'New folder' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Release folder…' })).toBeDisabled();
      fireEvent.click(screen.getAllByRole('checkbox', { name: /Spring harvest arrives/ })[0]);
      expect(screen.queryByRole('button', { name: 'Move' })).toBeNull();
    });

    it('says in the editor header why the page cannot be edited, instead of the save status', async () => {
      await setup({ view: 'editor', access: 'archived' });
      expect(screen.getByText('Archived project — read-only')).toBeInTheDocument();
      expect(screen.queryByText(/^Saved/)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
      expect(await screen.findByRole('menuitem', { name: 'Rename' })).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByRole('menuitem', { name: 'Delete…' })).toHaveAttribute('aria-disabled', 'true');
    });

    it('names the revision under time travel', async () => {
      await setup({ view: 'editor', travel: '88' });
      expect(await screen.findByText('Revision 88 — read-only')).toBeInTheDocument();
    });

    it('notes it in the Page settings drawer and blocks the rename', async () => {
      await setup({ view: 'editor', access: 'archived', psettings: 'page' });
      const drawer = await screen.findByRole('dialog', { name: 'Page settings' });
      expect(within(drawer).getByText(/This page is read-only/)).toBeInTheDocument();
      expect(within(drawer).getByRole('button', { name: 'Rename…' })).toBeDisabled();
    });
  });

  describe('moving pages and folders', () => {
    it('opens the Move dialog from the bulk bar: Move stays disabled until a folder is chosen, then Undo is offered', async () => {
      await setup({ view: 'folder' });
      const undo = vi.spyOn(TestBed.inject(ToastService), 'undo');
      fireEvent.click(within(await bulk()).getByRole('button', { name: 'Move' }));
      const dialog = await screen.findByRole('dialog', { name: 'Move 2 items to…' });
      const move = within(dialog).getByRole('button', { name: 'Move here' });
      expect(move).toHaveAttribute('aria-disabled', 'true');

      expect(await within(dialog).findByRole('treeitem', { name: /^Pages/ })).toBeInTheDocument();
      fireEvent.click(await within(dialog).findByRole('treeitem', { name: /^Shop/ }));
      await waitFor(() => expect(move).not.toHaveAttribute('aria-disabled'));
      fireEvent.click(move);

      await waitFor(() => expect(undo).toHaveBeenCalled());
      expect(undo.mock.lastCall![0]).toBe('Moved 2 items to “Shop”.');
      expect(screen.queryByRole('dialog', { name: /^Move/ })).toBeNull();
    });

    it('blocks a folder that is being moved and what lies inside it, and offers the root', async () => {
      await setup({ pdialog: 'folder-move', view: 'folder' });
      const dialog = await screen.findByRole('dialog', { name: 'Move “News” to…' });
      const news = await within(dialog).findByRole('treeitem', { name: /^News/ });
      expect(news).toHaveTextContent('Inside the folder being moved');
      expect(within(dialog).getByRole('treeitem', { name: /^Pages/ })).toBeInTheDocument();
      fireEvent.click(news);
      expect(within(dialog).getByRole('button', { name: 'Move here' })).toHaveAttribute('aria-disabled', 'true');
    });

    it('adds Move to…, New page here and Duplicate to the tree’s own menu', async () => {
      await setup({ view: 'folder' });
      const menu = () => TestBed.inject(ContextMenuService).state()?.items.map((item) => item.label);

      fireEvent.contextMenu(screen.getByRole('treeitem', { name: /^News/ }));
      await waitFor(() => expect(menu()).toBeDefined());
      expect(menu()).toEqual(expect.arrayContaining(['Cut', 'Copy', 'Move to…', 'New page here']));
      expect(menu()).not.toContain('Duplicate');
    });
  });

  describe('bulk actions in the folder table', () => {
    it('skips folders when pages and folders are duplicated, and says so with Undo', async () => {
      await setup({ view: 'folder' });
      const undo = vi.spyOn(TestBed.inject(ToastService), 'undo');
      const bar = await bulk();
      fireEvent.click(screen.getAllByRole('checkbox', { name: /Archive/ })[0]);
      fireEvent.click(within(bar).getByRole('button', { name: 'Duplicate' }));
      expect(undo).toHaveBeenCalledWith('2 copies created; folders are not duplicated.', expect.any(Function));
    });

    it('refuses to duplicate a selection of folders only', async () => {
      await setup({ view: 'folder' });
      const show = vi.spyOn(TestBed.inject(ToastService), 'show');
      await bulk();
      for (const name of [/Spring harvest arrives/, /Barista championship recap/]) {
        fireEvent.click(screen.getAllByRole('checkbox', { name })[0]);
      }
      fireEvent.click(screen.getAllByRole('checkbox', { name: /Archive/ })[0]);
      fireEvent.click(within(await bulk()).getByRole('button', { name: 'Duplicate' }));
      expect(show).toHaveBeenCalledWith('Folders cannot be duplicated — select pages.', 'info');
    });

    it('says nothing is waiting when everything selected is released', async () => {
      await setup({ view: 'folder' });
      const show = vi.spyOn(TestBed.inject(ToastService), 'show');
      await bulk();
      for (const name of [/Spring harvest arrives/, /Barista championship recap/]) {
        fireEvent.click(screen.getAllByRole('checkbox', { name })[0]);
      }
      fireEvent.click(screen.getAllByRole('checkbox', { name: /News overview/ })[0]);
      fireEvent.click(within(await bulk()).getByRole('button', { name: 'Release' }));
      expect(show).toHaveBeenCalledWith('Nothing here is waiting to be released.', 'info');
    });

    it('has no rename, move or delete in the root folder’s menu, but the News folder has them', async () => {
      await setup({});
      fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
      expect(await screen.findByRole('menuitem', { name: 'Folder settings…' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Copy link' })).toBeInTheDocument();
      for (const name of ['Rename', 'Move…', 'Delete…']) {
        expect(screen.queryByRole('menuitem', { name })).toBeNull();
      }
    });
  });

  describe('deleting the page', () => {
    it('says an online page stays online, and asks for the redirect target before it deletes', async () => {
      await setup({ view: 'editor', pdialog: 'delete' });
      const undo = vi.spyOn(TestBed.inject(ToastService), 'undo');
      const dialog = await screen.findByRole('dialog', { name: 'Delete “Spring harvest arrives”?' });
      expect(within(dialog).getByText(/It stays online until you release the deletion/)).toBeInTheDocument();
      const confirm = within(dialog).getByRole('button', { name: 'Delete' });
      expect(confirm).toBeEnabled();

      fireEvent.click(within(dialog).getByRole('checkbox', { name: /Redirect the old address/ }));
      expect(within(dialog).getByRole('button', { name: 'Delete' })).toHaveAttribute('aria-disabled', 'true');
      fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: '0' } });
      await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Delete' })).not.toHaveAttribute('aria-disabled'));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(undo).toHaveBeenCalled());
      expect(undo.mock.lastCall![0]).toContain('stays online until you release the deletion');
      expect(screen.queryByRole('dialog', { name: /^Delete/ })).toBeNull();
    });
  });

  describe('revision conflict drawer', () => {
    it('asks for a value per field, answers for all at once, and applies only when every field has one', async () => {
      await setup({ view: 'editor', conflict: 'fields' });
      const drawer = await screen.findByRole('dialog', { name: 'This page changed' });
      expect(within(drawer).getByText(/Jonas Weber saved a newer version 8 minutes ago \(revision 14\)/)).toBeInTheDocument();
      const apply = within(drawer).getByRole('button', { name: 'Apply changes' });
      expect(apply).toHaveAttribute('aria-disabled', 'true');

      fireEvent.click(within(drawer).getAllByRole('radio', { name: 'Keep mine' })[0]);
      expect(apply).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(within(drawer).getByRole('button', { name: 'Take all theirs' }));
      await waitFor(() => expect(apply).not.toHaveAttribute('aria-disabled'));
      expect(within(drawer).getAllByRole('radio', { name: 'Take theirs', checked: true })).toHaveLength(3);

      const show = vi.spyOn(TestBed.inject(ToastService), 'show');
      fireEvent.click(apply);
      expect(show).toHaveBeenCalledWith(expect.stringContaining('Applied your choices'), 'success');
      expect(screen.queryByRole('dialog', { name: 'This page changed' })).toBeNull();
    });

    it('offers only the two whole-page answers when the server named no values', async () => {
      await setup({ view: 'editor', conflict: 'whole' });
      const drawer = await screen.findByRole('dialog', { name: 'This page changed' });
      expect(within(drawer).queryByRole('radio')).toBeNull();
      expect(within(drawer).getByRole('list', { name: 'Fields that changed on the server' })).toBeInTheDocument();
      expect(within(drawer).getByRole('button', { name: 'Keep mine' })).toBeInTheDocument();
      expect(within(drawer).getByRole('button', { name: 'Take theirs' })).toBeInTheDocument();
    });
  });

  describe('editor header', () => {
    it('says how many fields the editing language has not translated', async () => {
      await setup({ view: 'editor' });
      expect(screen.getByText('English: 2 of 6 fields not translated')).toBeInTheDocument();
    });
  });

  describe('issues drawer status', () => {
    it('says when the draft was checked and which rules only a build checks', async () => {
      await setup({ view: 'editor', issues: '1' });
      const drawer = await screen.findByRole('dialog', { name: 'Issues' });
      expect(within(drawer).getByText('Checked at 12:04')).toBeInTheDocument();
      expect(within(drawer).getByText(/Not fully checked on a draft/)).toBeInTheDocument();
    });

    it('says the checks are unavailable, and checks again', async () => {
      await setup({ view: 'editor', issues: '1', istatus: 'unavailable' });
      const drawer = await screen.findByRole('dialog', { name: 'Issues' });
      expect(within(drawer).getByText(/Checks unavailable/)).toBeInTheDocument();
      expect(within(drawer).queryByRole('heading', { name: /Errors/ })).toBeNull();
      fireEvent.click(within(drawer).getByRole('button', { name: 'Check again' }));
      expect(await within(drawer).findByRole('heading', { name: /Errors/ })).toBeInTheDocument();
    });

    it('says the draft is being checked, and that the preview shows the published page', async () => {
      await setup({ view: 'editor', issues: '1', istatus: 'checking' });
      expect(await screen.findByText('Checking…')).toBeInTheDocument();
    });

    it('notes that the preview shows the published page', async () => {
      await setup({ view: 'editor', issues: '1', istatus: 'published' });
      expect(await screen.findByText(/The preview shows the published page/)).toBeInTheDocument();
    });
  });

  describe('folder settings', () => {
    it('lists the folder’s URLs (override in developer mode)', async () => {
      await setup({ view: 'folder', psettings: 'folder' });
      const drawer = await screen.findByRole('dialog', { name: 'Folder settings' });
      expect(within(drawer).getByRole('heading', { name: 'Addresses' })).toBeInTheDocument();
      expect(within(drawer).getByText('/en/news/')).toBeInTheDocument();
      expect(within(drawer).getAllByRole('button', { name: 'Override' }).length).toBeGreaterThan(0);
    });
  });

  describe('empty project', () => {
    it('offers Create a page to everyone when the project has page templates', async () => {
      await setup({ empty: '1', etemplates: '1', dev: '0' }, false);
      expect(await screen.findByText('No pages yet')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Create a page' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Go to Templates' })).toBeNull();
    });
  });
});
