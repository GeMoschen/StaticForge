import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfDataTableBulkAction, SfDataTableColumn, SfDataTableSelection } from '../../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../../shared/components/data-table/sf-data-table.component';
import { ConfirmService } from '../../../../shared/components/dialog/confirm.service';
import { SfAvatarComponent } from '../../../../shared/components/display/sf-avatar.component';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../../shared/components/display/sf-status.component';
import { SfTagComponent } from '../../../../shared/components/display/sf-tag.component';
import { SfFilterGroup, SfFilterPopoverComponent } from '../../../../shared/components/filter/sf-filter-popover.component';
import { SfSearchInputComponent } from '../../../../shared/components/forms/sf-search-input.component';
import { SfPageHeaderComponent } from '../../../../shared/components/layout/sf-page-header.component';
import { SfMenuComponent, SfMenuItem } from '../../../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { SfSplitterComponent } from '../../../../shared/components/splitter/sf-splitter.component';
import { SfTooltipDirective } from '../../../../shared/directives/sf-tooltip.directive';
import {
  CHANGES,
  CHANGE_LANGS,
  CHANGE_LANG_NAMES,
  CHANGE_PEOPLE,
  CHANGE_STATUSES,
  CHANGE_STATUS_ICONS,
  CHANGE_STATUS_TONES,
  CHANGE_TYPES,
  CHANGE_TYPE_ICONS,
  ChangeLang,
  DEFAULT_LANG,
  FIXED_DIFF,
  SampleChange,
} from './changes-data';
import { SampleChangeDiffComponent } from './sample-change-diff.component';
import { ReleaseLanguage, SampleReleaseDialogComponent } from './sample-release-dialog.component';
import { SampleScheduleDialogComponent } from './sample-schedule-dialog.component';
import { injectSampleDevMode, injectSampleNotice, injectSampleQuery, injectSampleText, minutesAgo, oneOf } from './sample-area.util';

/** The filters of the bar, in its order. Type, status and language take several picks (the Filters popover); changed by and folder one. */
export type ChangeFilterId = 'type' | 'status' | 'lang' | 'by' | 'folder';
export const CHANGE_FILTER_IDS: readonly ChangeFilterId[] = ['type', 'status', 'lang', 'by', 'folder'];
/** The filters inside the popover; the others are menus. */
const POPOVER_IDS = ['type', 'status', 'lang'] as const;
const MULTI_IDS: readonly ChangeFilterId[] = POPOVER_IDS;
export type ChangeSort = 'newest' | 'oldest' | 'az' | 'za';
const SORTS: readonly ChangeSort[] = ['newest', 'oldest', 'az', 'za'];

type ChangeFilters = Readonly<Partial<Record<ChangeFilterId, readonly string[]>>>;

interface FilterOption {
  readonly value: string;
  readonly label: string;
}

/** The folders of the changes, with a URL-safe id. */
const FOLDERS: readonly FilterOption[] = [...new Set(CHANGES.map((c) => c.folder))]
  .sort()
  .map((label) => ({ value: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), label }));

/** `type:page|media,lang:en,sort:az` (several picks joined by `|`) ⇄ filters, search and sort (the `cfilter` query parameter). */
export function parseChangeFilter(value: string | null): { filters: ChangeFilters; sort: ChangeSort; q: string } {
  const filters: Partial<Record<ChangeFilterId, string[]>> = {};
  let sort: ChangeSort = 'newest';
  let q = '';
  for (const part of (value ?? '').split(',')) {
    const at = part.indexOf(':');
    if (at <= 0) {
      continue;
    }
    const key = part.slice(0, at);
    const val = part.slice(at + 1);
    if (key === 'sort') {
      sort = oneOf(val, SORTS) ?? sort;
    } else if (key === 'q') {
      q = val;
    } else if ((CHANGE_FILTER_IDS as readonly string[]).includes(key) && val) {
      const id = key as ChangeFilterId;
      const values = (MULTI_IDS.includes(id) ? val.split('|') : [val]).filter(Boolean);
      if (values.length) {
        filters[id] = values;
      }
    }
  }
  return { filters, sort, q };
}

