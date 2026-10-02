import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfDrawerComponent } from '../../../../shared/components/dialog/sf-drawer.component';
import { SfAvatarComponent } from '../../../../shared/components/display/sf-avatar.component';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../../../shared/components/display/sf-relative-time.component';
import { SfTagComponent } from '../../../../shared/components/display/sf-tag.component';
import { SfMenuComponent } from '../../../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { injectSampleText, minutesAgo } from '../changes/sample-area.util';
import { injectHistoryActions } from './history-actions';
import { HistoryFilterMenu, historyFilterMenus } from './history-filter-menus';
import {
  HISTORY,
  HISTORY_KIND_ICONS,
  HistoryDateFilter,
  HistoryKind,
  HistoryRevision,
  NO_DATE_FILTER,
  PAGE_ASSET,
  RECORD_ASSET,
  inRange,
  versionsOf,
} from './history-data';
import { SampleHistoryDiffComponent } from './sample-history-diff.component';
import { HistoryRangeDialogComponent } from '../../../history/history-range-dialog.component';

/** Where the drawer was opened: an editor (that asset's versions) or anywhere else (the project's timeline). */
export type HistoryContext = 'page' | 'record' | 'project';

/**
 * The History drawer (M35.9 review round 2, M35.12). It starts **below the top bar** (decision), so the bar stays
 * usable.
 *
 * - **In an editor** (`page`, `record`): that asset's versions, newest first — the current one on top. Each entry shows
 *   the time, the author's name, a human summary and the languages touched. *View* time-travels to it, *Compare with
 *   current* opens the field diff under the entry, *Restore* confirms and then offers Undo (not on the current one).
 * - **Elsewhere** (`project`): the project's timeline, filterable by author, type and date; each entry names the
 *   changed assets. *View* time-travels to the revision, *Details* opens it on the full history page.
 * - **Open full history** (footer) leads to the full page in both contexts.
 */
@Component({
  selector: 'sf-sample-history-drawer',
  standalone: true,
  imports: [
    SampleHistoryDiffComponent,
    HistoryRangeDialogComponent,
    SfAvatarComponent,
    SfBadgeComponent,
    SfButtonComponent,
    SfDrawerComponent,
    SfIconComponent,
    SfMenuComponent,
    SfRelativeTimeComponent,
    SfTagComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-history-drawer.component.html',
  styleUrl: './sample-history-drawer.component.scss',
})
export class SampleHistoryDrawerComponent {
  readonly context = input.required<HistoryContext>();
  readonly closed = output<void>();
  /** *Open full history* / *Details*: the revision to select (`null` = the page as it is). */
  readonly openFull = output<number | null>();

  protected readonly t = injectSampleText('styleguide.sample.history');
  private readonly actions = injectHistoryActions();
  private readonly now = Date.now();

  protected readonly kindIcons = HISTORY_KIND_ICONS;
  protected readonly author = signal<string | null>(null);
  protected readonly kind = signal<HistoryKind | null>(null);
  protected readonly date = signal<HistoryDateFilter>(NO_DATE_FILTER);
  protected readonly rangeDialog = signal(false);
  /** The entry whose comparison with the current state is open. */
  protected readonly comparing = signal<number | null>(null);

  protected readonly asset = computed(() => (this.context() === 'page' ? PAGE_ASSET : this.context() === 'record' ? RECORD_ASSET : null));
  protected readonly isProject = computed(() => this.asset() === null);

  protected readonly title = computed(() => {
    switch (this.context()) {
      case 'page':
        return this.t('pageTitle', { name: 'Spring harvest arrives' });
      case 'record':
        return this.t('pageTitle', { name: 'Yirgacheffe Konga 250 g' });
      default:
        return this.t('projectTitle');
    }
  });

  protected readonly entries = computed<readonly HistoryRevision[]>(() => {
    const asset = this.asset();
    const source = asset ? versionsOf(asset) : HISTORY;
    const author = this.author();
    const kind = this.kind();
    const date = this.date();
    return source.filter((r) => (!author || r.by.id === author) && (!kind || r.kind === kind) && inRange(r.minutes, date, this.now));
  });
  /** The newest version of the asset is the current state. */
  protected readonly currentId = computed(() => {
    const asset = this.asset();
    return asset ? (versionsOf(asset)[0]?.id ?? null) : null;
  });

  protected readonly filtered = computed(() => this.author() !== null || this.kind() !== null || this.date().range !== 'any');

  protected readonly menus = computed<HistoryFilterMenu[]>(() =>
    historyFilterMenus(
      this.t,
      { by: this.author(), kind: this.kind(), date: this.date() },
      {
        by: (v) => this.author.set(v),
        kind: (v) => this.kind.set(v),
        date: (v) => this.date.set(v),
        custom: () => this.rangeDialog.set(true),
      },
    ),
  );

  protected minutesAgo(minutes: number): number {
    return minutesAgo(minutes, this.now);
  }

  protected clear(): void {
    this.author.set(null);
    this.kind.set(null);
    this.date.set(NO_DATE_FILTER);
  }

  protected view(revision: HistoryRevision): void {
    this.actions.view(revision);
  }

  protected restore(revision: HistoryRevision): void {
    void this.actions.restoreAsset(revision, revision.assets[0]);
  }

  protected toggleCompare(revision: HistoryRevision): void {
    this.comparing.update((open) => (open === revision.id ? null : revision.id));
  }

  /** The first changed assets by name, then "+ N more". */
  protected assetNames(revision: HistoryRevision): { names: string; more: number } {
    const [first, second, ...rest] = revision.assets;
    return { names: [first, second].filter(Boolean).map((a) => a.name).join(', '), more: rest.length };
  }

  protected langsOf(revision: HistoryRevision): string[] {
    return [...new Set(revision.assets.flatMap((a) => a.langs))].map((l) => l.toUpperCase());
  }
}
