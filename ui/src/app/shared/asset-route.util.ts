/**
 * Where an asset opens in the app (M23.4.1): the one mapping from an asset's type (and, for folders, its store) to a
 * route, shared by the command palette and the search page.
 */
export interface AssetRouteTarget {
  commands: string[];
  queryParams: Record<string, string>;
}

export interface RoutableAsset {
  uuid?: string;
  type?: string;
  folderPath?: string;
}

/** The store a folder path lives in, from its first segment (`/media_root/photos/` → `media`). */
const STORE_ROOTS: Record<string, { store: string; param: 'asset' | 'folder' }> = {
  pages_root: { store: 'pages', param: 'folder' },
  media_root: { store: 'media', param: 'folder' },
  navigation_root: { store: 'navigation', param: 'asset' },
  templates_root: { store: 'templates', param: 'folder' },
  globals_root: { store: 'globals', param: 'asset' },
  content_root: { store: 'content', param: 'folder' },
};

export function assetRoute(projectKey: string, asset: RoutableAsset): AssetRouteTarget {
  const base = ['/p', projectKey];
  const uuid = asset.uuid ?? '';
  switch (asset.type) {
    case 'PAGE':
      return { commands: [...base, 'pages', uuid], queryParams: {} };
    case 'RECORD':
      return { commands: [...base, 'content', 'records', uuid], queryParams: {} };
    case 'RECORD_SET':
      return { commands: [...base, 'content', 'sets', uuid], queryParams: {} };
    case 'MEDIA':
      return { commands: [...base, 'media'], queryParams: { asset: uuid } };
    case 'PAGE_TEMPLATE':
    case 'SECTION_TEMPLATE':
    case 'DATASET':
      return { commands: [...base, 'templates'], queryParams: { asset: uuid } };
    case 'PAGE_REFERENCE':
      return { commands: [...base, 'navigation'], queryParams: { asset: uuid } };
    case 'GLOBAL_SET':
      return { commands: [...base, 'globals'], queryParams: { asset: uuid } };
    case 'FOLDER': {
      const root = (asset.folderPath ?? '').split('/').filter((segment) => segment.length > 0)[0] ?? '';
      const target = STORE_ROOTS[root];
      if (target) {
        return { commands: [...base, target.store], queryParams: { [target.param]: uuid } };
      }
      return { commands: [...base, 'pages'], queryParams: {} };
    }
    default:
      return { commands: [...base, 'pages'], queryParams: {} };
  }
}

/** The project key of an app URL (`/p/acme/pages/…` → `acme`), or `null` outside a project. */
export function projectKeyFromUrl(url: string): string | null {
  const match = /^\/p\/([^/?#]+)/.exec(url);
  return match ? decodeURIComponent(match[1]) : null;
}

/** The kind of templates a folder of the Templates store holds, from its path (`/templates_root/section_templates/…`). */
export function templateKindOfFolderPath(path: string | undefined): 'PAGE_TEMPLATE' | 'SECTION_TEMPLATE' | 'DATASET' {
  const segment = (path ?? '').split('/').filter((s) => s.length > 0)[1];
  if (segment === 'section_templates') {
    return 'SECTION_TEMPLATE';
  }
  return segment === 'datasets' ? 'DATASET' : 'PAGE_TEMPLATE';
}
