import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { ToastService } from '../../core/ui/toast.service';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfCopyableComponent } from '../../shared/components/display/sf-copyable.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfSaveStatusComponent, type SfSaveState } from '../../shared/components/layout/sf-save-status.component';
import type { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import { SfAssetFavoriteComponent } from '../../shared/components/sf-asset-favorite.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { HistoryDrawerStore } from '../history/history-drawer.store';
import { ReleaseActionsComponent } from '../release/release-actions.component';
import type { ReleaseMode } from '../release/release-choice.util';
import type { RecordDetailView } from './content.service';

/**
 * The record editor's header (M35.20), built like the page editor's: the record's display name as the `h1` with its
 * favorite star; the save status (or why the record is read-only), **Checks** with the count of what is wrong,
 * **History**, the release actions as one group (status per language, Release…, Schedule…, ⋮) and, last, the record's own
 * ⋮ menu — Save now, Move…, Copy link, Used by…, Delete…. Developer mode adds the dataset, UID, UUID and the template
 * snippet. The editor owns the state and the actions; this component only shows them and says what was chosen.
 */
@Component({
  selector: 'sf-record-editor-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReleaseActionsComponent,
    SfAssetFavoriteComponent,
    SfBadgeComponent,
    SfButtonComponent,
    SfCopyableComponent,
    SfPageHeaderComponent,
    SfSaveStatusComponent,
    TranslocoPipe,
  ],
  templateUrl: './record-editor-header.component.html',
  styleUrl: './record-editor-header.component.scss',
})
export class RecordEditorHeaderComponent {
  private readonly transloco = inject(TranslocoService);
  private readonly toasts = inject(ToastService);
  protected readonly developerMode = inject(DeveloperModeService).enabled;
  protected readonly historyDrawer = inject(HistoryDrawerStore);

  readonly projectKey = input.required<string>();
  readonly record = input.required<RecordDetailView>();
  /** The record's name: its display name, or a label when it has none. */
  readonly title = input.required<string>();
  /** The record's dataset, by name. */
  readonly datasetName = input<string>('');
  /** The template snippet that reads this record. */
  readonly snippet = input<string>('');
  /** The record cannot be edited (time travel, no editor role). */
  readonly readOnly = input(false);
  readonly timeTravelling = input(false);
  /** Why the record cannot be edited; the save status is for a record that can. */
  readonly readOnlyLabel = input('');
  readonly saveState = input<SfSaveState>('saved');
  readonly errorCount = input(0);
  readonly savedAt = input<string | null>(null);
  readonly checks = input<{ count: number; errors: number }>({ count: 0, errors: 0 });
  readonly checksOpen = input(false);
  /** Changes whenever the record was saved: the release group re-reads its status. */
  readonly releaseRefresh = input<unknown>(null);

  readonly saveNow = output<void>();
  readonly move = output<void>();
  readonly remove = output<void>();
  readonly restore = output<void>();
  readonly toggleChecks = output<void>();
  readonly showUsedBy = output<void>();
  readonly released = output<ReleaseMode>();

  protected readonly canRestore = computed(() => this.record().deleted === true && !this.timeTravelling() && !this.readOnly());

  protected readonly moreActions = computed<SfMenuItem[]>(() => {
    const t = (key: string) => this.transloco.translate(`content.record.menu.${key}`);
    const locked = this.readOnly() || this.record().deleted === true;
    return [
      { id: 'saveNow', label: t('saveNow'), icon: 'save', disabled: locked },
      { id: 'move', label: t('move'), icon: 'drive_file_move', disabled: locked },
      { id: 'copyLink', label: t('copyLink'), icon: 'link', separatorBefore: true },
      { id: 'usedBy', label: t('usedBy'), icon: 'account_tree' },
      { id: 'delete', label: t('delete'), icon: 'delete', danger: true, disabled: locked, separatorBefore: true },
    ];
  });

  protected onMore(item: SfMenuItem): void {
    switch (item.id) {
      case 'saveNow':
        this.saveNow.emit();
        break;
      case 'move':
        this.move.emit();
        break;
      case 'copyLink':
        void this.copyLink();
        break;
      case 'usedBy':
        this.showUsedBy.emit();
        break;
      case 'delete':
        this.remove.emit();
        break;
    }
  }

  private async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(location.href);
      this.toasts.show(this.transloco.translate('content.record.toast.linkCopied'), 'success');
    } catch {
      this.toasts.show(this.transloco.translate('content.record.toast.linkFailed'), 'error');
    }
  }
}
