import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfDataTableColumn } from '../../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../../shared/components/data-table/sf-data-table.component';
import { SfAvatarComponent } from '../../../../shared/components/display/sf-avatar.component';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../../../shared/components/display/sf-relative-time.component';
import { SfTagComponent } from '../../../../shared/components/display/sf-tag.component';
import { SfSearchInputComponent } from '../../../../shared/components/forms/sf-search-input.component';
import { SfPageHeaderComponent } from '../../../../shared/components/layout/sf-page-header.component';
import { SfMenuComponent } from '../../../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { SfSplitterComponent } from '../../../../shared/components/splitter/sf-splitter.component';
import { injectSampleQuery, injectSampleText, minutesAgo, oneOf } from '../changes/sample-area.util';
import { historyFilterMenus } from './history-filter-menus';
import {
  FIXED_REVISION,
  HISTORY,
  HISTORY_KINDS,
  HISTORY_KIND_ICONS,
  HISTORY_PEOPLE,
  HISTORY_RANGES,
  HistoryDateFilter,
  HistoryKind,
  HistoryRevision,
  NO_DATE_FILTER,
  inRange,
  revisionById,
} from './history-data';
import { HistoryRangeDialogComponent } from '../../../history/history-range-dialog.component';
import { SampleHistoryRevisionComponent } from './sample-history-revision.component';

/** `by:anna,kind:edit,range:week,q:price` ⇄ the filters (the `hfilter` query parameter); `range:custom,from:2026-09-01,to:2026-09-30`. */
export interface HistoryFilters {
  readonly by: string | null;
  readonly kind: HistoryKind | null;
  readonly date: HistoryDateFilter;
  readonly q: string;
}

export const NO_HISTORY_FILTERS: HistoryFilters = { by: null, kind: null, date: NO_DATE_FILTER, q: '' };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseHistoryFilter(value: string | null): HistoryFilters {
  let by: string | null = null;
  let kind: HistoryKind | null = null;
  let range: HistoryDateFilter['range'] = 'any';
  let from: string | null = null;
  let to: string | null = null;
  let q = '';
  for (const part of (value ?? '').split(',')) {
    const at = part.indexOf(':');
    if (at <= 0) {
      continue;
    }
    const key = part.slice(0, at);
    const val = part.slice(at + 1);
    if (key === 'by' && HISTORY_PEOPLE.some((p) => p.id === val)) {
      by = val;
    } else if (key === 'kind') {
      kind = oneOf(val, HISTORY_KINDS);
    } else if (key === 'range') {
      range = oneOf(val, HISTORY_RANGES) ?? 'any';
    } else if (key === 'from' && ISO_DAY.test(val)) {
      from = val;
    } else if (key === 'to' && ISO_DAY.test(val)) {
      to = val;
    } else if (key === 'q') {
      q = val;
    }
  }
  const custom = range === 'custom' && (from !== null || to !== null);
  const date: HistoryDateFilter = custom ? { range, from, to } : { range: range === 'custom' ? 'any' : range, from: null, to: null };
  return { by, kind, date, q };
}

export function formatHistoryFilter({ by, kind, date, q }: HistoryFilters): string | null {
  const parts: string[] = [];
  if (by) {
    parts.push(`by:${by}`);
  }
  if (kind) {
    parts.push(`kind:${kind}`);
  }
  if (date.range !== 'any') {
    parts.push(`range:${date.range}`);
    if (date.range === 'custom') {
      if (date.from) {
        parts.push(`from:${date.from}`);
      }
      if (date.to) {
        parts.push(`to:${date.to}`);
      }
    }
  }
  if (q.trim()) {
    parts.push(`q:${q.trim().replace(/,/g, ' ')}`);
  }
  return parts.length ? parts.join(',') : null;
}

export function filterHistory(filters: HistoryFilters, now = Date.now()): HistoryRevision[] {
  const q = filters.q.trim().toLowerCase();
  return HISTORY.filter(
    (r) =>
      (!filters.by || r.by.id === filters.by) &&
      (!filters.kind || r.kind === filters.kind) &&
      inRange(r.minutes, filters.date, now) &&
      (!q || r.summary.toLowerCase().includes(q) || r.assets.some((a) => a.name.toLowerCase().includes(q))),
  );
}

