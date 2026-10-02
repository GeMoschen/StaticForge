/** The asset kinds a person can open, favorite and find again (M35.15): everything with a UUID in a project's stores. */
export interface AssetRef {
  /** The asset type (`PAGE`, `RECORD`, `RECORD_SET`, `MEDIA`, `PAGE_TEMPLATE`, `FOLDER`, …), as the API reports it. */
  readonly type: string;
  readonly uuid: string;
  readonly displayName: string;
  /** Where it lives in its store (`/pages_root/news/`); tells a folder which store it belongs to. */
  readonly folderPath?: string;
}

/** The icon of an asset kind (the palette and the lists). */
export const ASSET_ICONS: Readonly<Record<string, string>> = {
  PAGE: 'description',
  FOLDER: 'folder',
  RECORD_SET: 'table_rows',
  RECORD: 'table_rows',
  MEDIA: 'image',
  PAGE_TEMPLATE: 'code_blocks',
  SECTION_TEMPLATE: 'code_blocks',
  DATASET: 'code_blocks',
  GLOBAL_SET: 'tune',
  PAGE_REFERENCE: 'menu_open',
};

export function assetIcon(type: string): string {
  return ASSET_ICONS[type] ?? 'description';
}

/**
 * Where an asset lives, for the muted text beside its name: the folder path without the store's root and the trailing
 * slash (`/pages_root/news/archive/` → `news › archive`). A folder's own name is not repeated. `null` when it is at the root.
 */
export function assetLocation(folderPath: string | undefined, type: string): string | null {
  const segments = (folderPath ?? '').split('/').filter(Boolean).slice(1);
  const parents = type === 'FOLDER' ? segments.slice(0, -1) : segments;
  return parents.length > 0 ? parents.join(' › ') : null;
}
