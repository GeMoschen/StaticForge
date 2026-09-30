import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { MediaDrawerMetadataStore } from './media-drawer-metadata.store';
import { MediaDrawerStore } from './media-drawer.store';

/** Alt text, caption, copyright and focal point of the file. */
@Component({
  selector: 'sf-media-drawer-metadata',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfFieldComponent, SfButtonComponent],
  templateUrl: './media-drawer-metadata.component.html',
  styleUrl: './media-drawer-metadata.component.scss',
})
export class MediaDrawerMetadataComponent {
  protected readonly core = inject(MediaDrawerStore);
  protected readonly metadata = inject(MediaDrawerMetadataStore);
}
