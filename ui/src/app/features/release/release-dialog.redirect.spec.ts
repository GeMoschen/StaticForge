import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ToastService } from '../../core/ui/toast.service';
import { ReleaseDialogComponent } from './release-dialog.component';
import type { ReleaseChoice } from './release-choice.util';

type AssetSummaryView = components['schemas']['AssetSummaryView'];
type ChannelView = components['schemas']['ChannelView'];
type ReleaseResultView = components['schemas']['ReleaseResultView'];
type RedirectView = components['schemas']['RedirectView'];
type ReleasePlanView = components['schemas']['ReleasePlanView'];
type FolderView = components['schemas']['FolderView'];

const BASE = '/api/v1/projects/proj';
const HAMMER = '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1a01';
const PRODUCTS = '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1a02';
const CATALOGUE = '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1a03';

// GET /pages as PageController#list sends it: folder paths under the pages root and release blocks per locale key.
const PAGES: AssetSummaryView[] = [
  { uuid: 'root', uid: 'index', type: 'PAGE', displayName: 'Home', folderPath: '/pages_root/', revision: 2, release: { '': { status: 'PUBLISHED' } } },
  { uuid: PRODUCTS, uid: 'index', type: 'PAGE', displayName: 'Products', folderPath: '/pages_root/products/', revision: 4, release: { '': { status: 'PUBLISHED' } } },
  { uuid: CATALOGUE, uid: 'catalogue', type: 'PAGE', displayName: 'Catalogue', folderPath: '/pages_root/products/', revision: 7, release: { '': { status: 'PUBLISHED' } } },
  { uuid: 'tools-index', uid: 'index', type: 'PAGE', displayName: 'Tools', folderPath: '/pages_root/products/tools/', revision: 5, release: { '': { status: 'NEW' } } },
  { uuid: HAMMER, uid: 'hammer', type: 'PAGE', displayName: 'Hammer', folderPath: '/pages_root/products/tools/', revision: 6, release: { '': { status: 'PUBLISHED' } } },
];

/** GET /folders?scope=PAGES as FolderController#list sends it: the protected pages root and its subtree (M31). */
function folders(productsStartPage?: string): FolderView[] {
  const tools: FolderView = { uuid: 'tools-f', uid: 'tools', displayName: 'Tools', path: '/pages_root/products/tools/', scope: 'PAGES', protectedFolder: false, type: 'FOLDER', revision: 3, children: [] };
  const products: FolderView = { uuid: 'products-f', uid: 'products', displayName: 'Products', path: '/pages_root/products/', scope: 'PAGES', protectedFolder: false, type: 'FOLDER', revision: 4, startPageUuid: productsStartPage, children: [tools] };
  return [{ uuid: 'pages-root', uid: 'pages_root', displayName: 'All Pages', path: '/pages_root/', scope: 'PAGES', protectedFolder: true, type: 'FOLDER', revision: 1, children: [products] }];
}
const CHANNELS: ChannelView[] = [{ key: 'html', name: 'Website', fileExtension: 'html', isDefault: true, enabled: true }];

/** An unpublish choice as the release bar builds it for the page open in the editor. */
const HAMMER_CHOICE: ReleaseChoice = {
  assetUuid: HAMMER,
  locale: '',
  label: 'All languages — Published',
  status: 'PUBLISHED',
  checked: true,
  assetType: 'PAGE',
  assetName: 'Hammer',
  folderPath: '/pages_root/products/tools/',
};

const UNPUBLISHED: ReleaseResultView = {
  revision: 12,
  applied: [{ uuid: HAMMER, type: 'PAGE', uid: 'hammer', displayName: 'Hammer', status: 'UNPUBLISHED', versionId: 9 }],
  skipped: [],
};

// What POST /redirects/for-asset answers: the manual redirects it wrote (shadowed until a build drops the page).
const WRITTEN: RedirectView[] = [
  {
    id: 31,
    channel: 'html',
    locale: '',
    fromPath: 'products/tools/hammer.html',
    toAssetUuid: PRODUCTS,
    toPageNumber: 1,
    toAssetName: 'Products',
    kind: 'MANUAL',
    state: 'SHADOWED',
    resolvedTarget: 'products/index.html',
    createdAt: '2026-09-27T10:00:00Z',
    createdBy: 1,
    version: 0,
  },
];

