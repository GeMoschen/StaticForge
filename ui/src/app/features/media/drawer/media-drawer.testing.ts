import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, type TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { render } from '@testing-library/angular';
import { vi } from 'vitest';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { DeveloperModeService } from '../../../core/frame/developer-mode.service';
import { MediaDetailDrawerComponent } from '../media-detail-drawer.component';

type MediaView = components['schemas']['MediaView'];
type AssetHistoryEntry = components['schemas']['AssetHistoryEntry'];

/** A photo as `GET /media/{uuid}` answers it (the list rows carry none of alt text, focal point or variants). */
export const PHOTO: MediaView = {
  uuid: 'media-1',
  uid: 'photo_jpg',
  displayName: 'Photo',
  revision: 3,
  blobSha256: 'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12',
  fileName: 'photo.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 1_258_291,
  image: { width: 4000, height: 2667 },
  altText: 'A photo',
  caption: '',
  copyright: '',
  focalPoint: { x: 0.5, y: 0.5 },
  variants: [
    { name: 'w400', width: 400, format: 'webp' },
    { name: 'w1600', width: 1600, format: 'webp' },
  ],
  processCms: false,
  textEditable: false,
  localized: false,
  release: {},
  scheduled: [],
};

/** The same photo as a library list row (`MediaSummaryView`): what the drawer is opened with. */
export const PHOTO_ROW = {
  uuid: PHOTO.uuid,
  uid: PHOTO.uid,
  displayName: PHOTO.displayName,
  mimeType: PHOTO.mimeType,
  sizeBytes: PHOTO.sizeBytes,
  folderPath: '/media_root/products/',
  revision: PHOTO.revision,
  processCms: false,
  textEditable: false,
  localized: false,
  usageCount: 0,
} as MediaView;

export const PNG: MediaView = {
  ...PHOTO,
  uuid: 'media-png',
  uid: 'texture_png',
  displayName: 'Texture',
  fileName: 'texture.png',
  mimeType: 'image/png',
  image: { width: 800, height: 600 },
  focalPoint: undefined,
  variants: [],
};

export const SVG: MediaView = {
  ...PHOTO,
  uuid: 'media-svg',
  uid: 'logo_svg',
  displayName: 'Logo',
  fileName: 'logo.svg',
  mimeType: 'image/svg+xml',
  sizeBytes: 420,
  image: undefined,
  focalPoint: undefined,
  variants: [],
  textEditable: true,
};

export const CSS: MediaView = {
  uuid: 'media-css',
  uid: 'brand_css',
  displayName: 'Brand',
  revision: 5,
  blobSha256: 'ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00',
  fileName: 'brand.css',
  mimeType: 'text/css',
  sizeBytes: 120,
  variants: [],
  processCms: false,
  textEditable: true,
  localized: false,
  release: {},
  scheduled: [],
};

export const PDF: MediaView = {
  uuid: 'media-pdf',
  uid: 'price_list_pdf',
  displayName: 'Price list',
  revision: 2,
  fileName: 'price-list.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 90_000,
  variants: [],
  processCms: false,
  textEditable: false,
  localized: false,
  release: {},
  scheduled: [],
};

/** `GET /assets/{uuid}/history`: newest first, as the server lists it. */
export const HISTORY: AssetHistoryEntry[] = [
  { revision: 3, displayName: 'Photo', changedByName: 'Ada', changedAt: '2026-10-03T09:00:00Z' },
  { revision: 2, displayName: 'Photo', changedByName: 'Ada', changedAt: '2026-10-02T09:00:00Z' },
  { revision: 1, displayName: 'Photo', changedByName: 'Grace', changedAt: '2026-10-01T09:00:00Z' },
];

/** What the stubbed server answers to the drawer's reads. */
export interface DrawerAnswers {
  detail?: MediaView;
  usages?: unknown[];
  history?: AssetHistoryEntry[];
  text?: string;
  utf8?: boolean;
  rendered?: string;
  diagnostics?: unknown[];
}

