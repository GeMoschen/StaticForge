import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { combineLatest, filter, map, startWith } from 'rxjs';
import { ShortcutService } from '../shortcut.service';
import { SfAutofocusDirective } from '../../../shared/directives/sf-autofocus.directive';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { assetRoute, projectKeyFromUrl } from '../../../shared/asset-route.util';
import { SearchService, type LiveSearchState } from '../../../features/search/search.service';
import {
  MATCHED_IN_LABELS,
  groupHits,
  highlightParts,
  type HitGroup,
  type SearchHitView,
  type SnippetPart,
} from '../../../features/search/search.util';
import { TimeTravelStore } from '../../../features/revisions/time-travel.store';

/** One selectable row of the listbox: a hit, or a group's "See all" row. */
interface PaletteOption {
  id: string;
  kind: 'hit' | 'more';
  group: HitGroup;
  hit?: SearchHitView;
  parts?: SnippetPart[];
}

interface PaletteGroup {
  group: HitGroup;
  headingId: string;
  options: PaletteOption[];
}

/**
 * Quick-open over project search (M23.4.1), opened with Ctrl/Cmd+K. A modal WAI-ARIA combobox: the input owns a
 * listbox of results grouped by type; arrows move the active option, Enter opens it, Ctrl/Cmd+Enter opens the search
 * page, Esc closes and returns focus to where it was. Outside a project it only explains that search is per project.
 */
@Component({
  selector: 'sf-command-palette',
  standalone: true,
  imports: [SfAutofocusDirective, SfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './command-palette.component.html',
  styleUrl: './command-palette.component.scss',
})
export class CommandPaletteComponent {
  private readonly shortcuts = inject(ShortcutService);
  private readonly router = inject(Router);
  private readonly search = inject(SearchService);
  protected readonly timeTravel = inject(TimeTravelStore);

  readonly open = this.shortcuts.commandPaletteOpen;
  protected readonly listboxId = 'sf-palette-listbox';
  protected readonly matchedInLabels = MATCHED_IN_LABELS;

  private readonly input = viewChild<ElementRef<HTMLInputElement>>('input');
  private returnFocus: HTMLElement | null = null;

  protected readonly query = signal('');
  protected readonly activeIndex = signal(0);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );
  protected readonly projectKey = computed(() => projectKeyFromUrl(this.url()));

  protected readonly state = signal<LiveSearchState>({ kind: 'idle', q: '' });

  protected readonly groups = computed<PaletteGroup[]>(() => {
    const state = this.state();
    if (state.kind !== 'results') {
      return [];
    }
    let index = 0;
    return groupHits(state.result).map((group) => {
      const options: PaletteOption[] = group.hits.map((hit) => ({
        id: `sf-palette-opt-${index++}`,
        kind: 'hit',
        group,
        hit,
        parts: highlightParts(hit.snippet, hit.highlights),
      }));
      if (group.total > group.hits.length) {
        options.push({ id: `sf-palette-opt-${index++}`, kind: 'more', group });
      }
      return { group, headingId: `sf-palette-group-${group.type}`, options };
    });
  });

  protected readonly options = computed<PaletteOption[]>(() => this.groups().flatMap((g) => g.options));

  protected readonly activeOption = computed<PaletteOption | null>(() => this.options()[this.activeIndex()] ?? null);

  protected readonly totalHits = computed(() => {
    const state = this.state();
    return state.kind === 'results' ? (state.result.page?.totalElements ?? 0) : 0;
  });

  /** Announced politely whenever results arrive. */
  protected readonly announcement = computed(() => {
    const state = this.state();
    switch (state.kind) {
      case 'results': {
        const n = this.totalHits();
        return n === 0 ? `No results for ${state.q}` : `${n} ${n === 1 ? 'result' : 'results'}`;
      }
      case 'unavailable':
        return 'Search is temporarily unavailable';
      default:
        return '';
    }
  });

  constructor() {
    combineLatest([toObservable(this.projectKey), toObservable(this.query)])
      .pipe(
        map(([projectKey, q]) => ({ projectKey, q })),
        (queries) => this.search.live(queries),
        takeUntilDestroyed(),
      )
      .subscribe((state) => {
        this.state.set(state);
        if (state.kind !== 'loading') {
          this.activeIndex.set(0);
        }
      });

    effect(() => {
      if (this.open()) {
        untracked(() => {
          const active = document.activeElement;
          this.returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
          this.query.set('');
          this.activeIndex.set(0);
        });
      }
    });
  }

  close(): void {
    this.shortcuts.closePalette();
    const target = this.returnFocus;
    this.returnFocus = null;
    if (target?.isConnected) {
      queueMicrotask(() => target.focus());
    }
  }

  protected onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.options().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (count > 0) {
          this.activeIndex.update((i) => (i + 1) % count);
          this.scrollActiveIntoView();
        }
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (count > 0) {
          this.activeIndex.update((i) => (i - 1 + count) % count);
          this.scrollActiveIntoView();
        }
        return;
      case 'Home':
      case 'End':
        if (count > 0 && event.ctrlKey) {
          event.preventDefault();
          this.activeIndex.set(event.key === 'Home' ? 0 : count - 1);
          this.scrollActiveIntoView();
        }
        return;
      case 'Enter': {
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
          this.openSearchPage();
          return;
        }
        const option = this.activeOption();
        if (option) {
          this.choose(option);
        }
        return;
      }
      case 'Escape':
        event.preventDefault();
        this.close();
        return;
      case 'Tab':
        // The dialog is modal and the input is its only tab stop: keep focus inside.
        event.preventDefault();
        return;
    }
  }

  protected choose(option: PaletteOption): void {
    const key = this.projectKey();
    if (!key) {
      return;
    }
    if (option.kind === 'more') {
      this.openSearchPage([option.group.type]);
      return;
    }
    if (option.hit) {
      this.leaveTimeTravel();
      const route = assetRoute(key, option.hit);
      this.shortcuts.closePalette();
      this.returnFocus = null;
      void this.router.navigate(route.commands, { queryParams: route.queryParams });
    }
  }

  protected openSearchPage(types: string[] = []): void {
    const key = this.projectKey();
    if (!key) {
      return;
    }
    const q = this.query().trim();
    this.leaveTimeTravel();
    this.shortcuts.closePalette();
    this.returnFocus = null;
    void this.router.navigate(['/p', key, 'search'], {
      queryParams: { q: q === '' ? null : q, type: types.length > 0 ? types : null },
    });
  }

  protected hover(option: PaletteOption): void {
    const index = this.options().indexOf(option);
    if (index >= 0) {
      this.activeIndex.set(index);
    }
  }

  protected optionLabel(option: PaletteOption): string {
    return option.kind === 'more' ? `See all ${option.group.total} ${option.group.label.toLowerCase()}` : '';
  }

  /** Search always answers from the current revision: opening a result leaves time travel. */
  private leaveTimeTravel(): void {
    if (this.timeTravel.isTimeTravel()) {
      this.timeTravel.exit();
    }
  }

  private scrollActiveIntoView(): void {
    const id = this.activeOption()?.id;
    queueMicrotask(() => {
      if (id) {
        document.getElementById(id)?.scrollIntoView({ block: 'nearest' });
      }
      this.input()?.nativeElement.focus();
    });
  }
}