export function formatChangeFilter(filters: ChangeFilters, sort: ChangeSort, q: string): string | null {
  const parts = CHANGE_FILTER_IDS.filter((id) => filters[id]?.length).map((id) => `${id}:${filters[id]!.join('|')}`);
  if (q.trim()) {
    parts.push(`q:${q.trim().replace(/,/g, ' ')}`);
  }
  if (sort !== 'newest') {
    parts.push(`sort:${sort}`);
  }
  return parts.length ? parts.join(',') : null;
}

/**
 * Orders the rows: by the sort, keeping an asset's language rows together with the default language first (decision
 * 20: one row per language).
 */
export function sortChanges(rows: readonly SampleChange[], sort: ChangeSort): SampleChange[] {
  const latest = new Map<string, number>();
  for (const row of rows) {
    latest.set(row.asset, Math.min(latest.get(row.asset) ?? Number.MAX_SAFE_INTEGER, row.minutes));
  }
  const langOrder = (lang: ChangeLang) => (lang === DEFAULT_LANG ? 0 : 1 + CHANGE_LANGS.indexOf(lang));
  return [...rows].sort((a, b) => {
    let byAsset = 0;
    if (sort === 'newest' || sort === 'oldest') {
      byAsset = latest.get(a.asset)! - latest.get(b.asset)!;
      byAsset = sort === 'newest' ? byAsset : -byAsset;
    } else {
      byAsset = a.name.localeCompare(b.name);
      byAsset = sort === 'az' ? byAsset : -byAsset;
    }
    return byAsset || a.asset.localeCompare(b.asset) || langOrder(a.lang) - langOrder(b.lang);
  });
}

/** Pages and records are written per language; media, globals and navigation links are not (release key `""`). */
export function isLanguageSpecific(row: SampleChange): boolean {
  return row.type === 'page' || row.type === 'record';
}

/** The release dialog's languages for a set of rows: every language, the changed ones choosable. */
export function releaseLanguagesOf(rows: readonly SampleChange[], statusLabel: (row: SampleChange | null) => string): ReleaseLanguage[] {
  return CHANGE_LANGS.map((lang) => {
    const row = rows.find((r) => r.lang === lang) ?? null;
    return { lang, status: statusLabel(row), changed: row !== null };
  });
}

/**
 * The sample's Changes area (M35.9 decision 26, M35.23): `sf-page-header` with the count, a compact one-row filter bar
 * (search, a Filters popover with type, status and language, changed by, folder, sort) with removable chips below only while a filter is active,
 * and an `sf-data-table` with one row per language (default language first), selection and bulk Release / Discard /
 * Schedule. A row opens its diff in an `sf-splitter` pane on the right.
 *
 * Query parameters (read on load, written back by replacing the history entry, removed when the area closes):
 * `cfilter=type:page,status:changed,lang:en,by:anna,folder:pages-news,q:harvest,sort:az`, `diff=<row id>`
 * (`diff=1` opens the fixed row), `sel=<n>` (the first n rows selected → bulk bar), `release=1` (the release dialog for
 * the selection, else the diff row, else the fixed page). Developer mode: UIDs and the folder column.
 */
@Component({
  selector: 'sf-sample-changes-area',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    SampleChangeDiffComponent,
    SampleReleaseDialogComponent,
    SampleScheduleDialogComponent,
    SfAvatarComponent,
    SfBadgeComponent,
    SfButtonComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfFilterPopoverComponent,
    SfIconComponent,
    SfMenuComponent,
    SfPageHeaderComponent,
    SfRelativeTimeComponent,
    SfSearchInputComponent,
    SfSplitterComponent,
    SfStatusComponent,
    SfTagComponent,
    SfTooltipDirective,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-changes-area.component.html',
  styleUrl: './sample-changes-area.component.scss',
})
export class SampleChangesAreaComponent {
  protected readonly t = injectSampleText('styleguide.sample.changes');
  protected readonly dev = injectSampleDevMode();
  private readonly query = injectSampleQuery();
  private readonly notice = injectSampleNotice();
  private readonly confirms = inject(ConfirmService);
  private readonly table = viewChild<SfDataTableComponent<SampleChange>>(SfDataTableComponent);

