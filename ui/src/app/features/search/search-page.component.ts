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
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import {
  EMPTY,
  Subject,
  catchError,
  combineLatest,
  debounceTime,
  expand,
  map,
  of,
  startWith,
  switchMap,
  timer,
} from 'rxjs';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfAutofocusDirective } from '../../shared/directives/sf-autofocus.directive';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { assetRoute } from '../../shared/asset-route.util';
import type { components } from '../../core/api/generated/schema.d.ts';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { SearchService, problemMessage } from './search.service';
import {
  MATCHED_IN_LABELS,
  TYPE_ICONS,
  TYPE_LABELS,
  TYPE_ORDER,
  hasFilters,
  highlightParts,
  lagMessage,
  paramsFromState,
  stateFromParams,
  toggleType,
  type SearchHitView,
  type SearchPageState,
  type SearchResultView,
  type SearchStatusView,
  type SnippetPart,
} from './search.util';

type FolderView = components['schemas']['FolderView'];

type Load =
  | { kind: 'empty' }
  | { kind: 'results'; result: SearchResultView }
  | { kind: 'unavailable' }
  | { kind: 'error' };

interface ResultRow {
  hit: SearchHitView;
  icon: string;
  typeLabel: string;
  matchedIn: string;
  parts: SnippetPart[];
}

/**
 * The full search page (M23.4.2): every piece of state lives in query params (`q`, repeatable `type`, `folder`,
 * `page`, `size`), so reload and back/forward restore it. Type facets keep the counts of unselected types; the status
 * line tells how current the index is, and project admins can rebuild it.
 */
