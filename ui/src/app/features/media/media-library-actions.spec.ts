import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { Subject, of } from 'rxjs';
import { type MockInstance, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { FavoritesService } from '../../core/assets/favorites.service';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { PreferencesService } from '../../core/preferences/preferences.service';
import type { FavoriteEntry } from '../../core/preferences/preferences.types';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ToastService } from '../../core/ui/toast.service';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { ContextMenuService } from '../../shared/services/context-menu.service';
import { MEDIA_DRAG_TYPE } from './library/media-mover';
import { MediaLibraryStore } from './library/media-library.store';
import { PRODUCTS as PRODUCTS_PATH, pageOf, productFiles, projectStub, summary } from './library/media-library.testing';
import { MediaDetailDrawerComponent } from './media-detail-drawer.component';
import { MediaLibraryComponent } from './media-library.component';

type MediaView = components['schemas']['MediaView'];
type MediaSummaryView = components['schemas']['MediaSummaryView'];

@Component({ selector: 'sf-media-detail-drawer', standalone: true, template: '<p data-testid="drawer">{{ media().displayName }}</p>' })
class DrawerStub {
  readonly projectKey = input.required<string>();
  readonly media = input.required<MediaView>();
  readonly tab = input<string | null>(null);
  readonly position = input<unknown>(null);
  readonly folderPath = input<string | null>(null);
  readonly mediaUids = input<readonly string[]>([]);
  readonly closed = output<void>();
  readonly updated = output<MediaView>();
  readonly deleted = output<string>();
  readonly discarded = output<string>();
  readonly tabChange = output<string>();
  readonly step = output<-1 | 1>();
  readonly fileAction = output<string>();
  confirmDiscard(): boolean {
    return true;
  }
}

interface SetupOptions {
  files?: MediaSummaryView[];
  inputs?: Record<string, unknown>;
  readOnly?: boolean;
  /** A viewer: sees and downloads, changes nothing. */
  viewer?: boolean;
  view?: 'grid' | 'list';
  favorites?: FavoriteEntry[];
}

/** The favorites of the open project as a signal, with the service's own toggle semantics. */
function favoritesStub(initial: FavoriteEntry[]) {
  const entries = signal<readonly FavoriteEntry[]>(initial);
  return {
    list: entries.asReadonly(),
    isFavorite: (uuid: string | null | undefined) => uuid != null && entries().some((entry) => entry.uuid === uuid),
    toggle: vi.fn((asset: { type: string; uuid: string; displayName: string; folderPath?: string }) => {
      const on = !entries().some((entry) => entry.uuid === asset.uuid);
      entries.update((list) =>
        on ? [...list, { kind: asset.type, uuid: asset.uuid, title: asset.displayName, folderPath: asset.folderPath }] : list.filter((entry) => entry.uuid !== asset.uuid),
      );
      return on;
    }),
    remove: vi.fn((uuid: string) => entries.update((list) => list.filter((entry) => entry.uuid !== uuid))),
  };
}

