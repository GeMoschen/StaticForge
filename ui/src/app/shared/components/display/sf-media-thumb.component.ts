import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { ApiClient } from '../../../core/api/api.client';
import { SfIconComponent } from '../sf-icon.component';

/** Raster images the server makes thumbnails of (an SVG is text media and has none). */
const RASTER_IMAGE = /\.(jpe?g|png|gif|webp|avif|bmp|tiff?)$/i;

/** The icon of a file by its name, for what has no thumbnail. */
function iconOfFileName(name: string | null | undefined): string {
  const extension = /\.([a-z0-9]+)$/i.exec(name ?? '')?.[1]?.toLowerCase() ?? '';
  if (extension === 'pdf') {
    return 'picture_as_pdf';
  }
  if (['css', 'js', 'json', 'html', 'xml', 'svg'].includes(extension)) {
    return 'code';
  }
  if (['txt', 'md', 'csv'].includes(extension)) {
    return 'description';
  }
  if (['mp4', 'webm', 'mov'].includes(extension)) {
    return 'movie';
  }
  if (['mp3', 'wav', 'ogg'].includes(extension)) {
    return 'audio_file';
  }
  if (['zip', 'gz'].includes(extension)) {
    return 'folder_zip';
  }
  return 'image';
}

/**
 * The thumbnail of a media file (M35.17): the server's thumbnail, fetched through `HttpClient` so the app's session rides
 * along (a plain `<img src>` would not carry it) and shown as an object URL. It is fetched only once it scrolls into
 * view — a picker lists up to a hundred files — and falls back to an icon while it loads, for a file that is no image
 * and when the fetch fails. Sizing is the host's: the thumbnail fills the element it is in.
 *
 * The server refuses a thumbnail of anything that is not a raster image (`422`: a PDF, a stylesheet, an SVG as text media),
 * and the browser logs every refused request — so a host that knows what the file is says so (`image`, or the file's name),
 * and only an image is asked for; anything else shows the icon of its kind without a request.
 */
@Component({
  selector: 'sf-media-thumb',
  standalone: true,
  imports: [SfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sf-media-thumb.component.scss',
  host: { class: 'sf-media-thumb' },
  template: `
    @if (url(); as src) {
      <img class="sf-media-thumb__image" [src]="src" [alt]="alt()" />
    } @else {
      <sf-icon class="sf-media-thumb__fallback" [name]="fallbackIcon()" />
    }
  `,
})
export class SfMediaThumbComponent {
  readonly projectKey = input.required<string>();
  readonly uuid = input.required<string>();
  /** The image's alternative text; empty (decorative) by default, as the name always sits beside it. */
  readonly alt = input('');
  /** The host knows whether the file is an image (the media detail says so); `null` = decide by `fileName`. */
  readonly image = input<boolean | null>(null);
  /** The file's name, when the host has nothing better: its extension tells an image from the rest. */
  readonly fileName = input<string | null | undefined>(null);

  /** Whether a thumbnail is worth asking for: an image, or a file whose kind is not known (then it is tried once). */
  protected readonly thumbnailable = computed(() => {
    const image = this.image();
    if (image !== null) {
      return image;
    }
    const name = this.fileName();
    return !name || RASTER_IMAGE.test(name);
  });
  protected readonly fallbackIcon = computed(() => iconOfFileName(this.fileName()));

  private readonly api = inject(ApiClient);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly visible = signal(typeof IntersectionObserver === 'undefined');
  private readonly objectUrl = signal<string | null>(null);
  protected readonly url = computed(() => this.objectUrl());

  constructor() {
    const destroy = inject(DestroyRef);
    if (typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          this.visible.set(true);
          observer.disconnect();
        }
      });
      observer.observe(this.host.nativeElement);
      destroy.onDestroy(() => observer.disconnect());
    }
    effect((onCleanup) => {
      const key = this.projectKey();
      const uuid = this.uuid();
      if (!this.visible() || !this.thumbnailable()) {
        return;
      }
      const subscription = this.api.mediaThumbnailBlob(key, uuid).subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          untracked(() => this.objectUrl.set(url));
        },
        error: () => untracked(() => this.objectUrl.set(null)),
      });
      onCleanup(() => {
        subscription.unsubscribe();
        const current = untracked(() => this.objectUrl());
        if (current) {
          URL.revokeObjectURL(current);
          untracked(() => this.objectUrl.set(null));
        }
      });
    });
  }
}
