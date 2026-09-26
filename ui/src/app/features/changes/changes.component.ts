import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChildren,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { Subscription } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { problemOf } from '../../core/api/problem.util';
import { LocalesStore } from '../../core/project/locales.store';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ProjectMembersStore } from '../../core/project/project-members.store';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfDiffComponent } from '../../shared/components/sf-diff.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfRelativeTimePipe } from '../../shared/pipes/sf-relative-time.pipe';
import { assetRoute } from '../../shared/asset-route.util';
import { ReleaseBadgeComponent } from '../release/release-badge.component';
import { ReleaseDialogComponent } from '../release/release-dialog.component';
import { ReleaseEventsStore } from '../release/release-events.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { type ReleaseChoice, type ReleaseMode, assetName, eligible, itemKey } from '../release/release-choice.util';
import { type ReleaseStatus, localeTag, statusLabel } from '../release/release-status.util';
import { ScheduleDialogComponent } from '../schedules/schedule-dialog.component';
import {
  CHANGE_STATUSES,
  CHANGE_TYPES,
  type ChangesState,
  type QueryValue,
  SORTS,
  paramsFromState,
  queryFromState,
  stateFromParams,
  typeInfo,
} from './changes-query.util';

type ChangeRowView = components['schemas']['ChangeRowView'];
type ChangeDiffView = components['schemas']['ChangeDiffView'];
type FolderView = components['schemas']['FolderView'];

const SEARCH_DEBOUNCE_MS = 300;

interface FolderOption {
  uuid: string;
  label: string;
}

/**
 * The Changes view (M27.6.2): every unreleased (asset, locale) of the project, server-paged, filtered through the URL,
 * with the released-to-draft diff of the focused row and — for whoever may release — multi-select Release,
 * Discard and Schedule on the current page. One action is one revision; afterwards the list re-reads and the
 * selection clears.
 *
 * <p>Keyboard (§24.6): ↑/↓ move between rows, Space toggles the row's selection, Enter opens its diff.
 */
@Component({
  selector: 'sf-changes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    SfButtonComponent,
    SfDiffComponent,
    SfEmptyStateComponent,
    SfIconComponent,
    SfSpinnerComponent,
    SfRelativeTimePipe,
    ReleaseBadgeComponent,
    ReleaseDialogComponent,
    ScheduleDialogComponent,
  ],
  templateUrl: './changes.component.html',
  styleUrl: './changes.component.scss',
})
export class ChangesComponent implements OnDestroy {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly events = inject(ReleaseEventsStore);
  private readonly context = inject(ProjectContextStore);
  protected readonly locales = inject(LocalesStore);
  protected readonly members = inject(ProjectMembersStore);
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

  protected readonly typeOptions = CHANGE_TYPES;
  protected readonly statusOptions = CHANGE_STATUSES;
  protected readonly sortOptions = SORTS;

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

  protected readonly rows = signal<ChangeRowView[]>([]);
  protected readonly total = signal(0);
  protected readonly totalPages = signal(0);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Selected rows by `uuid|locale`; only rows of the current page. */
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  /** The row whose diff is shown, and the row the keyboard is on. */
  protected readonly focusedKey = signal<string | null>(null);
  protected readonly activeIndex = signal(0);
  protected readonly diff = signal<ChangeDiffView | null>(null);
  protected readonly diffLoading = signal(false);
  protected readonly diffError = signal<string | null>(null);
  protected readonly searchDraft = signal('');
  protected readonly dialog = signal<{ mode: ReleaseMode; choices: ReleaseChoice[] } | null>(null);
  protected readonly scheduling = signal<ReleaseChoice[] | null>(null);

  private readonly rowElements = viewChildren<ElementRef<HTMLElement>>('row');
  private request: Subscription | null = null;
  private diffRequest: Subscription | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly localeOptions = computed(() =>
    this.locales.isLocalized()
      ? this.locales.locales().map((l) => ({ value: l.code ?? '', label: l.label || l.code || '' }))
      : [],
  );

  /** The editorial folders of every store, "Pages › About › Team", for the folder filter. */
  protected readonly folderOptions = computed<FolderOption[]>(() => {
    const out: FolderOption[] = [];
    const walk = (nodes: FolderView[], trail: string[]) => {
      for (const node of nodes) {
        if (!node.uuid || node.type === 'RECORD_SET') {
          continue;
        }
        const label = [...trail, node.displayName || node.uid || ''];
        out.push({ uuid: node.uuid, label: label.join(' › ') });
        walk(node.children ?? [], label);
      }
    };
    walk(this.context.pageFolderTree(), []);
    walk(this.context.mediaFolderTree(), []);
    walk(this.context.contentFolderTree(), []);
    walk(this.context.globalsFolderTree(), []);
    walk(this.context.navigationFolderTree(), []);
    return out;
  });

