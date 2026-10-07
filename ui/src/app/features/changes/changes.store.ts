import { Injectable, OnDestroy, Signal, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
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
  private readonly transloco = inject(TranslocoService);
  readonly locales = inject(LocalesStore);

  private projectKey!: Signal<string>;
  /** The filters, sort and page as the URL holds them. */
  state!: Signal<ChangesState>;

  readonly rows = signal<ChangeRowView[]>([]);
  readonly total = signal(0);
  readonly totalPages = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /**
   * The selection as the table reports it: keys (`uuid|locale`) and the selected rows of the current page. A new page,
   * filter or finished action empties it, and the table follows (it is set to these keys).
   */
  readonly selectedKeys = signal<readonly string[]>([]);
  readonly selectedRows = signal<readonly ChangeRowView[]>([]);
  /** The row whose diff is shown (the table's current row). */
  readonly focusedKey = signal<string | null>(null);
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

  /**
   * The rows as listed: one row per language, an asset's languages together with the default language first (decision
   * 20). The server's order between assets is kept (the first row of an asset places the asset); only a page's rows
   * move, so an asset split by a page boundary keeps its languages on both pages.
   */
  readonly listed = computed<ChangeRowView[]>(() => {
    const rows = this.rows();
    const defaultLocale = this.locales.defaultLocale();
    const order = this.locales.locales().map((l) => l.code ?? '');
    const rank = (row: ChangeRowView) => {
      const locale = row.locale ?? '';
      if (locale === (defaultLocale ?? '')) {
        return -1;
      }
      const index = order.indexOf(locale);
      return index < 0 ? order.length : index;
    };
    const groups = new Map<string, ChangeRowView[]>();
    for (const row of rows) {
      const group = groups.get(row.uuid ?? '');
      if (group) {
        group.push(row);
      } else {
        groups.set(row.uuid ?? '', [row]);
      }
    }
    return [...groups.values()].flatMap((group) => [...group].sort((a, b) => rank(a) - rank(b)));
  });
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

  /** Reads the page again (the table's Retry). */
  retry(): void {
    this.reload(this.projectKey(), this.state());
  }

  // ── Filters ────────────────────────────────────────────────────────────

  toggleIn(key: 'type' | 'status' | 'locale', value: string): void {
    const current = this.state()[key];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    this.update({ [key]: next });
  }

  onSearch(value: string): void {
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

  setSelection(keys: readonly string[], rows: readonly ChangeRowView[]): void {
    this.selectedKeys.set(keys);
    this.selectedRows.set(rows);
  }

  clearSelection(): void {
    this.setSelection([], []);
  }

  openDiff(row: ChangeRowView): void {
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
        this.clearSelection();
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
        this.error.set(problemOf(err, this.transloco.translate('changes.page.loadFailed')).detail);
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
        this.diffError.set(problemOf(err, this.transloco.translate('changes.diff.loadFailed')).detail);
      },
    });
  }
}
