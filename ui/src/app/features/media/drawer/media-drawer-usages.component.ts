import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MediaDrawerUsagesStore } from './media-drawer-usages.store';

/** The assets that reference the file. */
@Component({
  selector: 'sf-media-drawer-usages',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './media-drawer-usages.component.html',
  styleUrl: './media-drawer-usages.component.scss',
})
export class MediaDrawerUsagesComponent {
  protected readonly store = inject(MediaDrawerUsagesStore);
}
