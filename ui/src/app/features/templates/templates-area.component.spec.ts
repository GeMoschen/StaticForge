import '@angular/compiler';
import { ApplicationRef, Component, input } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, type TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/angular';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FavoritesService } from '../../core/assets/favorites.service';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { FavoritesViewComponent } from '../favorites/favorites-view.component';
import { SUMMARIES, TREE } from './templates-fixtures.testing';
import { TemplatesComponent } from './templates.component';
import { TemplatesStore } from './templates.store';
import type { TemplateEntry } from './templates-tree.util';

/** The Templates area (M35.21): the URL is the selection, the tree menu, the New template dialog, rename, Used by and delete. */

const BASE = '/api/v1/projects/proj1';

@Component({ selector: 'sf-favorites-view', standalone: true, template: '<p data-testid="favorites-view"></p>' })
class FavoritesViewStub {}

@Component({ standalone: true, template: '' })
class RouteStub {
  readonly projectKey = input<string>();
}

interface SetupOptions {
  role?: string;
  dev?: boolean;
  inputs?: Record<string, unknown>;
  /** The URL the router starts at (the harness is created before the area: a new fixture removes the earlier ones' DOM). */
  url?: string;
  confirm?: boolean;
  favorites?: unknown[];
}

async function setup(options: SetupOptions = {}) {
  const confirm = vi.fn().mockResolvedValue(options.confirm ?? true);
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([
        { path: 'p/:projectKey/templates/:uuid', component: RouteStub },
        { path: 'p/:projectKey/templates', component: RouteStub },
      ]),
      provideProjectPermissions({ role: () => options.role ?? 'DEVELOPER', readOnly: () => false }),
      { provide: ConfirmService, useValue: { confirm } },
      { provide: DeveloperModeService, useValue: { enabled: () => options.dev ?? false } },
    ],
  });
  TestBed.overrideComponent(TemplatesComponent, {
    remove: { imports: [FavoritesViewComponent] },
    add: { imports: [FavoritesViewStub] },
  });
  const harness = await RouterTestingHarness.create(options.url);
  const fixture = TestBed.createComponent(TemplatesComponent);
  fixture.componentRef.setInput('projectKey', 'proj1');
  for (const [name, value] of Object.entries(options.inputs ?? {})) {
    fixture.componentRef.setInput(name, value);
  }
  const http = TestBed.inject(HttpTestingController);
  const router = TestBed.inject(Router);
  const store = fixture.debugElement.injector.get(TemplatesStore);
  const toasts = TestBed.inject(ToastService);
  if (options.favorites) {
    vi.spyOn(TestBed.inject(FavoritesService), 'list').mockReturnValue(options.favorites as never);
  }
  return { fixture, harness, http, router, store, toasts, confirm, instance: fixture.componentInstance as unknown as AreaInstance };
}

interface AreaInstance {
  menuItems(nodes: unknown[]): { label: string; shortcut?: string; children?: { label: string }[]; action?: () => void }[];
  allowAction(action: string, nodes: unknown[]): boolean;
  canDrop(dragged: unknown[], target: unknown): boolean;
  index(): { entries: Map<string, TemplateEntry> };
  openNewTemplate(folder: string | null, kind: 'page' | 'section' | 'dataset' | null): Promise<void>;
  openRename(entry: TemplateEntry): void;
  showUsedBy(uuid: string): Promise<void>;
  onDelete(request: unknown): void;
  confirmDelete(nodes: unknown[]): Promise<boolean>;
  validateName(name: string, context: unknown): string | null;
  newItems(): { id: string; label: string; disabledReason?: string }[];
}

