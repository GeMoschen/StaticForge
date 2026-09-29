import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ToastService } from '../../core/ui/toast.service';
import { PageDeleteDialogComponent } from './page-delete-dialog.component';

type AssetSummaryView = components['schemas']['AssetSummaryView'];
type ChannelView = components['schemas']['ChannelView'];
type PageAssetSummaryView = components['schemas']['PageAssetSummaryView'];

const BASE = '/api/v1/projects/proj';
const HAMMER = '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1a01';
const HOME = '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1a03';
const SAW = '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1a09';

// Pages as PageController#list sends them (the tree's summaries have the same shape).
const HAMMER_PAGE: AssetSummaryView = {
  uuid: HAMMER,
  uid: 'hammer',
  type: 'PAGE',
  displayName: 'Hammer',
  folderPath: '/products/tools/',
  revision: 6,
  release: { de: { status: 'PUBLISHED', releasedRevision: 4 }, en: { status: 'CHANGED', releasedRevision: 4 } },
};
const PAGES: AssetSummaryView[] = [
  { uuid: HOME, uid: 'index', type: 'PAGE', displayName: 'Home', folderPath: '/', revision: 2, release: { de: { status: 'PUBLISHED' } } },
  HAMMER_PAGE,
];
const CHANNELS: ChannelView[] = [{ key: 'html', name: 'Website', fileExtension: 'html', isDefault: true, enabled: true }];
const PICKER: PageAssetSummaryView = {
  content: [{ uuid: SAW, uid: 'saw', type: 'PAGE', displayName: 'Saw', folderPath: '/products/tools/' }],
  totalElements: 1,
  totalPages: 1,
};

describe('PageDeleteDialogComponent', () => {
  let fixture: ComponentFixture<PageDeleteDialogComponent>;
  let http: HttpTestingController;
  let deleted: number;

  afterEach(() => http.verify());

  function open(page: AssetSummaryView, permissions: string[] = ['RELEASE']): void {
    TestBed.configureTestingModule({
      imports: [PageDeleteDialogComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideProjectPermissions({ role: () => 'EDITOR', permissions: () => permissions, readOnly: () => false }),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PageDeleteDialogComponent);
    fixture.componentRef.setInput('projectKey', 'proj');
    fixture.componentRef.setInput('page', page);
    deleted = 0;
    fixture.componentInstance.deleted.subscribe(() => deleted++);
    fixture.detectChanges();
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function button(label: string): HTMLButtonElement {
    const found = Array.from(el().querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
    if (!found) {
      throw new Error(`No button "${label}"`);
    }
    return found;
  }

  it('deletes a published page, then redirects its old URLs to the chosen page', () => {
    open(HAMMER_PAGE);
    http.expectOne(`${BASE}/pages`).flush(PAGES);
    http.expectOne(`${BASE}/channels`).flush(CHANNELS);
    fixture.detectChanges();
    expect(el().textContent).toContain('It stays online until you release the deletion.');

    (el().querySelector('sf-redirect-option input[type="checkbox"]') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(el().querySelector('sf-redirect-option')?.textContent).toContain('Home');

    // A page of the user's choice replaces the preselection; the picker opens beside the dialog panel.
    button('Change page…').click();
    fixture.detectChanges();
    http.expectOne((r) => r.url === `${BASE}/assets`).flush(PICKER);
    fixture.detectChanges();
    expect(el().querySelector('.dialog sf-asset-picker-dialog')).toBeNull();
    (Array.from(el().querySelectorAll('.dialog__item')).find((b) => b.textContent?.includes('Saw')) as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el().querySelector('sf-redirect-option')?.textContent).toContain('Saw');

    button('Delete').click();
    const request = http.expectOne({ method: 'DELETE', url: `${BASE}/assets/${HAMMER}` });
    expect(http.match(`${BASE}/redirects/for-asset`)).toHaveLength(0);
    request.flush(null, { status: 204, statusText: 'No Content' });
    const redirect = http.expectOne({ method: 'POST', url: `${BASE}/redirects/for-asset` });
    expect(redirect.request.body).toEqual({ assetUuid: HAMMER, toAssetUuid: SAW });
    redirect.flush([]);
    expect(deleted).toBe(1);
    expect(TestBed.inject(ToastService).toasts().map((t) => t.message)).toContain(
      'Page deleted — it stays online until you release the deletion',
    );
  });

  it('refuses the page being deleted as its own target', () => {
    open(HAMMER_PAGE);
    http.expectOne(`${BASE}/pages`).flush(PAGES);
    http.expectOne(`${BASE}/channels`).flush(CHANNELS);
    (el().querySelector('sf-redirect-option input[type="checkbox"]') as HTMLInputElement).click();
    fixture.detectChanges();
    button('Change page…').click();
    fixture.detectChanges();
    http.expectOne((r) => r.url === `${BASE}/assets`).flush({ ...PICKER, content: [HAMMER_PAGE] });
    fixture.detectChanges();
    (Array.from(el().querySelectorAll('.dialog__item')).find((b) => b.textContent?.includes('Hammer')) as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el().querySelector('sf-redirect-option [role="alert"]')?.textContent).toContain('going offline itself');
    expect(el().querySelector('sf-redirect-option')?.textContent).toContain('Home');
  });

  it('offers no redirect for a page that was never released, nor without the right to unpublish', () => {
    open({ ...HAMMER_PAGE, release: { de: { status: 'NEW' } } });
    expect(el().querySelector('sf-redirect-option')).toBeNull();
    expect(el().textContent).toContain('This cannot be undone.');
    button('Delete').click();
    http.expectOne({ method: 'DELETE', url: `${BASE}/assets/${HAMMER}` }).flush(null, { status: 204, statusText: 'No Content' });
    expect(deleted).toBe(1);
    TestBed.resetTestingModule();

    open(HAMMER_PAGE, []);
    expect(el().querySelector('sf-redirect-option')).toBeNull();
  });

  it('writes no redirect when the delete fails', () => {
    open(HAMMER_PAGE);
    http.expectOne(`${BASE}/pages`).flush(PAGES);
    http.expectOne(`${BASE}/channels`).flush(CHANNELS);
    (el().querySelector('sf-redirect-option input[type="checkbox"]') as HTMLInputElement).click();
    fixture.detectChanges();
    button('Delete').click();
    http.expectOne(`${BASE}/assets/${HAMMER}`).flush({ status: 409, detail: 'Referenced.' }, { status: 409, statusText: 'Conflict' });
    expect(http.match(`${BASE}/redirects/for-asset`)).toHaveLength(0);
    expect(deleted).toBe(0);
  });
});
