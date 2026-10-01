import { Location } from '@angular/common';
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
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import {
  SfTreeAction,
  SfTreeComponent,
  SfTreeCreateKind,
  SfTreeDeleteRequest,
} from '../../../../shared/components/sf-tree.component';
import { SfSplitterComponent } from '../../../../shared/components/splitter/sf-splitter.component';
import { SfTreeLoader, SfTreeNode } from '../../../../shared/components/tree/tree-model';
import { SampleMediaFolder, mediaFolder, mediaFolderChildren } from './sample-media-data';
import { SampleMediaDetailComponent } from './sample-media-detail.component';
import { SampleMediaLibraryComponent } from './sample-media-library.component';
import { MEDIA_TABS, MEDIA_VIEWS, SampleMediaState, SampleMediaTab, SampleMediaView } from './sample-media-state';

/** The query parameters this area owns (removed again when it closes). */
const OWN_PARAMS = ['media', 'folder', 'asset', 'mtab', 'upload', 'selected'] as const;
const TREE_WIDTH = 260;
const TREE_WIDTH_NARROW = 220;
const WIDE_QUERY = '(min-width: 1280px)';

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return allowed.includes(value as T) ? (value as T) : null;
}

/**
 * The sample's media area (M35.9, decisions 19–22; mocks M35.19): a folder tree (folders only, with a filter) beside
 * the library — grid and list, toolbar, selection with bulk actions, drop zone and upload panel — and the non-modal
 * detail drawer with every tab that applies to the file. Fake data, nothing is saved.
 *
 * Renders inside the sample's main region and fills it. Developer mode is the sample's ({@link SampleState.devMode}).
 *
 * **Query parameters** (read on load, kept in sync by replacing the history entry; other parameters are kept):
 * `media=grid|list`, `folder=<id>`, `asset=<id>` (opens the drawer), `mtab=details|variants|languages|processing|
 * rendered|source|usedby|versions`, `upload=1` (the upload panel mid-upload), `selected=<n>` (the first n files
 * selected, so the bulk bar shows).
 */
@Component({
  selector: 'sf-sample-media-area',
  standalone: true,
  imports: [
    SampleMediaDetailComponent,
    SampleMediaLibraryComponent,
    SfButtonComponent,
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
  private readonly tree = viewChild.required<SfTreeComponent<SampleMediaFolder>>(SfTreeComponent);

  protected readonly treeWidth =
    typeof matchMedia !== 'function' || matchMedia(WIDE_QUERY).matches ? TREE_WIDTH : TREE_WIDTH_NARROW;
  protected readonly treeActions: readonly SfTreeAction[] = ['rename', 'delete', 'create'];
  protected readonly createKinds: readonly SfTreeCreateKind[] = ['folder'];

  /** Folders only (decision 19), each with its file count and, in developer mode, its UID. */
  protected readonly loader = computed<SfTreeLoader<SampleMediaFolder>>(() => {
    const dev = this.state.devMode();
    const files = this.state.files();
    return (parent) =>
      mediaFolderChildren(parent?.id ?? null).map(
        (folder) =>
          ({
            id: folder.id,
            label: folder.name,
            icon: 'folder',
            secondary: dev ? folder.uid : null,
            badges: [{ kind: 'badge', label: String(files.filter((f) => f.folderId === folder.id).length) }],
            hasChildren: (folder.children?.length ?? 0) > 0,
            droppable: true,
            data: folder,
          }) satisfies SfTreeNode<SampleMediaFolder>,
      );
  });

  protected readonly treeSelection = computed(() => [this.state.folderId()]);

  constructor() {
    this.readQueryParams();
    effect(() => this.writeQueryParams());

    // The sample's breadcrumb: Media › folders; a chosen segment opens that folder (the area root: the default one).
    const sample = this.state.sample;
    effect(
      () => {
        const path = this.state.folderPath();
        sample.areaPath.set(path.map((f, i) => (i === path.length - 1 ? { label: f.name } : { label: f.name, target: f.id })));
      },
      { allowSignalWrites: true },
    );
    effect(() => {
      const chosen = sample.areaTarget();
      if (chosen) {
        untracked(() => {
          const target = chosen.target !== null && mediaFolder(chosen.target) ? chosen.target : null;
          this.state.openFolder(target ?? this.state.folderPath()[0]?.id ?? this.state.folderId());
          sample.areaTarget.set(null);
        });
      }
    });

    // Keep the open folder visible in the tree.
    let rendered = false;
    afterNextRender(() => {
      rendered = true;
      void this.reveal();
    });
    effect(() => {
      this.state.folderId();
      if (rendered) {
        untracked(() => void this.reveal());
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
    this.state.openFolder(node.id);
  }

  protected onDelete(request: SfTreeDeleteRequest<SampleMediaFolder>): void {
    request.completed(() => this.state.notice('folder.restored'));
  }

  protected newFolder(): void {
    void this.tree().startCreate(this.state.folderId(), 'folder');
  }

  private async reveal(): Promise<void> {
    for (const folder of this.state.folderPath()) {
      await this.tree().expand(folder.id);
    }
  }

  private readQueryParams(): void {
    const params = inject(ActivatedRoute).snapshot.queryParamMap;
    const view = oneOf<SampleMediaView>(params.get('media'), MEDIA_VIEWS);
    if (view) {
      this.state.view.set(view);
    }
    const folder = params.get('folder');
    if (folder && mediaFolder(folder)) {
      this.state.folderId.set(folder);
    }
    const asset = params.get('asset');
    const file = asset ? this.state.files().find((f) => f.id === asset) : undefined;
    if (file) {
      // A file opens in its own folder.
      this.state.folderId.set(file.folderId);
      this.state.openAsset(file.id, oneOf<SampleMediaTab>(params.get('mtab'), MEDIA_TABS) ?? 'details');
    }
    if (params.get('upload') === '1') {
      this.state.seedUploads();
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

  private writeQueryParams(): void {
    const query = untracked(() => this.currentQuery());
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
    if (this.state.uploads().length > 0) {
      query.set('upload', '1');
    } else {
      query.delete('upload');
    }
    const selected = this.state.selection().length;
    if (selected > 0) {
      query.set('selected', String(selected));
    } else {
      query.delete('selected');
    }
    this.replace(query);
  }

  private currentQuery(): URLSearchParams {
    return new URLSearchParams(this.location.path().split('?')[1] ?? '');
  }

  private replace(query: URLSearchParams): void {
    this.location.replaceState(this.location.path().split('?')[0], query.toString());
  }
}
