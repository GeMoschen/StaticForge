import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable, Subscription } from 'rxjs';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import {
  reasonBadge,
  reasonText,
  rootKindLabel,
  type EntryPage,
  type PlanEntryQuery,
  type PlanEntryView,
} from './insight.util';
import { SfRebuildReasonComponent } from './sf-rebuild-reason.component';

export const PLAN_ENTRIES_PAGE_SIZE = 25;
const FILTER_DELAY_MS = 250;

/**
 * A paged table of plan entries with their reasons (M22.3.1): output path, asset, channel and a collapsed reason that
 * expands to its chain. Filters by root kind, channel and text; every request goes through {@link fetch}, so the same
 * table serves a dry run, a run's stored plan and an asset's impact. Never fetches more than one page.
 */
@Component({
  selector: 'sf-plan-entries-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, SfButtonComponent, SfRebuildReasonComponent],
  template: `
    <div class="entries">
      <div class="entries__filters">
        @if (rootKinds().length > 1) {
          <select class="entries__select" aria-label="Filter by reason" (change)="setRootKind($event)">
            <option value="">All reasons</option>
            @for (kind of rootKinds(); track kind) {
              <option [value]="kind" [selected]="query().rootKind === kind">{{ label(kind) }}</option>
            }
          </select>
        }
        @if (channels().length > 1) {
          <select class="entries__select" aria-label="Filter by channel" (change)="setChannel($event)">
            <option value="">All channels</option>
            @for (channel of channels(); track channel) {
              <option [value]="channel" [selected]="query().channel === channel">{{ channel }}</option>
            }
          </select>
        }
        <input
          class="entries__search"
          type="search"
          placeholder="Filter by path or uid"
          aria-label="Filter entries by output path, uid or name"
          [value]="query().q ?? ''"
          (input)="setText($event)"
        />
      </div>

      @if (error()) {
        <p class="entries__error" role="alert">{{ error() }}</p>
      } @else if (!result() && loading()) {
        <p class="entries__muted">Loading entries…</p>
      } @else if (result()) {
        @let page = result()!;
        @if ((page.content ?? []).length === 0) {
          <p class="entries__muted">{{ emptyText() }}</p>
        } @else {
          <div class="sf-table-wrap">
            <table class="entries__table" [attr.aria-busy]="loading()">
              <thead>
                <tr>
                  <th scope="col">Output</th>
                  <th scope="col">Asset</th>
                  <th scope="col">Channel</th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                @for (entry of page.content ?? []; track rowKey(entry)) {
                  <tr>
                    <td class="entries__path">{{ entry.outputPath }}</td>
                    <td>
                      @if (linkPages() && entry.assetType === 'PAGE' && projectKey()) {
                        <a [routerLink]="['/p', projectKey(), 'pages', entry.assetUuid]">{{ entry.uid }}</a>
                      } @else {
                        <span class="entries__uid">{{ entry.uid }}</span>
                      }
                      @if (entry.pageNumber) {
                        <span class="entries__muted"> (page {{ entry.pageNumber }})</span>
                      }
                    </td>
                    <td>{{ entry.channel ?? 'media' }}</td>
                    <td>
                      @if (impact() && !(entry.reason?.steps ?? []).length) {
                        <span class="entries__muted">This asset itself</span>
                      } @else {
                      <button
                        type="button"
                        class="entries__toggle"
                        [attr.aria-expanded]="expanded().has(rowKey(entry))"
                        [attr.title]="text(entry)"
                        (click)="toggle(entry)"
                      >
                        {{ impact() ? 'Show chain' : badge(entry) }}
                        <span aria-hidden="true">{{ expanded().has(rowKey(entry)) ? '▾' : '▸' }}</span>
                      </button>
                      }
                    </td>
                  </tr>
                  @if (expanded().has(rowKey(entry))) {
                    <tr class="entries__detail">
                      <td colspan="4">
                        <sf-rebuild-reason [reason]="entry.reason" [projectKey]="projectKey()" [impact]="impact()" />
                      </td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>
          <nav class="entries__pager" aria-label="Entries pages">
            <sf-button variant="ghost" [disabled]="query().page === 0 || loading()" (click)="goTo(query().page - 1)">
              Previous
            </sf-button>
            <span class="entries__muted" aria-live="polite">
              Page {{ query().page + 1 }} of {{ totalPages() }} · {{ page.page?.totalElements ?? 0 }} entries
            </span>
            <sf-button
              variant="ghost"
              [disabled]="query().page + 1 >= totalPages() || loading()"
              (click)="goTo(query().page + 1)"
            >
              Next
            </sf-button>
          </nav>
        }
      }
    </div>
  `,
  styles: [
    `
      .entries {
        display: flex;
        flex-direction: column;
        gap: var(--sf-2);
        min-width: 0;
      }
      .entries__filters {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sf-2);
      }
      .entries__select,
      .entries__search {
        padding: var(--sf-1) var(--sf-2);
        border: 1px solid var(--sf-line);
        border-radius: var(--sf-radius-md);
        background: var(--sf-surface);
        color: var(--sf-ink);
        font-size: var(--sf-text-sm);
      }
      .entries__search {
        flex: 1;
        min-width: 10rem;
      }
      .entries__table {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--sf-text-sm);
      }
      .entries__table th,
      .entries__table td {
        text-align: left;
        padding: var(--sf-1) var(--sf-2);
        border-bottom: 1px solid var(--sf-line);
        vertical-align: top;
      }
      .entries__path,
      .entries__uid {
        font-family: var(--sf-font-mono);
        overflow-wrap: anywhere;
      }
      .entries__toggle {
        border: 1px solid var(--sf-line);
        border-radius: var(--sf-radius-sm);
        background: transparent;
        color: var(--sf-ink);
        font-size: var(--sf-text-xs);
        padding: 0 var(--sf-2);
        cursor: pointer;
        white-space: nowrap;
      }
      .entries__detail td {
        background: color-mix(in srgb, var(--sf-line) 25%, transparent);
      }
      .entries__pager {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--sf-2);
      }
      .entries__muted {
        color: var(--sf-slate);
        font-size: var(--sf-text-sm);
        margin: 0;
      }
      .entries__error {
        margin: 0;
        color: var(--sf-rust);
        font-size: var(--sf-text-sm);
      }
    `,
  ],
})
export class SfPlanEntriesTableComponent {
  /** Loads one page of entries; a new function (or {@link reloadKey}) reloads from the first page. */
  readonly fetch = input.required<(query: PlanEntryQuery) => Observable<EntryPage | null | undefined>>();
  readonly projectKey = input<string>('');
  /** The root kinds to offer as a filter (a plan summary's {@code byRootKind} keys). */
  readonly rootKinds = input<string[]>([]);
  readonly channels = input<string[]>([]);
  readonly impact = input(false);
  /** Link page entries to the page editor. */
  readonly linkPages = input(true);
  /** The unfiltered first page, when the caller already has it: shown without a request. */
  readonly initialPage = input<EntryPage | null>(null);
  readonly reloadKey = input<unknown>(null);
  readonly emptyText = input('Nothing to rebuild.');