  protected readonly tones = CHANGE_STATUS_TONES;
  protected readonly statusIcons = CHANGE_STATUS_ICONS;
  protected readonly typeIcons = CHANGE_TYPE_ICONS;
  protected readonly langNames = CHANGE_LANG_NAMES;
  protected readonly defaultLang = DEFAULT_LANG;
  private readonly now = Date.now();

  protected readonly filters = signal<ChangeFilters>({});
  protected readonly sort = signal<ChangeSort>('newest');
  protected readonly search = signal('');
  protected readonly diffId = signal<string | null>(null);
  protected readonly selected = signal<readonly string[]>([]);
  protected readonly release = signal<{ readonly subject: string; readonly languages: readonly ReleaseLanguage[]; readonly shared: number } | null>(null);
  protected readonly schedule = signal<{ readonly subject: string } | null>(null);

  protected readonly rows = computed(() => {
    const filters = this.filters();
    const q = this.search().trim().toLowerCase();
    const has = (id: ChangeFilterId, value: string) => !filters[id]?.length || filters[id]!.includes(value);
    const folderLabels = (filters.folder ?? []).map((value) => FOLDERS.find((f) => f.value === value)?.label);
    const matching = CHANGES.filter(
      (c) =>
        has('type', c.type) &&
        has('status', c.status) &&
        has('lang', c.lang) &&
        has('by', c.by.id) &&
        (folderLabels.length === 0 || folderLabels.includes(c.folder)) &&
        (!q || c.name.toLowerCase().includes(q) || (this.dev() && c.uid.includes(q))),
    );
    return sortChanges(matching, this.sort());
  });
  protected readonly diff = computed(() => CHANGES.find((c) => c.id === this.diffId()) ?? null);
  protected readonly filtered = computed(() => CHANGE_FILTER_IDS.some((id) => this.filters()[id]?.length) || this.search().trim() !== '');

  /** Type, status and language: the groups of the Filters popover. */
  protected readonly groups = computed<SfFilterGroup[]>(() =>
    POPOVER_IDS.map((id) => ({
      id,
      label: this.t(`filters.${id}`),
      options: this.optionsOf(id).map((o) => (id === 'type' ? { ...o, icon: CHANGE_TYPE_ICONS[o.value as keyof typeof CHANGE_TYPE_ICONS] } : o)),
    })),
  );
  protected readonly popoverPicked = computed(() => {
    const filters = this.filters();
    return { type: filters.type ?? [], status: filters.status ?? [], lang: filters.lang ?? [] };
  });

  /** Changed by and folder stay menus: their trigger text names the pick, the items tick it. */
  protected readonly filterMenus = computed(() => {
    const filters = this.filters();
    return (['by', 'folder'] as const).map((id) => {
      const options = this.optionsOf(id);
      const picked = options.find((o) => o.value === filters[id]?.[0]);
      const name = this.t(`filters.${id}`);
      const items: SfMenuItem[] = [
        { id: '', label: this.t(`filters.any.${id}`), icon: picked ? undefined : 'check', action: () => this.setFilter(id, null) },
        ...options.map((o, i) => ({
          id: o.value,
          label: o.label,
          icon: picked?.value === o.value ? 'check' : undefined,
          separatorBefore: i === 0,
          action: () => this.setFilter(id, o.value),
        })),
      ];
      return { id, name, text: picked ? this.t('filters.picked', { filter: name, value: picked.label }) : name, items };
    });
  });

