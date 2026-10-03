import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from '@angular/core';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { MediaLibraryStore, type MediaSummaryView } from './media-library.store';
import { isRaster, isTransparent, mediaIconFor } from './media-library.util';
import { MediaThumbnailStore } from './media-thumbnail.store';

/**
 * The preview of one file (decision 22): a raster's thumbnail, the first lines of a text file on the code surface (a card
 * only — a list row has no room for them), else the file's icon (PDFs, SVG without text, anything without a thumbnail).
 * Fills its container; transparent files sit on a checkerboard. The preview is requested when the card or row is rendered.
 * Decorative: the card or row carries the file's name.
 */
@Component({
  selector: 'sf-media-preview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfIconComponent],
  template: `
    @if (url(); as src) {
      <img class="preview__img" [class.preview__img--contain]="contain()" [src]="src" alt="" loading="lazy" draggable="false" />
    } @else if (snippet() !== null && variant() === 'card') {
      <pre class="preview__code" aria-hidden="true">{{ snippet() }}</pre>
    } @else {
      <sf-icon class="preview__icon" [name]="icon()" />
    }
  `,
  styleUrl: './media-preview.component.scss',
  host: {
    class: 'preview',
    '[class.preview--card]': "variant() === 'card'",
    '[class.preview--row]': "variant() === 'row'",
    '[class.preview--checker]': 'checker()',
  },
})
export class MediaPreviewComponent {
  readonly item = input.required<MediaSummaryView>();
  readonly variant = input<'card' | 'row'>('card');

  private readonly library = inject(MediaLibraryStore);
  private readonly thumbs = inject(MediaThumbnailStore);

  protected readonly url = computed(() => this.thumbs.thumb(this.item()));
  protected readonly snippet = computed(() => this.thumbs.snippet(this.item()));
  protected readonly icon = computed(() => mediaIconFor(this.item().mimeType));
  protected readonly checker = computed(() => !!this.url() && isTransparent(this.item().mimeType));
  /** Transparent pictures keep their whole shape; photos fill the frame. */
  protected readonly contain = computed(() => isTransparent(this.item().mimeType) && isRaster(this.item().mimeType));

  constructor() {
    effect(() => {
      const item = this.item();
      // Tracks the editing language as well as the file: a localized file needs its language's preview.
      untracked(() => this.thumbs.request(this.library.projectKey(), item));
    });
  }
}
