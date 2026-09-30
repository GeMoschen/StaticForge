import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MediaDrawerStore } from './media-drawer.store';
import { MediaDrawerTextStore } from './media-drawer-text.store';
import { positionLabel } from '../text-media.util';

/** The "Process CMS syntax" switch of text media, with the diagnostics of the last switch-on attempt. */
@Component({
  selector: 'sf-media-drawer-process',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './media-drawer-process.component.html',
  styleUrl: './media-drawer-process.component.scss',
})
export class MediaDrawerProcessComponent {
  protected readonly core = inject(MediaDrawerStore);
  protected readonly text = inject(MediaDrawerTextStore);
  protected readonly positionLabel = positionLabel;
}
