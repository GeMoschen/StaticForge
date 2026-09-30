/**
 * Shared contracts for the PAGES feature (StaticForge milestone M3).
 */

/** A single section instance within a page body. */
export interface SectionInstance {
  instanceId: string;
  templateRef: string;
  content: Record<string, unknown>;
}

/** Page `bodies` payload, keyed by body name. */
export type BodiesMap = Record<string, SectionInstance[]>;

/** Autosave lifecycle state. */
/**
 * `rejected`: the save rule gate refused the save (M33.8, `422` with rule `issues`) — the edits stay local, the
 * findings are in {@link AutosaveService.rejected}, and the next change saves again.
 */
export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'rejected';

/** Reconciliation mode for the conflict drawer. */
export type ResolveMode = 'mine' | 'theirs';

/** Conflict payload parsed from a 409 problem response. */
export interface ConflictInfo {
  expectedRevision: number;
  currentRevision: number;
  detail?: string;
  changedBy?: number;
  changedAt?: string;
  base?: unknown;
  theirs?: unknown;
}

/** Per-field merge decisions emitted by the conflict drawer on resolve. */
export interface FieldResolveEvent {
  fields: Record<string, ResolveMode>;
}

/** Folder drag-and-drop move event (source moved into target). */
export interface FolderMoveEvent {
  source: string;
  target: string;
}
