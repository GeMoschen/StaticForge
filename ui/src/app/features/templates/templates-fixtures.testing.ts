import type { components } from '../../core/api/generated/schema.d.ts';
import type { TemplateSummary } from './templates.service';

type FolderView = components['schemas']['FolderView'];

/** The folder tree as the REST API sends it: the fixed wrapper, the three kind roots (sorted by name), folders with stored paths. */
export const TREE: FolderView[] = [
  {
    uuid: 'all',
    uid: 'templates_root',
    displayName: 'All Templates',
    path: '/templates_root/',
    protectedFolder: true,
    type: 'FOLDER',
    children: [
      { uuid: 'ds', uid: 'datasets', displayName: 'Datasets', path: '/templates_root/datasets/', protectedFolder: true, type: 'FOLDER', children: [] },
      {
        uuid: 'pt',
        uid: 'page_templates',
        displayName: 'Page Templates',
        path: '/templates_root/page_templates/',
        protectedFolder: true,
        type: 'FOLDER',
        children: [
          {
            uuid: 'blog',
            uid: 'blog',
            displayName: 'Blog',
            path: '/templates_root/page_templates/blog/',
            type: 'FOLDER',
            children: [{ uuid: 'archive', uid: 'archive', displayName: 'Archive', path: '/templates_root/page_templates/blog/archive/', type: 'FOLDER', children: [] }],
          },
        ],
      },
      { uuid: 'st', uid: 'section_templates', displayName: 'Section Templates', path: '/templates_root/section_templates/', protectedFolder: true, type: 'FOLDER', children: [] },
    ],
  },
];

export const SUMMARIES: TemplateSummary[] = [
  { uuid: 'article', uid: 'article', assetType: 'PAGE_TEMPLATE', displayName: 'Article', folderPath: '/templates_root/page_templates/', channels: ['html', 'rss'], usedByCount: 3, changedAt: '2026-10-01T10:00:00Z', revision: 4 },
  { uuid: 'post', uid: 'post', assetType: 'PAGE_TEMPLATE', displayName: 'Post', folderPath: '/templates_root/page_templates/blog/', channels: ['html'], usedByCount: 0, abstract: true },
  { uuid: 'teaser', uid: 'teaser', assetType: 'SECTION_TEMPLATE', displayName: 'Teaser', folderPath: '/templates_root/section_templates/', channels: [], usedByCount: 5 },
  { uuid: 'products', uid: 'products', assetType: 'DATASET', displayName: 'Products', folderPath: '/templates_root/datasets/', channels: ['html'], usedByCount: 2 },
  { uuid: 'lost', uid: 'lost', assetType: 'PAGE_TEMPLATE', displayName: 'Lost', folderPath: '/templates_root/nowhere/' },
];
