import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ToastService } from '../../core/ui/toast.service';
import { ContextMenuService } from '../../shared/services/context-menu.service';
import { PageNavNodeComponent } from './page-nav-node.component';

type FolderView = components['schemas']['FolderView'];
type AssetSummaryView = components['schemas']['AssetSummaryView'];

const BASE = '/api/v1/projects/proj';
const HOME = '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1b01';
const ABOUT = '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1b03';

// GET /folders?scope=PAGES: the protected pages root with its start page pointer (M31.1).
const PAGES_ROOT: FolderView = {
  uuid: '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1a00',
  uid: 'pages_root',
  displayName: 'All Pages',
  path: '/pages_root/',
  scope: 'PAGES',
  protectedFolder: true,
  type: 'FOLDER',
  revision: 7,
  startPageUuid: HOME,
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
  children: [],
  scheduled: [],
};

// GET /pages summaries.
const HOME_PAGE: AssetSummaryView = { uuid: HOME, uid: 'homepage', type: 'PAGE', displayName: 'Homepage', folderPath: '/pages_root/', revision: 5 };
const ABOUT_PAGE: AssetSummaryView = { uuid: ABOUT, uid: 'about', type: 'PAGE', displayName: 'About', folderPath: '/pages_root/products/', revision: 9 };

describe('PageNavNodeComponent — start page (M31)', () => {
  let fixture: ComponentFixture<PageNavNodeComponent>;
  let http: HttpTestingController;
  let changed: number;

  afterEach(() => http.verify());

  function open(page: AssetSummaryView, folder: FolderView, options: { role?: string; readOnly?: boolean } = {}): void {
    TestBed.configureTestingModule({
      imports: [PageNavNodeComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideProjectPermissions({ role: () => options.role ?? 'EDITOR', readOnly: () => options.readOnly ?? false }),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PageNavNodeComponent);
    fixture.componentRef.setInput('projectKey', 'proj');
    fixture.componentRef.setInput('summary', page);
    fixture.componentRef.setInput('folder', folder);
    changed = 0;
    fixture.componentInstance.changed.subscribe(() => changed++);
    fixture.detectChanges();
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function menuLabels(): string[] {
    const row = el().querySelector('.page-nav__row') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    return (TestBed.inject(ContextMenuService).state()?.items ?? []).map((item) => item.label);
  }

  function runMenuItem(label: string): void {
    menuLabels();
    const item = TestBed.inject(ContextMenuService).state()?.items.find((candidate) => candidate.label === label);
    if (!item?.action) {
      throw new Error(`No menu item "${label}"`);
    }
    item.action();
  }

  it('badges the folder’s start page', () => {
    open(HOME_PAGE, PAGES_ROOT);
    expect(el().querySelector('.page-nav__start')?.textContent?.trim()).toBe('Start page');
  });

  it('shows no badge on other pages', () => {
    open(ABOUT_PAGE, PRODUCTS);
    expect(el().querySelector('.page-nav__start')).toBeNull();
  });

  it('makes a page its folder’s start page from the context menu, with If-Match', () => {
    open(ABOUT_PAGE, PRODUCTS);
    runMenuItem('Make start page of Products');
    const request = http.expectOne({ method: 'PATCH', url: `${BASE}/folders/${PRODUCTS.uuid}` });
    expect(request.request.headers.get('If-Match')).toBe('"rev-12"');
    expect(request.request.body).toEqual({ startPage: ABOUT });
    request.flush({ ...PRODUCTS, revision: 13, startPageUuid: ABOUT });
    expect(changed).toBe(1);
    expect(TestBed.inject(ToastService).toasts().map((toast) => toast.message)).toContain('Start page of Products set');
  });

  it('names the pages root "All pages" and offers nothing for its current start page', () => {
    open({ ...HOME_PAGE, uuid: 'other', uid: 'other', displayName: 'Other' }, PAGES_ROOT);
    expect(menuLabels()).toContain('Make start page of All pages');
    TestBed.resetTestingModule();
    open(HOME_PAGE, PAGES_ROOT);
    expect(menuLabels().some((label) => label.startsWith('Make start page'))).toBe(false);
  });

  it('shows an index claim conflict (SF-DOM-0111) with the page to rename', () => {
    open(ABOUT_PAGE, PRODUCTS);
    runMenuItem('Make start page of Products');
    http.expectOne(`${BASE}/folders/${PRODUCTS.uuid}`).flush(
      { status: 409, code: 'SF-DOM-0111', detail: 'Conflict', conflictingPageUuid: 'x', conflictingPageUid: 'index' },
      { status: 409, statusText: 'Conflict' },
    );
    const message = TestBed.inject(ToastService).toasts().find((toast) => toast.kind === 'error')?.message;
    expect(message).toContain('“index”');
    expect(message).toContain('Change its UID first');
    expect(changed).toBe(0);
  });

  it('reloads the tree when the folder changed meanwhile', () => {
    open(ABOUT_PAGE, PRODUCTS);
    runMenuItem('Make start page of Products');
    http.expectOne(`${BASE}/folders/${PRODUCTS.uuid}`).flush(
      { status: 409, code: 'SF-API-0409', detail: 'Stale.' },
      { status: 409, statusText: 'Conflict' },
    );
    expect(changed).toBe(1);
    expect(TestBed.inject(ToastService).toasts().some((toast) => toast.message.includes('changed in the meantime'))).toBe(true);
  });

  it('is not offered to viewers nor while read-only', () => {
    open(ABOUT_PAGE, PRODUCTS, { role: 'VIEWER' });
    expect(menuLabels().some((label) => label.startsWith('Make start page'))).toBe(false);
    TestBed.resetTestingModule();
    open(ABOUT_PAGE, PRODUCTS, { readOnly: true });
    expect(menuLabels().some((label) => label.startsWith('Make start page'))).toBe(false);
  });
});
