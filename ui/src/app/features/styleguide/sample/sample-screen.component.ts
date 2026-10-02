import { DOCUMENT, Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { DensityService } from '../../../core/ui/density.service';
import { ShortcutService } from '../../../core/ui/shortcut.service';
import { ThemeService } from '../../../core/ui/theme.service';
import { SfDrawerComponent } from '../../../shared/components/dialog/sf-drawer.component';
import { SfMenuComponent, SfMenuItem } from '../../../shared/components/menu/sf-menu.component';
import {
  SfTreeAction,
  SfTreeComponent,
  SfTreeCreateKind,
  SfTreeDeleteRequest,
} from '../../../shared/components/sf-tree.component';
import { SfSplitterComponent } from '../../../shared/components/splitter/sf-splitter.component';
import { SfTreeLoader, SfTreeNode } from '../../../shared/components/tree/tree-model';
import { SampleContentFolderComponent } from './sample-content-folder.component';
import { SampleContentTreeComponent } from './sample-content-tree.component';
import { SampleDatasetViewComponent } from './sample-dataset-view.component';
import { SampleFolderViewComponent } from './sample-folder-view.component';
import { SamplePageEditorComponent } from './sample-page-editor.component';
import { SampleRailComponent } from './sample-rail.component';
import { SampleRecordEditorComponent } from './sample-record-editor.component';
import { SampleRecordSetComponent } from './sample-record-set.component';
import { SampleEntry, childrenOf, parentOf, pathTo } from './sample-data';
import { FAVORITES_NODE, SampleFavorite } from './sample-favorites';
import { favoriteChildren, favoriteNodes, favoritesNode, isFavoriteNode } from './sample-favorites-nodes';
import { SampleFavoritesViewComponent } from './sample-favorites-view.component';
import type { ContextMenuItem } from '../../../shared/services/context-menu.service';
import {
  AREA_OF_VIEW,
  SAMPLE_AREAS,
  SAMPLE_DATASET_TABS,
  SAMPLE_VIEWS,
  SELF_CONTAINED_AREAS,
  STATUS_ICONS,
  STATUS_TONES,
  SampleArea,
  SampleCodePalette,
  SampleDensity,
  SampleRail,
  SampleSelfContainedArea,
  SampleState,
  SampleThemeChoice,
  SampleView,
} from './sample-state';
import { CDL_SECTIONS, SampleTemplateChannel, SampleTemplateKey, templateDefById } from './sample-template-data';
import { SampleTemplateViewComponent } from './sample-template-view.component';
import { SampleTemplatesTreeComponent } from './sample-templates-tree.component';
import { TEASERS_ROW } from './sample-page-editor.component';
import { SampleTopbarComponent } from './sample-topbar.component';
import { SampleChangesAreaComponent } from './changes/sample-changes-area.component';
import { SampleSchedulesAreaComponent } from './changes/sample-schedules-area.component';
import { SampleGlobalsAreaComponent } from './globals/sample-globals-area.component';
import { SampleMediaAreaComponent } from './media/sample-media-area.component';
import { SamplePublishingAreaComponent } from './publishing/sample-publishing-area.component';
import { SampleSettingsAreaComponent } from './settings/sample-settings-area.component';
import { SampleHistoryAreaComponent } from './history/sample-history-area.component';
import { SampleHistoryDrawerComponent } from './history/sample-history-drawer.component';
import { SampleTimeTravelBannerComponent } from './history/sample-time-travel-banner.component';
import { revisionById } from './history/history-data';
import { SampleNavigationAreaComponent } from './navigation/sample-navigation-area.component';
import { SamplePaletteComponent } from './keyboard/sample-palette.component';
import { SampleShortcutSheetComponent } from './keyboard/sample-shortcut-sheet.component';

const DARK_QUERY = '(prefers-color-scheme: dark)';
/** `--sf-tree-width` (the splitter takes a number); narrower below the large breakpoint. */
const TREE_WIDTH = 280;
const TREE_WIDTH_NARROW = 240;
const WIDE_QUERY = '(min-width: 1280px)';

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return allowed.includes(value as T) ? (value as T) : null;
}

