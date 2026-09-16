/**
 * The types the picker's type switch can offer: assets, and (M21.4.1) the two pagination sources — a folder of the
 * Navigation store and a dataset — which are offered only when asked for by name.
 */
export type PickerType = 'PAGE' | 'MEDIA' | 'PAGE_TEMPLATE' | 'SECTION_TEMPLATE' | 'RECORD' | 'NAV_FOLDER' | 'DATASET';

export const PICKER_TYPE_OPTIONS: { value: PickerType; label: string }[] = [
  { value: 'PAGE', label: 'Pages' },
  { value: 'MEDIA', label: 'Media' },
  { value: 'PAGE_TEMPLATE', label: 'Page templates' },
  { value: 'SECTION_TEMPLATE', label: 'Section templates' },
  { value: 'RECORD', label: 'Records' },
];

/** Pagination sources (M21.4.1): never part of the default type switch. */
export const SOURCE_TYPE_OPTIONS: { value: PickerType; label: string }[] = [
  { value: 'NAV_FOLDER', label: 'Navigation folders' },
  { value: 'DATASET', label: 'Datasets' },
];

/**
 * The type switch's options. A `dataset` restriction (a reference editor's `dataset "uid"`) means
 * records only; otherwise `allowedTypes` (its `assetTypes`) filters the list, and an unknown or empty
 * restriction offers everything.
 */
export function pickerTypeOptions(
  allowedTypes: readonly string[] | null | undefined,
  dataset: string | null | undefined,
): { value: PickerType; label: string }[] {
  if (dataset) {
    return PICKER_TYPE_OPTIONS.filter((t) => t.value === 'RECORD');
  }
  if (!allowedTypes || allowedTypes.length === 0) {
    return PICKER_TYPE_OPTIONS;
  }
  const filtered = [...PICKER_TYPE_OPTIONS, ...SOURCE_TYPE_OPTIONS].filter((t) => allowedTypes.includes(t.value));
  return filtered.length > 0 ? filtered : PICKER_TYPE_OPTIONS;
}

/** One pickable folder: its place in the tree for indentation, its path as the row's detail. */
export interface PickerFolderRow {
  uuid: string;
  uid?: string;
  displayName?: string;
  path?: string;
  depth: number;
}

interface FolderTreeNode {
  uuid?: string;
  uid?: string;
  displayName?: string;
  path?: string;
  children?: FolderTreeNode[];
}

/**
 * A folder tree as pickable rows, depth-first in tree order. With a search, only folders whose name or uid contains
 * it (case-insensitive) are kept, together with their ancestors so each match keeps its place in the tree.
 */
export function folderRows(tree: readonly FolderTreeNode[] | null | undefined, search = '', depth = 0): PickerFolderRow[] {
  const needle = search.trim().toLowerCase();
  const rows: PickerFolderRow[] = [];
  for (const node of tree ?? []) {
    const children = folderRows(node.children, needle, depth + 1);
    const matches =
      !needle ||
      (node.displayName ?? '').toLowerCase().includes(needle) ||
      (node.uid ?? '').toLowerCase().includes(needle);
    if (node.uuid && (matches || children.length > 0)) {
      rows.push({ uuid: node.uuid, uid: node.uid, displayName: node.displayName, path: node.path, depth });
    }
    rows.push(...children);
  }
  return rows;
}

/** Datasets whose name or uid contains the search (case-insensitive). */
export function matchingDatasets<T extends { uid?: string; displayName?: string }>(datasets: readonly T[], search: string): T[] {
  const needle = search.trim().toLowerCase();
  return needle
    ? datasets.filter((d) => (d.displayName ?? '').toLowerCase().includes(needle) || (d.uid ?? '').toLowerCase().includes(needle))
    : [...datasets];
}

/** The datasets a record picker offers: only the restricted one when `dataset` names one. */
export function pickerDatasets<T extends { uid?: string }>(datasets: readonly T[], dataset: string | null | undefined): T[] {
  return dataset ? datasets.filter((d) => d.uid === dataset) : [...datasets];
}