describe('ReleaseDialogComponent — "Redirect old URL to…"', () => {
  let fixture: ComponentFixture<ReleaseDialogComponent>;
  let http: HttpTestingController;

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function open(
    mode: 'release' | 'unpublish',
    choices: ReleaseChoice[],
    rights: { role: string; permissions: string[] } = { role: 'EDITOR', permissions: ['RELEASE'] },
  ): void {
    TestBed.configureTestingModule({
      imports: [ReleaseDialogComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideProjectPermissions({ role: () => rights.role, permissions: () => rights.permissions, readOnly: () => false }),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ReleaseDialogComponent);
    fixture.componentRef.setInput('projectKey', 'proj');
    fixture.componentRef.setInput('mode', mode);
    fixture.componentRef.setInput('choices', choices);
    fixture.componentRef.setInput('subjectName', 'Hammer');
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

  function flushPreselection(pages: AssetSummaryView[] = PAGES, tree: FolderView[] = folders()): void {
    http.expectOne(`${BASE}/pages`).flush(pages);
    http.expectOne(`${BASE}/channels`).flush(CHANNELS);
    const folderRequest = http.expectOne((r) => r.url === `${BASE}/folders`);
    expect(folderRequest.request.params.get('scope')).toBe('PAGES');
    folderRequest.flush(tree);
    fixture.detectChanges();
  }

  function tickRedirect(): void {
    const checkbox = el().querySelector('sf-redirect-option input[type="checkbox"]') as HTMLInputElement;
    checkbox.click();
    fixture.detectChanges();
  }

  it('preselects the nearest online folder index page and redirects only after the unpublish succeeded', () => {
    open('unpublish', [HAMMER_CHOICE]);
    flushPreselection();
    expect(el().querySelector('sf-redirect-option')?.textContent).toContain('Redirect old URL to…');
    tickRedirect();
    // The tools index was never released: the products index is the nearest one online.
    expect(el().querySelector('sf-redirect-option')?.textContent).toContain('Products');

    const toasts = TestBed.inject(ToastService);
    button('Unpublish').click();
    const unpublish = http.expectOne({ method: 'POST', url: `${BASE}/releases/unpublish` });
    expect(unpublish.request.body.items).toEqual([{ assetUuid: HAMMER }]);
    // Nothing is redirected before the unpublish has succeeded.
    expect(http.match(`${BASE}/redirects/for-asset`)).toHaveLength(0);
    unpublish.flush(UNPUBLISHED);

    const redirect = http.expectOne({ method: 'POST', url: `${BASE}/redirects/for-asset` });
    expect(redirect.request.body).toEqual({ assetUuid: HAMMER, toAssetUuid: PRODUCTS });
    redirect.flush(WRITTEN);
    const hint = toasts.toasts().find((toast) => toast.message.includes('redirects to “Products”'));
    expect(hint?.kind).toBe('info');
    expect(hint?.message).toContain('once a build no longer contains the page');
    expect(hint?.message).toContain('Shadowed');
  });

  it('preselects a folder’s start page over its index UID page (M31)', () => {
    open('unpublish', [HAMMER_CHOICE]);
    flushPreselection(PAGES, folders(CATALOGUE));
    tickRedirect();
    expect(el().querySelector('sf-redirect-option')?.textContent).toContain('Catalogue');
    button('Unpublish').click();
    http.expectOne(`${BASE}/releases/unpublish`).flush(UNPUBLISHED);
    const redirect = http.expectOne({ method: 'POST', url: `${BASE}/redirects/for-asset` });
    expect(redirect.request.body).toEqual({ assetUuid: HAMMER, toAssetUuid: CATALOGUE });
    redirect.flush([]);
  });

  it('keeps the unpublish and warns with a link to the Redirects tab when the redirect fails', () => {
    open('unpublish', [HAMMER_CHOICE]);
    flushPreselection();
    tickRedirect();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const toasts = TestBed.inject(ToastService);
    button('Unpublish').click();
    http.expectOne(`${BASE}/releases/unpublish`).flush(UNPUBLISHED);
    http
      .expectOne(`${BASE}/redirects/for-asset`)
      .flush(
        { status: 422, code: 'SF-DOM-0194', detail: 'The page has no published output to redirect.' },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
    expect(toasts.toasts().some((toast) => toast.message.startsWith('Unpublished in r12'))).toBe(true);
    const warning = toasts.toasts().find((toast) => toast.kind === 'warning');
    expect(warning?.message).toContain('The page has no published output to redirect.');
    expect(warning?.action?.label).toBe('Open Redirects');
    warning!.action!.run();
    expect(navigate).toHaveBeenCalledWith(['/p', 'proj', 'settings', 'redirects']);
  });

  it('needs a page once the option is ticked; nothing preselected when no folder above has an online index', () => {
    open('unpublish', [HAMMER_CHOICE]);
    flushPreselection(PAGES.filter((page) => page.uid !== 'index'));
    expect(button('Unpublish').disabled).toBe(false);
    tickRedirect();
    expect(el().querySelector('sf-redirect-option')?.textContent).toContain('No page chosen');
    expect(button('Unpublish').disabled).toBe(true);
    // Unticked again, the unpublish goes ahead without a redirect.
    tickRedirect();
    button('Unpublish').click();
    http.expectOne(`${BASE}/releases/unpublish`).flush(UNPUBLISHED);
    expect(http.match(`${BASE}/redirects/for-asset`)).toHaveLength(0);
  });

  it('is not offered without the right to unpublish, nor for other asset types', () => {
    open('unpublish', [HAMMER_CHOICE], { role: 'EDITOR', permissions: [] });
    expect(el().querySelector('sf-redirect-option')).toBeNull();
    TestBed.resetTestingModule();

    open('unpublish', [{ ...HAMMER_CHOICE, assetType: 'MEDIA' }]);
    expect(el().querySelector('sf-redirect-option')).toBeNull();
    TestBed.resetTestingModule();

    // A developer may redirect whatever the publish policy says.
    open('unpublish', [HAMMER_CHOICE], { role: 'DEVELOPER', permissions: [] });
    flushPreselection();
    expect(el().querySelector('sf-redirect-option')).not.toBeNull();
  });

  it('is offered when a release publishes a page’s deletion (Changes view)', () => {
    vi.useFakeTimers();
    open('release', [{ ...HAMMER_CHOICE, status: 'DELETION_PENDING', label: 'Hammer — Deletion pending' }]);
    flushPreselection();
    vi.advanceTimersByTime(300);
    const plan: ReleasePlanView = {
      items: [{ uuid: HAMMER, type: 'PAGE', uid: 'hammer', displayName: 'Hammer', status: 'DELETION_PENDING', versionId: 9 }],
      dependencies: [],
      incomplete: [],
      warnings: [],
    };
    http.expectOne(`${BASE}/releases/plan`).flush(plan);
    fixture.detectChanges();
    expect(el().querySelector('sf-redirect-option')).not.toBeNull();
  });
});