  protected readonly sortItems = computed<SfMenuItem[]>(() =>
    SORTS.map((sort) => ({
      id: sort,
      label: this.t(`sort.${sort}`),
      icon: this.sort() === sort ? 'check' : undefined,
      action: () => this.sort.set(sort),
    })),
  );

  /** One removable chip per picked value. */
  protected readonly chips = computed(() => {
    const filters = this.filters();
    return CHANGE_FILTER_IDS.flatMap((id) =>
      (filters[id] ?? []).map((value) => ({
        id,
        value,
        label: this.t('filters.picked', { filter: this.t(`filters.${id}`), value: this.optionsOf(id).find((o) => o.value === value)?.label ?? value }),
      })),
    );
  });

  protected readonly columns = computed<SfDataTableColumn<SampleChange>[]>(() => {
    const header = (id: string) => this.t(`columns.${id}`);
    const columns: SfDataTableColumn<SampleChange>[] = [
      { id: 'name', header: header('name'), value: (r) => r.name, hideable: false, width: 260 },
      { id: 'lang', header: header('lang'), value: (r) => r.lang, width: 104 },
      { id: 'status', header: header('status'), value: (r) => r.status, width: 150 },
      { id: 'changed', header: header('changed'), value: (r) => r.minutes, width: 220 },
    ];
    if (this.dev()) {
      columns.push({ id: 'folder', header: header('folder'), value: (r) => r.folder, width: 220 });
    }
    return columns;
  });

  protected readonly bulkActions = computed<SfDataTableBulkAction<SampleChange>[]>(() => [
    { id: 'release', label: this.t('bulk.release'), icon: 'publish', variant: 'primary', action: (s) => this.openRelease(s.rows) },
    { id: 'schedule', label: this.t('bulk.schedule'), icon: 'schedule', action: (s) => this.openSchedule(s.rows) },
    { id: 'discard', label: this.t('bulk.discard'), icon: 'undo', variant: 'danger-ghost', action: (s) => void this.discard(s) },
  ]);

  protected readonly rowKey = (row: SampleChange) => row.id;
  protected readonly rowLabel = (row: SampleChange) => `${row.name} (${row.lang.toUpperCase()})`;

  constructor() {
    this.readQuery();

    // The selection survives the table being re-created (opening or closing the diff pane re-parents it).
    effect(
      () => {
        const table = this.table();
        if (table) {
          untracked(() => table.selectKeys(this.selected()));
        }
      },
      { allowSignalWrites: true },
    );

    effect(() =>
      this.query.set({
        cfilter: formatChangeFilter(this.filters(), this.sort(), this.search()),
        diff: this.diffId(),
        sel: this.selected().length ? String(this.selected().length) : null,
        release: this.release() ? '1' : null,
      }),
    );
    inject(DestroyRef).onDestroy(() => this.query.set({ cfilter: null, diff: null, sel: null, release: null }));
  }

  /** Sets a single-pick filter (changed by, folder), or clears it with `null`. */
  protected setFilter(id: ChangeFilterId, value: string | null): void {
    this.filters.update((filters) => {
      const next = { ...filters };
      if (value === null) {
        delete next[id];
      } else {
        next[id] = [value];
      }
      return next;
    });
  }

  /** Turns one value of a filter on or off (the popover's tags and the chips' remove). */
  protected toggleFilter(id: string, value: string): void {
    const key = id as ChangeFilterId;
    this.filters.update((filters) => {
      const current = filters[key] ?? [];
      const values = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      const next = { ...filters };
      if (values.length) {
        next[key] = values;
      } else {
        delete next[key];
      }
      return next;
    });
  }

  protected clearPopover(): void {
    this.filters.update(({ by, folder }) => ({ ...(by ? { by } : {}), ...(folder ? { folder } : {}) }));
  }

  protected clearFilters(): void {
    this.filters.set({});
    this.search.set('');
  }

