import { DOCUMENT, Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { CodeFormat, extensionOf } from '../../../../shared/code-editor/code-format';
import { SfSearchInputComponent } from '../../../../shared/components/forms/sf-search-input.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../../../shared/components/sf-empty-state.component';
import {
  SfTreeAction,
  SfTreeComponent,
  SfTreeCreateKind,
  SfTreeDeleteRequest,
} from '../../../../shared/components/sf-tree.component';
import { SfSplitterComponent } from '../../../../shared/components/splitter/sf-splitter.component';
import { SfTreeLoader, SfTreeNode } from '../../../../shared/components/tree/tree-model';
import { SAMPLE_LANGS, SampleLang } from '../sample-data';
import {
  MEDIA_TYPE_FILTERS,
  SOURCE_BANNERS,
  SampleMediaFile,
  SampleMediaFolder,
  allFolders,
  completionStub,
  mediaFolder,
  mediaFolderChildren,
  mediaFolderMatches,
} from './sample-media-data';
import { SampleMediaDetailComponent } from './sample-media-detail.component';
import { SampleMediaLibraryComponent } from './sample-media-library.component';
import {
  MEDIA_DIALOGS,
  MEDIA_REVIEW_STATES,
  MEDIA_SORTS,
  MEDIA_TABS,
  MEDIA_VIEWS,
  SampleMediaSort,
  SampleMediaState,
  SampleMediaTab,
  SampleMediaView,
  SampleSortDirection,
  UPLOAD_SEEDS,
} from './sample-media-state';

/** The query parameters this area owns (removed again when it closes). */
const OWN_PARAMS = [
  'media',
  'folder',
  'asset',
  'mtab',
  'upload',
  'selected',
  'state',
  'tfilter',
  'q',
  'type',
  'sort',
  'dirty',
  'dialog',
  'menu',
  'banner',
  'highlight',
  'lang',
  'complete',
] as const;
/** `highlight=` values: Auto (the type's override is removed) or a format (the type is highlighted as it). */
const HIGHLIGHT_PARAMS: Readonly<Record<string, CodeFormat | null>> = {
  auto: null,
  css: 'CSS',
  javascript: 'JAVASCRIPT',
  json: 'JSON',
  xml: 'XML',
  markdown: 'MARKDOWN',
  plain: 'PLAIN',
};
const TREE_WIDTH = 260;
const TREE_WIDTH_NARROW = 220;
const WIDE_QUERY = '(min-width: 1280px)';
const SORT_PARAM = new RegExp(`^(${MEDIA_SORTS.join('|')})-(asc|desc)$`);
/** The class a tree row gets while files are dragged over it. */
const DROP_CLASS = 'is-media-drop';

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return allowed.includes(value as T) ? (value as T) : null;
}

/**
 * The sample's media area (M35.9, decisions 19–22 and 90–101; mocks M35.19): a folder tree (folders only, with a
 * filter) beside the library — grid and list, toolbar, selection with bulk actions, drop zone and upload panel — and the
 * non-modal detail drawer with every tab that applies to the file. Fake data, nothing is saved.
 *
 * Renders inside the sample's main region and fills it. Developer mode is the sample's ({@link SampleState.devMode}).
 *
 * **Query parameters** (read on load, kept in sync by replacing the history entry; other parameters are kept):
 * - `media=grid|list`, `folder=<id>`, `asset=<id>` (opens the drawer), `mtab=details|variants|languages|processing|
 *   rendered|source|usedby|versions`, `selected=<n>` (the first n files of the folder selected, so the bulk bar shows;
 *   `folder=m-archive&selected=30` for the typed delete confirmation);
 * - `q=<text>` (search), `type=images|documents|text`, `sort=name|date|size|type` + `-asc|-desc` (`sort=size-desc`);
 * - `tfilter=<text>` (the folder tree's filter);
 * - `state=loading|error|empty` (skeleton, error with Retry — Retry returns to normal — and a library with no folders
 *   and no files);
 * - `upload=1` (the panel mid-upload) or `upload=errors` (every kind of refusal);
 * - review shortcuts, applied once on load: `dirty=1` (the open file has unsaved edits, so stepping, switching folder
 *   or closing asks), `dialog=rename|move|folder-move|delete` (that dialog opens), `menu=<fileId>` (that file's menu);
 * - the Source tab of a text file (`asset=a-brand-css&mtab=source`, or `a-logo` for SVG), applied once on load:
 *   `banner=large|utf8|eol` (too large to edit / not valid UTF-8 / mixed line endings), `highlight=auto|css|javascript|
 *   json|xml|markdown|plain` (the project's highlight override for the open file's type), `lang=de|en` (the file has one
 *   file per language, shown in that language), `complete=1` (ends the text with an unfinished `$CMS_VALUE(#global.br`
 *   to try completion on: Ctrl+End, Ctrl+Space).
 */
