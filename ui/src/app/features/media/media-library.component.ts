import { ChangeDetectionStrategy, Component, effect, inject, input, untracked } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfSplitterComponent } from '../../shared/components/splitter/sf-splitter.component';
import { ReleaseDialogComponent } from '../release/release-dialog.component';
import { ReleaseEventsStore, withObservedRelease } from '../release/release-events.store';
import { MediaFolderActions } from './library/media-folder-actions';
import { MediaItemActions } from './library/media-item-actions';
import { MediaMover } from './library/media-mover';
import { MediaReleaseActions } from './library/media-release.actions';
import { MediaSelectionActions } from './library/media-selection.actions';
import { MediaLibraryMainComponent } from './library/media-library-main.component';
import { MediaLibraryTreeComponent } from './library/media-library-tree.component';
import { type MediaView, MediaLibraryStore } from './library/media-library.store';
import { MediaThumbnailStore } from './library/media-thumbnail.store';
import { MediaUploadStore } from './library/media-upload.store';
import { MediaDetailDrawerComponent, type MediaFileAction } from './media-detail-drawer.component';

const TREE_WIDTH = 280;
const TREE_WIDTH_NARROW = 240;
const WIDE_QUERY = '(min-width: 1280px)';

/**
 * The media library screen (M35.19): the folder tree on the left (a collapsible splitter pane), the library on the right
 * and, over it, the detail drawer of the open file. The URL is the source of truth — `?folder=`, `?asset=`, `?q=`,
 * `?type=`, `?sort=` and `?media=` come in as inputs, are applied to the {@link MediaLibraryStore}, and every change a
 * person makes goes back through the router — so back, forward and deep links work, and a stale `folder` or `asset` is
 * dropped. The stores are provided here and shared by the tree, toolbar, grid, list and drawer; the effects that react to
 * the route and to release events stay in this constructor, in one place, so their order under zoneless change detection
 * is explicit.
 */
@Component({
  selector: 'sf-media-library',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MediaDetailDrawerComponent,
    MediaLibraryMainComponent,
    MediaLibraryTreeComponent,
    ReleaseDialogComponent,
    SfSplitterComponent,
    TranslocoPipe,
  ],
  providers: [MediaLibraryStore, MediaThumbnailStore, MediaUploadStore, MediaMover, MediaFolderActions, MediaItemActions, MediaReleaseActions, MediaSelectionActions],
  templateUrl: './media-library.component.html',
  styleUrl: './media-library.component.scss',
})
export class MediaLibraryComponent {
  readonly projectKey = input.required<string>();
  /** `?asset=<uuid>` is the open file (its detail drawer); also how search and recents link to a file. */
  readonly asset = input<string | undefined>();
  /** `?folder=<uuid>` is the open folder. */
  readonly folder = input<string | undefined>();
  /** `?q=<text>` searches the folder by name. */
  readonly q = input<string | undefined>();
  /** `?type=images|documents|text` narrows the folder to a kind of file. */
  readonly type = input<string | undefined>();
  /** `?sort=<name|date|size|type>-<asc|desc>`. */
  readonly sort = input<string | undefined>();
  /** `?media=grid|list` overrides the stored view. */
  readonly media = input<string | undefined>();
  /** `?mtab=` is the drawer's tab (`source`, `usedby`, …). */
  readonly mtab = input<string | undefined>();
  /** `?favorites=1` shows the Favorites list in the main pane (the tree's pinned *Favorites* node). */
  readonly favorites = input<string | undefined>();

  private readonly project = inject(ProjectContextStore);
  private readonly releaseEvents = inject(ReleaseEventsStore);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  protected readonly library = inject(MediaLibraryStore);
  private readonly itemActions = inject(MediaItemActions);
  private readonly mover = inject(MediaMover);
  protected readonly release = inject(MediaReleaseActions);

  protected readonly treeWidth =
    typeof matchMedia !== 'function' || matchMedia(WIDE_QUERY).matches ? TREE_WIDTH : TREE_WIDTH_NARROW;

