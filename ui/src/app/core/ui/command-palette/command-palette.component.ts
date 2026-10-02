import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { combineLatest, map } from 'rxjs';
import { ApiClient } from '../../api/api.client';
import { areaNav } from '../../frame/area-nav';
import { DeveloperModeService } from '../../frame/developer-mode.service';
import { FrameContextStore } from '../../frame/frame-context.store';
import { railGroups, SETTINGS_ITEM } from '../../frame/rail-model';
import { assetIcon, assetLocation } from '../../assets/asset-ref';
import { FavoritesService } from '../../assets/favorites.service';
import { RecentsService } from '../../assets/recents.service';
import { PreferencesService } from '../../preferences/preferences.service';
import { EditingLocaleStore } from '../../project/editing-locale.store';
import { ProjectPermissionsStore } from '../../project/project-permissions.store';
import { SearchService, type LiveSearchState } from '../../../features/search/search.service';
import { groupHits } from '../../../features/search/search.util';
import { TimeTravelStore } from '../../../features/revisions/time-travel.store';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SfKbdComponent } from '../../../shared/components/display/sf-kbd.component';
import { assetRoute } from '../../../shared/asset-route.util';
import { OverlayHandle, OverlayStack } from '../../../shared/overlay/overlay-stack';
import { highlightRanges } from '../fuzzy-match.util';
import { ShortcutService } from '../shortcut.service';
import {
  PREFIX_OF_MODE,
  buildSections,
  parseQuery,
  type PaletteGroup,
  type PaletteItem,
  type PaletteMode,
  type PaletteRow,
  type PaletteSources,
} from './palette-model';
import type { ProjectSummary } from '../../../features/frame/project-switcher.util';

interface OptionView {
  readonly id: string;
  readonly row: PaletteRow;
  readonly parts: { text: string; mark: boolean }[];
}

interface SectionView {
  readonly group: PaletteGroup;
  readonly headingId: string;
  readonly options: OptionView[];
  readonly more: number;
}

/**
 * The command palette (M35.14), opened with Ctrl/Cmd+K: a modal WAI-ARIA combobox over grouped results — *Actions* (the
 * registry's commands that apply to what is open), *Navigate* (every screen and settings page the person may open),
 * *Recent*, *Favorites* and *Search results* (the project search) — with fuzzy matching and key hints. The prefix `>`
 * lists actions only, `#` settings pages and `@` projects; a chip names the mode and Backspace on an empty box leaves
 * it. Arrows move, Enter runs, Ctrl/Cmd+Enter opens the search page, Esc closes.
 */