/** The query parameters the screen owns; every other parameter belongs to an area and is kept as it is. */
const OWN_PARAMS = ['area', 'view', 'template', 'tab', 'channel', 'focus', 'dev', 'rail', 'theme', 'density', 'palette', 'hdrawer', 'travel', 'cmdk', 'sheet', 'sheetq'];

/**
 * The M35.9 sample screen: a clickable prototype of the new frame (dark top bar, rail) around the working areas —
 * Pages (tree, folder table, page editor with a catalog field), Content (folders and record sets, record set view with
 * its query panel, record editor), Templates in developer mode (datasets, the template view with CDL and OCTL), and
 * the self-contained areas other parts render — built only from design-system components and fake data. Nothing is
 * saved.
 *
 * - **Theme, density and the code palette** are previewed on `<html>` (`data-theme`, `data-density`,
 *   `data-code-palette`) without touching the user's preferences; leaving restores what {@link ThemeService} and
 *   {@link DensityService} say and drops the palette.
 * - **Query parameters** for scripted screenshots are read on load and kept in sync (replacing the history entry) as
 *   the user clicks: `area=pages|content|templates|…`; `view=folder|editor` (Pages), `contentfolder|recordset|record`
 *   (Content), `dataset|template` (Templates); `template=article|teaser`; `tab` (the dataset tab, or the template's
 *   CDL tab `content|bodies|rules`); `channel=html|rss`; `focus=catalog` (the page editor's catalog field in view);
 *   `dev=1|0`, `rail=expanded|collapsed`, `theme=light|dark`, `density=compact|comfortable`,
 *   `palette=current|refined`.
 */
