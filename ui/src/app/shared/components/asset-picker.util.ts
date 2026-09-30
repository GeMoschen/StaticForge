/**
 * The types the picker's type switch can offer: assets, and (M21.4.1) the two pagination sources — a folder of the
 * Navigation store and a dataset — which are offered only when asked for by name.
 */
export type PickerType =
  | 'PAGE'
  | 'MEDIA'
  | 'PAGE_TEMPLATE'
  | 'SECTION_TEMPLATE'
  | 'RECORD'
  | 'RECORD_SET'
  | 'NAV_FOLDER'
  | 'DATASET';

export const PICKER_TYPE_OPTIONS: { value: PickerType; labelKey: string }[] = [
  { value: 'PAGE', labelKey: 'enum.pickerType.PAGE' },
  { value: 'MEDIA', labelKey: 'enum.pickerType.MEDIA' },
  { value: 'PAGE_TEMPLATE', labelKey: 'enum.pickerType.PAGE_TEMPLATE' },
  { value: 'SECTION_TEMPLATE', labelKey: 'enum.pickerType.SECTION_TEMPLATE' },
  { value: 'RECORD', labelKey: 'enum.pickerType.RECORD' },
  { value: 'RECORD_SET', labelKey: 'enum.pickerType.RECORD_SET' },
];

/** The types a `dataset "uid"` restriction applies to (M25.5.3): a dataset's records and its record sets. */
const DATASET_BOUND_TYPES: readonly PickerType[] = ['RECORD', 'RECORD_SET'];

/** Pagination sources (M21.4.1): never part of the default type switch. */
export const SOURCE_TYPE_OPTIONS: { value: PickerType; labelKey: string }[] = [
  { value: 'NAV_FOLDER', labelKey: 'enum.pickerType.NAV_FOLDER' },
  { value: 'DATASET', labelKey: 'enum.pickerType.DATASET' },
];

/**
 * The type switch's options. A `dataset` restriction (a reference editor's `dataset "uid"`) means that
 * dataset's records and/or record sets, exactly as the server validates the value
 * (`ContentValidator.validateDataset`): record sets only when `allowedTypes` (its `assetTypes`) names
 * `RECORD_SET`, records when it names `RECORD` — and records alone when it says nothing (the M19 meaning of
 * `dataset "uid"`) or allows neither (the CDL rejects that combination, `SF-CDL-0104`). Otherwise
 * `allowedTypes` filters the list, and an unknown or empty restriction offers everything.
 */
export function pickerTypeOptions(
  allowedTypes: readonly string[] | null | undefined,
  dataset: string | null | undefined,
): { value: PickerType; labelKey: string }[] {
  if (dataset) {
    const allowed = PICKER_TYPE_OPTIONS.filter(
      (t) => DATASET_BOUND_TYPES.includes(t.value) && allowedTypes?.includes(t.value),
    );
    return allowed.length > 0 ? allowed : PICKER_TYPE_OPTIONS.filter((t) => t.value === 'RECORD');
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

interface PickableRecordSet {
  uid?: string;
  displayName?: string;
  dataset?: { uid?: string };
}

/**
 * The record sets a set picker offers (M25.5.3): only the restricted dataset's when `dataset` names one, and of
 * those the ones whose name or uid contains the search (case-insensitive).
 */
export function pickerRecordSets<T extends PickableRecordSet>(
  sets: readonly T[],
  dataset: string | null | undefined,
  search: string,
): T[] {
  return matchingDatasets(dataset ? sets.filter((s) => s.dataset?.uid === dataset) : sets, search);
}

/** Looks a key up in the active language (`TranslocoService.translate`), for helpers that run outside a template. */
export type Translator = (key: string, params?: Record<string, unknown>) => string;

/** "1 record" / "12 records" (`common.count.records`). */
export function recordCountLabel(count: number | null | undefined, translate: Translator): string {
  return translate('common.count.records', { count: count ?? 0 });
}
