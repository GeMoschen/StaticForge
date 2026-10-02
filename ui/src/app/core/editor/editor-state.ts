import { Signal } from '@angular/core';
import type { SaveResult } from '../../shared/components/dialog/unsaved-changes.service';
import type { SfSaveState } from '../../shared/components/layout/sf-save-status.component';

/** Why an editor's content is not saved: a readable reason and, when findings refused it, how many. */
export interface EditorError {
  readonly message: string;
  readonly count?: number;
}

/**
 * What every editor tells the frame about its content (M35.13, decision 11): whether it has unsaved changes, whether it
 * is saving, when it last saved, and why a save was refused — plus how to save and how to give the changes up. The
 * header's `sf-save-status`, the global Ctrl/Cmd+S, the route guard and `beforeunload` all read this one contract.
 *
 * An editor registers itself with {@link ActiveEditorService} while it is open.
 */
export interface EditorStateService {
  /** What the unsaved-changes dialog names: the open item ("Spring harvest arrives", "Template › Article"). */
  readonly name: Signal<string>;
  /** Changes that are not on the server: edits waiting for a save, or for the autosave's debounce. */
  readonly dirty: Signal<boolean>;
  readonly saving: Signal<boolean>;
  /** The clock time of the last save ("12:04"), `null` before the first. */
  readonly lastSaved: Signal<string | null>;
  /** Why the last save was refused; `null` when it was not. */
  readonly error: Signal<EditorError | null>;
  /** The editor writes by itself (pages, records): leaving flushes silently, and only a failed write asks. */
  readonly autosave: boolean;
  /** Saves now. Resolves `{ ok: false }` with a reason when the save is refused (errors, conflict, offline). */
  save(): Promise<SaveResult>;
  /** Gives the unsaved changes up and shows the server's version again. */
  discard(): Promise<void>;
}

/** The save status to show for an editor. */
export function saveStateOf(editor: Pick<EditorStateService, 'dirty' | 'saving' | 'error'>): SfSaveState {
  if (editor.error()) {
    return 'error';
  }
  if (editor.saving()) {
    return 'saving';
  }
  return editor.dirty() ? 'dirty' : 'saved';
}
