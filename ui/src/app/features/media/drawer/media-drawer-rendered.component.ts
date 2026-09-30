import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { positionLabel } from '../text-media.util';
import { MediaDrawerTextStore } from './media-drawer-text.store';

/** The Rendered tab: the saved text media file as preview serves it. */
@Component({
  selector: 'sf-media-drawer-rendered',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent],
  templateUrl: './media-drawer-rendered.component.html',
  styleUrl: './media-drawer-rendered.component.scss',
})
export class MediaDrawerRenderedComponent {
  protected readonly text = inject(MediaDrawerTextStore);
  protected readonly positionLabel = positionLabel;
}
