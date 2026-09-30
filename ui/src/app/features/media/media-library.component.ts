import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SfCreateAssetDialogComponent } from '../../shared/components/sf-create-asset-dialog.component';
import { SfRenameAssetDialogComponent } from '../../shared/components/sf-rename-asset-dialog.component';
import { SfDropTargetDirective } from '../../shared/directives/sf-drop-target.directive';
import { consumeQueryParam } from '../../shared/deep-link';
import { ReleaseEventsStore, withObservedRelease } from '../release/release-events.store';
import { MediaFolderActions } from './library/media-folder-actions';
import { MediaItemActions } from './library/media-item-actions';
import { MediaLibraryGridComponent } from './library/media-library-grid.component';
import { MediaLibrarySidebarComponent } from './library/media-library-sidebar.component';
import { MediaLibraryStore } from './library/media-library.store';
import { findFolder } from './library/media-library.util';
import { MediaLibraryToolbarComponent } from './library/media-library-toolbar.component';
import { MediaLibraryUploadsComponent } from './library/media-library-uploads.component';
import { MediaThumbnailStore } from './library/media-thumbnail.store';
import { MediaUploadStore } from './library/media-upload.store';
import { MediaDetailDrawerComponent } from './media-detail-drawer.component';
import { MediaFolderDetailComponent } from './media-folder-detail.component';

/**
 * The media library screen: the layout and dialogs around the sidebar, toolbar, grid and uploads list. They share the
 * feature-scoped stores provided here; the effects that react to the inputs and to release events stay in this
 * constructor, in one place, so their order under zoneless change detection is explicit.
 */
@Component({
  selector: 'sf-media-library',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfCreateAssetDialogComponent,
    SfRenameAssetDialogComponent,
    SfDropTargetDirective,
    MediaDetailDrawerComponent,
    MediaFolderDetailComponent,
    MediaLibrarySidebarComponent,
    MediaLibraryToolbarComponent,
    MediaLibraryGridComponent,
    MediaLibraryUploadsComponent,
  ],
  providers: [
    MediaLibraryStore,
    MediaThumbnailStore,
    MediaUploadStore,
    MediaFolderActions,
    MediaItemActions,
  ],
  templateUrl: './media-library.component.html',
  styleUrl: './media-library.component.scss',
})
export class MediaLibraryComponent {
  readonly projectKey = input.required<string>();
  /** `?asset=<uuid>` opens that media item's detail drawer (search deep link, M23.4.1). */
  readonly asset = input<string | undefined>();
  /** `?folder=<uuid>` selects that folder. */
  readonly folder = input<string | undefined>();

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly releaseEvents = inject(ReleaseEventsStore);

  protected readonly library = inject(MediaLibraryStore);
  private readonly thumbs = inject(MediaThumbnailStore);
  protected readonly uploads = inject(MediaUploadStore);
  protected readonly folders = inject(MediaFolderActions);
  protected readonly itemActions = inject(MediaItemActions);

  private readonly detailDrawer = viewChild<MediaDetailDrawerComponent>('detailDrawer');

  constructor() {
    this.library.connect(this.projectKey);
    this.library.canLeaveDetail = () => this.detailDrawer()?.confirmDiscard() ?? true;

    effect(() => {
      const key = this.projectKey();
      untracked(() => {
        this.library.reload();
        this.library.loadAllMedia(key);
      });
    });

    // Deep links apply once what they name has loaded, then clear themselves.
    effect(() => {
      const uuid = this.asset();
      if (!uuid || !this.library.allMedia().some((item) => item.uuid === uuid)) {
        return;
      }
      untracked(() => {
        this.library.onSelectMediaLeaf(uuid);
        consumeQueryParam(this.router, this.route, 'asset');
      });
    });
    effect(() => {
      const uuid = this.folder();
      const node = uuid ? findFolder(this.library.tree(), uuid) : null;
      if (!node) {
        return;
      }
      untracked(() => {
        this.library.selectFolder(node);
        consumeQueryParam(this.router, this.route, 'folder');
      });
    });

    effect(() => {
      // Tracks the editing language as well as the items: a localized item needs its language's thumbnail.
      this.thumbs.requestAll(this.projectKey(), this.library.items());
    });

    // A release, unpublish, discard or schedule anywhere: the grid and the tree leaves re-read their statuses
    // (the folder tree itself is refreshed by the project shell).
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
}