/** Answers what the area reads: the folder tree, the two template lists, the datasets and the rest as empty. */
function answer(req: TestRequest): void {
  const url = req.request.url;
  const summaries = SUMMARIES.filter((s) => s.folderPath !== '/templates_root/nowhere/');
  if (url.includes('/folders?scope=TEMPLATES')) {
    req.flush(TREE);
  } else if (url.endsWith('/page-templates')) {
    req.flush({ content: summaries.filter((s) => s.assetType === 'PAGE_TEMPLATE') });
  } else if (url.endsWith('/section-templates')) {
    req.flush({ content: summaries.filter((s) => s.assetType === 'SECTION_TEMPLATE') });
  } else if (url.endsWith('/datasets')) {
    req.flush(summaries.filter((s) => s.assetType === 'DATASET'));
  } else if (url.includes('/folders?scope=') || url.endsWith('/channels') || url.endsWith('/revisions') || url.endsWith('/usages')) {
    req.flush([]);
  } else {
    req.flush({});
  }
}

function settle(fixture: ComponentFixture<unknown>, http: HttpTestingController): void {
  fixture.detectChanges();
  // The tree reveals the open item after the next render.
  TestBed.inject(ApplicationRef).tick();
  for (let round = 0; round < 3; round++) {
    for (const req of http.match((r) => r.method === 'GET' && !/-templates\/[\w-]+$/.test(r.url))) {
      answer(req);
    }
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();
  }
}

/** Waits for the area to show something: the fixture does not detect changes by itself. */
const until = (fixture: ComponentFixture<unknown>, assertion: () => void) =>
  waitFor(() => {
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();
    assertion();
  });

const rowNames = () => screen.queryAllByRole('treeitem').map((row) => row.querySelector('.sf-tree__name')?.textContent?.trim());
const selectedRows = () =>
  screen.queryAllByRole('treeitem', { selected: true }).map((row) => row.querySelector('.sf-tree__name')?.textContent?.trim());
const lastToast = (toasts: ToastService) => toasts.toasts().at(-1)!;

