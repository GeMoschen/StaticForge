import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { SfFileSizePipe } from '../../../../shared/pipes/sf-file-size.pipe';
import { SampleMediaState, SampleUpload } from './sample-media-state';

/**
 * The upload panel (M35.19 mocked), docked bottom right of the library: a summary that can collapse the list, and per
 * file its name, a progress bar, the size and Cancel — a finished upload offers "Add alt text", a failed one Retry.
 * The progress is fake (see {@link SampleMediaState.upload}).
 */
@Component({
  selector: 'sf-sample-media-uploads',
  standalone: true,
  imports: [SfButtonComponent, SfFileSizePipe, SfIconComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-media-uploads.component.html',
  styleUrl: './sample-media-uploads.component.scss',
})
export class SampleMediaUploadsComponent {
  protected readonly state = inject(SampleMediaState);
  protected readonly collapsed = signal(false);

  protected readonly running = computed(() => this.state.uploads().filter((u) => u.state === 'uploading').length);
  protected readonly failed = computed(() => this.state.uploads().filter((u) => u.state === 'error').length);
  protected readonly summary = computed(() => {
    const total = this.state.uploads().length;
    const running = this.running();
    return running > 0
      ? this.state.t('uploads.running', { count: running, total })
      : this.state.t('uploads.finished', { count: total - this.failed(), failed: this.failed() });
  });

  protected addAltText(upload: SampleUpload): void {
    if (upload.fileId) {
      this.state.openAsset(upload.fileId, 'details');
    } else {
      this.state.notice();
    }
  }
}
