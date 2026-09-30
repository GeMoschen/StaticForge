import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { MediaItemActions } from './media-item-actions';
import { MediaLibraryStore } from './media-library.store';
import { MediaUploadStore } from './media-upload.store';

/** Search, type filter, bulk delete and Upload above the grid. */
@Component({
  selector: 'sf-media-library-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent],
  templateUrl: './media-library-toolbar.component.html',
  styleUrl: './media-library-toolbar.component.scss',
})
export class MediaLibraryToolbarComponent {
  protected readonly library = inject(MediaLibraryStore);
  protected readonly items = inject(MediaItemActions);
  protected readonly uploads = inject(MediaUploadStore);

  protected onSearchInput(event: Event): void {
    this.library.queueSearch((event.target as HTMLInputElement).value);
  }

  protected onMimeChange(event: Event): void {
    this.library.setMimeFilter((event.target as HTMLSelectElement).value);
  }
}
