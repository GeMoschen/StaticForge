import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ToastService } from '../../core/ui/toast.service';
import { stubReleaseBar } from '../release/testing/release-bar.stub';
import { FolderDetailComponent } from './folder-detail.component';

type FolderView = components['schemas']['FolderView'];
type AssetSummaryView = components['schemas']['AssetSummaryView'];

const BASE = '/api/v1/projects/proj';
const HOME = '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1b01';
const INDEX = '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1b02';
const ABOUT = '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1b03';

// GET /folders?scope=PAGES as FolderController#list sends it (M31.1: `startPageUuid` is the folder's draft pointer).
const PAGES_ROOT: FolderView = {
  uuid: '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1a00',
  uid: 'pages_root',
  displayName: 'All Pages',
  path: '/pages_root/',
  scope: 'PAGES',
  protectedFolder: true,
  type: 'FOLDER',
  revision: 7,
  children: [],
  scheduled: [],
};
const PRODUCTS: FolderView = {
  uuid: '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1a10',
  uid: 'products',
  displayName: 'Products',
  path: '/pages_root/products/',
  scope: 'PAGES',
  protectedFolder: false,
  type: 'FOLDER',
  revision: 12,
  startPageUuid: ABOUT,
  children: [],
  release: { '': { status: 'PUBLISHED', releasedRevision: 12 } },
  scheduled: [],
};

// GET /pages summaries of the pages directly in the pages root.
const ROOT_PAGES: AssetSummaryView[] = [
  { uuid: HOME, uid: 'homepage', type: 'PAGE', displayName: 'Homepage', folderPath: '/pages_root/', revision: 5 },
  { uuid: INDEX, uid: 'index', type: 'PAGE', displayName: 'Old home', folderPath: '/pages_root/', revision: 3 },
];
const PRODUCT_PAGES: AssetSummaryView[] = [
  { uuid: ABOUT, uid: 'about', type: 'PAGE', displayName: 'About', folderPath: '/pages_root/products/', revision: 9 },
];

