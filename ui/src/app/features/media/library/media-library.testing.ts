import { signal } from '@angular/core';
import { of } from 'rxjs';
import { vi } from 'vitest';
import type { components } from '../../../core/api/generated/schema.d.ts';

type FolderView = components['schemas']['FolderView'];
type MediaSummaryView = components['schemas']['MediaSummaryView'];

/** The root of the media store and its folders as `GET /projects/{key}/folders?scope=MEDIA` sends them. */
export const MEDIA_TREE: FolderView[] = [
  {
    uuid: 'root-uuid',
    uid: 'media_root',
    path: '/media_root/',
    displayName: 'All Media',
    protectedFolder: true,
    revision: 1,
    children: [
      { uuid: 'archive-uuid', uid: 'archive', path: '/media_root/archive/', displayName: 'Archive', revision: 3, children: [] },
      {
        uuid: 'products-uuid',
        uid: 'products',
        path: '/media_root/products/',
        displayName: 'Products',
        revision: 2,
        children: [
          { uuid: 'roastery-uuid', uid: 'roastery', path: '/media_root/products/roastery/', displayName: 'Roastery', revision: 4, children: [] },
        ],
      },
      { uuid: 'team-uuid', uid: 'team', path: '/media_root/team/', displayName: 'Team', revision: 5, children: [] },
    ],
  },
];

/** A file as the media list sends it (`GET /projects/{key}/media`): the summary of its current version. */
export function summary(name: string, folderPath: string, overrides: Partial<MediaSummaryView> = {}): MediaSummaryView {
  const lower = name.toLowerCase();
  const mimeType = lower.endsWith('.jpg')
    ? 'image/jpeg'
    : lower.endsWith('.png')
      ? 'image/png'
      : lower.endsWith('.svg')
        ? 'image/svg+xml'
        : lower.endsWith('.css')
          ? 'text/css'
          : 'application/pdf';
  const picture = mimeType.startsWith('image/') && mimeType !== 'image/svg+xml';
  const id = name.replace(/\W+/g, '-');
  return {
    uuid: `uuid-${id}`,
    uid: id.toLowerCase(),
    displayName: name,
    mimeType,
    sizeBytes: 1024,
    folderPath,
    revision: 3,
    processCms: false,
    textEditable: mimeType === 'text/css' || mimeType === 'image/svg+xml',
    localized: false,
    width: picture ? 640 : undefined,
    height: picture ? 480 : undefined,
    changedAt: '2026-10-01T10:00:00Z',
    usageCount: 0,
    release: { '': { status: 'PUBLISHED', releasedRevision: 3 } },
    scheduled: [],
    ...overrides,
  };
}

export const PRODUCTS = '/media_root/products/';

/** What the Products folder holds: three pictures, a stylesheet, an SVG and a PDF (one of the pictures unreleased). */
export function productFiles(): MediaSummaryView[] {
  return [
    summary('yirgacheffe.jpg', PRODUCTS, { sizeBytes: 14_900, changedAt: '2026-10-01T09:00:00Z', usageCount: 2 }),
    summary('latte-art.jpg', PRODUCTS, { sizeBytes: 11_800, changedAt: '2026-10-02T09:00:00Z', release: { '': { status: 'CHANGED', releasedRevision: 2 } } }),
    summary('logo-mark.png', PRODUCTS, { sizeBytes: 7_100, width: 400, height: 400, changedAt: '2026-09-20T09:00:00Z' }),
    summary('brand.css', PRODUCTS, { sizeBytes: 141, changedAt: '2026-09-30T09:00:00Z' }),
    summary('logo.svg', PRODUCTS, { sizeBytes: 204, changedAt: '2026-09-29T09:00:00Z' }),
    summary('price-list.pdf', PRODUCTS, { sizeBytes: 193, changedAt: '2026-09-28T09:00:00Z' }),
  ];
}

/** A page of the list as Spring sends it. */
export function pageOf(content: MediaSummaryView[], page = 0, size = 200, total = content.length) {
  return { content, number: page, size, totalElements: total, totalPages: Math.max(1, Math.ceil(total / size)) };
}

/**
 * The project context the library reads: the media folder tree and the project load state. `loadFor` answers at once
 * (the tree is already there).
 */
export function projectStub(tree: FolderView[] = MEDIA_TREE) {
  return {
    mediaFolderTree: signal(tree),
    project: signal<components['schemas']['ProjectDetail'] | null>(null),
    loading: signal(false),
    error: signal<string | null>(null),
    loadFor: vi.fn().mockReturnValue(of(undefined)),
  };
}
