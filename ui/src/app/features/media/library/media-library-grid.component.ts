import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { SfEmptyStateComponent } from '../../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../../shared/components/sf-spinner.component';
import { SfFileSizePipe } from '../../../shared/pipes/sf-file-size.pipe';
import { ReleaseBadgeComponent } from '../../release/release-badge.component';
import { MediaFolderActions } from './media-folder-actions';
import { MediaItemActions } from './media-item-actions';
import { MediaLibraryStore } from './media-library.store';
import { mediaIconFor } from './media-library.util';
import { MediaThumbnailStore } from './media-thumbnail.store';

/** The folders and media items of the selected folder as cards, loading the next page as the end scrolls in. */
@Component({
  selector: 'sf-media-library-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfEmptyStateComponent, SfIconComponent, SfSpinnerComponent, SfFileSizePipe, ReleaseBadgeComponent],
  templateUrl: './media-library-grid.component.html',
  styleUrl: './media-library-grid.component.scss',
})
export class MediaLibraryGridComponent implements AfterViewInit {
  protected readonly library = inject(MediaLibraryStore);
  protected readonly folders = inject(MediaFolderActions);
  protected readonly items = inject(MediaItemActions);
  protected readonly thumbs = inject(MediaThumbnailStore);
  protected readonly mediaIconFor = mediaIconFor;

  readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');
  private observer: IntersectionObserver | null = null;

  ngAfterViewInit(): void {
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          this.library.loadMore();
        }
      },
      { root: null, rootMargin: '200px', threshold: 0 },
    );
    const el = this.sentinel()?.nativeElement;
    if (el) {
      this.observer.observe(el);
    }
  }
}