@Component({
  selector: 'sf-command-palette',
  standalone: true,
  imports: [SfIconComponent, SfKbdComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './command-palette.component.html',
  styleUrl: './command-palette.component.scss',
})
export class CommandPaletteComponent {
  private readonly shortcuts = inject(ShortcutService);
  private readonly router = inject(Router);
  private readonly search = inject(SearchService);
  private readonly api = inject(ApiClient);
  private readonly frame = inject(FrameContextStore);
  private readonly developerMode = inject(DeveloperModeService);
  private readonly permissions = inject(ProjectPermissionsStore);
  private readonly preferences = inject(PreferencesService);
  private readonly recentAssets = inject(RecentsService);
  private readonly favoriteAssets = inject(FavoritesService);
  private readonly editingLocale = inject(EditingLocaleStore);
  private readonly transloco = inject(TranslocoService);
  private readonly overlays = inject(OverlayStack);
  protected readonly timeTravel = inject(TimeTravelStore);

  readonly open = this.shortcuts.commandPaletteOpen;
  protected readonly listboxId = 'sf-palette-listbox';

  private readonly input = viewChild<ElementRef<HTMLInputElement>>('input');
  private readonly paletteHost = viewChild<ElementRef<HTMLElement>>('host');
  private handle: OverlayHandle | null = null;
  private returnFocus: HTMLElement | null = null;

  protected readonly query = signal('');
  protected readonly activeIndex = signal(0);
  protected readonly parsed = computed(() => parseQuery(this.query()));
  protected readonly mode = computed<PaletteMode>(() => this.parsed().mode);
  /** What the box shows: the whole query, or — once a prefix became the mode chip — the text after it. */
  protected readonly display = computed(() => (this.mode() === 'all' ? this.query() : this.parsed().rest));

  protected readonly projectKey = this.frame.projectKey;

  protected readonly state = signal<LiveSearchState>({ kind: 'idle', q: '' });
  private readonly projects = signal<readonly ProjectSummary[]>([]);

  /** Re-evaluates the translated labels when the language file arrives or changes. */
  private readonly translations = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  private t(key: string, params?: Record<string, unknown>): string {
    this.translations();
    return this.transloco.translate(key, params);
  }

  private readonly actionItems = computed<PaletteItem[]>(() =>
    this.shortcuts.actions().map((def) => {
      const label = def.palette!.label;
      const key = typeof label === 'function' ? label() : (label ?? def.description);
      return {
        id: `action-${def.id}`,
        group: 'actions' as const,
        label: this.t(key),
        icon: def.palette!.icon,
        context: def.palette!.context?.() ?? null,
        keys: def.keys ?? null,
        run: () => void def.handler!(),
      };
    }),
  );

  /** Every screen the person may open: the rail's items, the history, and the Publishing and Settings pages. */
  private readonly navigateItems = computed<PaletteItem[]>(() => {
    const location = this.frame.location();
    const dev = this.developerMode.enabled();
    const key = this.projectKey();
    const go = (commands: readonly string[]) => () => void this.router.navigate(commands.length > 0 && commands[0].startsWith('/') ? [...commands] : ['/p', key ?? '', ...commands]);
    const rail = railGroups({ location, developerMode: dev })
      .flatMap((group) => group.items)
      .map((item) => ({
        id: `go-${item.id}`,
        group: 'navigate' as const,
        label: this.t(`frame.rail.item.${item.id}`),
        icon: item.icon,
        keys: this.shortcuts.keysOf(`go.${item.id}`),
        run: go(item.route),
      }));
    if (location.kind !== 'project') {
      return rail;
    }
    const publishing = areaNav('publishing', { developerMode: dev, projectAdmin: this.permissions.readsAsProjectAdmin() }).map((entry) => ({
      id: `go-publishing-${entry.id}`,
      group: 'navigate' as const,
      label: this.t(`frame.sub.publishing.${entry.id}`),
      icon: entry.icon,
      context: this.t('frame.rail.item.publishing'),
      keys: null,
      run: go(['publishing', entry.id]),
    }));
    return [
      ...rail,
      {
        id: 'go-settings',
        group: 'navigate' as const,
        label: this.t('frame.rail.item.settings'),
        icon: SETTINGS_ITEM.icon,
        keys: this.shortcuts.keysOf('go.settings'),
        run: go(SETTINGS_ITEM.route),
      },
      ...publishing,
    ];
  });

  private readonly settingsItems = computed<PaletteItem[]>(() => {
    if (this.frame.location().kind !== 'project') {
      return [];
    }
    return areaNav('settings', { developerMode: this.developerMode.enabled(), projectAdmin: this.permissions.readsAsProjectAdmin() }).map((entry) => ({
      id: `settings-${entry.id}`,
      group: 'settings' as const,
      label: this.t(`frame.sub.settings.${entry.id}`),
      icon: entry.icon,
      context: this.t('frame.rail.item.settings'),
      keys: null,
      run: () => void this.router.navigate(['/p', this.projectKey() ?? '', 'settings', entry.id]),
    }));
  });

  private readonly projectItems = computed<PaletteItem[]>(() => {
    const favorites = this.preferences.favoriteProjects();
    const recents = this.preferences.recentProjects();
    const rank = (key: string | undefined) => (favorites.includes(key ?? '') ? 0 : recents.includes(key ?? '') ? 1 : 2);
    return [...this.projects()]
      .sort((a, b) => rank(a.key) - rank(b.key) || (a.name ?? a.key ?? '').localeCompare(b.name ?? b.key ?? ''))
      .map((project) => ({
        id: `project-${project.key}`,
        group: 'projects' as const,
        label: project.name ?? project.key ?? '',
        icon: favorites.includes(project.key ?? '') ? 'star' : recents.includes(project.key ?? '') ? 'history' : 'folder_open',
        context: project.key ?? null,
        keys: null,
        run: () => void this.router.navigate(['/p', project.key ?? '']),
      }));
  });

  private entryItems(
    group: 'recent' | 'favorites',
    entries: readonly { kind: string; uuid: string; title?: string; folderPath?: string }[],
  ): PaletteItem[] {
    const key = this.projectKey();
    if (key === null) {
      return [];
    }
    return entries.map((entry) => {
      const route = assetRoute(key, { type: entry.kind, uuid: entry.uuid, folderPath: entry.folderPath });
      return {
        id: `${group}-${entry.kind}-${entry.uuid}`,
        group,
        label: entry.title ?? entry.uuid,
        icon: assetIcon(entry.kind),
        context: assetLocation(entry.folderPath, entry.kind),
        keys: null,
        run: () => void this.router.navigate(route.commands, { queryParams: route.queryParams }),
      };
    });
  }

  private readonly searchItems = computed<{ items: PaletteItem[]; total: number }>(() => {
    const state = this.state();
    const key = this.projectKey();
    if (state.kind !== 'results' || key === null) {
      return { items: [], total: 0 };
    }
    const items = groupHits(state.result).flatMap((group) =>
      group.hits.map((hit) => ({
        id: `search-${hit.uuid}`,
        group: 'search' as const,
        label: hit.displayName || hit.uid || '',
        icon: group.icon,
        context: hit.folderPath ?? null,
        keys: null,
        matched: true,
        run: () => {
          this.leaveTimeTravel();
          const route = assetRoute(key, hit);
          void this.router.navigate(route.commands, { queryParams: route.queryParams });
        },
      })),
    );
    return { items, total: state.result.page?.totalElements ?? items.length };
  });

  protected readonly sections = computed<SectionView[]>(() => {
    const key = this.projectKey();
    const recent = key ? this.recentAssets.list() : [];
    const favorites = key ? this.favoriteAssets.list() : [];
    const search = this.searchItems();
    const sources: PaletteSources = {
      actions: this.actionItems(),
      navigate: this.navigateItems(),
      settings: this.settingsItems(),
      projects: this.projectItems(),
      recent: this.entryItems('recent', recent),
      favorites: this.entryItems('favorites', favorites),
      search: search.items,
      searchTotal: search.total,
    };
    let index = 0;
    return buildSections(this.query(), sources).map((section) => ({
      group: section.group,
      headingId: `sf-palette-group-${section.group}`,
      more: section.more,
      options: section.rows.map((row) => ({
        id: `sf-palette-opt-${index++}`,
        row,
        parts: highlightRanges(row.item.label, row.match?.ranges ?? []),
      })),
    }));
  });

  protected readonly options = computed(() => this.sections().flatMap((section) => section.options));
  protected readonly active = computed<OptionView | null>(() => this.options()[this.activeIndex()] ?? null);

  protected readonly placeholder = computed(() =>
    this.t(this.mode() === 'all' && this.projectKey() === null ? 'shell.palette.placeholders.noProject' : `shell.palette.placeholders.${this.mode()}`),
  );

  /** Announced politely whenever the list changes. */
  protected readonly announcement = computed(() => {
    const state = this.state();
    if (state.kind === 'unavailable') {
      return this.t('shell.palette.announceUnavailable');
    }
    return this.t('shell.palette.announceResults', { count: this.options().length });
  });

  protected readonly searching = computed(() => this.state().kind === 'loading');

  constructor() {
    // The palette searches the language the editor is working in (M24.4.1).
    combineLatest([toObservable(this.projectKey), toObservable(computed(() => this.parsed().rest)), toObservable(this.editingLocale.locale)])
      .pipe(
        map(([projectKey, q, locale]) => ({ projectKey, q: this.mode() === 'all' ? q : '', locale: locale ?? undefined })),
        (queries) => this.search.live(queries),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.state.set(state));

    effect(() => {
      this.query();
      untracked(() => this.activeIndex.set(0));
    });

    // Opening (or a restart with a seed, such as `@`) clears the box and takes the focus.
    effect(() => {
      const request = this.shortcuts.paletteRequest();
      if (this.open()) {
        untracked(() => {
          if (this.handle === null) {
            const active = document.activeElement;
            this.returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
          }
          this.query.set(request?.seed ?? '');
          this.loadProjects();
          // Deleted assets leave the lists before they show; renamed ones come with their new name (M35.15).
          const key = this.projectKey();
          if (key !== null) {
            this.recentAssets.verify(key).subscribe();
          }
        });
      }
    });

    effect(() => {
      if (this.open()) {
        untracked(() => afterNextRender(() => this.attach(), { injector: this.injectorRef }));
      } else {
        untracked(() => this.detach());
      }
    });
  }

  private readonly injectorRef = inject(Injector);

  protected close(): void {
    this.shortcuts.closePalette();
    const target = this.returnFocus;
    this.returnFocus = null;
    if (target?.isConnected) {
      queueMicrotask(() => target.focus());
    }
  }

  /** Like `sf-dialog`: leaves the app frame's subtree (which a modal makes `inert`) and joins the overlay stack. */
  private attach(): void {
    const host = this.paletteHost()?.nativeElement;
    if (!host || this.handle !== null) {
      return;
    }
    // The wrapper (`.sf-command-palette-host`) is the overlay pane.
    document.body.appendChild(host);
    this.handle = this.overlays.push(host, { layer: 'modal', modal: true, onEscape: () => this.close(), restoreFocus: null });
    this.input()?.nativeElement.focus();
  }

  private detach(): void {
    this.handle?.remove(false);
    this.handle = null;
    this.paletteHost()?.nativeElement.remove();
  }

  protected onInput(event: Event): void {
    const field = event.target as HTMLInputElement;
    const prefix = this.mode() === 'all' ? '' : this.query().charAt(0);
    this.query.set(prefix + field.value);
    // Typing a prefix turns it into the chip: the box must not keep showing it.
    field.value = this.display();
  }

  protected modePrefix(mode: Exclude<PaletteMode, 'all'>): string {
    return PREFIX_OF_MODE[mode];
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.options().length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (count > 0) {
          const step = event.key === 'ArrowDown' ? 1 : -1;
          this.activeIndex.update((i) => (i + step + count) % count);
          this.scrollActive();
        }
        return;
      }
      case 'Home':
      case 'End':
        if (count > 0 && event.ctrlKey) {
          event.preventDefault();
          this.activeIndex.set(event.key === 'Home' ? 0 : count - 1);
          this.scrollActive();
        }
        return;
      case 'Enter':
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
          this.openSearchPage();
        } else if (this.active()) {
          this.run(this.active()!);
        }
        return;
      case 'Backspace':
        // The prefix is the first character of the query: an empty box leaves the mode.
        if (this.parsed().rest === '' && this.mode() !== 'all') {
          event.preventDefault();
          this.query.set('');
        }
        return;
      case 'Tab':
        // The dialog is modal and the box its only tab stop: keep the focus inside.
        event.preventDefault();
        return;
    }
  }

  protected hover(option: OptionView): void {
    this.activeIndex.set(this.options().indexOf(option));
  }

  protected run(option: OptionView): void {
    const item = option.row.item;
    this.close();
    item.run();
  }

  /** The "See all N results" row: the search page, with the text typed so far. */
  protected openSearchPage(): void {
    const key = this.projectKey();
    if (!key) {
      return;
    }
    const q = this.parsed().rest.trim();
    this.leaveTimeTravel();
    this.close();
    void this.router.navigate(['/p', key, 'search'], { queryParams: { q: q === '' ? null : q } });
  }

  protected totalHits(): number {
    return this.searchItems().total;
  }

  /** The projects are read each time the palette opens, so a new one shows up without a reload. */
  private loadProjects(): void {
    this.api.listProjects().subscribe({
      next: (projects) => this.projects.set(projects ?? []),
      error: () => this.projects.set([]),
    });
  }

  /** Search always answers from the current revision: opening a result leaves time travel. */
  private leaveTimeTravel(): void {
    if (this.timeTravel.isTimeTravel()) {
      this.timeTravel.exit();
    }
  }

  private scrollActive(): void {
    const id = this.active()?.id;
    queueMicrotask(() => id && document.getElementById(id)?.scrollIntoView({ block: 'nearest' }));
  }
}