  /** The chosen filter values as removable chips. */
  protected readonly chips = computed(() => {
    const state = this.state();
    const chips: { key: string; label: string; remove: () => void }[] = [];
    for (const type of state.type) {
      chips.push({ key: `type:${type}`, label: typeInfo(type).label, remove: () => this.toggleIn('type', type) });
    }
    for (const status of state.status) {
      chips.push({ key: `status:${status}`, label: statusLabel(status), remove: () => this.toggleIn('status', status) });
    }
    for (const locale of state.locale) {
      chips.push({ key: `locale:${locale}`, label: locale ? this.locales.labelOf(locale) : 'All languages', remove: () => this.toggleIn('locale', locale) });
    }
    if (state.changedBy != null) {
      chips.push({ key: 'changedBy', label: `Changed by ${this.members.nameOf(state.changedBy)}`, remove: () => this.update({ changedBy: null }) });
    }
    if (state.folder) {
      const folder = this.folderOptions().find((f) => f.uuid === state.folder);
      chips.push({ key: 'folder', label: `In ${folder?.label ?? 'folder'}`, remove: () => this.update({ folder: null }) });
    }
    if (state.q) {
      chips.push({ key: 'q', label: `“${state.q}”`, remove: () => this.update({ q: '' }) });
    }
    return chips;
  });

  protected readonly selectedRows = computed(() => this.rows().filter((row) => this.selected().has(this.keyOf(row))));
  protected readonly allSelected = computed(() => this.rows().length > 0 && this.selectedRows().length === this.rows().length);
  protected readonly someSelected = computed(() => this.selectedRows().length > 0 && !this.allSelected());
  protected readonly discardable = computed(() => this.selectedRows().filter((row) => eligible('discard', row.status)));
  protected readonly focusedRow = computed(() => this.rows().find((row) => this.keyOf(row) === this.focusedKey()) ?? null);

  constructor() {
    effect(() => {
      const key = this.projectKey();
      const state = this.state();
      this.events.version();
      untracked(() => {
        this.members.load(key);
        if (!this.searchTimer) {
          this.searchDraft.set(state.q);
        }
        this.load(key, state);
      });
    });
  }

