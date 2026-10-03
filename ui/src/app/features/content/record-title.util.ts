/** The few fields of a record that name it. */
export interface RecordNameSource {
  displayName?: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What the record editor calls a record: its display name. A dataset without a title field names its records by their
 * UUID (M25); that is never shown, the `fallback` (a label such as "Untitled Products record") stands in. Pure.
 */
export function recordTitle(record: RecordNameSource | null | undefined, fallback: string): string {
  const name = record?.displayName?.trim();
  return name && !UUID_PATTERN.test(name) ? name : fallback;
}
