import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MediaUploadStore } from './media-upload.store';

/** The progress of the files uploaded in this visit. */
@Component({
  selector: 'sf-media-library-uploads',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './media-library-uploads.component.html',
  styleUrl: './media-library-uploads.component.scss',
})
export class MediaLibraryUploadsComponent {
  protected readonly store = inject(MediaUploadStore);
}