  constructor() {
    this.library.connect(this.projectKey);

    // What the URL says (first, so the effects below see it).
    effect(() => {
      const params = {
        folder: this.folder(),
        asset: this.asset(),
        q: this.q(),
        type: this.type(),
        sort: this.sort(),
        media: this.media(),
        mtab: this.mtab(),
        favorites: this.favorites(),
      };
      untracked(() => this.library.applyRoute(params));
    });

    effect(() => {
      const key = this.projectKey();
      if (key) {
        untracked(() => {
          this.project.loadFor(key).subscribe();
          this.library.loadAllMedia(key);
        });
      }
    });

    // The open folder's files, read when the folder tree is there (the folder's path comes from it): from scratch for
    // another folder, in place when only its path changed (it was renamed or moved).
    let loadedFolder: string | null = null;
    effect(() => {
      const key = this.projectKey();
      const ready = this.library.treeReady();
      const gone = this.library.folderGone();
      const folder = this.library.folderUuid();
      this.library.folderPath();
      if (key && ready && !gone) {
        untracked(() => {
          const sameFolder = loadedFolder === `${key}|${folder}`;
          loadedFolder = `${key}|${folder}`;
          if (sameFolder) {
            this.library.reload();
          } else {
            this.library.loadFolder();
          }
        });
      }
    });

    // A folder that is not in the tree (deleted, another project's): the library shows its root and forgets the link.
    effect(() => {
      if (this.library.folderGone()) {
        untracked(() => {
          this.toasts.show(this.transloco.translate('media.library.folderGone'), 'info');
          this.library.forgetFolder();
        });
      }
    });

    // The drawer shows the file the URL names; a file that does not exist is forgotten, and a file of another folder
    // brings its folder along.
    effect(() => {
      const uuid = this.library.assetUuid();
      this.library.items();
      this.library.allMedia();
      this.library.allLoaded();
      untracked(() => {
        this.library.resolveAsset(uuid);
        if (this.library.assetGone()) {
          this.toasts.show(this.transloco.translate('media.library.assetGone'), 'info');
          this.library.forgetAsset();
        } else if (uuid && this.library.selectedMedia()?.uuid === uuid) {
          const home = this.library.folderUuidOfAsset(uuid);
          if (home !== null && home !== this.library.folderUuid()) {
            this.library.showFolderOfAsset(home);
          }
        }
      });
    });

    // A release, unpublish, discard or schedule anywhere: the files and the counts re-read their statuses (the folder
    // tree itself is refreshed by the project shell).
    let seenReleaseVersion = this.releaseEvents.version();
    effect(() => {
      const version = this.releaseEvents.version();
      if (version === seenReleaseVersion) {
        return;
      }
      seenReleaseVersion = version;
      untracked(() => this.library.reloadMedia());
    });

    // The drawer's release bar read a new status (e.g. after a save): the rows show it at once (M27.6.1).
    effect(
      () => {
        const observed = this.releaseEvents.observed();
        untracked(() => {
          const items = withObservedRelease(this.library.items(), observed);
          if (items) {
            this.library.items.set(items);
          }
          const all = withObservedRelease(this.library.allMedia(), observed);
          if (all) {
            this.library.allMedia.set(all);
          }
          const open = this.library.selectedMedia();
          const patched = open ? withObservedRelease([open], observed) : null;
          if (patched) {
            this.library.selectedMedia.set(patched[0]);
          }
        });
      },
      { allowSignalWrites: true },
    );
  }

  /** The drawer's ⋮ menu: the same rename, move, download and link as the grid's menu, with the same dialogs. */
  protected onFileAction(action: MediaFileAction, file: MediaView): void {
    switch (action) {
      case 'rename':
        void this.itemActions.rename(file);
        break;
      case 'move':
        void this.mover.moveFiles([file]);
        break;
      case 'download':
        void this.itemActions.download([file]);
        break;
      case 'copyLink':
        void this.itemActions.copyLink(file);
        break;
    }
  }
}