@Component({
  selector: 'sf-sample-media-area',
  standalone: true,
  imports: [
    SampleMediaDetailComponent,
    SampleMediaLibraryComponent,
    SfButtonComponent,
    SfEmptyStateComponent,
    SfSearchInputComponent,
    SfSplitterComponent,
    SfTreeComponent,
    TranslocoPipe,
  ],
  providers: [SampleMediaState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-media-area.component.html',
  styleUrls: ['../sample-tree-pane.scss', './sample-media-area.component.scss'],
})
export class SampleMediaAreaComponent {
  protected readonly state = inject(SampleMediaState);
  private readonly location = inject(Location);
  private readonly document = inject(DOCUMENT);
  private readonly tree = viewChild.required<SfTreeComponent<SampleMediaFolder>>(SfTreeComponent);
  /** The tree row files are being dragged over. */
  private dropRow: HTMLElement | null = null;

  protected readonly treeWidth =
    typeof matchMedia !== 'function' || matchMedia(WIDE_QUERY).matches ? TREE_WIDTH : TREE_WIDTH_NARROW;
  protected readonly treeActions: readonly SfTreeAction[] = ['rename', 'delete', 'create'];
  protected readonly createKinds: readonly SfTreeCreateKind[] = ['folder'];

  /** The filter, lower case and trimmed. */
  private readonly query = computed(() => this.state.treeFilter().trim().toLowerCase());
  /** The filter matches no folder: the pane says so, with *Clear filter*. */
  protected readonly noMatch = computed(
    () => this.query() !== '' && this.state.review() === 'live' && !mediaFolderChildren(null).some((f) => mediaFolderMatches(f, this.query())),
  );

  /**
   * Folders only (decision 19), each with its file count and, in developer mode, its UID. The filter keeps the folders
   * whose name matches and the folders that lead to them; `state=loading` never answers, `state=error` fails the root
   * once (Retry loads it and returns the area to normal), `state=empty` has no folders at all.
   */
  protected readonly loader = computed<SfTreeLoader<SampleMediaFolder>>(() => {
    const dev = this.state.devMode();
    const files = this.state.files();
    const review = this.state.review();
    const query = this.query();
    const children = (id: string | null) => mediaFolderChildren(id).filter((f) => mediaFolderMatches(f, query));
    const nodes = (parent: SfTreeNode<SampleMediaFolder> | null): SfTreeNode<SampleMediaFolder>[] =>
      children(parent?.id ?? null).map(
        (folder) =>
          ({
            id: folder.id,
            label: folder.name,
            icon: 'folder',
            secondary: dev ? folder.uid : null,
            badges: [{ kind: 'badge', label: String(files.filter((f) => f.folderId === folder.id).length) }],
            hasChildren: children(folder.id).length > 0,
            droppable: true,
            data: folder,
          }) satisfies SfTreeNode<SampleMediaFolder>,
      );
    if (review === 'loading') {
      return (parent) => (parent === null ? new Promise<SfTreeNode<SampleMediaFolder>[]>(() => undefined) : nodes(parent));
    }
    if (review === 'empty') {
      return () => [];
    }
    if (review === 'error') {
      let attempts = 0;
      return (parent) => {
        if (parent !== null || attempts++ === 0) {
          return parent === null ? Promise.reject(new Error('sample: the tree could not be loaded')) : nodes(parent);
        }
        // Retry: the root loads, and the whole area is back to normal.
        queueMicrotask(() => this.state.review.set('live'));
        return nodes(null);
      };
    }
    return nodes;
  });

  protected readonly treeSelection = computed(() => [this.state.folderId()]);

  constructor() {
    const params = inject(ActivatedRoute).snapshot.queryParamMap;
    this.readQueryParams(params);
    effect(() => this.writeQueryParams());

    // The sample's breadcrumb: Media › folders; a chosen segment opens that folder (the area root: the default one).
    const sample = this.state.sample;
    effect(
      () => {
        const path = this.state.review() === 'empty' ? [] : this.state.folderPath();
        sample.areaPath.set(path.map((f, i) => (i === path.length - 1 ? { label: f.name } : { label: f.name, target: f.id })));
      },
      { allowSignalWrites: true },
    );
    effect(
      () => {
        const chosen = sample.areaTarget();
        if (chosen) {
          untracked(() => {
            const target = chosen.target !== null && mediaFolder(chosen.target) ? chosen.target : null;
            void this.state.requestOpenFolder(target ?? this.state.folderPath()[0]?.id ?? this.state.folderId());
            sample.areaTarget.set(null);
          });
        }
      },
      { allowSignalWrites: true },
    );

    // The folder menu's Rename folder / the empty library's New folder: the tree's own inline editing.
    effect(
      () => {
        const request = this.state.folderRequest();
        if (request) {
          untracked(() => {
            this.state.folderRequest.set(null);
            if (request === 'rename') {
              this.tree().startRename(this.state.folderId());
            } else {
              void this.tree().startCreate(this.state.review() === 'empty' ? null : this.state.folderId(), 'folder');
            }
          });
        }
      },
      { allowSignalWrites: true },
    );

    // Keep the open folder visible in the tree, and the matches of the filter.
    let rendered = false;
    const dialog = oneOf(params.get('dialog'), MEDIA_DIALOGS);
    const menu = params.get('menu');
    afterNextRender(() => {
      rendered = true;
      void this.reveal();
      if (dialog) {
        this.state.openDialog(dialog);
      }
      if (menu) {
        this.openMenuFor(menu);
      }
    });
    effect(() => {
      this.state.folderId();
      if (rendered) {
        untracked(() => void this.reveal());
      }
    });
    effect(() => {
      const query = this.query();
      if (query && this.state.review() === 'live') {
        // The tree reloads for the new filter first; then its folders on the way to a match open.
        untracked(() => setTimeout(() => void this.expandMatches(query)));
      }
    });

    inject(DestroyRef).onDestroy(() => {
      sample.areaPath.set([]);
      const query = this.currentQuery();
      OWN_PARAMS.forEach((key) => query.delete(key));
      this.replace(query);
    });
  }

  protected onOpen(node: SfTreeNode<SampleMediaFolder>): void {
    void this.state.requestOpenFolder(node.id);
  }

  protected onDelete(request: SfTreeDeleteRequest<SampleMediaFolder>): void {
    request.completed(() => this.state.notice('folder.restored'));
  }

  protected newFolder(): void {
    this.state.folderRequest.set('create');
  }

  protected clearTreeFilter(): void {
    this.state.treeFilter.set('');
  }

  // ── Files dragged onto a folder of the tree (decision 94) ──────────────────

  protected onTreeDragOver(event: DragEvent): void {
    if (this.state.dragging().length === 0) {
      return;
    }
    const row = this.rowOf(event);
    const valid = row !== null && row.dataset['nodeId'] !== this.state.folderId();
    this.mark(valid ? row : null);
    if (valid) {
      event.preventDefault();
    }
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = valid ? 'move' : 'none';
    }
  }

  protected onTreeDragLeave(event: DragEvent, pane: HTMLElement): void {
    if (!(event.relatedTarget instanceof Node && pane.contains(event.relatedTarget))) {
      this.mark(null);
    }
  }

  protected onTreeDrop(event: DragEvent): void {
    const ids = this.state.dragging();
    const row = this.rowOf(event);
    this.mark(null);
    const target = row?.dataset['nodeId'];
    if (ids.length === 0 || !target || target === this.state.folderId()) {
      return;
    }
    event.preventDefault();
    this.state.dragging.set([]);
    this.state.applyMove(ids, target);
  }

  private rowOf(event: DragEvent): HTMLElement | null {
    return event.target instanceof Element ? event.target.closest<HTMLElement>('[role="treeitem"][data-node-id]') : null;
  }

  private mark(row: HTMLElement | null): void {
    if (row === this.dropRow) {
      return;
    }
    this.dropRow?.classList.remove(DROP_CLASS);
    this.dropRow = row;
    row?.classList.add(DROP_CLASS);
  }

  // ── Tree helpers ───────────────────────────────────────────────────────────

  private async reveal(): Promise<void> {
    for (const folder of this.state.folderPath()) {
      await this.tree().expand(folder.id);
    }
  }

  /** Opens the folders that lead to a match of the filter. */
  private async expandMatches(query: string): Promise<void> {
    if (query !== this.query()) {
      return; // typed on since
    }
    for (const folder of allFolders()) {
      if ((folder.children ?? []).some((child) => mediaFolderMatches(child, query))) {
        await this.tree().expand(folder.id);
      }
    }
  }

  private openMenuFor(id: string): void {
    const file: SampleMediaFile | undefined = this.state.files().find((f) => f.id === id);
    const element = this.document.querySelector<HTMLElement>(`[data-file="${id}"]`);
    if (file && element) {
      this.state.openFileMenu(element, file);
    }
  }

  // ── URL ────────────────────────────────────────────────────────────────────

  private readQueryParams(params: { get(name: string): string | null }): void {
    const view = oneOf<SampleMediaView>(params.get('media'), MEDIA_VIEWS);
    if (view) {
      this.state.view.set(view);
    }
    const folder = params.get('folder');
    if (folder && mediaFolder(folder)) {
      this.state.folderId.set(folder);
    }
    const review = oneOf(params.get('state'), MEDIA_REVIEW_STATES);
    if (review) {
      this.state.review.set(review);
    }
    this.state.treeFilter.set(params.get('tfilter') ?? '');
    this.state.search.set(params.get('q') ?? '');
    const type = oneOf(params.get('type'), MEDIA_TYPE_FILTERS);
    if (type) {
      this.state.typeFilter.set(type);
    }
    const sort = SORT_PARAM.exec(params.get('sort') ?? '');
    if (sort) {
      this.state.sort.set(sort[1] as SampleMediaSort);
      this.state.direction.set(sort[2] as SampleSortDirection);
    }
    const asset = params.get('asset');
    const file = asset ? this.state.files().find((f) => f.id === asset) : undefined;
    if (file) {
      // A file opens in its own folder.
      this.state.folderId.set(file.folderId);
      this.state.openAsset(file.id, oneOf<SampleMediaTab>(params.get('mtab'), MEDIA_TABS) ?? 'details');
      this.readSourceParams(params, file);
      if (params.get('dirty') === '1') {
        this.state.edit(
          file.kind === 'image' || file.format === 'SVG'
            ? { alt: `${file.alt} (edited)`.trim() }
            : { caption: `${file.caption} (edited)`.trim() },
        );
      }
    }
    const upload = oneOf(params.get('upload'), UPLOAD_SEEDS);
    if (upload) {
      this.state.seedUploads(upload);
    }
    const selected = Number(params.get('selected'));
    if (Number.isInteger(selected) && selected > 0) {
      this.state.selection.set(
        this.state
          .visible()
          .slice(0, selected)
          .map((f) => f.id),
      );
    }
  }

  /** `banner`, `highlight`, `lang` and `complete`: review shortcuts for the Source tab of a text file. */
  private readSourceParams(params: { get(name: string): string | null }, file: SampleMediaFile): void {
    const banner = oneOf(params.get('banner'), SOURCE_BANNERS);
    if (banner) {
      this.state.sourceBanner.set(banner);
    }
    const highlight = params.get('highlight');
    if (highlight !== null && highlight in HIGHLIGHT_PARAMS) {
      this.state.setHighlight(file, HIGHLIGHT_PARAMS[highlight]);
    }
    const lang = oneOf<SampleLang>(params.get('lang'), SAMPLE_LANGS);
    if (lang && file.kind === 'text') {
      this.state.setLocalized(file, true);
      this.state.textLang.set(lang);
    }
    if (params.get('complete') === '1' && file.kind === 'text') {
      this.state.sourceDraft.set(this.state.sourceBase() + completionStub(extensionOf(file.name) ?? ''));
    }
  }

  private writeQueryParams(): void {
    const query = untracked(() => this.currentQuery());
    const set = (key: string, value: string | null) => (value ? query.set(key, value) : query.delete(key));
    query.set('media', this.state.view());
    query.set('folder', this.state.folderId());
    const asset = this.state.assetId();
    if (asset) {
      query.set('asset', asset);
      query.set('mtab', this.state.currentTab());
    } else {
      query.delete('asset');
      query.delete('mtab');
    }
    const review = this.state.review();
    set('state', review === 'live' ? null : review);
    set('tfilter', this.state.treeFilter().trim() || null);
    set('q', this.state.search().trim() || null);
    set('type', this.state.typeFilter() === 'all' ? null : this.state.typeFilter());
    const sort = `${this.state.sort()}-${this.state.direction()}`;
    set('sort', sort === 'name-asc' ? null : sort);
    const uploads = this.state.uploads();
    if (uploads.length > 0) {
      query.set('upload', query.get('upload') === 'errors' ? 'errors' : '1');
    } else {
      query.delete('upload');
    }
    const selected = this.state.selection().length;
    set('selected', selected > 0 ? String(selected) : null);
    this.replace(query);
  }

  private currentQuery(): URLSearchParams {
    return new URLSearchParams(this.location.path().split('?')[1] ?? '');
  }

  private replace(query: URLSearchParams): void {
    this.location.replaceState(this.location.path().split('?')[0], query.toString());
  }
}