  ngOnDestroy(): void {
    this.request?.unsubscribe();
    this.diffRequest?.unsubscribe();
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }
  }

  protected keyOf(row: ChangeRowView): string {
    return itemKey(row.uuid, row.locale);
  }

  protected typeInfo = typeInfo;
  protected localeTag = localeTag;
  protected statusLabel = statusLabel;
  protected name = assetName;

  /** The badge input for one row: its own status in its own locale. */
  protected releaseOf(row: ChangeRowView): Record<string, { status: string }> {
    return { [row.locale ?? '']: { status: row.status ?? '' } };
  }

  protected folderText(row: ChangeRowView): string {
    // Stored paths start with the store root (`/pages_root/about/`): show the part below it.
    const segments = (row.folderPath ?? '').split('/').filter((s) => s.length > 0);
    return segments.length > 1 ? `/${segments.slice(1).join('/')}/` : '/';
  }

  protected editorRoute(row: ChangeRowView) {
    return assetRoute(this.projectKey(), row);
  }

  // ── Filters ────────────────────────────────────────────────────────────

  protected isIn(list: string[], value: string): boolean {
    return list.includes(value);
  }

  protected toggleIn(key: 'type' | 'status' | 'locale', value: string): void {
    const current = this.state()[key];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    this.update({ [key]: next });
  }

  protected onSelectFilter(key: 'changedBy' | 'folder' | 'sort', event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (key === 'changedBy') {
      this.update({ changedBy: value ? Number(value) : null });
    } else if (key === 'folder') {
      this.update({ folder: value || null });
    } else {
      this.update({ sort: value as ChangesState['sort'] });
    }
  }

  protected onSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchDraft.set(value);
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.update({ q: value });
    }, SEARCH_DEBOUNCE_MS);
  }

  protected clearAll(): void {
    this.update({ type: [], status: [], locale: [], changedBy: null, folder: null, q: '' });
  }

  protected goToPage(page: number): void {
    this.update({ page: Math.max(0, page) }, false);
  }

  /** Writes a new state to the URL; any filter change starts at the first page. */
  private update(patch: Partial<ChangesState>, resetPage = true): void {
    const next: ChangesState = { ...this.state(), ...patch, ...(resetPage && patch.page === undefined ? { page: 0 } : {}) };
    void this.router.navigate([], { relativeTo: this.route, queryParams: paramsFromState(next) });
  }

  // ── Selection, keyboard, diff ──────────────────────────────────────────

  protected isSelected(row: ChangeRowView): boolean {
    return this.selected().has(this.keyOf(row));
  }

  protected toggleRow(row: ChangeRowView): void {
    const key = this.keyOf(row);
    this.selected.update((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  protected toggleAll(): void {
    this.selected.set(this.allSelected() ? new Set() : new Set(this.rows().map((row) => this.keyOf(row))));
  }

  protected openDiff(row: ChangeRowView, index: number): void {
    this.activeIndex.set(index);
    const key = this.keyOf(row);
    if (this.focusedKey() === key && this.diff()) {
      return;
    }
    this.focusedKey.set(key);
    this.loadDiff(row);
  }

  protected closeDiff(): void {
    this.focusedKey.set(null);
    this.diff.set(null);
    this.diffError.set(null);
  }

  protected onRowKeydown(event: KeyboardEvent, row: ChangeRowView, index: number): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.focusRow(Math.min(index + 1, this.rows().length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.focusRow(Math.max(index - 1, 0));
        break;
      case ' ':
        event.preventDefault();
        this.toggleRow(row);
        break;
      case 'Enter':
        event.preventDefault();
        this.openDiff(row, index);
        break;
    }
  }

  private focusRow(index: number): void {
    this.activeIndex.set(index);
    queueMicrotask(() => this.rowElements()[index]?.nativeElement.focus());
  }

  // ── Actions ────────────────────────────────────────────────────────────

  private choicesOf(rows: ChangeRowView[]): ReleaseChoice[] {
    return rows.map((row) => ({
      assetUuid: row.uuid ?? '',
      locale: row.locale ?? '',
      label: `${assetName(row)}${row.locale ? ` · ${localeTag(row.locale)}` : ''} — ${statusLabel(row.status)}`,
      status: (row.status as ReleaseStatus) ?? null,
      checked: true,
    }));
  }

  protected releaseSelected(): void {
    this.dialog.set({ mode: 'release', choices: this.choicesOf(this.selectedRows()) });
  }

  protected discardSelected(): void {
    this.dialog.set({ mode: 'discard', choices: this.choicesOf(this.discardable()) });
  }

  protected scheduleSelected(): void {
    this.scheduling.set(this.choicesOf(this.selectedRows()));
  }

  // ── Loading ────────────────────────────────────────────────────────────

  private load(projectKey: string, state: ChangesState): void {
    this.request?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.request = this.api.listChanges(projectKey, queryFromState(state)).subscribe({
      next: (page) => {
        const rows = page.rows ?? [];
        this.loading.set(false);
        this.rows.set(rows);
        this.total.set(page.totalElements ?? 0);
        this.totalPages.set(page.totalPages ?? 0);
        // A new page, filter or a finished action: nothing stays selected, the diff follows its row if still listed.
        this.selected.set(new Set());
        this.activeIndex.set(0);
        const focused = rows.find((row) => this.keyOf(row) === this.focusedKey());
        if (focused) {
          this.loadDiff(focused);
        } else {
          this.closeDiff();
        }
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.rows.set([]);
        this.error.set(problemOf(err, 'Could not load the changes — try again in a moment.').detail);
      },
    });
  }

  private loadDiff(row: ChangeRowView): void {
    if (!row.uuid) {
      return;
    }
    this.diffRequest?.unsubscribe();
    this.diffLoading.set(true);
    this.diffError.set(null);
    this.diffRequest = this.api.changeDiff(this.projectKey(), row.uuid, row.locale || null).subscribe({
      next: (diff) => {
        this.diffLoading.set(false);
        this.diff.set(diff);
      },
      error: (err: unknown) => {
        this.diffLoading.set(false);
        this.diff.set(null);
        this.diffError.set(problemOf(err, 'Could not load the diff.').detail);
      },
    });
  }

  protected readonly localeLabels = computed<Record<string, string>>(() =>
    Object.fromEntries(this.locales.locales().map((l) => [l.code ?? '', l.label || l.code || ''])),
  );
}