@Component({
  selector: 'sf-sample-screen',
  standalone: true,
  imports: [
    SampleChangesAreaComponent,
    SampleContentFolderComponent,
    SampleContentTreeComponent,
    SampleDatasetViewComponent,
    SampleFavoritesViewComponent,
    SampleFolderViewComponent,
    SampleGlobalsAreaComponent,
    SampleHistoryAreaComponent,
    SampleHistoryDrawerComponent,
    SampleMediaAreaComponent,
    SampleNavigationAreaComponent,
    SamplePageEditorComponent,
    SamplePublishingAreaComponent,
    SampleSettingsAreaComponent,
    SampleRailComponent,
    SampleRecordEditorComponent,
    SampleRecordSetComponent,
    SampleSchedulesAreaComponent,
    SampleTemplateViewComponent,
    SampleTemplatesTreeComponent,
    SampleTimeTravelBannerComponent,
    SampleTopbarComponent,
    SamplePaletteComponent,
    SampleShortcutSheetComponent,
    SfDrawerComponent,
    SfMenuComponent,
    SfSplitterComponent,
    SfTreeComponent,
    TranslocoPipe,
  ],
  providers: [SampleState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-screen.component.html',
  styleUrls: ['./sample-screen.component.scss', './sample-tree-pane.scss'],
})
export class SampleScreenComponent {
  protected readonly state = inject(SampleState);
  private readonly location = inject(Location);
  private readonly root = inject(DOCUMENT).documentElement;
  private readonly injector = inject(Injector);
  /** The Pages tree (absent while another area is open). */
  private readonly tree = viewChild<SfTreeComponent<SampleEntry>>(SfTreeComponent);

  protected readonly treeWidth =
    typeof matchMedia !== 'function' || matchMedia(WIDE_QUERY).matches ? TREE_WIDTH : TREE_WIDTH_NARROW;
  protected readonly treeActions: readonly SfTreeAction[] = ['rename', 'delete', 'create'];
  /** The *Favorites* branch is a view: nothing in it is renamed, deleted or created. */
  protected readonly allowAction = (_action: SfTreeAction, nodes: readonly SfTreeNode<SampleEntry>[]): boolean =>
    !nodes.some((node) => isFavoriteNode(node.id));

  /** Lazy children with status badges (only when not released) and, in developer mode, the UID. */
  protected readonly loader = computed<SfTreeLoader<SampleEntry>>(() => {
    const dev = this.state.devMode();
    const lang = this.state.lang();
    this.state.t('status.released'); // tracks the language file
    const favorites = this.state.favorites();
    const label = this.state.t('favorites.node');
    return (parent) => {
      if (parent?.id === FAVORITES_NODE) {
        return favoriteNodes<SampleEntry>(favorites);
      }
      if (parent && isFavoriteNode(parent.id)) {
        return favoriteChildren<SampleEntry>(parent.id, favorites);
      }
      const nodes = childrenOf(parent?.id ?? null).map((entry) => this.toNode(entry, dev, lang));
      return parent === null && favorites.length > 0 ? [favoritesNode<SampleEntry>(label), ...nodes] : nodes;
    };
  });

  protected readonly treeSelection = computed(() => {
    if (this.state.view() === 'editor') {
      return [this.state.pageId()];
    }
    if (this.state.favoritesOpen()) {
      return [FAVORITES_NODE];
    }
    const folder = this.state.folderId();
    return folder === null ? [] : [folder];
  });

  protected readonly newItems = computed<SfMenuItem[]>(() => [
    { id: 'page', label: this.state.t('tree.newPage'), icon: 'note_add', action: () => this.create('item') },
    { id: 'folder', label: this.state.t('tree.newFolder'), icon: 'create_new_folder', action: () => this.create('folder') },
  ]);

  /** The open area when its own component fills the main region. */
  protected readonly selfContained = computed<SampleSelfContainedArea | null>(() => {
    const area = this.state.area();
    return (SELF_CONTAINED_AREAS as readonly string[]).includes(area) ? (area as SampleSelfContainedArea) : null;
  });

  constructor() {
    const theme = inject(ThemeService);
    const density = inject(DensityService);
    this.state.theme.set(theme.preference());
    this.state.density.set(density.density());
    this.readQueryParams();

    // The sample has no app shell, so it registers the two keys the frame owns in the app (M35.14).
    inject(ShortcutService).use([
      {
        id: 'palette',
        keys: 'Mod+K',
        scope: 'global',
        group: 'general',
        description: 'frame.shortcuts.items.palette',
        allowInInput: true,
        handler: () => this.state.paletteQuery.set(''),
      },
      {
        id: 'sheet',
        keys: '?',
        scope: 'global',
        group: 'general',
        description: 'frame.shortcuts.items.sheet',
        handler: () => this.state.shortcutsOpen.set(true),
      },
    ]);

    // Preview theme and density on <html>; restore the user's own when leaving.
    const dark = typeof matchMedia === 'function' ? matchMedia(DARK_QUERY).matches : false;
    effect(() => {
      const choice = this.state.theme();
      this.root.dataset['theme'] = choice === 'system' ? (dark ? 'dark' : 'light') : choice;
      this.root.dataset['density'] = this.state.density();
      if (this.state.palette() === 'refined') {
        this.root.dataset['codePalette'] = 'refined';
      } else {
        delete this.root.dataset['codePalette'];
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.root.dataset['theme'] = theme.theme();
      this.root.dataset['density'] = density.density();
      delete this.root.dataset['codePalette'];
    });

    // The Templates area is developer-only: switching developer mode off leaves it.
    effect(
      () => {
        if (!this.state.devMode() && this.state.area() === 'templates') {
          untracked(() => this.state.openArea('pages'));
        }
      },
      { allowSignalWrites: true },
    );

    effect(() => this.writeQueryParams());

    // Keep the open folder or page visible in the tree (expanding its ancestors; the folder itself too).
    let rendered = false;
    afterNextRender(() => {
      rendered = true;
      void this.revealOpen();
    });
    effect(() => {
      this.state.view();
      this.state.folderId();
      this.state.pageId();
      if (rendered) {
        // After the Pages tree is (back) in the view.
        untracked(() => afterNextRender(() => void this.revealOpen(), { injector: this.injector }));
      }
    });
  }

  /** The context menu's *Add to favorites* / *Remove from favorites* for a page or folder (M35.15). */
  protected readonly treeMenuItems = (nodes: readonly SfTreeNode<SampleEntry>[]): ContextMenuItem[] => {
    const node = nodes.length === 1 ? nodes[0] : null;
    if (!node || isFavoriteNode(node.id) || !node.data) {
      return [];
    }
    const entry = node.data;
    const on = this.state.isFavorite(entry.id);
    return [
      {
        label: this.state.t(on ? 'favorites.remove' : 'favorites.add'),
        icon: 'star',
        action: () => this.state.toggleFavorite(entry.id),
      },
    ];
  };

  protected async onOpen(node: SfTreeNode<SampleEntry>): Promise<void> {
    if (isFavoriteNode(node.id)) {
      if (await this.state.canLeave()) {
        this.state.openFavoriteNode(node.data as unknown as SampleFavorite | undefined);
      }
      return;
    }
    const entry = node.data!;
    if (!(await this.state.canLeave())) {
      return;
    }
    if (entry.kind === 'folder') {
      this.state.openFolder(entry.id);
    } else {
      this.state.openPage(entry.id);
    }
  }

  protected onDelete(request: SfTreeDeleteRequest<SampleEntry>): void {
    request.completed(() => this.state.notice('folder.restored'));
  }

  /** The drawer's *Open full history* / *Details*: the History page, with that revision open. */
  protected openFullHistory(revision: number | null): void {
    this.state.history.set(null);
    this.state.historyRev.set(revision);
    this.state.openArea('history');
  }

  private create(kind: SfTreeCreateKind): void {
    const parent = this.state.view() === 'folder' ? this.state.folderId() : parentOf(this.state.pageId());
    void this.tree()?.startCreate(parent, kind);
  }

  private async revealOpen(): Promise<void> {
    const tree = this.tree();
    if (!tree || this.state.area() !== 'pages') {
      return;
    }
    const id = this.state.view() === 'editor' ? this.state.pageId() : this.state.folderId();
    const path = pathTo(id).filter((entry) => entry.kind === 'folder');
    for (const entry of path) {
      await tree.expand(entry.id);
    }
  }

  private toNode(entry: SampleEntry, dev: boolean, lang: 'de' | 'en'): SfTreeNode<SampleEntry> {
    const status = entry.status[lang];
    const isFolder = entry.kind === 'folder';
    return {
      id: entry.id,
      label: entry.name,
      icon: isFolder ? 'folder' : entry.startPage ? 'home' : 'description',
      secondary: dev ? entry.uid : null,
      badges:
        isFolder || status === 'released'
          ? []
          : [{ label: this.state.statusLabel(status), tone: STATUS_TONES[status], icon: STATUS_ICONS[status] }],
      hasChildren: isFolder && (entry.children?.length ?? 0) > 0,
      droppable: isFolder,
      data: entry,
    };
  }

  private readQueryParams(): void {
    const params = inject(ActivatedRoute).snapshot.queryParamMap;
    const dev = params.get('dev');
    if (dev === '1' || dev === '0') {
      this.state.devMode.set(dev === '1');
    }
    const area = oneOf<SampleArea>(params.get('area'), SAMPLE_AREAS);
    const view = oneOf<SampleView>(params.get('view'), SAMPLE_VIEWS);
    const template = oneOf<SampleTemplateKey>(params.get('template'), ['article', 'teaser']);
    if (view && SAMPLE_AREAS.includes(AREA_OF_VIEW[view]) && (!area || AREA_OF_VIEW[view] === area)) {
      this.state.openFixed(view, template ?? 'article');
    } else if (area) {
      this.state.openArea(area);
    }
    if (this.state.area() === 'templates' && !this.state.devMode()) {
      this.state.openArea('pages');
    }
    const tab = params.get('tab');
    const datasetTab = oneOf(tab, SAMPLE_DATASET_TABS);
    if (datasetTab) {
      this.state.datasetTab.set(datasetTab);
    }
    const section = oneOf(tab, CDL_SECTIONS);
    if (section) {
      this.state.templateSection.set(section);
    }
    const channel = oneOf<SampleTemplateChannel>(params.get('channel'), ['html', 'rss']);
    if (channel) {
      this.state.templateChannel.set(channel);
    }
    if (params.get('focus') === TEASERS_ROW && this.state.view() === 'editor') {
      this.state.focus.set(TEASERS_ROW);
    }
    const palette = oneOf<SampleCodePalette>(params.get('palette'), ['current', 'refined']);
    if (palette) {
      this.state.palette.set(palette);
    }
    const drawer = oneOf(params.get('hdrawer'), ['page', 'record', 'project'] as const);
    if (drawer) {
      this.state.history.set(drawer);
    }
    const travel = Number(params.get('travel'));
    if (params.has('travel') && revisionById(travel)) {
      this.state.travel.set(travel);
    }
    if (params.has('cmdk')) {
      this.state.paletteQuery.set(params.get('cmdk') ?? '');
    }
    if (params.get('sheet') === '1') {
      this.state.shortcutsQuery.set(params.get('sheetq') ?? '');
      this.state.shortcutsOpen.set(true);
    }
    const rail = oneOf<SampleRail>(params.get('rail'), ['expanded', 'collapsed']);
    if (rail) {
      this.state.rail.set(rail);
    }
    const theme = oneOf<SampleThemeChoice>(params.get('theme'), ['light', 'dark']);
    if (theme) {
      this.state.theme.set(theme);
    }
    const density = oneOf<SampleDensity>(params.get('density'), ['compact', 'comfortable']);
    if (density) {
      this.state.density.set(density);
    }
  }

  private writeQueryParams(): void {
    const area = this.state.area();
    const view = this.state.view();
    const query = new URLSearchParams({ area });
    if (!this.selfContained()) {
      query.set('view', view);
    }
    if (view === 'template') {
      const def = templateDefById(this.state.templateId());
      if (def) {
        query.set('template', def.key);
        if (this.state.templateSection() !== 'content') {
          query.set('tab', this.state.templateSection());
        }
        if (this.state.templateChannel() !== 'html') {
          query.set('channel', this.state.templateChannel());
        }
      }
    } else if (view === 'dataset' && this.state.datasetTab() !== 'overview') {
      query.set('tab', this.state.datasetTab());
    }
    if (this.state.history()) {
      query.set('hdrawer', this.state.history()!);
    }
    if (this.state.travel() !== null) {
      query.set('travel', String(this.state.travel()));
    }
    if (this.state.paletteQuery() !== null) {
      query.set('cmdk', this.state.paletteQuery()!);
    }
    if (this.state.shortcutsOpen()) {
      query.set('sheet', '1');
    }
    query.set('dev', this.state.devMode() ? '1' : '0');
    query.set('rail', this.state.rail());
    const theme = this.state.theme();
    if (theme !== 'system') {
      query.set('theme', theme);
    }
    query.set('density', this.state.density());
    if (this.state.palette() !== 'current') {
      query.set('palette', this.state.palette());
    }
    const [path, search = ''] = this.location.path().split('?');
    // Only the screen's own keys are rewritten; the areas' parameters (media, nav, set, psec, ssec, …) stay — each
    // area removes its own when it closes.
    new URLSearchParams(search).forEach((value, key) => {
      if (!OWN_PARAMS.includes(key)) {
        query.append(key, value);
      }
    });
    this.location.replaceState(path, query.toString());
  }
}
