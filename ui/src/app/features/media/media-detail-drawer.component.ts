import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ApiClient } from '../../core/api/api.client';
import { DialogService } from '../../core/ui/dialog.service';
import { ToastService } from '../../core/ui/toast.service';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfUidRenameComponent } from '../../shared/components/sf-uid-rename.component';

type MediaView = components['schemas']['MediaView'];
type MediaMetadataRequest = components['schemas']['MediaMetadataRequest'];
type FocalPointView = components['schemas']['FocalPointView'];
type UsageDto = components['schemas']['UsageDto'];

@Component({
  selector: 'sf-media-detail-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    SfFieldComponent,
    SfButtonComponent,
    SfUidRenameComponent,
  ],
  templateUrl: './media-detail-drawer.component.html',
  styleUrl: './media-detail-drawer.component.scss',
})
export class MediaDetailDrawerComponent implements OnInit {
  readonly projectKey = input.required<string>();
  readonly media = input.required<MediaView>();

  readonly closed = output<void>();
  readonly updated = output<MediaView>();
  readonly deleted = output<string>();

  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  protected readonly dialog = inject(DialogService);

  protected readonly DELETE_TOKEN = 'DELETE';

  readonly revision = signal<number | null>(null);
  readonly usages = signal<UsageDto[]>([]);
  readonly usagesLoading = signal(false);
  readonly saving = signal(false);
  readonly replacing = signal(false);
  readonly deleting = signal(false);
  readonly confirmText = signal('');

  readonly form = new FormGroup({
    altText: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    caption: new FormControl('', { nonNullable: true }),
    copyright: new FormControl('', { nonNullable: true }),
    focalX: new FormControl<number | null>(null),
    focalY: new FormControl<number | null>(null),
  });

  readonly variants = computed(
    () => this.media()?.variants ?? [],
  );

  ngOnInit(): void {
    const media = this.media();
    this.revision.set(media.revision ?? null);
    this.form.reset({
      altText: media.altText ?? '',
      caption: media.caption ?? '',
      copyright: media.copyright ?? '',
      focalX: media.focalPoint?.x ?? null,
      focalY: media.focalPoint?.y ?? null,
    });
    this.loadUsages();
  }

  previewUrl(): string {
    return this.api.mediaBinaryUrl(this.projectKey(), this.media()?.uuid ?? '');
  }

  downloadUrl(variant?: string): string {
    return this.api.mediaBinaryUrl(this.projectKey(), this.media()?.uuid ?? '', variant);
  }

  focalPosition(): string | null {
    const fp = this.media()?.focalPoint;
    if (fp == null || fp.x == null || fp.y == null) {
      return null;
    }
    const x = Math.round(fp.x * 1000) / 10;
    const y = Math.round(fp.y * 1000) / 10;
    return `${x}% ${y}%`;
  }

  closeDrawer(): void {
    this.closed.emit();
  }

  save(): void {
    const uuid = this.media()?.uuid;
    if (!uuid) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toasts.show('Alt text is required before publishing', 'warning');
      return;
    }
    const focalX = this.form.controls.focalX.value;
    const focalY = this.form.controls.focalY.value;
    const hasFocal = focalX !== null || focalY !== null;
    const payload: MediaMetadataRequest = {
      altText: this.form.controls.altText.value,
      caption: this.form.controls.caption.value,
      copyright: this.form.controls.copyright.value,
      focalPoint: hasFocal
        ? ({ x: focalX ?? undefined, y: focalY ?? undefined } as FocalPointView)
        : undefined,
    };
    this.saving.set(true);
    this.api
      .updateMediaMetadata(
        this.projectKey(),
        uuid,
        payload,
        this.revision() ?? undefined,
      )
      .subscribe({
        next: (updated) => {
          this.revision.set(updated.revision ?? null);
          this.toasts.show('Metadata saved', 'success');
          this.saving.set(false);
          this.updated.emit(updated);
        },
        error: () => this.saving.set(false),
      });
  }

  onReplaceFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const uuid = this.media()?.uuid;
    if (!file || !uuid) {
      return;
    }
    this.replacing.set(true);
    this.api.replaceMedia(this.projectKey(), uuid, file).subscribe({
      next: (updated) => {
        this.revision.set(updated.revision ?? null);
        this.toasts.show('Media replaced', 'success');
        this.replacing.set(false);
        this.updated.emit(updated);
        input.value = '';
      },
      error: () => this.replacing.set(false),
    });
  }

  confirmDelete(): void {
    const uuid = this.media()?.uuid;
    if (!uuid) {
      return;
    }
    const referenced = this.usages().length > 0;
    this.confirmText.set('');
    this.dialog.open({
      title: 'Delete media',
      message: referenced
        ? `This file is referenced by ${this.usages().length} asset(s). Deleting it will break those references. Type DELETE to confirm.`
        : 'Delete this media file? This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      kind: 'danger',
    });
  }

  canConfirmDelete(): boolean {
    return this.usages().length === 0 || this.confirmText().trim() === this.DELETE_TOKEN;
  }

  onDeleteInput(event: Event): void {
    this.confirmText.set((event.target as HTMLInputElement).value);
  }

  cancelDelete(): void {
    this.dialog.close();
    this.confirmText.set('');
  }

  performDelete(): void {
    const uuid = this.media()?.uuid;
    if (!uuid || !this.canConfirmDelete() || this.deleting()) {
      return;
    }
    this.deleting.set(true);
    this.api.deleteAsset(this.projectKey(), uuid).subscribe({
      next: () => {
        this.toasts.show('Media deleted', 'success');
        this.deleting.set(false);
        this.dialog.close();
        this.confirmText.set('');
        this.deleted.emit(uuid);
      },
      error: () => {
        this.deleting.set(false);
        this.toasts.show('Could not delete media — it may still be referenced by a page or template.', 'error');
      },
    });
  }

  onUidChanged(newUid: string): void {
    const current = this.media();
    this.updated.emit({ ...current, uid: newUid });
  }

  private loadUsages(): void {
    const uuid = this.media()?.uuid;
    if (!uuid) {
      return;
    }
    this.usagesLoading.set(true);
    this.api.assetUsages(this.projectKey(), uuid).subscribe({
      next: (usages) => {
        this.usages.set(usages ?? []);
        this.usagesLoading.set(false);
      },
      error: () => this.usagesLoading.set(false),
    });
  }
}
