import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { ReleaseDialogComponent } from '../release/release-dialog.component';
import { ReleaseEventsStore } from '../release/release-events.store';
import { type ReleaseChoice, type ReleaseMode, assetName } from '../release/release-choice.util';
import { type ReleaseStatus, localeTag, statusLabel } from '../release/release-status.util';
import { ScheduleDialogComponent } from '../schedules/schedule-dialog.component';
import { ChangesDiffComponent } from './changes-diff.component';
import { ChangesFiltersComponent } from './changes-filters.component';
import { ChangesListComponent } from './changes-list.component';
import { type ChangesState, type QueryValue, stateFromParams } from './changes-query.util';
import { type ChangeRowView, ChangesStore } from './changes.store';

/**
 * The Changes view (M27.6.2): every unreleased (asset, locale) of the project, server-paged, filtered through the URL,
 * with the released-to-draft diff of the focused row and — for whoever may release — multi-select Release,
 * Discard and Schedule on the current page. One action is one revision; afterwards the list re-reads and the
 * selection clears.
 *
 * <p>This component owns the router-bound query, the load effect and the release / discard / schedule actions; the
 * filter bar, the table and the diff are sub-components sharing the feature-scoped {@link ChangesStore}.
 */
@Component({
  selector: 'sf-changes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfButtonComponent,
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
  protected readonly scheduling = signal<ReleaseChoice[] | null>(null);

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

  private choicesOf(rows: ChangeRowView[]): ReleaseChoice[] {
    return rows.map((row) => ({
      assetUuid: row.uuid ?? '',
      locale: row.locale ?? '',
      label: `${assetName(row)}${row.locale ? ` · ${localeTag(row.locale)}` : ''} — ${statusLabel(row.status)}`,
      status: (row.status as ReleaseStatus) ?? null,
      checked: true,
      assetType: row.type,
      assetName: assetName(row),
      folderPath: row.folderPath,
    }));
  }

  protected releaseSelected(): void {
    this.dialog.set({ mode: 'release', choices: this.choicesOf(this.store.selectedRows()) });
  }

  protected discardSelected(): void {
    this.dialog.set({ mode: 'discard', choices: this.choicesOf(this.store.discardable()) });
  }

  protected scheduleSelected(): void {
    this.scheduling.set(this.choicesOf(this.store.selectedRows()));
  }
}
