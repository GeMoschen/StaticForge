import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { LocalesStore } from '../../core/project/locales.store';
import { answerReads, flushPending } from './drawer/media-drawer.testing';
import { MediaDetailDrawerComponent } from './media-detail-drawer.component';
import { localeFileRows } from './media-locale-files.util';

type MediaView = components['schemas']['MediaView'];

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
  let http: HttpTestingController;
  let settle: () => Promise<void>;

  beforeEach(async () => {
    const result = await render(MediaDetailDrawerComponent, {
      componentInputs: { projectKey: 'proj1', media: LOCALIZED, tab: 'languages' },
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      configureTestBed: (bed) => bed.inject(LocalesStore).set('proj1', LOCALES),
    });
    http = TestBed.inject(HttpTestingController);
    settle = async () => {
      for (let round = 0; round < 4; round++) {
        result.fixture.detectChanges();
        answerReads(http, { detail: LOCALIZED });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      result.fixture.detectChanges();
    };
    await settle();
  });

  afterEach(() => {
    flushPending(http);
  });

  const toggle = () => screen.getByRole('switch', { name: 'Different file per language' });
  const rows = () => Array.from(document.querySelectorAll<HTMLElement>('.lang'));

  it('turning it off with other language files lists them and resends with confirmDiscard', async () => {
    expect(toggle()).toBeChecked();

    fireEvent.click(toggle());
    const first = http.expectOne((r) => r.method === 'PUT' && r.url.endsWith('/media/media-1/localized'));
    expect(first.request.body).toEqual({ localized: false, confirmDiscard: false });
    expect(first.request.headers.get('If-Match')).toBe('"rev-3"');
    first.flush(
      {
        status: 409,
        code: 'SF-MEDIA-0505',
        detail: 'Un-localizing keeps only the default language file; the other language files would be discarded.',
        files: [{ locale: 'de', fileName: 'hero-de.png', sizeBytes: 1258291 }],
      },
      { status: 409, statusText: 'Conflict' },
    );

    expect(await screen.findByText(/These files will be discarded: DE hero-de\.png \(1\.2 MB\)/)).toBeInTheDocument();
    await waitFor(() => expect(toggle()).toBeChecked());

    fireEvent.click(screen.getByRole('button', { name: 'Discard files' }));
    const second = await waitFor(() => http.expectOne((r) => r.method === 'PUT' && r.url.endsWith('/media/media-1/localized')));
    expect(second.request.body).toEqual({ localized: false, confirmDiscard: true });
    second.flush({ ...LOCALIZED, revision: 4, localized: false, localeFiles: undefined });
    await settle();

    await waitFor(() => expect(screen.queryByText(/These files will be discarded/)).not.toBeInTheDocument());
    expect(toggle()).not.toBeChecked();
  });

  it('keeps the files when the discard question is declined', async () => {
    fireEvent.click(toggle());
    http
      .expectOne((r) => r.method === 'PUT')
      .flush({ code: 'SF-MEDIA-0505', files: [{ locale: 'de', fileName: 'hero-de.png', sizeBytes: 10 }] }, { status: 409, statusText: 'Conflict' });
    await screen.findByText(/These files will be discarded/);

    fireEvent.click(screen.getByRole('button', { name: 'Keep the files' }));

    await waitFor(() => expect(screen.queryByText(/These files will be discarded/)).not.toBeInTheDocument());
    expect(toggle()).toBeChecked();
    http.expectNone((r) => r.method === 'PUT');
  });

  it('labels own and fallback rows: the default file has no Remove, a fallback row offers Upload', () => {
    expect(rows().map((row) => row.dataset['locale'])).toEqual(['en', 'de', 'fr']);

    const [en, de, fr] = rows();
    expect(en.textContent).toContain('hero.png');
    expect(en.textContent).toContain('Default');
    expect(within(en).getByRole('button', { name: 'Replace the English (EN) file' })).toBeInTheDocument();
    expect(within(en).queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();

    expect(de.textContent).toContain('hero-de.png');
    expect(within(de).getByRole('button', { name: 'Remove the German (DE) file' })).toBeInTheDocument();

    expect(fr.textContent).toContain('Uses the German file');
    expect(within(fr).getByRole('button', { name: 'Upload a file for French (FR)' })).toBeInTheDocument();
    expect(within(fr).queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
  });

  it('uploads a file dropped on a language row for that language', async () => {
    const fr = rows()[2];
    const file = new File(['x'], 'hero-fr.png', { type: 'image/png' });
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file], types: ['Files'] } });
    fr.dispatchEvent(drop);

    const req = await waitFor(() => http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/media/media-1/files/fr')));
    expect((req.request.body as FormData).get('file')).toBe(file);
    req.flush({ media: { ...LOCALIZED, revision: 4 }, warnings: [] });
  });

  it('removes a language file after asking', async () => {
    fireEvent.click(within(rows()[1]).getByRole('button', { name: 'Remove the German (DE) file' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove file' }));

    const req = await waitFor(() => http.expectOne((r) => r.method === 'DELETE' && r.url.endsWith('/media/media-1/files/de')));
    req.flush({ ...LOCALIZED, revision: 4 });
  });
});

describe('localized media without project languages', () => {
  it('says the project has no languages and offers no switch that works', async () => {
    const media = { ...LOCALIZED, localized: false, localeFiles: undefined };
    await render(MediaDetailDrawerComponent, {
      componentInputs: { projectKey: 'proj1', media, tab: 'languages' },
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const http = TestBed.inject(HttpTestingController);
    answerReads(http, { detail: media });

    expect(await screen.findByRole('switch', { name: 'Different file per language' })).toBeDisabled();
    expect(screen.getByText(/This project has no languages/)).toBeInTheDocument();
    expect(document.querySelector('.lang')).toBeNull();
    flushPending(http);
  });
});

describe('media locale files util', () => {
  it('labels a fallback row with the language it uses', () => {
    const rows = localeFileRows(LOCALIZED.localeFiles, LOCALES.locales, 'en');
    expect(rows[2]).toMatchObject({ locale: 'fr', own: false, fallbackText: "Uses German's file", isDefault: false });
    expect(rows[0].isDefault).toBe(true);
  });
});
