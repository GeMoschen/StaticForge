import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ToastService } from '../../core/ui/toast.service';
import { PageDeleteDialogComponent } from './page-delete-dialog.component';

/** Chooses a row of the asset picker (it lives in the page body, as a dialog does) by double click. */
function pickRow(name: string): void {
  const row = Array.from(document.querySelectorAll('.picker__row')).find((r) => r.textContent?.includes(name)) as HTMLElement;
  row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
}

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
        provideTranslocoTesting(),
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
    pickRow('Saw');
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
      'Deleted “Hammer”. It stays online until you release the deletion.',
    );
  });

  describe('undo', () => {
    const lastToast = () => TestBed.inject(ToastService).toasts().at(-1)!;

    function deleteHammer(): void {
      open(HAMMER_PAGE, []);
      button('Delete').click();
      http.expectOne({ method: 'DELETE', url: `${BASE}/assets/${HAMMER}` }).flush(null, { status: 204, statusText: 'No Content' });
    }

    it('replaces the plain toast by an Undo toast, and Undo restores the page from its last live revision', async () => {
      deleteHammer();
      expect(lastToast().message).toBe('Deleted “Hammer”. It stays online until you release the deletion.');
      expect(lastToast().action).toBeDefined();
      expect(http.match(`${BASE}/assets/${HAMMER}/restore`)).toHaveLength(0);

      lastToast().action!.run();
      // The revision comes from the history at the moment of the Undo, not from the (possibly stale) tree row.
      const history = await vi.waitFor(() => http.expectOne({ method: 'GET', url: `${BASE}/assets/${HAMMER}/history` }));
      history.flush([
        { revision: 9, deleted: true },
        { revision: 7, deleted: false },
        { revision: 6, deleted: false },
      ]);
      const restore = await vi.waitFor(() => http.expectOne({ method: 'POST', url: `${BASE}/assets/${HAMMER}/restore` }));
      expect(restore.request.body).toEqual({ fromRevision: 7 });
      restore.flush({ uuid: HAMMER });
      await vi.waitFor(() => expect(lastToast().message).toBe('Undone.'));
    });

    it('shows the error toast when the restore fails', async () => {
      deleteHammer();

      lastToast().action!.run();
      (await vi.waitFor(() => http.expectOne({ method: 'GET', url: `${BASE}/assets/${HAMMER}/history` }))).flush([
        { revision: 7, deleted: false },
      ]);
      (await vi.waitFor(() => http.expectOne({ method: 'POST', url: `${BASE}/assets/${HAMMER}/restore` }))).flush(
        { detail: 'folder deleted' },
        { status: 409, statusText: 'Conflict' },
      );

      await vi.waitFor(() => expect(lastToast().kind).toBe('error'));
      expect(lastToast().message).toMatch(/Could not undo/);
    });
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
    pickRow('Hammer');
    fixture.detectChanges();
    expect(el().querySelector('sf-redirect-option [role="alert"]')?.textContent).toContain('going offline itself');
    expect(el().querySelector('sf-redirect-option')?.textContent).toContain('Home');
  });

  it('offers no redirect for a page that was never released, nor without the right to unpublish', () => {
    open({ ...HAMMER_PAGE, release: { de: { status: 'NEW' } } });
    expect(el().querySelector('sf-redirect-option')).toBeNull();
    expect(el().textContent).toContain('Delete "Hammer"?');
    expect(el().textContent).not.toContain('This cannot be undone.');
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
