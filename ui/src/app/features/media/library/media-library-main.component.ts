import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, viewChild } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { useFrameItem } from '../../../core/frame/use-frame-item';
import { FavoritesService } from '../../../core/assets/favorites.service';
import { mediaShortcuts } from '../../../core/ui/documented-shortcuts';
import { ShortcutService } from '../../../core/ui/shortcut.service';
import { FavoritesViewComponent } from '../../favorites/favorites-view.component';
import { SfBannerComponent } from '../../../shared/components/layout/sf-banner.component';
import { SfPageHeaderComponent } from '../../../shared/components/layout/sf-page-header.component';
import { SfSkeletonComponent } from '../../../shared/components/layout/sf-skeleton.component';
import type { SfMenuItem } from '../../../shared/components/menu/sf-menu-item';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { MediaFolderActions } from './media-folder-actions';
import { MediaItemActions } from './media-item-actions';
import { MediaMover } from './media-mover';
import { MediaLibraryGridComponent } from './media-library-grid.component';
import { MediaLibraryListComponent } from './media-library-list.component';
import { MediaLibraryToolbarComponent } from './media-library-toolbar.component';
import { MediaLibraryUploadsComponent } from './media-library-uploads.component';
import { MediaLibraryStore } from './media-library.store';
import { MediaUploadStore } from './media-upload.store';

/** What the area below the toolbar shows. */
export type MediaBodyState = 'error' | 'loading' | 'empty' | 'noMatch' | 'files';

/**
 * The library beside the folder tree: the folder's page header (its name as the page's one `h1`, the file count and the
 * folder's ⋮ menu), the toolbar, the grid or the list, the bulk bar on a selection, the states (loading skeleton, error with
 * Retry, empty folder, nothing matches, empty library), the drop zone over the whole area while files are dragged over
 * it and the upload list.
 *
 * The breadcrumb (*Media › folders*) belongs to the app frame: this reports the open folder to it.
 */
@Component({
  selector: 'sf-media-library-main',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MediaLibraryGridComponent,
    MediaLibraryListComponent,
    MediaLibraryToolbarComponent,
    MediaLibraryUploadsComponent,
    FavoritesViewComponent,
    SfBannerComponent,
    SfButtonComponent,
    SfEmptyStateComponent,
    SfIconComponent,
    SfPageHeaderComponent,
    SfSkeletonComponent,
    TranslocoPipe,
  ],
  templateUrl: './media-library-main.component.html',
  styleUrl: './media-library-main.component.scss',
})
export class MediaLibraryMainComponent {
  protected readonly library = inject(MediaLibraryStore);
  protected readonly folders = inject(MediaFolderActions);
  protected readonly items = inject(MediaItemActions);
  protected readonly mover = inject(MediaMover);
  protected readonly uploads = inject(MediaUploadStore);
  private readonly transloco = inject(TranslocoService);
  private readonly favorites = inject(FavoritesService);
  private readonly picker = viewChild<ElementRef<HTMLInputElement>>('picker');

  /** Placeholder cards of the loading grid. */
  protected readonly skeletonCards = Array.from({ length: 8 }, (_, index) => index);

  protected readonly folderName = computed(
    () => this.library.folderNode()?.displayName ?? this.library.folderNode()?.uid ?? this.transloco.translate('media.library.title'),
  );
  protected readonly title = computed(() => (this.library.libraryEmpty() ? this.transloco.translate('media.library.title') : this.folderName()));
  /**
   * The count says nothing while the folder loads or fails to load, but its line stays (a no-break space): the toolbar
   * does not jump when the files arrive.
   */
  protected readonly subtitle = computed(() => {
    if (this.library.libraryEmpty()) {
      return '';
    }
    return this.bodyState() === 'loading' || this.bodyState() === 'error'
      ? '\u00A0'
      : this.transloco.translate('media.library.count', { count: this.library.totalElements() });
  });

