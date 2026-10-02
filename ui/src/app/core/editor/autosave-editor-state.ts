import { computed, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import type { AutosaveService } from '../../shared/services/autosave.base';
import type { SfSaveState } from '../../shared/components/layout/sf-save-status.component';
import type { EditorError, EditorStateService } from './editor-state';

/** The save status an autosave editor's header shows, and how many findings refused the last save. */
export function autosaveStatus(autosave: Pick<AutosaveService<never, { revision?: number | null }>, 'saveState' | 'rejected'>): {
  state: SfSaveState;
  errorCount: number;
} {
  switch (autosave.saveState()) {
    case 'dirty':
      return { state: 'dirty', errorCount: 0 };
    case 'saving':
      return { state: 'saving', errorCount: 0 };
    case 'rejected':
      return { state: 'error', errorCount: autosave.rejected().filter((finding) => finding.severity === 'ERROR').length };
    case 'error':
      return { state: 'error', errorCount: 0 };
    default:
      return { state: 'saved', errorCount: 0 };
  }
}

/**
 * The {@link EditorStateService} of an autosave editor (pages, records): its content is unsaved from the first edit
 * until the write succeeds (`dirty`, `saving`, `error` and `rejected` states of the {@link AutosaveService}), `save()`
 * flushes the waiting edit, and `discard()` gives it up and lets the editor show the server's version again. Call it in
 * an injection context.
 */
export function autosaveEditorState(options: {
  /** The open item's name, for the unsaved-changes dialog. */
  name: () => string;
  autosave: AutosaveService<never, { revision?: number | null }>;
  /** Shows the server's version again (reload the item) after the waiting edit was given up. */
  reload: () => void;
}): EditorStateService {
  const transloco = inject(TranslocoService);
  const { autosave } = options;
  const state = autosave.saveState;
  const t = (key: string, params?: Record<string, unknown>) => transloco.translate(`shared.saveStatus.${key}`, params);

  const error = computed<EditorError | null>(() => {
    switch (state()) {
      case 'rejected': {
        const count = autosave.rejected().filter((finding) => finding.severity === 'ERROR').length;
        return { message: t('rejected', { count }), count };
      }
      case 'error':
        return { message: autosave.conflict() ? t('conflict') : t('failed') };
      default:
        return null;
    }
  });

  return {
    name: computed(options.name),
    dirty: computed(() => state() === 'dirty' || state() === 'saving' || error() !== null),
    saving: computed(() => state() === 'saving'),
    lastSaved: autosave.lastSavedAt,
    error,
    autosave: true,
    async save() {
      const written = await autosave.flush();
      return written ? { ok: true } : { ok: false, message: error()?.message ?? t('failed') };
    },
    async discard() {
      autosave.discardPending();
      options.reload();
    },
  };
}
