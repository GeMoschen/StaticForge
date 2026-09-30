import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { MediaFolderNodeComponent } from '../media-folder-node.component';
import { MediaNavNodeComponent } from '../media-nav-node.component';
import { MediaFolderActions } from './media-folder-actions';
import { MediaLibraryStore } from './media-library.store';

/** The folder tree beside the grid, with the media items as its leaves. */
@Component({
  selector: 'sf-media-library-sidebar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfIconComponent, MediaFolderNodeComponent, MediaNavNodeComponent],
  templateUrl: './media-library-sidebar.component.html',
  styleUrl: './media-library-sidebar.component.scss',
})
export class MediaLibrarySidebarComponent {
  protected readonly library = inject(MediaLibraryStore);
  protected readonly folders = inject(MediaFolderActions);
}
