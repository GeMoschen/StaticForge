import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfAvatarComponent } from '../../../shared/components/display/sf-avatar.component';
import { SfBadgeComponent } from '../../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../../shared/components/display/sf-relative-time.component';
import { SfSkeletonComponent } from '../../../shared/components/layout/sf-skeleton.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { MediaDrawerTextStore } from './media-drawer-text.store';
import { MediaDrawerMetadataStore } from './media-drawer-metadata.store';
import { MediaDrawerVersionsStore } from './media-drawer-versions.store';
import { MediaDrawerStore } from './media-drawer.store';

/**
 * The Versions tab (decision 21): the file's history, newest first, the current version marked; Restore (with a
 * confirmation) makes an earlier version the current one again. Restoring is offered once nothing is unsaved: the
 * restored file would replace the edits.
 */
@Component({
  selector: 'sf-media-drawer-versions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfAvatarComponent, SfBadgeComponent, SfButtonComponent, SfRelativeTimeComponent, SfSkeletonComponent, TranslocoPipe],
  templateUrl: './media-drawer-versions.component.html',
  styleUrl: './media-drawer-versions.component.scss',
})
export class MediaDrawerVersionsComponent {
  protected readonly core = inject(MediaDrawerStore);
  protected readonly store = inject(MediaDrawerVersionsStore);
  private readonly metadata = inject(MediaDrawerMetadataStore);
  private readonly text = inject(MediaDrawerTextStore);

  protected unsaved(): boolean {
    return this.metadata.dirty() || this.text.dirty();
  }
}
