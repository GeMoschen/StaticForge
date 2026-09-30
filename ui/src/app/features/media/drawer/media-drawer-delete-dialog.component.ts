import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { MediaDrawerUsagesStore } from './media-drawer-usages.store';

/** The "Delete media" confirmation; asks for a typed DELETE while other assets reference the file. */
@Component({
  selector: 'sf-media-drawer-delete-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent],
  templateUrl: './media-drawer-delete-dialog.component.html',
  styleUrl: './media-drawer-delete-dialog.component.scss',
})
export class MediaDrawerDeleteDialogComponent {
  protected readonly store = inject(MediaDrawerUsagesStore);
}
