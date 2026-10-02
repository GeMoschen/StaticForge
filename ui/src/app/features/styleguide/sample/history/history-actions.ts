import { inject } from '@angular/core';
import { ToastService } from '../../../../core/ui/toast.service';
import { ConfirmService } from '../../../../shared/components/dialog/confirm.service';
import { CURRENT_PROJECT } from '../sample-data';
import { SampleState } from '../sample-state';
import { injectSampleText } from '../changes/sample-area.util';
import { HISTORY, HistoryAsset, HistoryRevision } from './history-data';

/** "12 Sep 14:03" — a revision's time in the time-travel banner and the detail pane. */
export function formatRevisionTime(minutes: number, now = Date.now()): string {
  return new Date(now - minutes * 60_000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export interface HistoryActions {
  /** *View*: time travel to the revision — the drawer closes, the banner appears, every screen is read-only. */
  view(revision: HistoryRevision): void;
  /** *Restore* an asset to its state in a revision: confirm, then a toast with Undo. */
  restoreAsset(revision: HistoryRevision, asset: HistoryAsset): Promise<void>;
  /** *Project roll-back*: a danger action — the user types the project key. */
  rollBack(revision: HistoryRevision): Promise<void>;
}

/** The three history actions the drawer, the full page and the banner share (M35.9 review round 2). */
export function injectHistoryActions(): HistoryActions {
  const state = inject(SampleState);
  const confirms = inject(ConfirmService);
  const toasts = inject(ToastService);
  const t = injectSampleText('styleguide.sample.history');
  return {
    view: (revision) => {
      state.history.set(null);
      state.travel.set(revision.id);
    },
    restoreAsset: async (revision, asset) => {
      const ok = await confirms.confirm({
        title: t('confirm.restoreTitle', { name: asset.name, n: revision.id }),
        message: t('confirm.restoreMessage'),
        confirmLabel: t('confirm.restoreConfirm'),
      });
      if (ok) {
        toasts.undo(t('confirm.restored', { name: asset.name, n: revision.id }), () => toasts.show(t('confirm.undone', { name: asset.name }), 'info'));
      }
    },
    rollBack: async (revision) => {
      const ok = await confirms.confirm({
        title: t('confirm.rollbackTitle', { n: revision.id }),
        message: t('confirm.rollbackMessage', { n: revision.id }),
        confirmLabel: t('confirm.rollbackConfirm', { n: revision.id }),
        tone: 'danger',
        typeToConfirm: CURRENT_PROJECT.key,
        details: [...new Set(HISTORY.filter((r) => r.id > revision.id).flatMap((r) => r.assets.map((a) => a.name)))],
      });
      if (ok) {
        state.travel.set(null);
        toasts.undo(t('confirm.rolledBack', { n: revision.id }), () => toasts.show(t('confirm.undone', { name: CURRENT_PROJECT.name }), 'info'));
      }
    },
  };
}