  protected openDiff(row: SampleChange): void {
    this.diffId.set(row.id);
  }

  protected onSelection(selection: SfDataTableSelection<SampleChange>): void {
    this.selected.set(selection.keys);
  }

  protected minutesAgo(minutes: number): number {
    return minutesAgo(minutes, this.now);
  }

  protected openRelease(rows: readonly SampleChange[]): void {
    const assets = new Set(rows.map((r) => r.asset));
    // One asset: all its languages (unchanged ones shown as released); several: the languages of the selection.
    const scope = (assets.size === 1 ? CHANGES.filter((c) => c.asset === rows[0].asset) : rows).filter(isLanguageSpecific);
    // Media, globals and navigation links have no language: they are one checkbox, not a row per language.
    const shared = new Set(rows.filter((r) => !isLanguageSpecific(r)).map((r) => r.asset)).size;
    this.release.set({
      shared,
      subject: assets.size === 1 ? rows[0].name : this.t('itemCount', { count: assets.size }),
      languages: scope.length === 0 ? [] : releaseLanguagesOf(scope, (row) => (row ? this.t(`statuses.${row.status}`) : this.t('statuses.released'))),
    });
  }

  protected openSchedule(rows: readonly SampleChange[]): void {
    const assets = new Set(rows.map((r) => r.asset));
    const langs = [...new Set(rows.map((r) => r.lang.toUpperCase()))].join(', ');
    this.schedule.set({
      subject: assets.size === 1 ? `${rows[0].name} (${langs})` : this.t('itemCount', { count: assets.size }),
    });
  }

  private async discard(selection: SfDataTableSelection<SampleChange>): Promise<void> {
    const rows = selection.rows.filter((r) => r.status === 'changed' || r.status === 'deletion');
    if (rows.length === 0) {
      this.notice(this.t('discardNothing'));
      return;
    }
    const confirmed = await this.confirms.confirm({
      title: this.t('discardTitle', { count: rows.length }),
      message: this.t('discardMessage'),
      confirmLabel: this.t('discardConfirm', { count: rows.length }),
      tone: 'danger',
      details: rows.map(this.rowLabel),
    });
    if (confirmed) {
      this.table()?.clearSelection();
      this.notice(this.t('discarded', { count: rows.length }));
    }
  }

  private optionsOf(id: ChangeFilterId): readonly FilterOption[] {
    switch (id) {
      case 'type':
        return CHANGE_TYPES.map((value) => ({ value, label: this.t(`types.${value}`) }));
      case 'status':
        return CHANGE_STATUSES.map((value) => ({ value, label: this.t(`statuses.${value}`) }));
      case 'lang':
        return CHANGE_LANGS.map((value) => ({ value, label: `${CHANGE_LANG_NAMES[value]} (${value.toUpperCase()})` }));
      case 'by':
        return CHANGE_PEOPLE.map((p) => ({ value: p.id, label: p.name }));
      case 'folder':
        return FOLDERS;
    }
  }

  private readQuery(): void {
    const { filters, sort, q } = parseChangeFilter(this.query.get('cfilter'));
    this.filters.set(filters);
    this.sort.set(sort);
    this.search.set(q);
    const diff = this.query.get('diff');
    if (diff) {
      this.diffId.set(diff === '1' ? FIXED_DIFF : CHANGES.some((c) => c.id === diff) ? diff : null);
    }
    const sel = Number(this.query.get('sel'));
    if (Number.isInteger(sel) && sel > 0) {
      this.selected.set(this.rows().slice(0, sel).map((r) => r.id));
    }
    if (this.query.get('release') === '1') {
      const selection = this.rows().filter((r) => this.selected().includes(r.id));
      const fallback = this.diff() ?? CHANGES.find((c) => c.id === FIXED_DIFF)!;
      this.openRelease(selection.length ? selection : [fallback]);
    }
  }
}
