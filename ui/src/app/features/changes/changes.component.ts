import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfBannerComponent } from '../../shared/components/layout/sf-banner.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfSplitterComponent } from '../../shared/components/splitter/sf-splitter.component';
import { ReleaseDialogComponent } from '../release/release-dialog.component';
import { ReleaseEventsStore } from '../release/release-events.store';
import { type ReleaseChoice, type ReleaseMode, eligible } from '../release/release-choice.util';
import type { ReleaseStatus } from '../release/release-status.util';
import { ScheduleDialogComponent } from '../schedules/schedule-dialog.component';
import type { ScheduleType } from '../schedules/schedule.util';
import { ChangesDiffComponent } from './changes-diff.component';
import { ChangesFiltersComponent } from './changes-filters.component';
import { ChangesListComponent } from './changes-list.component';
import { type ChangesState, type QueryValue, stateFromParams } from './changes-query.util';
import { type ChangeRowView, ChangesStore } from './changes.store';

/**
 * The Changes view (M27.6.2, rebuilt on `sf-data-table` in M35.23): every unreleased (asset, language) of the project,
 * server-paged, filtered through the URL, with the released-to-draft diff of the open row in an `sf-splitter` pane and
 * — for whoever may release — multi-select Release, Discard and Schedule on the current page. One action is one
 * revision; afterwards the list re-reads and the selection clears.
 *
 * <p>This component owns the router-bound query, the load effect and the release / discard / schedule actions; the
 * filter bar, the table and the diff are sub-components sharing the feature-scoped {@link ChangesStore}.
 */
@Component({
  selector: 'sf-changes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    SfBadgeComponent,
    SfBannerComponent,
    SfPageHeaderComponent,
    SfSplitterComponent,
    TranslocoPipe,
    ReleaseDialogComponent,
    ScheduleDialogComponent,
    ChangesFiltersComponent,
    ChangesListComponent,
    ChangesDiffComponent,
  ],
  providers: [ChangesStore],
  templateUrl: './changes.component.html',
  styleUrl: './changes.component.scss',
})
export class ChangesComponent {
  private readonly events = inject(ReleaseEventsStore);
  private readonly transloco = inject(TranslocoService);
  protected readonly store = inject(ChangesStore);
  protected readonly permissions = inject(ProjectPermissionsStore);
  protected readonly access = inject(ProjectAccessStore);

  readonly projectKey = input.required<string>();
  // The query string, bound by the router (`type`, `status` and `locale` may repeat).
  readonly type = input<QueryValue>();
  readonly status = input<QueryValue>();
  readonly locale = input<QueryValue>();
  readonly changedBy = input<string | undefined>();
  readonly folder = input<string | undefined>();
  readonly q = input<string | undefined>();
  readonly sort = input<string | undefined>();
  readonly page = input<string | undefined>();

  protected readonly state = computed<ChangesState>(() =>
    stateFromParams({
      type: this.type(),
      status: this.status(),
      locale: this.locale(),
      changedBy: this.changedBy(),
      folder: this.folder(),
      q: this.q(),
      sort: this.sort(),
      page: this.page(),
    }),
  );

  protected readonly dialog = signal<{ mode: ReleaseMode; choices: ReleaseChoice[] } | null>(null);
  /** The schedule dialog's offer: the selection as releasable and as unpublishable items, and the kinds the viewer may create. */
  protected readonly scheduling = signal<{ types: ScheduleType[]; choices: ReleaseChoice[]; unpublishChoices: ReleaseChoice[] } | null>(null);

  constructor() {
    // Alt+Shift+R releases the selected changes (M35.14).
    inject(ShortcutService).use([
      {
        id: 'release',
        keys: 'Alt+Shift+R',
        scope: 'screen',
        group: 'publishing',
        description: 'frame.shortcuts.items.release',
        allowInInput: true,
        enabled: () => this.permissions.canRelease() && this.store.selectedRows().length > 0 && this.dialog() === null,
        handler: () => this.releaseSelected(),
        palette: { icon: 'rocket_launch', label: 'frame.shortcuts.items.releaseSelected' },
      },
    ]);
    this.store.connect(this.projectKey, this.state);
    effect(() => {
      const key = this.projectKey();
      const state = this.state();
      this.events.version();
      untracked(() => this.store.reload(key, state));
    });
  }

  private choicesOf(rows: readonly ChangeRowView[]): ReleaseChoice[] {
    return rows.map((row) => {
      const name = row.displayName || row.uid || this.transloco.translate('changes.page.untitled');
      const status = this.transloco.translate(`enum.releaseStatus.${row.status}`);
      return {
        assetUuid: row.uuid ?? '',
        locale: row.locale ?? '',
        label: `${name}${row.locale ? ` · ${row.locale.toUpperCase()}` : ''} — ${status}`,
        status: (row.status as ReleaseStatus) ?? null,
        checked: true,
        assetType: row.type,
        assetName: name,
        folderPath: row.folderPath,
      };
    });
  }

  protected releaseSelected(rows: readonly ChangeRowView[] = this.store.selectedRows()): void {
    this.dialog.set({ mode: 'release', choices: this.choicesOf(rows) });
  }

  protected discardSelected(rows: readonly ChangeRowView[] = this.store.selectedRows()): void {
    this.dialog.set({ mode: 'discard', choices: this.choicesOf(rows.filter((row) => eligible('discard', row.status))) });
  }

  protected scheduleSelected(rows: readonly ChangeRowView[] = this.store.selectedRows()): void {
    const unpublishChoices = this.choicesOf(rows.filter((row) => eligible('unpublish', row.status)));
    // Release and unpublish take the selection's items (unpublish only those that are online); generation takes none.
    const types: ScheduleType[] = [
      'RELEASE',
      ...(unpublishChoices.length > 0 ? (['UNPUBLISH'] as const) : []),
      ...(this.permissions.canScheduleGeneration() ? (['GENERATION', 'RECURRING_GENERATION'] as const) : []),
    ];
    this.scheduling.set({ types, choices: this.choicesOf(rows), unpublishChoices });
  }
}
