import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SfFileSizePipe } from '../../../shared/pipes/sf-file-size.pipe';
import { MediaDrawerFilesStore } from './media-drawer-files.store';
import { MediaDrawerStore } from './media-drawer.store';

/** "Different file per language" and the files per language of localized media (M27.6.4). */
@Component({
  selector: 'sf-media-drawer-localization',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent, SfIconComponent, SfFileSizePipe],
  templateUrl: './media-drawer-localization.component.html',
  styleUrl: './media-drawer-localization.component.scss',
})
export class MediaDrawerLocalizationComponent {
  protected readonly core = inject(MediaDrawerStore);
  protected readonly files = inject(MediaDrawerFilesStore);
}
