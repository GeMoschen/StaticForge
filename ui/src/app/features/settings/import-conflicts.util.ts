import type { ImportConflictView } from './import-export.service';

/**
 * Material Symbols icon per `ConflictType` — a reasonable visual cue, not meant to be pixel-perfect. Keyed by the
 * plain string the API sends (`ImportConflictView.type` is not an enum in the schema), so a type the server adds
 * later just falls back to `info`.
 */
export const CONFLICT_ICONS: Record<string, string> = {
  PROTOCOL_VERSION_MISMATCH: 'warning',
  DUPLICATE_UUID: 'content_copy',
  DUPLICATE_UUID_TYPE_MISMATCH: 'report',
  MISSING_TEMPLATE_REFERENCE: 'link_off',
  RECORD_DATASET_MISSING: 'dataset_linked',
  RECORD_SET_DATASET_MISSING: 'dataset_linked',
  RECORD_SET_MISSING: 'table_rows',
  RECORD_SET_DATASET_MISMATCH: 'rule',
  RECORD_OUTSIDE_RECORD_SET: 'move_item',
  RECORD_SET_QUERY_INVALID: 'filter_alt_off',
  PARENT_TEMPLATE_MISSING: 'link_off',
  MISSING_PARENT_FOLDER: 'folder_off',
  SETTINGS_KEY_COLLISION: 'settings',
  TARGET_PATH_COLLISION: 'drive_file_move',
  LOCALE_CONFIG_MISMATCH: 'translate',
  LOCALIZATION_SHAPE_MISMATCH: 'translate',
  RELEASE_LOCALE_MISSING: 'translate',
  DUPLICATE_SCHEDULE: 'event_repeat',
  SCHEDULE_OVERDUE: 'event_busy',
  SCHEDULE_TARGET_MISSING: 'link_off',
  SCHEDULE_INVALID: 'event_busy',
  SCHEDULE_OWNER_REPLACED: 'person',
  REDIRECT_SOURCE_EXISTS: 'alt_route',
  REDIRECT_INVALID: 'link_off',
  URL_OVERRIDE_KEPT: 'edit_note',
  URL_TAKEN: 'link_off',
  URL_INVALID: 'link_off',
};

/**
 * Whether a conflict refuses the whole import. A `BLOCKING` conflict does unless the server says it only rejects
 * its own asset (`blocksImport: false` — M25: a record outside a record set, which is left out while the rest of
 * the archive imports). A conflict without the flag counts as refusing, the safe reading.
 */
export function refusesImport(conflict: ImportConflictView): boolean {
  return conflict.severity === 'BLOCKING' && conflict.blocksImport !== false;
}

/** Whether a conflict keeps only its own asset out of the import (`BLOCKING` with `blocksImport: false`). */
export function rejectsAssetOnly(conflict: ImportConflictView): boolean {
  return conflict.severity === 'BLOCKING' && conflict.blocksImport === false;
}

/** The icon for a conflict type, `info` for one the UI does not know. */
export function conflictIcon(type: string | undefined): string {
  return CONFLICT_ICONS[type ?? ''] ?? 'info';
}