  protected readonly query = signal<PlanEntryQuery>({ page: 0, size: PLAN_ENTRIES_PAGE_SIZE });
  protected readonly result = signal<EntryPage | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly expanded = signal<Set<string>>(new Set());
  protected readonly totalPages = computed(() => Math.max(1, this.result()?.page?.totalPages ?? 1));

  private request: Subscription | null = null;
  private filterTimer: ReturnType<typeof setTimeout> | null = null;

  private source: { fetch: unknown; reloadKey: unknown } | null = null;

  constructor() {
    effect(() => {
      const fetch = this.fetch();
      const reloadKey = this.reloadKey();
      const query = this.query();
      untracked(() => {
        const sourceChanged = this.source !== null && (this.source.fetch !== fetch || this.source.reloadKey !== reloadKey);
        this.source = { fetch, reloadKey };
        if (sourceChanged && query.page !== 0) {
          this.query.set({ ...query, page: 0 }); // runs this effect again, which loads
          return;
        }
        this.load(fetch, query);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.request?.unsubscribe();
      if (this.filterTimer) {
        clearTimeout(this.filterTimer);
      }
    });
  }

  private load(fetch: (query: PlanEntryQuery) => Observable<EntryPage | null | undefined>, query: PlanEntryQuery): void {
    this.request?.unsubscribe();
    const initial = untracked(() => this.initialPage());
    if (initial && query.page === 0 && !query.rootKind && !query.channel && !query.q) {
      this.result.set(initial);
      this.loading.set(false);
      this.error.set(null);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.request = fetch(query).subscribe({
      next: (page) => {
        this.result.set(page ?? { content: [], page: { totalElements: 0, totalPages: 0, number: 0, size: query.size } });
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Could not load the entries — try again in a moment.');
      },
    });
  }

  protected rowKey(entry: PlanEntryView): string {
    return `${entry.assetUuid}|${entry.channel ?? ''}|${entry.outputPath}`;
  }

  protected label(kind: string): string {
    return rootKindLabel(kind);
  }

  protected badge(entry: PlanEntryView): string {
    return reasonBadge(entry.reason);
  }

  protected text(entry: PlanEntryView): string {
    return reasonText(entry, this.impact());
  }

  protected toggle(entry: PlanEntryView): void {
    const key = this.rowKey(entry);
    this.expanded.update((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  protected goTo(page: number): void {
    this.query.update((q) => ({ ...q, page: Math.max(0, page) }));
  }

  protected setRootKind(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.query.update((q) => ({ ...q, page: 0, rootKind: value || undefined }));
  }

  protected setChannel(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.query.update((q) => ({ ...q, page: 0, channel: value || undefined }));
  }

  protected setText(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (this.filterTimer) {
      clearTimeout(this.filterTimer);
    }
    this.filterTimer = setTimeout(() => {
      this.filterTimer = null;
      this.query.update((q) => ({ ...q, page: 0, q: value }));
    }, FILTER_DELAY_MS);
  }
}
