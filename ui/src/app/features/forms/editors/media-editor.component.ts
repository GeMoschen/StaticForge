import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { ApiClient } from '../../../core/api/api.client';
import { DeveloperModeService } from '../../../core/frame/developer-mode.service';
import { I18nFormatService } from '../../../core/i18n/i18n-format.service';
import { SfCopyableComponent } from '../../../shared/components/display/sf-copyable.component';
import { SfMediaThumbComponent } from '../../../shared/components/display/sf-media-thumb.component';
import { SfInputComponent } from '../../../shared/components/forms/sf-input.component';
import type { SfFinding } from '../../../shared/components/forms/sf-finding.component';
import { SfAssetPickerDialogComponent, AssetPicked } from '../../../shared/components/sf-asset-picker-dialog.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SfDropTargetDirective } from '../../../shared/directives/sf-drop-target.directive';
import { controlChanges } from '../control-changes';
import { SfEditorBase } from '../editor-base';

type MediaView = components['schemas']['MediaView'];

/** What the card knows about the chosen file: loading, found, or gone. */
type MediaState = { state: 'loading' } | { state: 'found'; media: MediaView } | { state: 'missing' };

/**
 * The MEDIA editor (M35.17, decision 78): a drop zone while nothing is chosen; once a file is, a thumbnail card — its name,
 * dimensions and size, *Replace* and *Remove* — and the alternative-text field below it (`altOverride`, with a warning
 * finding while an image has none). A file is chosen through the shared asset picker or by dropping an asset dragged from the
 * library. The UUID is never an input: in developer mode it is shown copyable, otherwise it does not appear at all.
 */
@Component({
  selector: 'sf-media-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    SfAssetPickerDialogComponent,
    SfButtonComponent,
    SfCopyableComponent,
    SfDropTargetDirective,
    SfFieldComponent,
    SfIconComponent,
    SfInputComponent,
    SfMediaThumbComponent,
    TranslocoPipe,
  ],
  templateUrl: './media-editor.component.html',
  styleUrl: './media-editor.component.scss',
})
export class SfMediaEditor extends SfEditorBase<FormGroup> {
  readonly projectKey = input<string>();

  private readonly api = inject(ApiClient);
  private readonly format = inject(I18nFormatService);
  protected readonly developer = inject(DeveloperModeService).enabled;
  private readonly groupChanges = controlChanges(() => this.control());

  /** The shared asset picker, limited to media. */
  protected readonly pickerOpen = signal(false);
  protected readonly over = signal(false);
  private readonly resolved = signal<MediaState | null>(null);

  protected readonly uuid = computed(() => {
    this.groupChanges();
    return String(this.control().get('uuid')?.value ?? '').trim() || null;
  });
  protected readonly alt = computed(() => {
    this.groupChanges();
    return String(this.control().get('altOverride')?.value ?? '');
  });
  protected readonly readOnly = computed(() => !!this.definition().readOnly);

  protected readonly media = computed(() => {
    const state = this.resolved();
    return state?.state === 'found' ? state.media : null;
  });
  protected readonly missing = computed(() => this.resolved()?.state === 'missing');
  protected readonly name = computed(() => {
    const media = this.media();
    return media ? (media.displayName ?? media.fileName ?? media.uid ?? '') : '';
  });
  /** "2400 × 1350 · 980 KB". */
  protected readonly details = computed(() => {
    const media = this.media();
    if (!media) {
      return '';
    }
    const parts: string[] = [];
    if (media.image?.width && media.image?.height) {
      parts.push(`${media.image.width} × ${media.image.height}`);
    }
    if (media.sizeBytes) {
      parts.push(this.sizeLabel(media.sizeBytes));
    }
    return parts.join(' · ');
  });
  /** Alternative text is only asked for an image. */
  protected readonly altFindings = computed<SfFinding[]>(() =>
    this.media()?.image && this.alt().trim() === ''
      ? [{ level: 'warning', message: this.transloco.translate('forms.media.altMissing') }]
      : [],
  );

  private lastUuid: string | null = null;

  constructor() {
    super();
    effect(
      () => {
        const key = this.projectKey();
        const uuid = this.uuid();
        if (!key || !uuid) {
          this.lastUuid = null;
          this.resolved.set(null);
          return;
        }
        if (uuid === this.lastUuid) {
          return;
        }
        this.lastUuid = uuid;
        untracked(() => this.resolve(key, uuid));
      },
      { allowSignalWrites: true },
    );
  }

  /** A value is a media reference with a UUID; nothing else counts as filled. */
  protected override isEmpty(value: unknown): boolean {
    const uuid = (value as { uuid?: string | null } | null)?.uuid;
    return !uuid || String(uuid).trim() === '';
  }

  field(name: string): FormControl {
    return this.control().get(name) as FormControl;
  }

  choose(): void {
    if (this.projectKey() && !this.readOnly()) {
      this.pickerOpen.set(true);
    }
  }

  protected onPicked(picked: AssetPicked): void {
    this.select(picked.uuid);
    this.pickerOpen.set(false);
  }

  select(uuid: string): void {
    this.field('uuid').setValue(uuid);
    this.field('uuid').markAsDirty();
  }

  protected remove(): void {
    if (this.readOnly()) {
      return;
    }
    this.field('uuid').setValue(null);
    this.field('altOverride').setValue(null);
    this.control().markAsDirty();
  }

  protected setAlt(value: string): void {
    this.field('altOverride').setValue(value);
    this.field('altOverride').markAsDirty();
  }

  protected onOver(event: DragEvent): void {
    if (!this.readOnly()) {
      event.preventDefault();
      this.over.set(true);
    }
  }

  onDrop(event: DragEvent): void {
    this.over.set(false);
    if (this.readOnly()) {
      return;
    }
    const data = event.dataTransfer?.getData('application/json') || event.dataTransfer?.getData('text/plain') || '';
    if (!data) {
      return;
    }
    try {
      const parsed = JSON.parse(data) as { uuid?: string };
      if (parsed.uuid) {
        this.select(parsed.uuid);
      }
    } catch {
      this.select(data);
    }
  }

  private resolve(key: string, uuid: string): void {
    this.resolved.set({ state: 'loading' });
    this.api.mediaDetail(key, uuid).subscribe({
      next: (media) => this.resolved.set({ state: 'found', media }),
      error: () => this.resolved.set({ state: 'missing' }),
    });
  }

  private sizeLabel(bytes: number): string {
    const [unit, divisor] = bytes >= 1024 * 1024 ? ['MB', 1024 * 1024] : bytes >= 1024 ? ['KB', 1024] : ['B', 1];
    return `${this.format.number(bytes / (divisor as number), { maximumFractionDigits: 1 })} ${unit}`;
  }
}