/**
 * Answers every pending read of the drawer (the file in full, usages, history, previews, the text, the release bar...) and
 * leaves writes (`PUT`, `POST`, `DELETE`) alone, for the spec to answer. Returns what it answered.
 */
export function answerReads(http: HttpTestingController, answers: DrawerAnswers = {}): TestRequest[] {
  const answered: TestRequest[] = [];
  const reads = http.match(
    (req) => req.method === 'GET' || (req.method === 'POST' && req.url.endsWith('/text/validate')),
  );
  for (const req of reads) {
    if (req.cancelled) {
      continue;
    }
    const url = req.request.url;
    const rendered = req.request.params.get('rendered') === 'true';
    if (req.request.responseType === 'blob') {
      req.flush(new Blob(['x']));
    } else if (rendered) {
      req.flush(answers.rendered ?? '', { status: 200, statusText: 'OK' });
    } else if (url.endsWith('/text/validate')) {
      req.flush({ diagnostics: answers.diagnostics ?? [] });
    } else if (url.endsWith('/text')) {
      req.flush({ text: answers.text ?? '', utf8: answers.utf8 ?? true, revision: answers.detail?.revision ?? 1 });
    } else if (url.endsWith('/usages')) {
      req.flush(answers.usages ?? []);
    } else if (url.endsWith('/history')) {
      req.flush(answers.history ?? HISTORY);
    } else if (/\/media\/[^/]+$/.test(url) && answers.detail) {
      req.flush(answers.detail);
    } else if (url.endsWith('/pages') || url.endsWith('/globals')) {
      req.flush([]);
    } else {
      req.flush({});
    }
    answered.push(req);
  }
  return answered;
}

/**
 * Settles whatever is still pending at the end of a spec: reads get their real answer shape (a list is an array, never `{}`),
 * writes get an empty body. Cancelled requests are skipped.
 */
export function flushPending(http: HttpTestingController): void {
  answerReads(http);
  for (const pending of http.match(() => true).filter((req) => !req.cancelled)) {
    pending.flush(pending.request.responseType === 'blob' ? new Blob() : {});
  }
}

export interface RenderDrawerOptions {
  /** What the drawer is opened with (a list row); the full file by default. */
  row?: MediaView;
  /** What `GET /media/{uuid}` answers. */
  detail?: MediaView;
  inputs?: Record<string, unknown>;
  dev?: boolean;
  answers?: DrawerAnswers;
  configure?: () => void;
}

/**
 * Renders the detail drawer over a stubbed server: opened on `row`, with every read answered ({@link answerReads}).
 * Returns the fixture, the controller, `settle` (answers what the drawer asks next) and the output spies.
 */
export async function renderDrawer(options: RenderDrawerOptions = {}) {
  const detail = options.detail ?? PHOTO;
  const row = options.row ?? (detail === PHOTO ? PHOTO_ROW : detail);
  const spies = { step: vi.fn(), updated: vi.fn(), deleted: vi.fn(), tabChange: vi.fn(), fileAction: vi.fn() };
  const result = await render(MediaDetailDrawerComponent, {
    componentInputs: { projectKey: 'proj1', media: row, position: { index: 1, count: 3 }, ...options.inputs },
    on: spies,
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      ...(options.dev ? [{ provide: DeveloperModeService, useValue: { enabled: signal(true) } }] : []),
    ],
    configureTestBed: options.configure ? () => options.configure!() : undefined,
  });
  const http = TestBed.inject(HttpTestingController);
  const answers: DrawerAnswers = { detail, ...options.answers };
  /** Answers the reads the drawer makes, round after round, until it has nothing left to ask. */
  const settle = async () => {
    for (let round = 0; round < 4; round++) {
      result.fixture.detectChanges();
      answerReads(http, answers);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    result.fixture.detectChanges();
  };
  await settle();
  return { ...result, http, settle, answers, ...spies };
}
