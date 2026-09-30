import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MediaDrawerPreviewStore } from './media-drawer-preview.store';
import { MediaDrawerStore } from './media-drawer.store';

/** The generated variants of an image, each downloadable. */
@Component({
  selector: 'sf-media-drawer-variants',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './media-drawer-variants.component.html',
  styleUrl: './media-drawer-variants.component.scss',
})
export class MediaDrawerVariantsComponent {
  protected readonly core = inject(MediaDrawerStore);
  protected readonly preview = inject(MediaDrawerPreviewStore);
}