describe('the Templates area', () => {
  beforeEach(() => vi.restoreAllMocks());

  describe('the tree', () => {
    it('shows the three fixed folders on top, in the order page templates, section templates, datasets', async () => {
      const { fixture, http } = await setup();
      settle(fixture, http);

      await waitFor(() => expect(rowNames()).toEqual(['Page Templates', 'Section Templates', 'Datasets']));
    });

    it('selects the open folder (?folder=) and shows its table', async () => {
      const { fixture, http } = await setup({ inputs: { folder: 'blog' } });
      settle(fixture, http);

      expect(await screen.findByRole('heading', { level: 1, name: 'Blog' })).toBeTruthy();
      await until(fixture, () => expect(selectedRows()).toEqual(['Blog']));
    });

    it('opens the datasets folder for ?kind=DATASET (the Content store links there)', async () => {
      const { fixture, http } = await setup({ inputs: { kind: 'DATASET' } });
      settle(fixture, http);

      expect(await screen.findByRole('heading', { level: 1, name: 'Datasets' })).toBeTruthy();
      expect((await screen.findAllByText('Products')).length).toBeGreaterThan(0);
    });

    it('shows the Favorites list for ?favorites=1', async () => {
      const { fixture, http } = await setup({ inputs: { favorites: '1' } });
      settle(fixture, http);

      expect(await screen.findByTestId('favorites-view')).toBeTruthy();
      expect(screen.queryByRole('heading', { level: 1, name: 'Templates' })).toBeNull();
    });

    it('has one selection: the open template, not its folder as well', async () => {
      const { fixture, http, store } = await setup({ url: '/p/proj1/templates/article' });
      settle(fixture, http);

      expect(store.selectedUuid()).toBe('article');
      // The tree opens the folders above the open template.
      await until(fixture, () => expect(selectedRows()).toEqual(['Article']));
    });

    it('the URL is the selection: another template, a folder, and back', async () => {
      const { fixture, http, store, harness } = await setup({ url: '/p/proj1/templates/article' });
      settle(fixture, http);
      expect(store.selectedUuid()).toBe('article');

      await harness.navigateByUrl('/p/proj1/templates/teaser');
      fixture.detectChanges();
      expect(store.selectedUuid()).toBe('teaser');

      await harness.navigateByUrl('/p/proj1/templates');
      fixture.detectChanges();
      expect(store.selectedUuid()).toBeNull();
    });

    it('moves an old ?asset= link to the template\'s route (search, recents)', async () => {
      const { fixture, http, router } = await setup({ inputs: { asset: 'article' } });
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      settle(fixture, http);

      await waitFor(() => expect(navigate).toHaveBeenCalledWith(['/p', 'proj1', 'templates', 'article'], { replaceUrl: true }));
    });

    it('opens a template on its route and a folder in ?folder=', async () => {
      const { fixture, http, router } = await setup();
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      settle(fixture, http);
      await waitFor(() => expect(rowNames().length).toBe(3));

      fireEvent.click(screen.getByRole('treeitem', { name: /^Section Templates/ }));
      expect(navigate).toHaveBeenLastCalledWith(['/p', 'proj1', 'templates'], { queryParams: { folder: 'st' } });

      fireEvent.keyDown(screen.getByRole('treeitem', { name: /^Section Templates/ }), { key: 'ArrowRight' });
      await until(fixture, () => expect(screen.getByRole('treeitem', { name: /^Teaser/ })).toBeTruthy());
      fireEvent.click(screen.getByRole('treeitem', { name: /^Teaser/ }));
      expect(navigate).toHaveBeenLastCalledWith(['/p', 'proj1', 'templates', 'teaser']);
    });
  });

  describe('the tree menu (gate decision 157)', () => {
    const node = (instance: AreaInstance, uuid: string) => ({ id: uuid, label: instance.index().entries.get(uuid)!.name, data: instance.index().entries.get(uuid) });

    async function ready(options: SetupOptions = {}) {
      const area = await setup(options);
      settle(area.fixture, area.http);
      await waitFor(() => expect(area.instance.index().entries.size).toBeGreaterThan(0));
      return area;
    }

    it('a template has Duplicate, Rename…, Move to…, Used by and Add to favorites (Delete is the tree\'s own)', async () => {
      const { instance } = await ready();
      expect(instance.menuItems([node(instance, 'article')]).map((item) => item.label)).toEqual([
        'Duplicate',
        'Rename…',
        'Move to…',
        'Used by',
        'Add “Article” to favorites',
      ]);
    });

    it('a folder has New ▸ with the kind named in every entry, Rename…, Move to… and Add to favorites', async () => {
      const { instance } = await ready();
      const items = instance.menuItems([node(instance, 'blog')]);

      expect(items.map((item) => item.label)).toEqual(['New', 'Rename…', 'Move to…', 'Add “Blog” to favorites']);
      expect(items[0].children!.map((child) => child.label)).toEqual(['Page template', 'Section template', 'Dataset', 'Folder']);
      expect(items[1].shortcut).toBe('F2');
    });

    it('a fixed top-level folder is never renamed or moved', async () => {
      const { instance } = await ready();
      const items = instance.menuItems([node(instance, 'pt')]);

      expect(items.map((item) => item.label)).toEqual(['New', 'Add “Page Templates” to favorites']);
      expect(instance.allowAction('delete', [node(instance, 'pt')])).toBe(false);
      expect(instance.allowAction('rename', [node(instance, 'pt')])).toBe(false);
      expect(instance.allowAction('create', [node(instance, 'pt')])).toBe(true);
      expect(instance.allowAction('create', [node(instance, 'article')])).toBe(false);
    });

    it('offers a viewer only Used by and favorites, and no editing at all', async () => {
      const { instance } = await ready({ role: 'EDITOR' });
      expect(instance.menuItems([node(instance, 'article')]).map((item) => item.label)).toEqual(['Used by', 'Add “Article” to favorites']);
      expect(instance.menuItems([node(instance, 'blog')]).map((item) => item.label)).toEqual(['Add “Blog” to favorites']);
      expect(instance.allowAction('delete', [node(instance, 'article')])).toBe(false);
    });

    it('drops only into a folder of the same kind', async () => {
      const { instance } = await ready();
      expect(instance.canDrop([node(instance, 'article')], node(instance, 'blog'))).toBe(true);
      expect(instance.canDrop([node(instance, 'article')], node(instance, 'st'))).toBe(false);
      expect(instance.canDrop([node(instance, 'article')], node(instance, 'products'))).toBe(false);
      expect(instance.canDrop([node(instance, 'article')], null)).toBe(false);
      expect(instance.canDrop([node(instance, 'pt')], node(instance, 'blog'))).toBe(false);
    });

    it('checks that a folder name is free among its sibling folders', async () => {
      const { instance } = await ready();
      expect(instance.validateName('blog', { mode: 'create', node: null, parent: node(instance, 'pt'), kind: 'folder' })).toBe(
        'A folder with this name already exists here.',
      );
      expect(instance.validateName('News', { mode: 'create', node: null, parent: node(instance, 'pt'), kind: 'folder' })).toBeNull();
    });

    it('Duplicate reads the template and creates "<name> copy" next to it', async () => {
      const { instance, http, toasts } = await ready();
      instance.menuItems([node(instance, 'article')])[0].action!();

      const read = await vi.waitFor(() => http.expectOne({ method: 'GET', url: `${BASE}/page-templates/article` }));
      read.flush({ contentCdl: '', bodiesCdl: '', rulesCdl: '', channelTemplates: { html: { source: '<p/>' } } });
      const create = await vi.waitFor(() => http.expectOne({ method: 'POST', url: `${BASE}/page-templates` }));
      expect(create.request.body).toMatchObject({ displayName: 'Article copy', parentFolderUuid: 'pt', channelSources: { html: '<p/>' } });
      create.flush({ uuid: 'copy-1' });

      await vi.waitFor(() => expect(lastToast(toasts).message).toBe('Copied “Article”.'));
      expect(lastToast(toasts).action).toBeDefined();
    });
  });

  describe('the New template dialog', () => {
    async function ready() {
      const area = await setup();
      settle(area.fixture, area.http);
      await waitFor(() => expect(area.instance.index().entries.size).toBeGreaterThan(0));
      return area;
    }

    async function fillAndCreate(name: string) {
      const dialog = await screen.findByRole('dialog', { name: 'New template' });
      fireEvent.input(within(dialog).getByRole('textbox', { name: /^Name/ }), { target: { value: name } });
      // The dialog lives outside the fixture: tick the application so Create sees the name.
      TestBed.inject(ApplicationRef).tick();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
      return dialog;
    }

    it('from a New ▸ kind entry the kind is what was picked, and it is created in the folder it started from', async () => {
      const { instance, http, router, toasts } = await ready();
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      void instance.openNewTemplate('blog', 'page');
      const dialog = await screen.findByRole('dialog', { name: 'New template' });
      expect(within(dialog).getByRole('radio', { name: 'Page template' })).toBeChecked();
      expect(within(dialog).getByText('Created in Blog.')).toBeInTheDocument();
      await fillAndCreate('Landing');

      const create = await vi.waitFor(() => http.expectOne({ method: 'POST', url: `${BASE}/page-templates` }));
      expect(create.request.body).toMatchObject({ displayName: 'Landing', parentFolderUuid: 'blog' });
      create.flush({ uuid: 'new-1', uid: 'landing' });
      await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(['/p', 'proj1', 'templates', 'new-1']));
      expect(lastToast(toasts).message).toBe('Created “Landing”.');
    });

    it('a kind that does not belong in the folder it started from goes into the fixed folder of its kind', async () => {
      const { instance, http, store, router } = await ready();
      vi.spyOn(router, 'navigate').mockResolvedValue(true);

      void instance.openNewTemplate('blog', 'section');
      const dialog = await screen.findByRole('dialog', { name: 'New template' });
      expect(within(dialog).getByText('Created in Section Templates.')).toBeInTheDocument();
      await fillAndCreate('Hero');

      const create = await vi.waitFor(() => http.expectOne({ method: 'POST', url: `${BASE}/section-templates` }));
      expect(create.request.body).toMatchObject({ displayName: 'Hero', parentFolderUuid: 'st' });
      create.flush({ uuid: 'new-2', uid: 'hero' });
      // The new template is in the list before it is read again, so opening it uses the section endpoint.
      await vi.waitFor(() => expect(store.templates().some((t) => t.uuid === 'new-2' && t.assetType === 'SECTION_TEMPLATE')).toBe(true));
    });

    it('from the header button nothing is chosen, never the selection\'s kind, and a dataset starts with one field', async () => {
      const { instance, http } = await ready();

      void instance.openNewTemplate('blog', null);
      const dialog = await screen.findByRole('dialog', { name: 'New template' });
      for (const label of ['Page template', 'Section template', 'Dataset']) {
        expect(within(dialog).getByRole('radio', { name: label })).not.toBeChecked();
      }
      fireEvent.click(within(dialog).getByRole('radio', { name: 'Dataset' }));
      await fillAndCreate('Team');

      const create = await vi.waitFor(() => http.expectOne({ method: 'POST', url: `${BASE}/datasets` }));
      expect(create.request.body).toMatchObject({ displayName: 'Team', parentFolderUuid: 'ds', titleEditor: 'name' });
      expect((create.request.body as { contentCdl: string }).contentCdl).toContain('editor text name');
      create.flush({ uuid: 'new-3', uid: 'team' });
    });

    it('is not offered to a viewer', async () => {
      const { instance } = await setup({ role: 'EDITOR' });
      void instance.openNewTemplate('blog', 'page');
      expect(screen.queryByRole('dialog', { name: 'New template' })).toBeNull();
    });

    it('the head\'s New menu names the kind in every entry and cannot make a folder at the top level', async () => {
      const { instance } = await ready();
      expect(instance.newItems().map((item) => item.label)).toEqual(['Page template', 'Section template', 'Dataset', 'Folder']);
      expect(instance.newItems().at(-1)!.disabledReason).toBeTruthy();
    });
  });

  describe('rename, Used by and delete', () => {
    async function ready(options: SetupOptions = {}) {
      const area = await setup(options);
      settle(area.fixture, area.http);
      await waitFor(() => expect(area.instance.index().entries.size).toBeGreaterThan(0));
      return area;
    }

    it('Rename… is the rename dialog: name with Save, the UID on its own, and an Undo toast', async () => {
      const { instance, http, toasts, fixture } = await ready();

      instance.openRename(instance.index().entries.get('article')!);
      // The dialog fills its draft from an effect: a second pass shows it.
      fixture.detectChanges();
      fixture.detectChanges();
      const dialog = await screen.findByRole('dialog', { name: 'Rename' });
      const field = within(dialog).getByRole('textbox', { name: 'Display name' });
      expect(field).toHaveValue('Article');
      expect(within(dialog).getByText('article')).toBeInTheDocument();
      fireEvent.input(field, { target: { value: 'Story' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

      const rename = await vi.waitFor(() => http.expectOne({ method: 'PATCH', url: `${BASE}/assets/article/display-name` }));
      expect(rename.request.body).toEqual({ displayName: 'Story' });
      rename.flush({ revision: 5 });
      await vi.waitFor(() => expect(lastToast(toasts).message).toBe('Renamed “Article” to “Story”.'));
      lastToast(toasts).action!.run();
      const back = await vi.waitFor(() => http.expectOne({ method: 'PATCH', url: `${BASE}/assets/article/display-name` }));
      expect(back.request.body).toEqual({ displayName: 'Article' });
      back.flush({ revision: 6 });
    });

    it('does not rename a fixed top-level folder', async () => {
      const { instance, fixture } = await ready();
      instance.openRename(instance.index().entries.get('pt')!);
      fixture.detectChanges();
      expect(screen.queryByRole('dialog', { name: 'Rename' })).toBeNull();
    });

    it('Used by lists the pages, templates and record sets that use it, each with a type and a link', async () => {
      const { instance, http, fixture } = await ready();

      const shown = instance.showUsedBy('article');
      const usages = await vi.waitFor(() => http.expectOne({ method: 'GET', url: `${BASE}/assets/article/usages` }));
      usages.flush([
        { fromType: 'PAGE', fromUuid: 'p1', fromUid: 'home', sourcePath: 'template' },
        { fromType: 'PAGE_TEMPLATE', fromUuid: 'post', fromUid: 'post' },
        { fromType: 'RECORD_SET', fromUuid: 'rs1', fromUid: 'team' },
      ]);
      await shown;
      fixture.detectChanges();

      expect(await screen.findByText('Used by — Article')).toBeTruthy();
      expect(await screen.findByText('Page')).toBeTruthy();
      expect(screen.getByText('Template')).toBeTruthy();
      expect(screen.getByText('Record set')).toBeTruthy();
      expect(screen.getByRole('link', { name: 'home' })).toHaveAttribute('href', '/p/proj1/pages/p1');
      expect(screen.getByRole('link', { name: 'post' })).toHaveAttribute('href', '/p/proj1/templates/post');
      expect(screen.getByRole('link', { name: 'team' })).toHaveAttribute('href', '/p/proj1/content/sets/rs1');
    });

    it('Used by says "Not used yet" for a template nothing uses, and says so when the lookup fails', async () => {
      const { instance, http, toasts, fixture } = await ready();

      const shown = instance.showUsedBy('post');
      (await vi.waitFor(() => http.expectOne({ method: 'GET', url: `${BASE}/assets/post/usages` }))).flush([]);
      await shown;
      fixture.detectChanges();
      expect(await screen.findByText('Not used yet')).toBeTruthy();

      const failed = instance.showUsedBy('teaser');
      (await vi.waitFor(() => http.expectOne({ method: 'GET', url: `${BASE}/assets/teaser/usages` }))).flush({}, { status: 500, statusText: 'Server Error' });
      await failed;
      expect(toasts.toasts().some((t) => t.kind === 'error')).toBe(true);
    });

    it('Used by is asked through the store (the table\'s count, the header) and opens once', async () => {
      const { store, http, fixture } = await ready();

      store.usedByUuid.set('teaser');
      fixture.detectChanges();

      (await vi.waitFor(() => http.expectOne({ method: 'GET', url: `${BASE}/assets/teaser/usages` }))).flush([]);
      await new Promise((resolve) => setTimeout(resolve, 20));
      fixture.detectChanges();
      expect(await screen.findByText('Used by — Teaser')).toBeTruthy();
      expect(store.usedByUuid()).toBeNull();
    });

    it('deleting from the tree asks naming what uses it, deletes, and Undo restores through the tree\'s toast', async () => {
      const { instance, http, confirm } = await ready();
      const node = { id: 'teaser', label: 'Teaser', data: instance.index().entries.get('teaser') };
      const completed = vi.fn();

      const asked = instance.confirmDelete([node]);
      (await vi.waitFor(() => http.expectOne({ method: 'GET', url: `${BASE}/assets/teaser/usages` }))).flush([{ fromType: 'PAGE', fromUuid: 'p1' }]);
      expect(await asked).toBe(true);
      expect(confirm.mock.calls[0][0].message).toContain('In use by 1 page.');

      instance.onDelete({ nodes: [node], completed });
      (await vi.waitFor(() => http.expectOne({ method: 'DELETE', url: `${BASE}/section-templates/teaser` }))).flush(null);
      await vi.waitFor(() => expect(completed).toHaveBeenCalledWith(expect.any(Function)));
    });
  });
});
