import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfBadgeComponent } from '../../../shared/components/display/sf-badge.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfFileSizePipe } from '../../../shared/pipes/sf-file-size.pipe';
import { formatOf } from '../library/media-library.util';
import { MediaDrawerPreviewStore } from './media-drawer-preview.store';
import { MediaDrawerStore } from './media-drawer.store';

/** One row of the Variants table: the original, or a generated size. */
interface VariantRow {
  readonly id: string;
  /** The variant's name; `null` for the original. */
  readonly name: string | null;
  readonly format: string;
  readonly width: number | null;
  readonly height: number | null;
  /** The original's size; variants carry none. */
  readonly sizeBytes: number | null;
}

/**
 * The Variants tab (decision 21): the generated sizes and formats of a picture as a table — the original first — with
 * a download per row. The backend lists a variant's name, width and format, so its height follows the original's aspect
 * and its size is not shown.
 */
@Component({
  selector: 'sf-media-drawer-variants',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfBadgeComponent, SfButtonComponent, SfFileSizePipe, TranslocoPipe],
  templateUrl: './media-drawer-variants.component.html',
  styleUrl: './media-drawer-variants.component.scss',
})
export class MediaDrawerVariantsComponent {
  protected readonly core = inject(MediaDrawerStore);
  private readonly preview = inject(MediaDrawerPreviewStore);

  protected readonly rows = computed<VariantRow[]>(() => {
    const media = this.core.media();
    const width = media.image?.width ?? null;
    const height = media.image?.height ?? null;
    const original: VariantRow = {
      id: 'original',
      name: null,
      format: formatOf({ mimeType: media.mimeType, displayName: media.fileName, uid: media.uid }),
      width,
      height,
      sizeBytes: media.sizeBytes ?? null,
    };
    const generated = (media.variants ?? []).map<VariantRow>((variant) => ({
      id: variant.name ?? '',
      name: variant.name ?? '',
      format: (variant.format ?? '').toUpperCase(),
      width: variant.width ?? null,
      height: width && height && variant.width ? Math.round((variant.width * height) / width) : null,
      sizeBytes: null,
    }));
    return [original, ...generated];
  });

  protected download(row: VariantRow): void {
    this.preview.downloadVariant(row.name ?? undefined);
  }
}
