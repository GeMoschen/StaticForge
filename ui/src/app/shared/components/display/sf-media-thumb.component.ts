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

/**
 * The thumbnail of a media file (M35.17): the server's thumbnail, fetched through `HttpClient` so the app's session rides
 * along (a plain `<img src>` would not carry it) and shown as an object URL. It is fetched only once it scrolls into
 * view — a picker lists up to a hundred files — and falls back to an icon while it loads, for a file that is no image
 * and when the fetch fails. Sizing is the host's: the thumbnail fills the element it is in.
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
      <sf-icon class="sf-media-thumb__fallback" name="image" />
    }
  `,
})
export class SfMediaThumbComponent {
  readonly projectKey = input.required<string>();
  readonly uuid = input.required<string>();
  /** The image's alternative text; empty (decorative) by default, as the name always sits beside it. */
  readonly alt = input('');

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
      if (!this.visible()) {
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