async function setup(options: SetupOptions = {}) {
  const files = options.files ?? [...productFiles(), summary('anna.jpg', '/media_root/team/'), summary('root-banner.jpg', '/media_root/')];
  const api = {
    listMedia: vi.fn((_key: string, opts: { folder?: string; page?: number; size?: number } = {}) => {
      const inFolder = opts.folder ? files.filter((f) => f.folderPath === opts.folder) : files;
      return of(pageOf(inFolder, 0, 200, inFolder.length));
    }),
    listAssets: vi.fn().mockReturnValue(of({ content: [] })),
    mediaThumbnailBlob: vi.fn().mockReturnValue(of(new Blob(['x'], { type: 'image/jpeg' }))),
    mediaText: vi.fn().mockReturnValue(of({ text: 'a {}', mimeType: 'text/css', revision: 3, utf8: true })),
    mediaBinaryBlob: vi.fn().mockReturnValue(of(new Blob(['file']))),
    downloadMediaZip: vi.fn().mockReturnValue(of(new Blob(['zip']))),
    deleteAsset: vi.fn().mockReturnValue(of(undefined)),
    restoreAsset: vi.fn().mockReturnValue(of({})),
    renameAsset: vi.fn().mockReturnValue(of({ revision: 9 })),
    moveAsset: vi.fn().mockReturnValue(of({})),
    deleteFolder: vi.fn().mockReturnValue(of(undefined)),
    restoreFolder: vi.fn().mockReturnValue(of({})),
    createFolder: vi.fn().mockReturnValue(of({ uuid: 'new-folder' })),
    renameFolder: vi.fn().mockReturnValue(of({ revision: 9 })),
    uploadMediaWithProgress: vi.fn(() => new Subject()),
  };
  const confirm = { confirm: vi.fn().mockResolvedValue(true) };
  const favorites = favoritesStub(options.favorites ?? []);
  let navigate!: MockInstance<Router['navigate']>;
  const view = await render(MediaLibraryComponent, {
    componentInputs: { projectKey: 'proj', ...options.inputs },
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ApiClient, useValue: api },
      { provide: ProjectContextStore, useValue: projectStub() },
      { provide: ConfirmService, useValue: confirm },
      { provide: FavoritesService, useValue: favorites },
      { provide: DeveloperModeService, useValue: { enabled: signal(false) } },
      { provide: EditingLocaleStore, useValue: { locale: signal(null) } },
      {
        provide: ProjectPermissionsStore,
        useFactory: () => {
          const access = inject(ProjectAccessStore);
          return { canEditContent: computed(() => !access.readOnly() && !options.viewer) };
        },
      },
    ],
    configureTestBed: (tb) => {
      tb.overrideComponent(MediaLibraryComponent, {
        remove: { imports: [MediaDetailDrawerComponent] },
        add: { imports: [DrawerStub] },
      });
      navigate = vi.spyOn(tb.inject(Router), 'navigate').mockResolvedValue(true);
      if (options.view) {
        tb.inject(PreferencesService).setMediaView(options.view);
      }
      if (options.readOnly) {
        tb.inject(ProjectAccessStore).enterProject('proj', true);
      }
    },
  });
  view.fixture.detectChanges();
  const route = async (inputs: Record<string, unknown>) => {
    for (const [name, value] of Object.entries(inputs)) {
      view.fixture.componentRef.setInput(name, value);
    }
    view.fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    view.fixture.detectChanges();
  };
  return { ...view, api, confirm, favorites, navigate, route, toasts: TestBed.inject(ToastService) };
}

const grid = () => screen.getByRole('grid', { name: /^Files in/ });
const cards = () => within(grid()).getAllByRole('gridcell');
const card = (name: string) => cards().find((c) => c.getAttribute('aria-label')?.startsWith(name + ','))!;
const lastQuery = (navigate: { mock: { lastCall?: unknown[] } }) =>
  (navigate.mock.lastCall?.[1] as { queryParams?: Record<string, unknown> } | undefined)?.queryParams;
/** The entries of the context menu that is open (the app frame renders it; the screen alone only holds its state). */
const contextMenuItems = () => TestBed.inject(ContextMenuService).state()?.items ?? [];
/** Opens a card's ⋮ menu (an `sf-menu`, which renders itself) and returns it. */
async function openCardMenu(name: string): Promise<HTMLElement> {
  fireEvent.click(within(card(name)).getByRole('button', { name: `Actions for ${name}` }));
  return screen.findByRole('menu');
}
/** Focuses a tree row the way a click would, without its selection and open side effects, and opens it with the arrow key. */
function expandFocused(row: HTMLElement): void {
  row.focus();
  fireEvent.focusIn(row);
  fireEvent.keyDown(row, { key: 'ArrowRight' });
}
/** A button's label without the icon's ligature text. */
const buttonName = (button: HTMLElement) =>
  (button.querySelector('.sf-button__label')?.textContent ?? button.textContent ?? '').trim();
const menuItemNames = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.querySelector('.sf-menu__label')?.textContent?.trim());

/** A drag transfer as far as the screen reads it. */
function transfer(data: Record<string, string> = {}) {
  const store = { ...data };
  return {
    get types() {
      return Object.keys(store);
    },
    effectAllowed: 'all',
    dropEffect: 'none',
    setData: vi.fn((type: string, value: string) => {
      store[type] = value;
    }),
    getData: (type: string) => store[type] ?? '',
  };
}