/**
 * The sample's full History page (M35.9 review round 2, M35.12; the route moved out of Settings in M35.11):
 * `sf-page-header` with the count, a filter bar (search, author, type, date) whose state lives in the URL, and an
 * `sf-data-table` timeline — revision, when, author, human summary, type, changed assets by name. A row opens the
 * revision's detail in an `sf-splitter` pane: the changed assets with their field diffs, **View this state** (time
 * travel) and **Roll back project** (danger, typed confirmation).
 *
 * Query parameters (read on load, written back by replacing the history entry, removed when the area closes):
 * `hfilter=by:anna,kind:edit,range:week,q:price`, `hrev=<revision>` (`hrev=1` opens the fixed revision).
 */
@Component({
  selector: 'sf-sample-history-area',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    HistoryRangeDialogComponent,
    SampleHistoryRevisionComponent,
    SfAvatarComponent,
    SfBadgeComponent,
    SfButtonComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfIconComponent,
    SfMenuComponent,
    SfPageHeaderComponent,
    SfRelativeTimeComponent,
    SfSearchInputComponent,
    SfSplitterComponent,
    SfTagComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-history-area.component.html',
  styleUrl: './sample-history-area.component.scss',
})
export class SampleHistoryAreaComponent {
  /** A revision to open (the drawer's *Details*). */
  readonly open = input<number | null>(null);

  protected readonly t = injectSampleText('styleguide.sample.history');
  private readonly query = injectSampleQuery();
  private readonly now = Date.now();

  protected readonly kindIcons = HISTORY_KIND_ICONS;
  protected readonly filters = signal<HistoryFilters>(NO_HISTORY_FILTERS);
  protected readonly rangeDialog = signal(false);
  protected readonly revisionId = signal<number | null>(null);

  protected readonly rows = computed(() => filterHistory(this.filters(), this.now));
  protected readonly selected = computed(() => (this.revisionId() === null ? null : revisionById(this.revisionId()!)));
  protected readonly filtered = computed(() => formatHistoryFilter(this.filters()) !== null);

  protected readonly menus = computed(() => {
    const f = this.filters();
    return historyFilterMenus(
      this.t,
      { by: f.by, kind: f.kind, date: f.date },
      {
        by: (by) => this.filters.update((s) => ({ ...s, by })),
        kind: (kind) => this.filters.update((s) => ({ ...s, kind })),
        date: (date) => this.filters.update((s) => ({ ...s, date })),
        custom: () => this.rangeDialog.set(true),
      },
    );
  });

  protected readonly columns = computed<SfDataTableColumn<HistoryRevision>[]>(() => {
    const header = (id: string) => this.t(`columns.${id}`);
    return [
      { id: 'rev', header: header('rev'), value: (r) => r.id, width: 96, hideable: false },
      { id: 'summary', header: header('summary'), value: (r) => r.summary, width: 340, hideable: false },
      { id: 'kind', header: header('kind'), value: (r) => r.kind, width: 130 },
      { id: 'changed', header: header('changed'), value: (r) => r.assets.length, width: 240 },
      { id: 'by', header: header('by'), value: (r) => r.by.name, width: 220 },
    ];
  });

  protected readonly rowKey = (row: HistoryRevision) => String(row.id);
  protected readonly rowLabel = (row: HistoryRevision) => this.t('revision', { n: row.id });

  constructor() {
    const filters = parseHistoryFilter(this.query.get('hfilter'));
    this.filters.set(filters);
    const rev = this.query.get('hrev');
    if (rev) {
      const id = rev === '1' ? FIXED_REVISION : Number(rev);
      this.revisionId.set(revisionById(id) ? id : null);
    }
    effect(
      () => {
        const opened = this.open();
        if (opened !== null && revisionById(opened)) {
          this.revisionId.set(opened);
        }
      },
      { allowSignalWrites: true },
    );
    effect(() => this.query.set({ hfilter: formatHistoryFilter(this.filters()), hrev: this.revisionId() === null ? null : String(this.revisionId()) }));
    inject(DestroyRef).onDestroy(() => this.query.set({ hfilter: null, hrev: null }));
  }

  protected clear(): void {
    this.filters.set(NO_HISTORY_FILTERS);
  }

  protected applyRange(range: { readonly from: string | null; readonly to: string | null }): void {
    this.filters.update((f) => ({ ...f, date: { range: 'custom', ...range } }));
    this.rangeDialog.set(false);
  }

  protected setSearch(q: string): void {
    this.filters.update((f) => ({ ...f, q }));
  }

  protected openRevision(row: HistoryRevision): void {
    this.revisionId.set(row.id);
  }

  protected minutesAgo(minutes: number): number {
    return minutesAgo(minutes, this.now);
  }

  protected assetNames(row: HistoryRevision): { names: string; more: number } {
    const [first, second, ...rest] = row.assets;
    return { names: [first, second].filter(Boolean).map((a) => a.name).join(', '), more: rest.length };
  }
}