  protected readonly bodyState = computed<MediaBodyState>(() => {
    const library = this.library;
    if (library.treeError() || (library.failed() && library.items().length === 0)) {
      return 'error';
    }
    if (!library.loaded() || !library.treeReady()) {
      return 'loading';
    }
    if (library.items().length === 0) {
      return 'empty';
    }
    return library.visible().length === 0 ? 'noMatch' : 'files';
  });

  /** The folder's ⋮ menu; the library root (and an empty library) has no rename, move or delete. */
  protected readonly folderActions = computed<SfMenuItem[]>(() => {
    if (!this.library.folderNode() || this.library.libraryEmpty()) {
      return [];
    }
    const t = (id: string) => this.transloco.translate(`media.library.${id}`);
    const readOnly = !this.library.canEdit();
    return [
      { id: 'rename', label: t('rename'), icon: 'edit', disabled: readOnly },
      { id: 'move', label: t('move'), icon: 'drive_file_move', disabled: readOnly },
      { id: 'delete', label: t('delete'), icon: 'delete', danger: true, separatorBefore: true, disabled: readOnly },
    ];
  });

  constructor() {
    // The frame's breadcrumb ends with the open folder, with the folders above it as links.
    useFrameItem(() => {
      const folder = this.library.folderNode();
      if (!folder) {
        return null;
      }
      const key = this.library.projectKey();
      const ancestors = this.library.folderTrail().slice(0, -1);
      return {
        label: folder.displayName ?? folder.uid ?? '',
        trail: ancestors.map((ancestor) => ({
          id: ancestor.uuid ?? '',
          label: ancestor.displayName ?? ancestor.uid ?? '',
          link: ['/p', key, 'media'],
          queryParams: { folder: ancestor.uuid ?? '' },
        })),
        asset: folder.uuid ? { uuid: folder.uuid } : undefined,
      };
    });

    const canAct = () => this.bodyState() === 'files';
    // F2 renames the open folder (a focused card or row renames its file first: it handles the key itself).
    inject(ShortcutService).use([
      // The grid and list answer to their keys themselves; these entries put them on the `?` sheet (decision 100).
      ...mediaShortcuts({
        grid: () => canAct() && this.library.view() === 'grid' && !this.library.favoritesView(),
        files: () => canAct() && !this.library.favoritesView(),
        edit: () => this.library.canEdit(),
      }),
      {
        id: 'media.upload',
        scope: 'screen',
        group: 'screen',
        description: 'frame.shortcuts.items.mediaUpload',
        enabled: () => this.uploads.canUpload() && !this.library.favoritesView(),
        handler: () => this.picker()?.nativeElement.click(),
        palette: { icon: 'upload', context: () => this.title() || null },
      },
      {
        id: 'media.favorites',
        scope: 'screen',
        group: 'screen',
        description: 'frame.shortcuts.items.mediaFavorites',
        enabled: () => this.favorites.list().length > 0 && !this.library.favoritesView(),
        handler: () => void this.library.openFavorites(),
        palette: { icon: 'star' },
      },
      {
        id: 'folder.rename',
        keys: 'F2',
        scope: 'screen',
        group: 'screen',
        description: 'media.library.renameInline',
        enabled: () => !!this.library.folderNode() && this.library.canEdit(),
        handler: () => this.folders.startRename(),
      },
    ]);
  }

  /** Retry: the project's folders when they could not be read, else the folder's files. */
  protected retry(): void {
    if (this.library.treeError()) {
      this.library.reloadTree();
    } else {
      this.library.loadFolder();
    }
  }

  protected folderAction(item: SfMenuItem): void {
    const folder = this.library.folderNode();
    if (!folder) {
      return;
    }
    switch (item.id) {
      case 'rename':
        void this.folders.rename(folder);
        break;
      case 'move':
        void this.mover.moveFolders(folder.uuid ? [folder.uuid] : []);
        break;
      case 'delete':
        void this.folders.deleteFolder(folder);
        break;
    }
  }
}