@Component({
  selector: 'sf-search-page',
  standalone: true,
  imports: [SfAutofocusDirective, SfEmptyStateComponent, SfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './search-page.component.html',
  styleUrl: './search-page.component.scss',
})
export class SearchPageComponent {
  readonly projectKey = input.required<string>();

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly search = inject(SearchService);
  private readonly store = inject(ProjectContextStore);
  private readonly toasts = inject(ToastService);
  protected readonly timeTravel = inject(TimeTravelStore);

  protected readonly typeLabels = TYPE_LABELS;
  protected readonly typeIcons = TYPE_ICONS;

  private readonly params = toSignal(this.route.queryParamMap, { requireSync: true });
  protected readonly state = computed<SearchPageState>(() => stateFromParams(this.params()));

  /** The input's text: follows the URL, and updates it (debounced, replacing history) while typing. */
  protected readonly draft = signal('');
  private readonly typing$ = new Subject<string>();
  private readonly statusTick$ = new Subject<void>();
  private readonly refresh$ = new Subject<void>();
  private typedQuery: string | null = null;

  protected readonly load = signal<Load>({ kind: 'empty' });
  protected readonly status = signal<SearchStatusView | null>(null);
  protected readonly filtersOpen = signal(false);
  protected readonly rebuilding = signal(false);

  protected readonly isAdmin = inject(ProjectPermissionsStore).isProjectAdmin;

  protected readonly result = computed<SearchResultView | null>(() => {
    const load = this.load();
    return load.kind === 'results' ? load.result : null;
  });

  protected readonly rows = computed<ResultRow[]>(() =>
    (this.result()?.content ?? []).map((hit) => ({
      hit,
      icon: TYPE_ICONS[hit.type ?? ''] ?? 'draft',
      typeLabel: TYPE_LABELS[hit.type ?? ''] ?? hit.type ?? '',
      matchedIn: MATCHED_IN_LABELS[hit.matchedIn ?? ''] ?? '',
      parts: highlightParts(hit.snippet, hit.highlights),
    })),
  );

  /** Every type with a count, plus selected types without hits, in the fixed type order. */
  protected readonly facets = computed(() => {
    const counts = (this.result()?.facets?.types ?? {}) as Record<string, number>;
    const selected = this.state().types;
    return TYPE_ORDER.filter((type) => (counts[type] ?? 0) > 0 || selected.includes(type)).map((type) => ({
      type,
      label: TYPE_LABELS[type],
      count: counts[type] ?? 0,
      checked: selected.includes(type),
    }));
  });

  protected readonly total = computed(() => this.result()?.page?.totalElements ?? 0);
  protected readonly totalPages = computed(() => this.result()?.page?.totalPages ?? 0);
  protected readonly hasFilters = computed(() => hasFilters(this.state()));
  protected readonly lagMessage = computed(() => lagMessage(this.status()));

  /** Folder paths of every store, offered as suggestions for the folder filter. */
  protected readonly folderPaths = computed<string[]>(() => {
    const paths: string[] = [];
    const walk = (nodes: FolderView[]) => {
      for (const node of nodes) {
        if (node.path) {
          paths.push(node.path);
        }
        walk(node.children ?? []);
      }
    };
    walk(this.store.pageFolderTree());
    walk(this.store.mediaFolderTree());
    walk(this.store.navigationFolderTree());
    walk(this.store.templateFolderTree());
    walk(this.store.globalsFolderTree());
    walk(this.store.contentFolderTree());
    return [...new Set(paths)].sort();
  });

  constructor() {
    const destroyRef = inject(DestroyRef);

    // The URL drives the input, except for the navigation the input itself just caused: the user may have typed on.
    effect(() => {
      const q = this.state().q;
      untracked(() => {
        if (q !== this.typedQuery) {
          this.draft.set(q);
        }
        this.typedQuery = null;
      });
    });

    this.typing$.pipe(debounceTime(300), takeUntilDestroyed()).subscribe((q) => {
      this.typedQuery = q;
      this.navigate({ ...this.state(), q, page: 0 }, true);
    });

    combineLatest([toObservable(this.projectKey), toObservable(this.state), this.refresh$.pipe(startWith(undefined))])
      .pipe(
        switchMap(([projectKey, state]) => {
          if (state.q.trim() === '') {
            return of<Load>({ kind: 'empty' });
          }
          return this.search
            .search(projectKey, { q: state.q, types: state.types, folder: state.folder, page: state.page, size: state.size })
            .pipe(
              map((result): Load => ({ kind: 'results', result })),
              catchError((error: unknown) => of(this.failure(error))),
            );
        }),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe((load) => this.load.set(load));

    // The status line: fetched with every result, then every few seconds while the index catches up or rebuilds.
    combineLatest([toObservable(this.projectKey), toObservable(this.load), this.statusTick$.pipe(startWith(undefined))])
      .pipe(
        switchMap(([projectKey]) => {
          const fetch = () => this.search.status(projectKey).pipe(catchError(() => of(null)));
          return fetch().pipe(
            expand((status) =>
              status?.state === 'CATCHING_UP' || status?.state === 'REBUILDING'
                ? timer(3000).pipe(switchMap(fetch))
                : EMPTY,
            ),
          );
        }),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe((status) => {
        this.status.set(status);
        if (status && status.state !== 'REBUILDING') {
          this.rebuilding.set(false);
        }
      });
  }

  protected onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.draft.set(value);
    this.typing$.next(value);
  }

  /** Submitting searches again even when the URL wouldn't change (the index may have moved on). */
  protected submit(event: Event): void {
    event.preventDefault();
    const next = { ...this.state(), q: this.draft(), page: 0 };
    if (JSON.stringify(paramsFromState(next)) === JSON.stringify(paramsFromState(this.state()))) {
      this.refresh$.next();
      return;
    }
    this.navigate(next, false);
  }

  protected toggleFacet(type: string): void {
    this.navigate({ ...this.state(), types: toggleType(this.state().types, type), page: 0 }, false);
  }

  protected onFolderChange(event: Event): void {
    const folder = (event.target as HTMLInputElement).value;
    if (folder.trim() !== this.state().folder) {
      this.navigate({ ...this.state(), folder, page: 0 }, false);
    }
  }

  protected clearFilters(): void {
    this.navigate({ ...this.state(), types: [], folder: '', page: 0 }, false);
  }

  protected goToPage(page: number): void {
    this.navigate({ ...this.state(), page: Math.max(0, page) }, false);
  }

  protected open(hit: SearchHitView): void {
    if (this.timeTravel.isTimeTravel()) {
      this.timeTravel.exit();
    }
    const target = assetRoute(this.projectKey(), hit);
    void this.router.navigate(target.commands, { queryParams: target.queryParams });
  }

  protected href(hit: SearchHitView): string {
    const target = assetRoute(this.projectKey(), hit);
    return this.router.serializeUrl(this.router.createUrlTree(target.commands, { queryParams: target.queryParams }));
  }

  protected onResultClick(event: MouseEvent, hit: SearchHitView): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    this.open(hit);
  }

  protected rebuild(): void {
    if (!window.confirm('Rebuild the search index of this project? Search keeps answering from the current index until the rebuild finishes.')) {
      return;
    }
    this.rebuilding.set(true);
    this.search.reindex(this.projectKey()).subscribe({
      next: (status) => {
        this.status.set(status);
        this.statusTick$.next();
        this.toasts.show('Rebuilding the search index…', 'info');
      },
      error: (error: unknown) => {
        this.rebuilding.set(false);
        if (error instanceof HttpErrorResponse && error.status === 409) {
          this.toasts.show('A rebuild of the search index is already running.', 'warning');
        } else {
          this.toasts.show(problemMessage(error, 'Could not start the rebuild — try again.'), 'error');
        }
      },
    });
  }

  private navigate(state: SearchPageState, replaceUrl: boolean): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: paramsFromState(state),
      replaceUrl,
    });
  }

  private failure(error: unknown): Load {
    if (error instanceof HttpErrorResponse && error.status === 503) {
      return { kind: 'unavailable' };
    }
    if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
      this.toasts.show(problemMessage(error, 'Search failed — try again.'), 'error');
    }
    return { kind: 'error' };
  }
}
