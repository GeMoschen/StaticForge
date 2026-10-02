import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { LocalesStore } from '../../core/project/locales.store';
import { MediaDetailDrawerComponent } from './media-detail-drawer.component';
import { localeFileRows } from './media-locale-files.util';
import { MediaItemActions } from './library/media-item-actions';
import { MediaNavNodeComponent } from './media-nav-node.component';

type MediaView = components['schemas']['MediaView'];
type MediaSummaryView = components['schemas']['MediaSummaryView'];

/** `ProjectLocalesView` as `GET /projects/{key}/locales` answers it. */
const LOCALES = {
  locales: [
    { code: 'en', label: 'English' },
    { code: 'de', label: 'German' },
    { code: 'fr', label: 'French' },
  ],
  defaultLocale: 'en',
  fallbacks: { fr: ['de'] },
  defaultWithoutPrefix: true,
};

/**
 * A localized image as `PUT /media/{uuid}/localized` (and every other MediaView answer) returns it — `localeFiles`
 * in the shape of `MediaController#localeFiles`: every project language, own or resolved along its chain.
 */
const LOCALIZED: MediaView = {
  uuid: 'media-1',
  uid: 'hero',
  displayName: 'Hero',
  revision: 3,
  blobSha256: 'sha-en',
  fileName: 'hero.png',
  mimeType: 'image/png',
  sizeBytes: 2048,
  altText: 'Hero',
  altTextL10n: { en: 'Hero' },
  captionL10n: {},
  variants: [],
  processCms: false,
  textEditable: false,
  localized: true,
  localeFiles: {
    en: { own: true, fromLocale: 'en', blobSha256: 'sha-en', fileName: 'hero.png', mimeType: 'image/png', sizeBytes: 2048, processCms: false, textEditable: false },
    de: { own: true, fromLocale: 'de', blobSha256: 'sha-de', fileName: 'hero-de.png', mimeType: 'image/png', sizeBytes: 1258291, processCms: false, textEditable: false },
    fr: { own: false, fromLocale: 'de', blobSha256: 'sha-de', fileName: 'hero-de.png', mimeType: 'image/png', sizeBytes: 1258291, processCms: false, textEditable: false },
  },
  release: { en: { status: 'PUBLISHED', releasedRevision: 2 }, de: { status: 'NEW' }, fr: { status: 'NEW' } },
  scheduled: [],
};

