import { describe, expect, it } from 'vitest';
import { assetRoute, projectKeyFromUrl, templateKindOfFolderPath } from './asset-route.util';

describe('assetRoute', () => {
  it('opens pages in the page editor and records in the record editor', () => {
    expect(assetRoute('acme', { uuid: 'u1', type: 'PAGE' })).toEqual({ commands: ['/p', 'acme', 'pages', 'u1'], queryParams: {} });
    expect(assetRoute('acme', { uuid: 'r1', type: 'RECORD' })).toEqual({
      commands: ['/p', 'acme', 'content', 'records', 'r1'],
      queryParams: {},
    });
  });

  it('selects media, templates, datasets, navigation and globals through ?asset=', () => {
    expect(assetRoute('acme', { uuid: 'm1', type: 'MEDIA' })).toEqual({ commands: ['/p', 'acme', 'media'], queryParams: { asset: 'm1' } });
    for (const type of ['PAGE_TEMPLATE', 'SECTION_TEMPLATE', 'DATASET']) {
      expect(assetRoute('acme', { uuid: 't1', type })).toEqual({ commands: ['/p', 'acme', 'templates'], queryParams: { asset: 't1' } });
    }
    expect(assetRoute('acme', { uuid: 'n1', type: 'PAGE_REFERENCE' })).toEqual({
      commands: ['/p', 'acme', 'navigation'],
      queryParams: { asset: 'n1' },
    });
    expect(assetRoute('acme', { uuid: 'g1', type: 'GLOBAL_SET' })).toEqual({ commands: ['/p', 'acme', 'globals'], queryParams: { asset: 'g1' } });
  });

  it('opens a folder in the store its path belongs to', () => {
    const folder = (folderPath: string) => assetRoute('acme', { uuid: 'f1', type: 'FOLDER', folderPath });
    expect(folder('/pages_root/news/')).toEqual({ commands: ['/p', 'acme', 'pages'], queryParams: { folder: 'f1' } });
    expect(folder('/media_root/photos/')).toEqual({ commands: ['/p', 'acme', 'media'], queryParams: { folder: 'f1' } });
    expect(folder('/navigation_root/main/')).toEqual({ commands: ['/p', 'acme', 'navigation'], queryParams: { asset: 'f1' } });
    expect(folder('/templates_root/page_templates/blog/')).toEqual({ commands: ['/p', 'acme', 'templates'], queryParams: { folder: 'f1' } });
    expect(folder('/globals_root/site/')).toEqual({ commands: ['/p', 'acme', 'globals'], queryParams: { asset: 'f1' } });
    expect(folder('/content_root/team/')).toEqual({ commands: ['/p', 'acme', 'content'], queryParams: { folder: 'f1' } });
  });
});

describe('projectKeyFromUrl', () => {
  it('reads the project of a project URL', () => {
    expect(projectKeyFromUrl('/p/acme/pages/123?x=1')).toBe('acme');
    expect(projectKeyFromUrl('/p/acme')).toBe('acme');
    expect(projectKeyFromUrl('/')).toBeNull();
    expect(projectKeyFromUrl('/login')).toBeNull();
  });
});

describe('templateKindOfFolderPath', () => {
  it('reads the kind from the fixed template root a folder is in', () => {
    expect(templateKindOfFolderPath('/templates_root/section_templates/cards/')).toBe('SECTION_TEMPLATE');
    expect(templateKindOfFolderPath('/templates_root/datasets/')).toBe('DATASET');
    expect(templateKindOfFolderPath('/templates_root/page_templates/blog/')).toBe('PAGE_TEMPLATE');
    expect(templateKindOfFolderPath(undefined)).toBe('PAGE_TEMPLATE');
  });
});