describe('the media library actions (phase B)', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  describe('the file menu on a card', () => {
    it('opens on a right click with Open, Rename, Move, Download, Copy link, the favorite entry and Delete after a separator', async () => {
      await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');

      fireEvent.contextMenu(card('brand.css'));

      expect(contextMenuItems().map((item) => item.label)).toEqual([
        'Open',
        'Rename…',
        'Move…',
        'Download',
        'Copy link',
        'Add “brand.css” to favorites',
        'Delete…',
      ]);
      expect(contextMenuItems().at(-1)).toMatchObject({ label: 'Delete…', danger: true, separatorBefore: true });
    });

    it('opens below the card on Shift+F10', async () => {
      await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');
      const target = card('brand.css');
      target.focus();

      fireEvent.keyDown(target, { key: 'F10', shiftKey: true });

      expect(TestBed.inject(ContextMenuService).state()?.anchor).toEqual({ kind: 'element', element: target });
    });

    it('has a ⋮ button per card, named after the file, with the same entries', async () => {
      await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');

      fireEvent.click(within(card('brand.css')).getByRole('button', { name: 'Actions for brand.css' }));

      const menu = await screen.findByRole('menu');
      expect(menuItemNames(menu)).toHaveLength(7);
    });

    it('acts on the whole selection when the file is part of a multi-file selection', async () => {
      const { api } = await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');
      fireEvent.click(within(card('brand.css')).getByRole('checkbox', { name: 'Select brand.css' }));
      fireEvent.click(within(card('logo.svg')).getByRole('checkbox', { name: 'Select logo.svg' }));

      const menu = await openCardMenu('brand.css');

      expect(menuItemNames(menu)).toEqual(['Move 2 files…', 'Download 2 files as ZIP', 'Delete 2 files…']);
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Download 2 files as ZIP' }));
      await waitFor(() => expect(api.downloadMediaZip).toHaveBeenCalledWith('proj', ['uuid-brand-css', 'uuid-logo-svg'], 'products'));
    });

    it('downloads one file as itself under its name', async () => {
      const { api } = await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');
      const menu = await openCardMenu('brand.css');

      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Download' }));

      await waitFor(() => expect(api.mediaBinaryBlob).toHaveBeenCalledWith('proj', 'uuid-brand-css'));
    });

    it('stars a file from the menu, says so, and offers to remove the star afterwards', async () => {
      const { favorites, toasts } = await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');
      const menu = await openCardMenu('brand.css');

      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Add “brand.css” to favorites' }));

      expect(favorites.toggle).toHaveBeenCalledWith(expect.objectContaining({ type: 'MEDIA', uuid: 'uuid-brand-css', displayName: 'brand.css' }));
      expect(toasts.toasts().at(-1)?.message).toBe('“brand.css” added to your favorites.');
      const again = await openCardMenu('brand.css');
      expect(within(again).getByRole('menuitem', { name: 'Remove “brand.css” from favorites' })).toBeInTheDocument();
    });

    it.each([
      ['a read-only project', { readOnly: true }],
      ['a viewer', { viewer: true }],
    ])('keeps only what reads for %s', async (_who, access) => {
      await setup({ inputs: { folder: 'products-uuid' }, ...access });
      await screen.findAllByRole('gridcell');

      const menu = await openCardMenu('brand.css');

      expect(menuItemNames(menu)).toEqual(['Open', 'Download', 'Copy link', 'Add “brand.css” to favorites']);
    });
  });

  describe('rename (F2)', () => {
    it('opens the rename dialog on F2, checks the name and renames with Undo', async () => {
      const { api, toasts } = await setup({
        inputs: { folder: 'products-uuid' },
        files: [...productFiles(), summary('theme.css', PRODUCTS_PATH)],
      });
      await screen.findAllByRole('gridcell');
      const target = card('brand.css');
      target.focus();

      fireEvent.keyDown(target, { key: 'F2' });

      const dialog = await screen.findByRole('dialog', { name: 'Rename “brand.css”' });
      const apply = within(dialog).getByRole('button', { name: 'Apply' });
      const field = within(dialog).getByRole('textbox', { name: /File name/ });
      expect(apply).toBeDisabled();
      fireEvent.input(field, { target: { value: 'theme.css' } });
      expect(await within(dialog).findByText(/already exists in Products/)).toBeInTheDocument();
      fireEvent.input(field, { target: { value: 'brand.png' } });
      expect(await within(dialog).findByText(/Keep the \.css extension/)).toBeInTheDocument();
      fireEvent.input(field, { target: { value: 'site.css' } });
      await waitFor(() => expect(apply).toBeEnabled());
      fireEvent.click(apply);

      await waitFor(() => expect(api.renameAsset).toHaveBeenCalledWith('proj', 'uuid-brand-css', { displayName: 'site.css' }, 3));
      await waitFor(() => expect(card('site.css')).toBeInTheDocument());
      expect(toasts.toasts().at(-1)?.message).toBe('Renamed “brand.css” to “site.css”.');
      expect(toasts.toasts().at(-1)?.action).toBeDefined();
    });
  });

  describe('move', () => {
    it('moves a file from its menu through the move dialog, with the current folder disabled', async () => {
      const { api, toasts } = await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');
      const menu = await openCardMenu('brand.css');
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Move…' }));

      const dialog = await screen.findByRole('dialog', { name: 'Move “brand.css”' });
      expect(await within(dialog).findByRole('treeitem', { name: /^Products/ })).toHaveTextContent('Current folder');
      const move = within(dialog).getByRole('button', { name: 'Move' });
      expect(move).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(await within(dialog).findByRole('treeitem', { name: /^Archive/ }));
      await waitFor(() => expect(move).not.toHaveAttribute('aria-disabled'));
      fireEvent.click(move);

      await waitFor(() => expect(api.moveAsset).toHaveBeenCalledWith('proj', 'uuid-brand-css', { folderUuid: 'archive-uuid' }));
      await waitFor(() => expect(toasts.toasts().at(-1)?.message).toBe('Moved “brand.css” to Archive.'));
      expect(toasts.toasts().at(-1)?.action).toBeDefined();
    });

    it('moves the selection from the bulk bar', async () => {
      const { api, toasts } = await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');
      fireEvent.click(within(card('brand.css')).getByRole('checkbox', { name: 'Select brand.css' }));
      fireEvent.click(within(card('logo.svg')).getByRole('checkbox', { name: 'Select logo.svg' }));
      const bar = await screen.findByRole('group', { name: 'Bulk actions' });

      fireEvent.click(within(bar).getByRole('button', { name: 'Move' }));

      const dialog = await screen.findByRole('dialog', { name: 'Move 2 files' });
      fireEvent.click(await within(dialog).findByRole('treeitem', { name: /^All media/ }));
      const move = within(dialog).getByRole('button', { name: 'Move' });
      await waitFor(() => expect(move).not.toHaveAttribute('aria-disabled'));
      fireEvent.click(move);

      await waitFor(() => expect(api.moveAsset).toHaveBeenCalledTimes(2));
      expect(api.moveAsset).toHaveBeenCalledWith('proj', 'uuid-brand-css', {});
      await waitFor(() => expect(toasts.toasts().at(-1)?.message).toBe('Moved 2 files to All media.'));
    });
  });

  describe('the bulk bar', () => {
    it('offers Move, Download, Delete and Clear selection', async () => {
      await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');
      fireEvent.click(within(card('brand.css')).getByRole('checkbox', { name: 'Select brand.css' }));

      const bar = await screen.findByRole('group', { name: 'Bulk actions' });

      expect(within(bar).getAllByRole('button').map(buttonName)).toEqual(['Move', 'Download', 'Delete', 'Clear selection']);
    });

    it('downloads the selection as one ZIP named after the folder', async () => {
      const { api } = await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');
      fireEvent.keyDown(cards()[0], { key: 'a', ctrlKey: true });
      const bar = await screen.findByRole('group', { name: 'Bulk actions' });

      fireEvent.click(within(bar).getByRole('button', { name: 'Download' }));

      await waitFor(() => expect(api.downloadMediaZip).toHaveBeenCalledTimes(1));
      expect(api.downloadMediaZip.mock.calls[0][1]).toHaveLength(6);
      expect(api.downloadMediaZip.mock.calls[0][2]).toBe('products');
    });

    it('confirms fewer than 25 files plainly, naming them, and offers Undo as a group', async () => {
      const { confirm, api, toasts } = await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');
      fireEvent.click(within(card('brand.css')).getByRole('checkbox', { name: 'Select brand.css' }));
      fireEvent.click(within(card('logo.svg')).getByRole('checkbox', { name: 'Select logo.svg' }));
      const bar = await screen.findByRole('group', { name: 'Bulk actions' });

      fireEvent.click(within(bar).getByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(confirm.confirm).toHaveBeenCalledTimes(1));
      expect(confirm.confirm.mock.calls[0][0]).toMatchObject({ title: 'Delete 2 files?', details: expect.arrayContaining(['brand.css', 'logo.svg']) });
      expect(confirm.confirm.mock.calls[0][0].typeToConfirm).toBeUndefined();
      await waitFor(() => expect(api.deleteAsset).toHaveBeenCalledTimes(2));
      expect(toasts.toasts().at(-1)?.message).toBe('Deleted 2 files.');
      expect(toasts.toasts().filter((toast) => toast.action)).toHaveLength(1);
    });

    it('lets a read-only project download but not move or delete', async () => {
      await setup({ inputs: { folder: 'products-uuid' }, readOnly: true });
      await screen.findAllByRole('gridcell');
      fireEvent.click(within(card('brand.css')).getByRole('checkbox', { name: 'Select brand.css' }));
      const bar = await screen.findByRole('group', { name: 'Bulk actions' });

      expect(within(bar).getAllByRole('button').map(buttonName)).toEqual(['Download', 'Clear selection']);
    });
  });

  describe('drag and drop onto the tree', () => {
    it('makes the cards draggable', async () => {
      await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');

      expect(card('brand.css')).toHaveAttribute('draggable', 'true');
    });

    it('does not make the cards draggable for a viewer', async () => {
      await setup({ inputs: { folder: 'products-uuid' }, viewer: true });
      await screen.findAllByRole('gridcell');

      expect(card('brand.css')).not.toHaveAttribute('draggable');
    });

    it('moves the dragged card onto a tree folder, highlighting it, with Undo; the folder they are in refuses', async () => {
      const { api, toasts } = await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');
      const data = transfer();
      fireEvent.dragStart(card('brand.css'), { dataTransfer: data });
      expect(data.setData).toHaveBeenCalledWith(MEDIA_DRAG_TYPE, JSON.stringify(['uuid-brand-css']));

      const archive = await screen.findByRole('treeitem', { name: /^Archive/ });
      expect(fireEvent.dragOver(archive, { dataTransfer: data })).toBe(false); // allowed
      expect(archive.closest('.sf-tree__row')).toHaveClass('is-drop-target');

      const products = screen.getByRole('treeitem', { name: /^Products/ });
      expect(fireEvent.dragOver(products, { dataTransfer: data })).toBe(true); // refused: they are in it
      expect(products.closest('.sf-tree__row')).toHaveClass('is-drop-invalid');

      fireEvent.drop(archive, { dataTransfer: data });
      await waitFor(() => expect(api.moveAsset).toHaveBeenCalledWith('proj', 'uuid-brand-css', { folderUuid: 'archive-uuid' }));
      await waitFor(() => expect(toasts.toasts().at(-1)?.message).toBe('Moved “brand.css” to Archive.'));
      expect(toasts.toasts().at(-1)?.action).toBeDefined();
    });

    it('drags the whole selection when the card is part of it', async () => {
      await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');
      fireEvent.click(within(card('brand.css')).getByRole('checkbox', { name: 'Select brand.css' }));
      fireEvent.click(within(card('logo.svg')).getByRole('checkbox', { name: 'Select logo.svg' }));
      const data = transfer();

      fireEvent.dragStart(card('logo.svg'), { dataTransfer: data });

      expect(JSON.parse(data.setData.mock.calls[0][1] as string)).toHaveLength(2);
    });

    it('drops on the tree root to move to the top level', async () => {
      const { api } = await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');
      const data = transfer({ [MEDIA_DRAG_TYPE]: JSON.stringify(['uuid-brand-css']) });
      fireEvent.dragStart(card('brand.css'), { dataTransfer: data });

      const tree = screen.getByRole('tree', { name: 'Folders' });
      expect(fireEvent.dragOver(tree, { dataTransfer: data })).toBe(false);
      fireEvent.drop(tree, { dataTransfer: data });

      await waitFor(() => expect(api.moveAsset).toHaveBeenCalledWith('proj', 'uuid-brand-css', {}));
    });

    it('ignores a file dragged in from the desktop', async () => {
      const { api } = await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');
      const archive = await screen.findByRole('treeitem', { name: /^Archive/ });
      const files = { types: ['Files'], dropEffect: 'none', effectAllowed: 'all', getData: () => '', setData: vi.fn() };

      fireEvent.dragOver(archive, { dataTransfer: files });
      fireEvent.drop(archive, { dataTransfer: files });

      expect(archive.closest('.sf-tree__row')).not.toHaveClass('is-drop-target');
      expect(api.moveAsset).not.toHaveBeenCalled();
    });
  });

  describe('the list view', () => {
    it('has a ⋮ column with the same menu, and a star in the name cell', async () => {
      const { favorites, toasts } = await setup({ inputs: { folder: 'products-uuid' }, view: 'list' });
      const row = (await screen.findByText('brand.css')).closest('tr')!;

      fireEvent.click(within(row).getByRole('button', { name: 'Actions for brand.css' }));
      const menu = await screen.findByRole('menu');
      expect(menuItemNames(menu)).toHaveLength(7);
      fireEvent.keyDown(menu, { key: 'Escape' });

      fireEvent.click(within(row).getByRole('button', { name: 'Add “brand.css” to favorites' }));
      expect(favorites.toggle).toHaveBeenCalledWith(expect.objectContaining({ type: 'MEDIA', uuid: 'uuid-brand-css' }));
      expect(toasts.toasts().at(-1)?.message).toBe('“brand.css” added to your favorites.');
      expect(within(row).getByRole('button', { name: 'Remove “brand.css” from favorites' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('opens the context menu of a row on a right click', async () => {
      await setup({ inputs: { folder: 'products-uuid' }, view: 'list' });
      const row = (await screen.findByText('brand.css')).closest('tr')!;

      fireEvent.contextMenu(row);

      expect(contextMenuItems().map((item) => item.label)).toContain('Delete…');
    });

    it('offers Move, Download and Delete for the selection', async () => {
      await setup({ inputs: { folder: 'products-uuid' }, view: 'list' });
      const row = (await screen.findByText('brand.css')).closest('tr')!;

      fireEvent.click(within(row).getByRole('checkbox'));

      const bar = await screen.findByRole('group', { name: 'Bulk actions' });
      expect(within(bar).getByRole('button', { name: 'Move' })).toBeInTheDocument();
      expect(within(bar).getByRole('button', { name: 'Download' })).toBeInTheDocument();
      expect(within(bar).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    });
  });

  describe('favorites (decisions 57–58)', () => {
    const FAVORITES: FavoriteEntry[] = [
      { kind: 'MEDIA', uuid: 'uuid-brand-css', title: 'brand.css', folderPath: '/media_root/products/' },
      { kind: 'FOLDER', uuid: 'team-uuid', title: 'Team', folderPath: '/media_root/team/' },
      { kind: 'PAGE', uuid: 'page-1', title: 'Shop', folderPath: '/pages_root/' },
    ];

    it('has no Favorites node while there are no favorites', async () => {
      await setup();
      await screen.findAllByRole('treeitem');

      expect(screen.queryByRole('treeitem', { name: /^Favorites/ })).toBeNull();
    });

    it('pins a Favorites node on top of the tree while there are favorites', async () => {
      await setup({ favorites: FAVORITES });
      const items = await screen.findAllByRole('treeitem');

      expect(items[0]).toHaveAccessibleName(/^Favorites/);
    });

    it('offers the Favorites node in the palette only while there are favorites, and opens the list', async () => {
      const { favorites, navigate } = await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');
      const action = () => TestBed.inject(ShortcutService).actions().find((def) => def.id === 'media.favorites');
      expect(action()).toBeUndefined();

      favorites.toggle({ type: 'MEDIA', uuid: 'uuid-brand-css', displayName: 'brand.css', folderPath: '/media_root/products/' });

      await waitFor(() => expect(action()).toBeDefined());
      action()!.handler!();
      await waitFor(() => expect(lastQuery(navigate)).toMatchObject({ favorites: '1', folder: null, asset: null }));
    });

    it('lists the favorites of every store as flat shortcuts, with where they live', async () => {
      await setup({ favorites: FAVORITES });
      const node = await screen.findByRole('treeitem', { name: /^Favorites/ });

      expandFocused(node);

      const brand = await screen.findByRole('treeitem', { name: /^brand\.css/ });
      expect(brand).toHaveTextContent('products');
      expect(screen.getAllByRole('treeitem', { name: /^Team/ })).not.toHaveLength(0);
      expect(screen.getByRole('treeitem', { name: /^Shop/ })).toBeInTheDocument();
    });

    it('opens the Favorites list in the main pane when the node is clicked', async () => {
      const { navigate } = await setup({ favorites: FAVORITES, inputs: { folder: 'products-uuid' } });

      fireEvent.click(await screen.findByRole('treeitem', { name: /^Favorites/ }));

      await waitFor(() => expect(lastQuery(navigate)).toMatchObject({ favorites: '1', folder: null, asset: null }));
    });

    it('shows the Favorites list in the main pane, with the node selected, and no folder header', async () => {
      await setup({ favorites: FAVORITES, inputs: { favorites: '1' } });

      expect(await screen.findByRole('heading', { level: 1, name: 'Favorites' })).toBeInTheDocument();
      expect(screen.getByRole('treeitem', { name: /^Favorites/ })).toHaveAttribute('aria-selected', 'true');
      expect(screen.queryByRole('grid', { name: /^Files in/ })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull();
    });

    it('offers the star for a folder in its menu', async () => {
      const { favorites, toasts } = await setup({ favorites: FAVORITES, inputs: { folder: 'products-uuid' } });
      const archive = await screen.findByRole('treeitem', { name: /^Archive/ });

      fireEvent.contextMenu(archive);
      const star = contextMenuItems().find((item) => item.label === 'Add “Archive” to favorites');
      expect(star).toBeDefined();
      star!.action!();

      expect(favorites.toggle).toHaveBeenCalledWith(expect.objectContaining({ type: 'FOLDER', uuid: 'archive-uuid', displayName: 'Archive' }));
      expect(toasts.toasts().at(-1)?.message).toBe('“Archive” added to your favorites.');
    });

    it('has nothing to edit inside the Favorites branch: no rename, move or delete, and no menu of its own', async () => {
      await setup({ favorites: FAVORITES, inputs: { folder: 'products-uuid' } });
      const node = await screen.findByRole('treeitem', { name: /^Favorites/ });
      expandFocused(node);
      const shortcut = await screen.findByRole('treeitem', { name: /^brand\.css/ });

      fireEvent.contextMenu(shortcut);
      expect(contextMenuItems()).toEqual([]);
      shortcut.focus();
      fireEvent.keyDown(shortcut, { key: 'F2' });
      expect(screen.queryByRole('textbox', { name: /Rename/ })).toBeNull();
    });

    it('expands a favorite folder lazily, reading what is directly inside it', async () => {
      const { api } = await setup({ favorites: FAVORITES, inputs: { folder: 'products-uuid' } });
      api.listAssets.mockReturnValue(
        of({
          content: [
            { uuid: 'uuid-anna', type: 'MEDIA', displayName: 'anna.jpg', folderPath: '/media_root/team/' },
            { uuid: 'deep', type: 'MEDIA', displayName: 'deeper.jpg', folderPath: '/media_root/team/interns/' },
          ],
        }),
      );
      expandFocused(await screen.findByRole('treeitem', { name: /^Favorites/ }));
      const team = await screen.findAllByRole('treeitem', { name: /^Team/ });
      expect(api.listAssets).not.toHaveBeenCalled(); // not read before it is opened

      expandFocused(team.find((row) => row.getAttribute('data-node-id')?.startsWith('fav:'))!);

      expect(await screen.findByRole('treeitem', { name: /^anna\.jpg/ })).toBeInTheDocument();
      expect(api.listAssets).toHaveBeenCalledWith('proj', expect.objectContaining({ folder: '/media_root/team/' }));
      expect(screen.queryByRole('treeitem', { name: /^deeper\.jpg/ })).toBeNull();
    });

    it('opens a favorite file in the library', async () => {
      const { navigate } = await setup({ favorites: FAVORITES, inputs: { folder: 'products-uuid' } });
      expandFocused(await screen.findByRole('treeitem', { name: /^Favorites/ }));

      fireEvent.click(await screen.findByRole('treeitem', { name: /^brand\.css/ }));

      await waitFor(() => expect(navigate).toHaveBeenCalledWith(['/p', 'proj', 'media'], { queryParams: { asset: 'uuid-brand-css' } }));
    });
  });

  describe('the tree follows the store', () => {
    it('puts the selection back when the library stays on the open file (unsaved edits kept)', async () => {
      const { navigate, route } = await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');
      await route({ asset: 'uuid-brand-css' });
      await screen.findByTestId('drawer');
      // The drawer's leave guard asks about unsaved edits, the person keeps them and the router refuses.
      navigate.mockResolvedValueOnce(false);

      fireEvent.click(await screen.findByRole('treeitem', { name: /^Team/ }));

      await waitFor(() => expect(screen.getByRole('treeitem', { name: /^Products/ })).toHaveAttribute('aria-selected', 'true'));
      expect(screen.getByRole('treeitem', { name: /^Team/ })).toHaveAttribute('aria-selected', 'false');
    });
  });
});