describe('localized media drawer (M27.6.4)', () => {
  let fixture: ComponentFixture<MediaDetailDrawerComponent>;
  let httpMock: HttpTestingController;

  function drain(): void {
    for (const req of httpMock.match((r) => r.method === 'GET')) {
      req.flush(req.request.responseType === 'blob' ? new Blob() : req.request.url.includes('/usages') ? [] : {});
    }
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [MediaDetailDrawerComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(LocalesStore).set('proj1', LOCALES);
    fixture = TestBed.createComponent(MediaDetailDrawerComponent);
    fixture.componentRef.setInput('projectKey', 'proj1');
    fixture.componentRef.setInput('media', LOCALIZED);
    fixture.detectChanges();
    fixture.detectChanges();
    drain();
    fixture.detectChanges();
  });

  afterEach(() => {
    drain();
    httpMock.verify();
  });

  it('turning it off with other language files lists them and resends with confirmDiscard', () => {
    const toggle = el().querySelector<HTMLInputElement>('.localization input[role="switch"]')!;
    expect(toggle.checked).toBe(true);

    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    const first = httpMock.expectOne((r) => r.method === 'PUT' && r.url.endsWith('/media/media-1/localized'));
    expect(first.request.body).toEqual({ localized: false, confirmDiscard: false });
    expect(first.request.headers.get('If-Match')).toBe('"rev-3"');
    first.flush(
      {
        status: 409,
        code: 'SF-MEDIA-0505',
        detail: 'Un-localizing keeps only the default language\'s file; the other language files would be discarded.',
        files: [{ locale: 'de', fileName: 'hero-de.png', sizeBytes: 1258291 }],
      },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();

    const prompt = el().querySelector('.discard-prompt');
    expect(prompt?.textContent).toContain('These files will be discarded: DE hero-de.png (1.2 MB)');

    const confirm = Array.from(prompt!.querySelectorAll('button')).find((b) => b.textContent?.includes('Discard files'))!;
    confirm.click();
    const second = httpMock.expectOne((r) => r.method === 'PUT' && r.url.endsWith('/media/media-1/localized'));
    expect(second.request.body).toEqual({ localized: false, confirmDiscard: true });
    second.flush({ ...LOCALIZED, revision: 4, localized: false, localeFiles: undefined });
    fixture.detectChanges();
    expect(el().querySelector('.discard-prompt')).toBeNull();
  });

  it('labels own and fallback rows: the default file has no Remove, a fallback row offers Upload', () => {
    const rows = Array.from(el().querySelectorAll<HTMLElement>('.locale-file'));
    expect(rows.map((row) => row.dataset['locale'])).toEqual(['en', 'de', 'fr']);

    const [en, de, fr] = rows;
    expect(en.textContent).toContain('hero.png');
    expect(en.textContent).toContain('Replace');
    expect(en.textContent).not.toContain('Remove');

    expect(de.textContent).toContain('hero-de.png');
    expect(de.textContent).toContain('Remove');

    expect(fr.textContent).toContain("Uses German's file");
    expect(fr.textContent).toContain('Upload');
    expect(fr.textContent).not.toContain('Remove');
  });

  it('uploads a file dropped on a language row for that language', () => {
    const fr = el().querySelector<HTMLElement>('.locale-file[data-locale="fr"]')!;
    const file = new File(['x'], 'hero-fr.png', { type: 'image/png' });
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file], types: ['Files'] } });
    fr.dispatchEvent(drop);

    const req = httpMock.expectOne((r) => r.method === 'POST' && r.url.endsWith('/media/media-1/files/fr'));
    expect((req.request.body as FormData).get('file')).toBe(file);
    req.flush({ media: { ...LOCALIZED, revision: 4 }, warnings: [] });
  });
});

describe('localized media without project languages', () => {
  it('hides the switch and the Files section', () => {
    TestBed.configureTestingModule({
      imports: [MediaDetailDrawerComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(MediaDetailDrawerComponent);
    fixture.componentRef.setInput('projectKey', 'proj1');
    fixture.componentRef.setInput('media', { ...LOCALIZED, localized: false, localeFiles: undefined });
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.localization')).toBeNull();
    expect(root.querySelector('.locale-file')).toBeNull();
    for (const req of httpMock.match(() => true)) {
      req.flush(req.request.responseType === 'blob' ? new Blob() : {});
    }
  });
});

describe('media locale files util', () => {
  it('labels a fallback row with the language it uses', () => {
    const rows = localeFileRows(LOCALIZED.localeFiles, LOCALES.locales, 'en');
    expect(rows[2]).toMatchObject({ locale: 'fr', own: false, fallbackText: "Uses German's file", isDefault: false });
    expect(rows[0].isDefault).toBe(true);
  });
});

describe('media tree leaf release badge', () => {
  function render(summary: MediaSummaryView): HTMLElement {
    TestBed.configureTestingModule({
      imports: [MediaNavNodeComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: MediaItemActions, useValue: {} }],
    });
    const fixture = TestBed.createComponent(MediaNavNodeComponent);
    fixture.componentRef.setInput('projectKey', 'proj1');
    fixture.componentRef.setInput('summary', summary);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the status of a changed item, with its text for screen readers', () => {
    const root = render({ uuid: 'm1', uid: 'logo', displayName: 'Logo', mimeType: 'image/png', release: { '': { status: 'CHANGED', releasedRevision: 4 } } });
    expect(root.querySelector('sf-release-badge [role="img"]')?.getAttribute('aria-label')).toBe('Status: Changed');
  });

  it('shows a published item and the localized marker', () => {
    const root = render({
      uuid: 'm2',
      uid: 'hero',
      displayName: 'Hero',
      mimeType: 'image/png',
      localized: true,
      release: { '': { status: 'PUBLISHED', releasedRevision: 2 } },
    });
    expect(root.querySelector('sf-release-badge [role="img"]')?.getAttribute('aria-label')).toBe('Status: Published');
    expect(root.querySelector('.media-nav__localized')).not.toBeNull();
  });
});
