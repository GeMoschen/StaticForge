import { Injectable, OnDestroy, Signal, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { Subscription } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { problemOf } from '../../core/api/problem.util';
import { LocalesStore } from '../../core/project/locales.store';
import { ProjectMembersStore } from '../../core/project/project-members.store';
import { eligible, itemKey } from '../release/release-choice.util';
import { type ChangesState, paramsFromState, queryFromState } from './changes-query.util';

export type ChangeRowView = components['schemas']['ChangeRowView'];
type ChangeDiffView = components['schemas']['ChangeDiffView'];

const SEARCH_DEBOUNCE_MS = 300;

/**
 * The state the parts of the Changes view share (list, filters, diff, selection), provided per {@link ChangesComponent}.
 * The component binds the router-fed `projectKey` and query `state` with {@link connect}; everything else derives here.
 */
@Injectable()
export class ChangesStore implements OnDestroy {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly members = inject(ProjectMembersStore);
  readonly locales = inject(LocalesStore);

  private projectKey!: Signal<string>;
  /** The filters, sort and page as the URL holds them. */
  state!: Signal<ChangesState>;

  readonly rows = signal<ChangeRowView[]>([]);
  readonly total = signal(0);
  readonly totalPages = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Selected rows by `uuid|locale`; only rows of the current page. */
  readonly selected = signal<ReadonlySet<string>>(new Set());
  /** The row whose diff is shown, and the row the keyboard is on. */
  readonly focusedKey = signal<string | null>(null);
  readonly activeIndex = signal(0);
  readonly diff = signal<ChangeDiffView | null>(null);
  readonly diffLoading = signal(false);
  readonly diffError = signal<string | null>(null);
  readonly searchDraft = signal('');

  private request: Subscription | null = null;
  private diffRequest: Subscription | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  readonly localeOptions = computed(() =>
    this.locales.isLocalized()
      ? this.locales.locales().map((l) => ({ value: l.code ?? '', label: l.label || l.code || '' }))
      : [],
  );
  readonly localeLabels = computed<Record<string, string>>(() =>
    Object.fromEntries(this.locales.locales().map((l) => [l.code ?? '', l.label || l.code || ''])),
  );
  /** Whether any filter is set (what the removable chips show). */
  readonly filtered = computed(() => {
    const s = this.state();
    return s.type.length + s.status.length + s.locale.length > 0 || s.changedBy != null || !!s.folder || !!s.q;
  });

  readonly selectedRows = computed(() => this.rows().filter((row) => this.selected().has(this.keyOf(row))));
  readonly allSelected = computed(() => this.rows().length > 0 && this.selectedRows().length === this.rows().length);
  readonly someSelected = computed(() => this.selectedRows().length > 0 && !this.allSelected());
  readonly discardable = computed(() => this.selectedRows().filter((row) => eligible('discard', row.status)));
  readonly focusedRow = computed(() => this.rows().find((row) => this.keyOf(row) === this.focusedKey()) ?? null);

  connect(projectKey: Signal<string>, state: Signal<ChangesState>): void {
    this.projectKey = projectKey;
    this.state = state;
  }

  ngOnDestroy(): void {
    this.request?.unsubscribe();
    this.diffRequest?.unsubscribe();
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }
  }

  keyOf(row: ChangeRowView): string {
    return itemKey(row.uuid, row.locale);
  }

  /** Re-reads the members and the page for the current project and query (the component's effect calls this). */
  reload(key: string, state: ChangesState): void {
    this.members.load(key);
    if (!this.searchTimer) {
      this.searchDraft.set(state.q);
    }
    this.load(key, state);
  }

  // ── Filters ────────────────────────────────────────────────────────────

  toggleIn(key: 'type' | 'status' | 'locale', value: string): void {
    const current = this.state()[key];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    this.update({ [key]: next });
  }

  onSelectFilter(key: 'changedBy' | 'folder' | 'sort', event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (key === 'changedBy') {
      this.update({ changedBy: value ? Number(value) : null });
    } else if (key === 'folder') {
      this.update({ folder: value || null });
    } else {
      this.update({ sort: value as ChangesState['sort'] });
    }
  }

  onSearch(event: Event): void {
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

  clearAll(): void {
    this.update({ type: [], status: [], locale: [], changedBy: null, folder: null, q: '' });
  }

  goToPage(page: number): void {
    this.update({ page: Math.max(0, page) }, false);
  }

  /** Writes a new state to the URL; any filter change starts at the first page. */
  update(patch: Partial<ChangesState>, resetPage = true): void {
    const next: ChangesState = { ...this.state(), ...patch, ...(resetPage && patch.page === undefined ? { page: 0 } : {}) };
    void this.router.navigate([], { relativeTo: this.route, queryParams: paramsFromState(next) });
  }

  // ── Selection and diff ─────────────────────────────────────────────────

  isSelected(row: ChangeRowView): boolean {
    return this.selected().has(this.keyOf(row));
  }

  toggleRow(row: ChangeRowView): void {
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

  toggleAll(): void {
    this.selected.set(this.allSelected() ? new Set() : new Set(this.rows().map((row) => this.keyOf(row))));
  }

  openDiff(row: ChangeRowView, index: number): void {
    this.activeIndex.set(index);
    const key = this.keyOf(row);
    if (this.focusedKey() === key && this.diff()) {
      return;
    }
    this.focusedKey.set(key);
    this.loadDiff(row);
  }

  closeDiff(): void {
    this.focusedKey.set(null);
    this.diff.set(null);
    this.diffError.set(null);
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
}
