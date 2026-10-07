import { ToastService } from '../../../core/ui/toast.service';
import { SampleContentEntry, recordsInside } from './sample-content-data';
import { SAMPLE_LANGS } from './sample-data';
import { SampleState } from './sample-state';

/** Whether any record inside the entries (a folder: every set inside it) waits to be released in some language. */
export function hasPendingRelease(state: SampleState, entries: readonly SampleContentEntry[]): boolean {
  return entries
    .flatMap((entry) => recordsInside(entry, (id) => state.recordsOf(id)))
    .some((record) => SAMPLE_LANGS.some((lang) => record.status[lang] !== 'released'));
}

/**
 * *Release…* on Content entries (tree, folder table, bulk bar), announce only: with nothing pending it says so, otherwise
 * it reports the release with an Undo that says nothing was changed. The item is always enabled, as in the app.
 */
export function releaseContent(state: SampleState, toasts: ToastService, entries: readonly SampleContentEntry[]): void {
  if (entries.length === 0) {
    return;
  }
  if (!hasPendingRelease(state, entries)) {
    state.notice('folder.bulk.nothingToRelease');
    return;
  }
  toasts.undo(state.t('menus.released', { count: entries.length, name: entries[0].name }), () => state.notice('menus.releasedBack'));
}