describe('FolderDetailComponent — start page (M31)', () => {
  let fixture: ComponentFixture<FolderDetailComponent>;
  let http: HttpTestingController;
  let changed: number;

  beforeEach(() => stubReleaseBar(FolderDetailComponent));

  afterEach(() => http.verify());

  function open(
    folder: FolderView,
    pages: AssetSummaryView[],
    options: { role?: string; archived?: boolean } = {},
  ): void {
    TestBed.configureTestingModule({
      imports: [FolderDetailComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideProjectPermissions({ role: () => options.role ?? 'EDITOR' }),
      ],
    });
    if (options.archived) {
      TestBed.inject(ProjectAccessStore).enterProject('proj', true);
    }
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(FolderDetailComponent);
    fixture.componentRef.setInput('projectKey', 'proj');
    fixture.componentRef.setInput('folder', folder);
    fixture.componentRef.setInput('pages', pages);
    changed = 0;
    fixture.componentInstance.changed.subscribe(() => changed++);
    fixture.detectChanges();
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function select(): HTMLSelectElement {
    return el().querySelector('select') as HTMLSelectElement;
  }

  function choose(value: string): void {
    select().value = value;
    select().dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function optionLabels(): string[] {
    return Array.from(select().options).map((option) => option.textContent?.trim() ?? '');
  }

  it('offers the folder’s own pages and None, with the current start page selected', () => {
    open(PRODUCTS, PRODUCT_PAGES);
    expect(el().textContent).toContain("Renders as this folder's index.html.");
    expect(optionLabels()).toEqual(['— None (index page UID rule) —', 'About']);
    expect(select().value).toBe(ABOUT);
    expect(select().disabled).toBe(false);
  });

  it('saves the chosen page with If-Match and reports the change', () => {
    open(PAGES_ROOT, ROOT_PAGES);
    expect(select().value).toBe('');
    choose(HOME);
    const request = http.expectOne({ method: 'PATCH', url: `${BASE}/folders/${PAGES_ROOT.uuid}` });
    expect(request.request.headers.get('If-Match')).toBe('"rev-7"');
    expect(request.request.body).toEqual({ startPage: HOME });
    request.flush({ ...PAGES_ROOT, revision: 8, startPageUuid: HOME });
    expect(changed).toBe(1);
    expect(TestBed.inject(ToastService).toasts().map((toast) => toast.message)).toContain('Start page set');
  });

  it('clears the start page with an explicit null', () => {
    open(PRODUCTS, PRODUCT_PAGES);
    choose('');
    const request = http.expectOne({ method: 'PATCH', url: `${BASE}/folders/${PRODUCTS.uuid}` });
    expect(request.request.body).toEqual({ startPage: null });
    expect(request.request.headers.get('If-Match')).toBe('"rev-12"');
    request.flush({ ...PRODUCTS, revision: 13, startPageUuid: undefined });
    expect(changed).toBe(1);
  });

  it('names the page that also claims the index file (SF-DOM-0111) and puts the select back', () => {
    open(PAGES_ROOT, ROOT_PAGES);
    choose(HOME);
    http.expectOne(`${BASE}/folders/${PAGES_ROOT.uuid}`).flush(
      {
        type: 'https://cms.example.com/problems/sf-dom-0111',
        title: 'Conflict',
        status: 409,
        detail: "Page 'index' in this folder is also written as the folder's index file. Change its UID first, or make it the start page.",
        code: 'SF-DOM-0111',
        conflictingPageUuid: INDEX,
        conflictingPageUid: 'index',
      },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();
    const alert = el().querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('“Old home” (UID “index”)');
    expect(alert?.textContent).toContain('Change its UID first');
    expect(alert?.querySelector('button')).toBeNull();
    expect(select().value).toBe('');
    expect(changed).toBe(0);
  });

  it('asks to reload when the folder changed meanwhile (stale revision)', () => {
    open(PRODUCTS, PRODUCT_PAGES);
    choose('');
    http.expectOne(`${BASE}/folders/${PRODUCTS.uuid}`).flush(
      { status: 409, code: 'SF-API-0409', detail: 'Stale revision.' },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();
    const alert = el().querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain('changed in the meantime');
    expect(select().value).toBe(ABOUT);
    (Array.from(alert.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Reload') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(changed).toBe(1);
    expect(el().querySelector('[role="alert"]')).toBeNull();
  });

  it('shows the pages root with its start page but without rename, UID change or delete', () => {
    open(PAGES_ROOT, ROOT_PAGES);
    expect(el().querySelector('h2')?.textContent).toContain('All Pages');
    expect(el().querySelector('[aria-label="Rename folder"]')).toBeNull();
    expect(el().querySelector('sf-uid-rename')).toBeNull();
    expect(Array.from(el().querySelectorAll('button')).some((b) => b.textContent?.includes('Delete folder'))).toBe(false);
    expect(el().textContent).toContain('pages_root');
    expect(optionLabels()).toEqual(['— None (index page UID rule) —', 'Homepage', 'Old home']);
  });

  it('keeps an ordinary folder’s rename, UID change and delete', () => {
    open(PRODUCTS, PRODUCT_PAGES);
    expect(el().querySelector('[aria-label="Rename folder"]')).not.toBeNull();
    expect(el().querySelector('sf-uid-rename')).not.toBeNull();
    expect(Array.from(el().querySelectorAll('button')).some((b) => b.textContent?.includes('Delete folder'))).toBe(true);
  });

  it('says when the start page is no longer in the folder', () => {
    open({ ...PRODUCTS, startPageUuid: HOME }, PRODUCT_PAGES);
    expect(select().value).toBe(HOME);
    expect(optionLabels()).toContain('(page no longer in this folder)');
    expect(el().textContent).toContain('no longer in this folder');
  });

  it('is read-only for viewers', () => {
    open(PRODUCTS, PRODUCT_PAGES, { role: 'VIEWER' });
    expect(select().disabled).toBe(true);
  });

  it('is read-only in an archived project', () => {
    open(PAGES_ROOT, ROOT_PAGES, { archived: true });
    expect(select().disabled).toBe(true);
  });
});
