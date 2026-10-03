import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfInputComponent } from '../../../../shared/components/forms/sf-input.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { SfFileSizePipe } from '../../../../shared/pipes/sf-file-size.pipe';
import { UPLOAD_MAX_BYTES, mediaFolder } from './sample-media-data';
import { SampleMediaState, SampleUpload, acceptsAlt } from './sample-media-state';

/**
 * The upload panel (M35.19 mocked, decision 98), docked bottom right of the library. The header names the target folder
 * ("Uploads to Products") and has a summary and a collapse button. Per file: its name, a progress bar, the size and
 * Cancel; a finished picture asks for its alt text right there (field + Save) and can open its details; a refused file
 * says why and offers what fits the reason — *Retry* only for a lost connection (the other reasons would fail again),
 * *Replace* / *Keep both* for a name that is taken, and *Remove* for every refusal. The progress is fake (see
 * {@link SampleMediaState.upload}).
 */
@Component({
  selector: 'sf-sample-media-uploads',
  standalone: true,
  imports: [SfButtonComponent, SfFileSizePipe, SfIconComponent, SfInputComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-media-uploads.component.html',
  styleUrl: './sample-media-uploads.component.scss',
})
export class SampleMediaUploadsComponent {
  protected readonly state = inject(SampleMediaState);
  protected readonly collapsed = signal(false);
  /** The alt texts being typed, by upload. */
  protected readonly alts = signal<Readonly<Record<string, string>>>({});
  private readonly fileSize = new SfFileSizePipe();

  protected readonly running = computed(() => this.state.uploads().filter((u) => u.state === 'uploading').length);
  protected readonly failed = computed(() => this.state.uploads().filter((u) => u.state === 'error').length);
  protected readonly summary = computed(() => {
    const total = this.state.uploads().length;
    const running = this.running();
    return running > 0
      ? this.state.t('uploads.running', { count: running, total })
      : this.state.t('uploads.finished', { count: total - this.failed(), failed: this.failed() });
  });
  protected readonly title = computed(() => {
    const { folder, count } = this.state.uploadTarget();
    return this.state.t(count === 1 ? 'uploads.titleTo' : 'uploads.titleMany', { folder, count });
  });

  /** Why a file was refused, in words. */
  protected errorText(upload: SampleUpload): string {
    const folder = mediaFolder(upload.folderId)?.name ?? '';
    return this.state.t(`uploads.errors.${upload.error ?? 'network'}`, {
      size: this.fileSize.transform(upload.sizeBytes),
      limit: this.fileSize.transform(UPLOAD_MAX_BYTES),
      folder,
    });
  }

  protected asksForAlt(upload: SampleUpload): boolean {
    return upload.state === 'done' && acceptsAlt(upload.name) && upload.alt === undefined;
  }

  protected doneText(upload: SampleUpload): string {
    return this.state.t('uploads.done', { name: upload.name, outcome: upload.outcome ?? 'plain', altSaved: String(upload.alt !== undefined) });
  }

  protected altOf(upload: SampleUpload): string {
    return this.alts()[upload.id] ?? '';
  }

  protected setAlt(upload: SampleUpload, value: string): void {
    this.alts.update((all) => ({ ...all, [upload.id]: value }));
  }

  protected saveAlt(upload: SampleUpload): void {
    const alt = this.altOf(upload).trim();
    if (alt) {
      this.state.saveUploadAlt(upload.id, alt);
    }
  }

  protected openDetails(upload: SampleUpload): void {
    if (upload.fileId) {
      void this.state.requestOpenAsset(upload.fileId, 'details');
    } else {
      this.state.notice();
    }
  }
}
