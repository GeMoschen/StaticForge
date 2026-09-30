import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MediaDrawerPreviewStore } from './media-drawer-preview.store';
import { MediaDrawerStore } from './media-drawer.store';

/** The file's preview image, cropped around its focal point. */
@Component({
  selector: 'sf-media-drawer-preview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './media-drawer-preview.component.html',
  styleUrl: './media-drawer-preview.component.scss',
})
export class MediaDrawerPreviewComponent {
  protected readonly core = inject(MediaDrawerStore);
  protected readonly preview = inject(MediaDrawerPreviewStore);

  protected focalPosition(): string | null {
    const fp = this.core.media()?.focalPoint;
    if (fp == null || fp.x == null || fp.y == null) {
      return null;
    }
    const x = Math.round(fp.x * 1000) / 10;
    const y = Math.round(fp.y * 1000) / 10;
    return `${x}% ${y}%`;
  }
}
