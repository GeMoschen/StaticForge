import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { Subject, of, throwError } from 'rxjs';
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { MEDIA_TREE, PRODUCTS, pageOf, productFiles, projectStub, summary } from './library/media-library.testing';
import { MediaDetailDrawerComponent } from './media-detail-drawer.component';
import { MediaLibraryComponent } from './media-library.component';

type MediaView = components['schemas']['MediaView'];
type MediaSummaryView = components['schemas']['MediaSummaryView'];
type ListOptions = { folder?: string; page?: number; size?: number };

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
  dev?: boolean;
  readOnly?: boolean;
  tree?: typeof MEDIA_TREE;
  /** Replaces the list endpoint (to delay or fail it). */
  list?: (key: string, opts: ListOptions) => unknown;
  confirm?: boolean;
  view?: 'grid' | 'list';
}

const ROOT = '/media_root/';

async function setup(options: SetupOptions = {}) {
  const files = options.files ?? [...productFiles(), summary('anna.jpg', '/media_root/team/'), summary('root-banner.jpg', ROOT)];
  const listMedia = vi.fn(
    options.list ??
      ((_key: string, opts: ListOptions = {}) => {
        const size = opts.size ?? 200;
        const page = opts.page ?? 0;
        const inFolder = opts.folder ? files.filter((f) => f.folderPath === opts.folder) : files;
        return of(pageOf(inFolder.slice(page * size, (page + 1) * size), page, size, inFolder.length));
      }),
  );
  const api = {
    listMedia,
    mediaThumbnailBlob: vi.fn().mockReturnValue(of(new Blob(['x'], { type: 'image/jpeg' }))),
    mediaText: vi.fn().mockReturnValue(of({ text: 'a {\n  color: red;\n}\nb {}', mimeType: 'text/css', revision: 3, utf8: true })),
    deleteAsset: vi.fn().mockReturnValue(of(undefined)),
    restoreAsset: vi.fn().mockReturnValue(of({})),
    deleteFolder: vi.fn().mockReturnValue(of(undefined)),
    restoreFolder: vi.fn().mockReturnValue(of({})),
    createFolder: vi.fn().mockReturnValue(of({ uuid: 'new-folder' })),
    renameFolder: vi.fn().mockReturnValue(of({ revision: 9 })),
    moveAsset: vi.fn().mockReturnValue(of({})),
    uploadMediaWithProgress: vi.fn(() => new Subject()),
  };
  const project = projectStub(options.tree);
  const confirm = { confirm: vi.fn().mockResolvedValue(options.confirm ?? true) };
  // The router is spied on before the screen renders: its first effects already navigate.
  let navigate!: MockInstance<Router['navigate']>;
  const view = await render(MediaLibraryComponent, {
    componentInputs: { projectKey: 'proj', ...options.inputs },
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ApiClient, useValue: api },
      { provide: ProjectContextStore, useValue: project },
      { provide: ConfirmService, useValue: confirm },
      { provide: DeveloperModeService, useValue: { enabled: signal(options.dev ?? false) } },
      { provide: EditingLocaleStore, useValue: { locale: signal(null) } },
      // An editor: may upload unless the project is read-only.
      { provide: ProjectPermissionsStore, useFactory: () => {
          const access = inject(ProjectAccessStore);
          return { canEditContent: computed(() => !access.readOnly()) };
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
  const toasts = TestBed.inject(ToastService);
  const frame = TestBed.inject(FrameContextStore);
  view.fixture.detectChanges();
  /** What the router would do: hands the URL's parameters to the screen as inputs. */
  const route = async (inputs: Record<string, unknown>) => {
    for (const [name, value] of Object.entries(inputs)) {
      view.fixture.componentRef.setInput(name, value);
    }
    view.fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    view.fixture.detectChanges();
  };
  return { ...view, api, project, confirm, navigate, toasts, frame, route, preferences: TestBed.inject(PreferencesService) };
}

const grid = () => screen.getByRole('grid', { name: /^Files in/ });
const cards = () => within(grid()).getAllByRole('gridcell');
const card = (name: string) => cards().find((c) => c.getAttribute('aria-label')?.startsWith(name + ','))!;
const cardNames = () => cards().map((c) => c.getAttribute('aria-label')!.split(',')[0]);
const lastQuery = (navigate: { mock: { lastCall?: unknown[] } }) =>
  (navigate.mock.lastCall?.[1] as { queryParams?: Record<string, unknown> } | undefined)?.queryParams;

describe('MediaLibraryComponent', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:thumb');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  describe('the page', () => {
    it('opens at the library root: one h1, the root’s files, and the folders only in the tree', async () => {
      await setup();
      await screen.findAllByRole('gridcell');

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('All media');
      expect(cardNames()).toEqual(['root-banner.jpg']);
      const tree = screen.getByRole('tree', { name: 'Folders' });
      expect(within(tree).getAllByRole('treeitem').map((row) => row.getAttribute('aria-label') ?? row.textContent?.trim().split('\n')[0])).toHaveLength(3);
      expect(within(tree).queryByText('root-banner.jpg')).toBeNull();
      expect(screen.getByText('1 file')).toBeInTheDocument();
    });

    it('shows each folder with its file count, and no UID for an editor', async () => {
      await setup();
      await screen.findAllByRole('treeitem');

      await waitFor(() => expect(screen.getByRole('treeitem', { name: /^Products/ })).toHaveTextContent('6'));
      expect(screen.getByRole('treeitem', { name: /^Team/ })).toHaveTextContent('1');
      expect(screen.queryByText('products')).toBeNull();
    });

    it('shows each folder’s UID as secondary text in developer mode', async () => {
      await setup({ dev: true });
      await screen.findAllByRole('treeitem');

      expect(await screen.findByText('products')).toBeInTheDocument();
      expect(screen.getByText('archive')).toBeInTheDocument();
    });

    it('opens the folder the URL names: its name as the h1 and the breadcrumb’s last segment, its files as cards', async () => {
      const { frame } = await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Products');
      expect(screen.getByText('6 files')).toBeInTheDocument();
      expect(cardNames()).toEqual(['brand.css', 'latte-art.jpg', 'logo-mark.png', 'logo.svg', 'price-list.pdf', 'yirgacheffe.jpg']);
      expect(frame.item()).toMatchObject({ label: 'Products', trail: [], asset: { uuid: 'products-uuid' } });
    });

    it('puts the folders above a nested folder into the breadcrumb as links to them', async () => {
      const { frame } = await setup({ inputs: { folder: 'roastery-uuid' } });

      expect(frame.item()?.label).toBe('Roastery');
      expect(frame.item()?.trail).toEqual([
        { id: 'products-uuid', label: 'Products', link: ['/p', 'proj', 'media'], queryParams: { folder: 'products-uuid' } },
      ]);
    });

    it('opens a folder from the tree through the router (a history entry), closing the open file', async () => {
      const { navigate } = await setup({ inputs: { folder: 'products-uuid' } });

      fireEvent.click(await screen.findByRole('treeitem', { name: /^Team/ }));

      await waitFor(() => expect(lastQuery(navigate)).toEqual({ folder: 'team-uuid', asset: null }));
      expect(navigate.mock.lastCall?.[1]).toMatchObject({ queryParamsHandling: 'merge', replaceUrl: false });
    });

    it('selects the open folder in the tree', async () => {
      await setup({ inputs: { folder: 'team-uuid' } });

      await waitFor(() => expect(screen.getByRole('treeitem', { name: /^Team/ })).toHaveAttribute('aria-selected', 'true'));
      expect(screen.getByRole('treeitem', { name: /^Archive/ })).toHaveAttribute('aria-selected', 'false');
    });
  });

  describe('the grid', () => {
    it('is a grid of focusable cards, named by file, type and size, with the status as part of the name', async () => {
      await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');

      expect(grid()).toHaveAttribute('aria-multiselectable', 'true');
      expect(card('yirgacheffe.jpg')).toHaveAttribute('aria-label', 'yirgacheffe.jpg, JPG · 14.6 KB');
      expect(card('latte-art.jpg')).toHaveAttribute('aria-label', 'latte-art.jpg, JPG · 11.5 KB, Changed');
      expect(card('brand.css')).toHaveAttribute('aria-label', 'brand.css, CSS · 141 B');
      expect(card('price-list.pdf')).toHaveAttribute('aria-label', 'price-list.pdf, PDF · 193 B');
    });

    it('shows a status icon for an unreleased file only', async () => {
      await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');

      expect(within(card('latte-art.jpg')).getByText('Changed')).toBeInTheDocument();
      expect(within(card('yirgacheffe.jpg')).queryByText('Changed')).toBeNull();
      expect(within(card('yirgacheffe.jpg')).queryByText('Published')).toBeNull();
    });

    it('shows the thumbnail of a raster, the first lines of a text file and an icon for a PDF', async () => {
      const { api } = await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');

      await waitFor(() => expect(card('latte-art.jpg').querySelector('img')).toHaveAttribute('src', 'blob:thumb'));
      expect(api.mediaThumbnailBlob).toHaveBeenCalledWith('proj', 'uuid-latte-art-jpg', null);
      await waitFor(() => expect(card('brand.css').querySelector('pre')?.textContent).toContain('color: red;'));
      expect(card('price-list.pdf').querySelector('img, pre')).toBeNull();
      expect(card('price-list.pdf').querySelector('sf-icon')).not.toBeNull();
      // SVG is text, not a raster: no thumbnail request for it.
      expect(api.mediaThumbnailBlob).not.toHaveBeenCalledWith('proj', 'uuid-logo-svg', null);
    });

    it('truncates a long name at its end only and keeps the whole name for readers', async () => {
      const long = summary('a-very-long-photo-file-name-that-keeps-going-and-going.jpg', PRODUCTS);
      await setup({ files: [long], inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');

      expect(card(long.displayName!).querySelector('.card__name')).toHaveTextContent(long.displayName!);
      expect(card(long.displayName!)).toHaveAttribute('aria-label', expect.stringContaining(long.displayName!));
    });

    it('marks the card of the open file', async () => {
      const { route } = await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');

      await route({ asset: 'uuid-logo-mark-png' });

      expect(card('logo-mark.png')).toHaveClass('is-open');
      expect(card('brand.css')).not.toHaveClass('is-open');
      expect(await screen.findByTestId('drawer')).toHaveTextContent('logo-mark.png');
    });

    describe('keyboard', () => {
      it('has one tab stop and moves it with the arrow keys, Home and End', async () => {
        await setup({ inputs: { folder: 'products-uuid' } });
        await screen.findAllByRole('gridcell');
        const [first, second] = cards();
        expect(first).toHaveAttribute('tabindex', '0');
        expect(second).toHaveAttribute('tabindex', '-1');

        first.focus();
        fireEvent.keyDown(first, { key: 'ArrowRight' });
        expect(document.activeElement).toBe(second);
        expect(second).toHaveAttribute('tabindex', '0');
        expect(first).toHaveAttribute('tabindex', '-1');

        fireEvent.keyDown(second, { key: 'ArrowLeft' });
        expect(document.activeElement).toBe(first);
        fireEvent.keyDown(first, { key: 'End' });
        expect(document.activeElement).toBe(cards().at(-1));
        fireEvent.keyDown(cards().at(-1)!, { key: 'Home' });
        expect(document.activeElement).toBe(cards()[0]);
      });

      it('selects with Space, everything with Ctrl+A, and shows the count', async () => {
        await setup({ inputs: { folder: 'products-uuid' } });
        await screen.findAllByRole('gridcell');
        const [first, second] = cards();

        second.focus();
        fireEvent.keyDown(second, { key: ' ' });
        await waitFor(() => expect(second).toHaveAttribute('aria-selected', 'true'));
        expect(first).toHaveAttribute('aria-selected', 'false');
        expect(screen.getByRole('group', { name: 'Bulk actions' })).toHaveTextContent('1 selected');

        fireEvent.keyDown(second, { key: 'a', ctrlKey: true });
        await waitFor(() => expect(cards().every((c) => c.getAttribute('aria-selected') === 'true')).toBe(true));
        expect(screen.getByRole('group', { name: 'Bulk actions' })).toHaveTextContent('6 selected');
      });

      it('opens the file with Enter, through the router', async () => {
        const { navigate } = await setup({ inputs: { folder: 'products-uuid' } });
        await screen.findAllByRole('gridcell');
        const target = card('latte-art.jpg');
        target.focus();

        fireEvent.keyDown(target, { key: 'Enter' });

        expect(lastQuery(navigate)).toEqual({ asset: 'uuid-latte-art-jpg' });
        expect(navigate.mock.lastCall?.[1]).toMatchObject({ replaceUrl: false });
      });

      it('renders the cards past the first chunk when End jumps to the last one', async () => {
        const many = Array.from({ length: 150 }, (_, i) => summary(`img-${String(i).padStart(3, '0')}.jpg`, PRODUCTS));
        await setup({ files: many, inputs: { folder: 'products-uuid' } });
        await screen.findAllByRole('gridcell');
        expect(cards()).toHaveLength(60);

        fireEvent.keyDown(cards()[0], { key: 'End' });

        expect(cards()).toHaveLength(150);
        expect(document.activeElement).toBe(cards().at(-1));
        expect(document.activeElement).toHaveAttribute('aria-label', expect.stringContaining('img-149.jpg'));
      });

      it('asks to delete the file with Delete, the selection when the card is in it', async () => {
        const { confirm, api } = await setup({ inputs: { folder: 'products-uuid' } });
        await screen.findAllByRole('gridcell');
        const target = card('brand.css');
        target.focus();

        fireEvent.keyDown(target, { key: 'Delete' });

        await waitFor(() => expect(confirm.confirm).toHaveBeenCalledTimes(1));
        expect(confirm.confirm.mock.calls[0][0].title).toBe('Delete “brand.css”?');
        await waitFor(() => expect(api.deleteAsset).toHaveBeenCalledWith('proj', 'uuid-brand-css'));
      });
    });

    describe('selection with the pointer', () => {
      it('opens the file on a click, toggles with Ctrl or ⌘ and selects a range with Shift', async () => {
        const { navigate } = await setup({ inputs: { folder: 'products-uuid' } });
        await screen.findAllByRole('gridcell');

        fireEvent.click(card('logo.svg'));
        expect(lastQuery(navigate)).toEqual({ asset: 'uuid-logo-svg' });

        fireEvent.click(card('latte-art.jpg'), { ctrlKey: true });
        fireEvent.click(card('logo-mark.png'), { metaKey: true });
        await waitFor(() => expect(screen.getByRole('group', { name: 'Bulk actions' })).toHaveTextContent('2 selected'));

        fireEvent.click(card('logo-mark.png'), { metaKey: true });
        fireEvent.click(card('brand.css'), { ctrlKey: true });
        fireEvent.click(card('price-list.pdf'), { shiftKey: true });
        await waitFor(() =>
          expect(cards().filter((c) => c.getAttribute('aria-selected') === 'true').map((c) => c.getAttribute('aria-label')!.split(',')[0])).toEqual([
            'brand.css',
            'latte-art.jpg',
            'logo-mark.png',
            'logo.svg',
            'price-list.pdf',
          ]),
        );
      });

      it('labels each card’s checkbox with the file name and keeps it out of the tab order', async () => {
        await setup({ inputs: { folder: 'products-uuid' } });
        await screen.findAllByRole('gridcell');

        const box = within(card('latte-art.jpg')).getByRole('checkbox', { name: 'Select latte-art.jpg' });
        expect(box).toHaveAttribute('tabindex', '-1');
        fireEvent.click(box);

        await waitFor(() => expect(card('latte-art.jpg')).toHaveAttribute('aria-selected', 'true'));
      });

      it('clears the selection with the bulk bar’s button', async () => {
        await setup({ inputs: { folder: 'products-uuid' } });
        await screen.findAllByRole('gridcell');
        fireEvent.click(within(card('brand.css')).getByRole('checkbox', { name: 'Select brand.css' }));
        const bar = await screen.findByRole('group', { name: 'Bulk actions' });

        fireEvent.click(within(bar).getByRole('button', { name: 'Clear selection' }));

        await waitFor(() => expect(screen.queryByRole('group', { name: 'Bulk actions' })).toBeNull());
      });

      it('deletes the selection after a confirmation, asking for the word delete from 25 files', async () => {
        const many = Array.from({ length: 30 }, (_, i) => summary(`img-${String(i).padStart(2, '0')}.jpg`, PRODUCTS));
        const { confirm, api } = await setup({ files: many, inputs: { folder: 'products-uuid' } });
        await screen.findAllByRole('gridcell');
        fireEvent.keyDown(cards()[0], { key: 'a', ctrlKey: true });
        const bar = await screen.findByRole('group', { name: 'Bulk actions' });

        fireEvent.click(within(bar).getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(confirm.confirm).toHaveBeenCalledTimes(1));
        expect(confirm.confirm.mock.calls[0][0]).toMatchObject({ title: 'Delete 30 files?', typeToConfirm: 'delete' });
        await waitFor(() => expect(api.deleteAsset).toHaveBeenCalledTimes(30));
      });

      it('does not offer Delete in a read-only project', async () => {
        await setup({ inputs: { folder: 'products-uuid' }, readOnly: true });
        await screen.findAllByRole('gridcell');
        fireEvent.click(within(card('brand.css')).getByRole('checkbox', { name: 'Select brand.css' }));
        const bar = await screen.findByRole('group', { name: 'Bulk actions' });

        expect(within(bar).queryByRole('button', { name: 'Delete' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
      });
    });
  });

  describe('the list', () => {
    const table = () => screen.getByRole('grid', { name: /^Files in/ });
    /** The row of a file (its name cell, not the drawer's heading). */
    const rowOf = (name: string) => () =>
      Array.from(document.querySelectorAll<HTMLElement>('.list-name__text')).find((el) => el.textContent === name)?.closest('tr') ?? null;

    it('is an sf-data-table with the sample’s columns, from ?media=list', async () => {
      await setup({ inputs: { folder: 'products-uuid', media: 'list' } });
      await screen.findByText('yirgacheffe.jpg');

      for (const column of ['Preview', 'Name', 'Type', 'Dimensions', 'Size', 'Modified', 'Used by']) {
        expect(within(table()).getByRole('columnheader', { name: new RegExp(column) })).toBeInTheDocument();
      }
      expect(within(table()).queryByRole('grid', { name: /^Files in/ })).toBeNull();
    });

    it('shows dimensions, size, when it was modified and how many places use the file', async () => {
      await setup({ inputs: { folder: 'products-uuid', media: 'list' } });
      const row = (await screen.findByText('yirgacheffe.jpg')).closest('tr')!;

      expect(within(row).getByText('640 × 480')).toBeInTheDocument();
      expect(within(row).getByText('14.6 KB')).toBeInTheDocument();
      expect(within(row).getByText('JPG')).toBeInTheDocument();
      expect(within(row).getByText('2')).toBeInTheDocument(); // used in two places
      const css = screen.getByText('brand.css').closest('tr')!;
      expect(within(css).getByText('—')).toBeInTheDocument(); // no dimensions
    });

    it('opens a row through the router and highlights the open file', async () => {
      const { navigate, route } = await setup({ inputs: { folder: 'products-uuid', media: 'list' } });
      const row = rowOf('latte-art.jpg');
      await waitFor(() => expect(row()).not.toBeNull());

      fireEvent.click(row()!);
      expect(lastQuery(navigate)).toEqual({ asset: 'uuid-latte-art-jpg' });

      await route({ asset: 'uuid-latte-art-jpg' });
      await waitFor(() => expect(row()).toHaveAttribute('aria-current', 'true'));
      expect(rowOf('brand.css')()).not.toHaveAttribute('aria-current');
    });

    it('keeps the selection of the grid, and bulk-deletes it', async () => {
      const { confirm, api } = await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');
      fireEvent.click(within(card('brand.css')).getByRole('checkbox', { name: 'Select brand.css' }));
      await screen.findByRole('group', { name: 'Bulk actions' });

      fireEvent.click(screen.getByRole('radio', { name: 'List' }));

      const table = await screen.findByRole('grid', { name: /^Files in/ });
      await waitFor(() => expect(within(table).getByRole('checkbox', { name: 'Select brand.css' })).toBeChecked());
      expect(within(table).getByRole('checkbox', { name: 'Select latte-art.jpg' })).not.toBeChecked();
      const bar = screen.getByRole('group', { name: 'Bulk actions' });
      expect(bar).toHaveTextContent('1 selected');

      fireEvent.click(within(bar).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(confirm.confirm).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(api.deleteAsset).toHaveBeenCalledWith('proj', 'uuid-brand-css'));
    });

    it('lists the files in the toolbar’s order', async () => {
      await setup({ inputs: { folder: 'products-uuid', media: 'list', sort: 'size-desc' } });
      await screen.findByText('yirgacheffe.jpg');

      const names = within(table())
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).queryByText(/\.(jpg|png|css|svg|pdf)$/)?.textContent);
      expect(names.slice(0, 3)).toEqual(['yirgacheffe.jpg', 'latte-art.jpg', 'logo-mark.png']);
    });

    it('shows its loading state while the folder is read', async () => {
      const never = new Subject<never>();
      await setup({ inputs: { folder: 'products-uuid', media: 'list' }, list: () => never });

      await waitFor(() => expect(document.querySelector('sf-data-table [aria-busy="true"], sf-data-table sf-skeleton')).not.toBeNull());
    });
  });

  describe('the view', () => {
    it('is the stored preference, and the URL overrides it', async () => {
      const { route, preferences } = await setup({ inputs: { folder: 'products-uuid' }, view: 'list' });
      await screen.findByText('yirgacheffe.jpg');
      expect(screen.getByRole('radio', { name: 'List' })).toBeChecked();
      expect(preferences.mediaView()).toBe('list');

      await route({ media: 'grid' });
      await screen.findAllByRole('gridcell');
      expect(screen.getByRole('radio', { name: 'Grid' })).toBeChecked();
      expect(preferences.mediaView()).toBe('list');
    });

    it('is stored in the preferences when the segmented control changes it', async () => {
      const { preferences } = await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');

      fireEvent.click(screen.getByRole('radio', { name: 'List' }));

      await waitFor(() => expect(preferences.mediaView()).toBe('list'));
      expect(await screen.findByText('yirgacheffe.jpg')).toBeInTheDocument();
      expect(screen.queryByRole('gridcell')).toBeNull();
    });
  });

  describe('the toolbar', () => {
    it('has search, type, sort, view and Upload in that order, every one a tab stop (the search field keeps the arrow keys)', async () => {
      await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');

      const bar = screen.getByRole('group', { name: 'Library tools' });
      const inOrder = [
        within(bar).getByRole('searchbox', { name: 'Search this folder' }),
        within(bar).getByRole('combobox', { name: 'File type' }),
        within(bar).getByRole('button', { name: /^Sort: Name/ }),
        within(bar).getByRole('radio', { name: 'Grid' }),
        within(bar).getByRole('radio', { name: 'List' }),
        within(bar).getByRole('button', { name: 'Upload' }),
      ];
      for (let i = 1; i < inOrder.length; i++) {
        expect(inOrder[i - 1].compareDocumentPosition(inOrder[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
      // A roving toolbar would put tabindex -1 on all but one of them and could not be left from the search field.
      // (The Grid / List radios are one tab stop between them, as a radio group is.)
      expect(inOrder.filter((control) => control.getAttribute('role') !== 'radio' && control.getAttribute('tabindex') === '-1')).toEqual([]);
    });

    it('sends the type filter to the URL, and offers each type', async () => {
      const { navigate } = await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');
      const type = screen.getByRole('combobox', { name: 'File type' });
      expect(within(type).getAllByRole('option').map((o) => o.textContent?.trim())).toEqual(['All types', 'Images', 'Documents', 'Text']);

      fireEvent.change(type, { target: { value: '1' } });

      await waitFor(() => expect(lastQuery(navigate)).toEqual({ type: 'images' }));
      expect(navigate.mock.lastCall?.[1]).toMatchObject({ replaceUrl: true });
    });

    it('narrows the folder by the type from the URL', async () => {
      await setup({ inputs: { folder: 'products-uuid', type: 'text' } });
      await screen.findAllByRole('gridcell');

      expect(cardNames()).toEqual(['brand.css', 'logo.svg']);
      await waitFor(() => expect(screen.getByRole('combobox', { name: 'File type' })).toHaveDisplayValue(/Text/));
    });

    it('sorts by the URL’s field and direction, and names the sort on its button', async () => {
      await setup({ inputs: { folder: 'products-uuid', sort: 'date-asc' } });
      await screen.findAllByRole('gridcell');

      expect(cardNames()[0]).toBe('latte-art.jpg'); // newest first
      expect(screen.getByRole('button', { name: /Sort: Date modified/ })).toHaveTextContent('↑');
    });

    it('offers the sort fields and the order as two groups, and sends a choice to the URL', async () => {
      const { navigate } = await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');

      fireEvent.click(screen.getByRole('button', { name: /^Sort: Name/ }));
      const menu = await screen.findByRole('menu');
      expect(within(menu).getByText('Sort by')).toBeInTheDocument();
      expect(within(menu).getByText('Order')).toBeInTheDocument();
      expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent?.replace(/check/, '').trim())).toEqual([
        'Name',
        'Date modified',
        'Size',
        'Type',
        'Ascending',
        'Descending',
      ]);

      fireEvent.click(within(menu).getByRole('menuitem', { name: /Size/ }));
      await waitFor(() => expect(lastQuery(navigate)).toEqual({ sort: 'size-asc' }));
    });

    it('filters at once while typing, then puts q in the URL', async () => {
      const { navigate } = await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');

      fireEvent.input(screen.getByRole('searchbox', { name: 'Search this folder' }), { target: { value: 'logo' } });

      await waitFor(() => expect(cardNames()).toEqual(['logo-mark.png', 'logo.svg']));
      expect(navigate).not.toHaveBeenCalled();
      await waitFor(() => expect(lastQuery(navigate)).toEqual({ q: 'logo' }), { timeout: 2000 });
    });

    it('starts the file picker from Upload', async () => {
      await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');
      const input = document.querySelector<HTMLInputElement>('sf-media-library-toolbar input[type="file"]')!;
      const click = vi.spyOn(input, 'click');

      fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

      expect(click).toHaveBeenCalled();
    });
  });

  describe('states', () => {
    it('shows cards in the grid’s shape while the folder is read', async () => {
      const never = new Subject<never>();
      await setup({ inputs: { folder: 'products-uuid' }, list: () => never });

      await waitFor(() => expect(document.querySelector('.skeleton[aria-busy="true"]')).not.toBeNull());
      expect(document.querySelector('.skeleton')).toHaveTextContent('Loading the files of Products…');
      expect(document.querySelectorAll('.skeleton__card')).toHaveLength(8);
      expect(screen.queryByRole('gridcell')).toBeNull();
    });

    it('says the folder could not be read, and Retry reads it again', async () => {
      let fail = true;
      const files = productFiles();
      const { api } = await setup({
        inputs: { folder: 'products-uuid' },
        list: (_key, opts) => (fail ? throwError(() => new Error('500')) : of(pageOf(files, 0, 200, files.length))),
      });

      const banner = await screen.findByRole('alert');
      expect(banner).toHaveTextContent('Couldn’t load the files of Products.');
      const reads = api.listMedia.mock.calls.length;

      fail = false;
      fireEvent.click(within(banner).getByRole('button', { name: 'Retry' }));

      expect((await screen.findAllByRole('gridcell')).length).toBe(6);
      expect(api.listMedia.mock.calls.length).toBeGreaterThan(reads);
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('says a folder is empty and offers Upload', async () => {
      await setup({ inputs: { folder: 'archive-uuid' } });

      expect(await screen.findByRole('heading', { level: 2, name: 'This folder is empty' })).toBeInTheDocument();
      expect(screen.getByText('Drop files here or upload them to Archive.')).toBeInTheDocument();
      expect(screen.getByText('No files')).toBeInTheDocument();
    });

    it('says nothing matches, and Clear filters empties search and type in the URL', async () => {
      const { navigate } = await setup({ inputs: { folder: 'products-uuid', q: 'zzz', type: 'text' } });

      expect(await screen.findByRole('heading', { level: 2, name: 'No files match the search or filter' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

      await waitFor(() => expect(lastQuery(navigate)).toEqual({ q: null, type: null }));
      expect(screen.getByRole('searchbox', { name: 'Search this folder' })).toHaveValue('');
    });

    it('explains an empty library, with Upload and New folder, and hides the toolbar', async () => {
      await setup({ files: [], tree: [{ ...MEDIA_TREE[0], children: [] }] });

      expect(await screen.findByRole('heading', { level: 2, name: 'Your media library is empty' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('All media');
      expect(screen.queryByRole('toolbar', { name: 'Library tools' })).toBeNull();
      expect(screen.getAllByRole('button', { name: 'Upload' }).length).toBeGreaterThan(0);
      expect(screen.getAllByRole('button', { name: 'New folder' })).toHaveLength(3);
      expect(screen.getByRole('heading', { level: 3, name: 'No folders yet' })).toBeInTheDocument();
    });
  });

  describe('a URL that names something that is gone', () => {
    it('drops a folder that is not in the tree and says so', async () => {
      const { navigate, toasts } = await setup({ inputs: { folder: 'ghost-uuid' } });

      await waitFor(() => expect(lastQuery(navigate)).toEqual({ folder: null }));
      expect(navigate.mock.lastCall?.[1]).toMatchObject({ replaceUrl: true });
      expect(toasts.toasts().at(-1)?.message).toBe('That folder no longer exists.');
    });

    it('drops a file that is not in the library and says so', async () => {
      const { navigate, toasts } = await setup({ inputs: { asset: 'ghost-file' } });

      await waitFor(() => expect(lastQuery(navigate)).toEqual({ asset: null }));
      expect(toasts.toasts().at(-1)?.message).toBe('That file no longer exists.');
      expect(screen.queryByTestId('drawer')).toBeNull();
    });

    it('shows the folder of a file that is opened from a link without one', async () => {
      const { navigate } = await setup({ inputs: { asset: 'uuid-anna-jpg' } });

      await waitFor(() => expect(lastQuery(navigate)).toEqual({ folder: 'team-uuid' }));
      expect(navigate.mock.lastCall?.[1]).toMatchObject({ replaceUrl: true });
      expect(await screen.findByTestId('drawer')).toHaveTextContent('anna.jpg');
    });

    it('closes the drawer when the URL no longer names a file (back)', async () => {
      const { route } = await setup({ inputs: { folder: 'products-uuid', asset: 'uuid-brand-css' } });
      expect(await screen.findByTestId('drawer')).toHaveTextContent('brand.css');

      await route({ asset: undefined });

      await waitFor(() => expect(screen.queryByTestId('drawer')).toBeNull());
    });
  });

  describe('the folder’s menu in the page header', () => {
    it('has no folder menu at the library root', async () => {
      await setup();
      await screen.findAllByRole('gridcell');

      expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    });

    it('offers Rename… (the dialog; F2 stays the in-place edit), Move and Delete for a folder', async () => {
      await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');
      fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
      const menu = await screen.findByRole('menu');

      expect(within(menu).getByRole('menuitem', { name: /Rename folder…/ })).not.toHaveTextContent('F2');
      expect(within(menu).getByRole('menuitem', { name: /Move folder…/ })).toBeInTheDocument();
      expect(within(menu).getByRole('menuitem', { name: /Delete folder…/ })).toBeInTheDocument();
    });

    it('deletes the folder after a confirmation that counts what is inside, and offers Undo', async () => {
      const { api, confirm, toasts, navigate } = await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');
      await waitFor(() => expect(screen.getByRole('treeitem', { name: /^Products/ })).toHaveTextContent('6'));
      fireEvent.click(screen.getByRole('button', { name: 'More actions' }));

      fireEvent.click(await screen.findByRole('menuitem', { name: /Delete folder…/ }));

      await waitFor(() => expect(confirm.confirm).toHaveBeenCalled());
      expect(confirm.confirm.mock.calls[0][0]).toMatchObject({
        title: 'Delete “Products”?',
        message: 'This also deletes 6 media items and 1 sub-folder inside it.',
        tone: 'danger',
      });
      await waitFor(() => expect(api.deleteFolder).toHaveBeenCalledWith('proj', 'products-uuid', true));
      expect(toasts.toasts().at(-1)).toMatchObject({ message: 'Deleted “Products”.' });
      expect(toasts.toasts().at(-1)?.action).toBeDefined();
      // The open folder is gone: back to the library root.
      await waitFor(() => expect(lastQuery(navigate)).toEqual({ folder: null, asset: null }));
    });

    it('opens the move dialog with the library’s folders and moves the folder', async () => {
      const { api } = await setup({ inputs: { folder: 'team-uuid' } });
      await screen.findAllByRole('gridcell');
      fireEvent.click(screen.getByRole('button', { name: 'More actions' }));

      fireEvent.click(await screen.findByRole('menuitem', { name: /Move folder…/ }));

      const dialog = await screen.findByRole('dialog');
      fireEvent.click(await within(dialog).findByRole('treeitem', { name: /^Archive/ }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
      await waitFor(() => expect(api.moveAsset).toHaveBeenCalledWith('proj', 'team-uuid', { folderUuid: 'archive-uuid' }));
    });

    it('opens the Rename dialog, with the UID section in developer mode, and renames with the folder’s revision', async () => {
      const { api } = await setup({ inputs: { folder: 'team-uuid' }, dev: true });
      await screen.findAllByRole('gridcell');
      fireEvent.click(screen.getByRole('button', { name: 'More actions' }));

      fireEvent.click(await screen.findByRole('menuitem', { name: /Rename folder…/ }));

      const dialog = await screen.findByRole('dialog', { name: 'Rename “Team”' });
      expect(within(dialog).getByRole('heading', { name: 'UID' })).toBeInTheDocument();
      expect(within(dialog).getByText('team')).toBeInTheDocument();
      fireEvent.input(within(dialog).getByRole('textbox', { name: /Folder name/ }), { target: { value: 'Crew' } });
      await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Apply' })).toBeEnabled());
      fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
      await waitFor(() => expect(api.renameFolder).toHaveBeenCalledWith('proj', 'team-uuid', { displayName: 'Crew' }, 5));
    });

    it('has no UID section in the dialog outside developer mode', async () => {
      await setup({ inputs: { folder: 'team-uuid' } });
      await screen.findAllByRole('gridcell');
      fireEvent.click(screen.getByRole('button', { name: 'More actions' }));

      fireEvent.click(await screen.findByRole('menuitem', { name: /Rename folder…/ }));

      const dialog = await screen.findByRole('dialog', { name: 'Rename “Team”' });
      expect(within(dialog).queryByRole('heading', { name: 'UID' })).toBeNull();
    });

    it('keeps F2 as the in-place name edit in the tree', async () => {
      await setup({ inputs: { folder: 'team-uuid' } });
      await screen.findAllByRole('gridcell');
      const item = await screen.findByRole('treeitem', { name: /^Team/ });
      item.focus();

      fireEvent.keyDown(item, { key: 'F2' });

      expect(await screen.findByRole('textbox', { name: /Rename|Team/ })).toHaveValue('Team');
    });
  });

  describe('the folder tree', () => {
    it('filters the folders by name, keeping a folder that leads to a match, and says when none matches', async () => {
      await setup();
      await screen.findAllByRole('treeitem');
      const filter = screen.getByRole('searchbox', { name: 'Filter the folders' });

      fireEvent.input(filter, { target: { value: 'roast' } });
      await waitFor(() => expect(screen.queryByRole('treeitem', { name: /^Team/ })).toBeNull());
      expect(await screen.findByRole('treeitem', { name: /^Roastery/ })).toBeInTheDocument();
      expect(screen.getByRole('treeitem', { name: /^Products/ })).toBeInTheDocument();

      fireEvent.input(filter, { target: { value: 'zzz' } });
      expect(await screen.findByRole('heading', { level: 3, name: 'No folder matches “zzz”' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));

      await waitFor(() => expect(screen.getByRole('treeitem', { name: /^Team/ })).toBeInTheDocument());
      expect(filter).toHaveValue('');
    });

    it('reveals and expands the open folder', async () => {
      await setup({ inputs: { folder: 'roastery-uuid' } });

      expect(await screen.findByRole('treeitem', { name: /^Roastery/ })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('treeitem', { name: /^Products/ })).toHaveAttribute('aria-expanded', 'true');
    });

    it('creates a folder inline under the open folder and opens it', async () => {
      const { api, navigate } = await setup({ inputs: { folder: 'team-uuid' } });
      await screen.findAllByRole('gridcell');

      fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
      const name = await screen.findByRole('textbox');
      fireEvent.input(name, { target: { value: 'Interns' } });
      fireEvent.keyDown(name, { key: 'Enter' });

      await waitFor(() =>
        expect(api.createFolder).toHaveBeenCalledWith('proj', { displayName: 'Interns', parentFolderUuid: 'team-uuid', scope: 'MEDIA' }),
      );
      await waitFor(() => expect(lastQuery(navigate)).toEqual({ folder: 'new-folder', asset: null }));
    });

    it('refuses a name a sibling already has', async () => {
      await setup();
      await screen.findAllByRole('treeitem');

      fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
      const name = await screen.findByRole('textbox');
      fireEvent.input(name, { target: { value: 'archive' } });
      fireEvent.keyDown(name, { key: 'Enter' });

      expect(await screen.findByText('A folder with this name already exists here.')).toBeInTheDocument();
    });

    it('shows a skeleton while the project is read and an error with Retry when it could not be', async () => {
      const loading = await setup({ tree: [] });
      loading.project.loading.set(true);
      loading.fixture.detectChanges();
      expect(document.querySelector('sf-media-library-tree sf-skeleton')).not.toBeNull();

      loading.project.loading.set(false);
      loading.project.error.set('Could not load project');
      loading.fixture.detectChanges();
      const pane = within(document.querySelector<HTMLElement>('sf-media-library-tree')!);
      const alert = await pane.findByRole('alert');
      expect(alert).toHaveTextContent('Couldn’t load the folders');
      // The library beside it has nothing to show either, and says so with its own Retry.
      const library = within(document.querySelector<HTMLElement>('sf-media-library-main')!);
      expect(library.getByRole('alert')).toHaveTextContent('Couldn’t load the files of All media.');
      loading.project.loadFor.mockClear();

      fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
      expect(loading.project.loadFor).toHaveBeenCalledWith('proj', true);

      loading.project.loadFor.mockClear();
      fireEvent.click(library.getByRole('button', { name: 'Retry' }));
      expect(loading.project.loadFor).toHaveBeenCalledWith('proj', true);
    });
  });

  describe('the drop zone', () => {
    const files = (...names: string[]) => names.map((n) => new File(['x'], n, { type: 'image/jpeg' }));

    it('covers the library while files are dragged over it and names the folder', async () => {
      await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');
      const library = document.querySelector('.library')!;

      fireEvent.dragEnter(library, { dataTransfer: { types: ['Files'] } });

      expect(await screen.findByText('Drop files to upload to Products')).toBeInTheDocument();
      expect(document.querySelector('.drop')).toHaveAttribute('aria-hidden', 'true');
      fireEvent.dragLeave(library, { dataTransfer: { types: ['Files'] } });
      await waitFor(() => expect(screen.queryByText('Drop files to upload to Products')).toBeNull());
    });

    it('stays while the pointer moves over the cards (enter and leave of children balance out)', async () => {
      await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');
      const library = document.querySelector('.library')!;
      const dataTransfer = { types: ['Files'] };

      fireEvent.dragEnter(library, { dataTransfer });
      fireEvent.dragEnter(cards()[0], { dataTransfer });
      fireEvent.dragLeave(library, { dataTransfer });

      expect(await screen.findByText('Drop files to upload to Products')).toBeInTheDocument();
      fireEvent.dragLeave(cards()[0], { dataTransfer });
      await waitFor(() => expect(screen.queryByText('Drop files to upload to Products')).toBeNull());
    });

    it('ignores a drag that carries no files', async () => {
      await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');

      fireEvent.dragEnter(document.querySelector('.library')!, { dataTransfer: { types: ['text/plain'] } });

      expect(screen.queryByText(/Drop files to upload/)).toBeNull();
    });

    it('uploads the dropped files into the open folder and opens the panel', async () => {
      const { api } = await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');
      const library = document.querySelector('.library')!;

      fireEvent.dragEnter(library, { dataTransfer: { types: ['Files'] } });
      fireEvent.drop(library, { dataTransfer: { types: ['Files'], files: files('new-one.jpg', 'new-two.jpg') } });

      expect(api.uploadMediaWithProgress).toHaveBeenCalledTimes(2);
      expect(api.uploadMediaWithProgress.mock.calls[0]).toEqual(['proj', expect.objectContaining({ name: 'new-one.jpg' }), { folderUuid: 'products-uuid' }]);
      expect(await screen.findByRole('heading', { name: 'Uploads to Products' })).toBeInTheDocument();
      expect(screen.queryByText(/Drop files to upload/)).toBeNull();
    });

    it('puts an uploaded file into the grid at once and counts it in the tree', async () => {
      const { api, fixture } = await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');
      const before = cards().length;
      fireEvent.drop(document.querySelector('.library')!, { dataTransfer: { types: ['Files'], files: files('fresh.jpg') } });
      const subject = (api.uploadMediaWithProgress.mock.results[0] as { value: Subject<unknown> }).value;

      subject.next({
        kind: 'done',
        body: { uuid: 'fresh-uuid', uid: 'fresh-jpg', displayName: 'fresh.jpg', mimeType: 'image/jpeg', sizeBytes: 10, revision: 1 },
      });
      fixture.detectChanges();

      await waitFor(() => expect(cards()).toHaveLength(before + 1));
      expect(cardNames()).toContain('fresh.jpg');
    });

    it('takes no files in a read-only project: no overlay, no upload', async () => {
      const { api } = await setup({ inputs: { folder: 'products-uuid' }, readOnly: true });
      await screen.findAllByRole('gridcell');
      const library = document.querySelector('.library')!;

      fireEvent.dragEnter(library, { dataTransfer: { types: ['Files'] } });
      fireEvent.drop(library, { dataTransfer: { types: ['Files'], files: files('x.jpg') } });

      expect(screen.queryByText(/Drop files to upload/)).toBeNull();
      expect(api.uploadMediaWithProgress).not.toHaveBeenCalled();
    });
  });

  describe('keyboard shortcuts on the ? sheet (decision 100)', () => {
    const listed = () => TestBed.inject(ShortcutService).commands();
    const byId = (id: string) => listed().find((def) => def.id === id);

    it('lists the grid keys under "Media files", as screen shortcuts with translated descriptions', async () => {
      await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');

      const grid = listed().filter((def) => def.group === 'mediaGrid');
      expect(grid.map((def) => [def.id, def.keys])).toEqual([
        ['media.gridMove', 'ArrowRight'],
        ['media.gridFirst', 'Home'],
        ['media.gridLast', 'End'],
        ['media.gridSelect', 'Space'],
        ['media.gridAll', 'Mod+A'],
        ['media.gridOpen', 'Enter'],
        ['media.fileRename', 'F2'],
        ['media.fileMenu', 'Shift+F10'],
        ['media.fileDelete', 'Delete'],
      ]);
      expect(grid.every((def) => def.scope === 'screen' && def.description.startsWith('frame.shortcuts.items.'))).toBe(true);
    });

    it('leaves out the grid-only keys in the list view, and rename and delete for someone who cannot change files', async () => {
      await setup({ inputs: { folder: 'products-uuid' }, view: 'list' });
      await screen.findByRole('grid', { name: /./ });

      expect(byId('media.gridMove')).toBeUndefined();
      expect(byId('media.fileMenu')).toBeDefined();
    });

    it('offers no rename or delete key in a read-only project', async () => {
      await setup({ inputs: { folder: 'products-uuid' }, readOnly: true });
      await screen.findAllByRole('gridcell');

      expect(byId('media.fileMenu')).toBeDefined();
      expect(byId('media.fileRename')).toBeUndefined();
      expect(byId('media.fileDelete')).toBeUndefined();
      expect(byId('media.upload')).toBeUndefined();
    });

    it('puts Upload files in the palette, and opens the file picker', async () => {
      await setup({ inputs: { folder: 'products-uuid' } });
      await screen.findAllByRole('gridcell');
      const click = vi.spyOn(HTMLInputElement.prototype, 'click');

      const action = TestBed.inject(ShortcutService).actions().find((def) => def.id === 'media.upload');
      expect(action?.palette?.icon).toBe('upload');
      action!.handler!();

      expect(click).toHaveBeenCalled();
    });
  });
});
