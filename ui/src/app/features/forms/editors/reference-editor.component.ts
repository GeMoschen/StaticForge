import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { ReactiveFormsModule, FormControl, FormGroup } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiClient } from '../../../core/api/api.client';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SfDropTargetDirective } from '../../../shared/directives/sf-drop-target.directive';
import { SfAssetPickerDialogComponent, AssetPicked } from '../../../shared/components/sf-asset-picker-dialog.component';
import { EditorDefinition } from '../form.model';

/** Feature areas that have their own route — used to link a resolved reference open in a new tab. Types without a per-item route (templates) link to their list page; MEDIA has no dedicated route today. */
function linkFor(projectKey: string, assetType: string | null, uuid: string): string[] | null {
  switch (assetType) {
    case 'PAGE':
      return ['/p', projectKey, 'pages', uuid];
    case 'PAGE_TEMPLATE':
    case 'SECTION_TEMPLATE':
      return ['/p', projectKey, 'templates'];
    default:
      return null;
  }
}

@Component({
  selector: 'sf-reference-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    SfFieldComponent,
    SfButtonComponent,
    SfIconComponent,
    SfDropTargetDirective,
    SfAssetPickerDialogComponent,
  ],
  templateUrl: './reference-editor.component.html',
  styleUrl: './reference-editor.component.scss',
})
export class SfReferenceEditor {
  readonly definition = input.required<EditorDefinition>();
  readonly control = input.required<FormGroup>();
  readonly projectKey = input<string>();

  private readonly api = inject(ApiClient);

  protected readonly pickerOpen = signal(false);
  protected readonly resolvedLabel = signal<string | null>(null);
  private lastResolvedUuid: string | null = null;

  /**
   * Route to the referenced asset (opened in a new tab so editing here isn't
   * interrupted), or `null` when this asset type has no per-item route to
   * link to (e.g. media). Deliberately a plain method, not a `computed()` —
   * `uuid()`/`assetType()` read a plain `FormControl.value`, not a signal, so
   * a `computed()` here would never see `select()`/`reset()` updates; this
   * gets freshly re-evaluated on each CD pass like `uuid()`/`assetType()` do.
   */
  protected link(): string[] | null {
    const key = this.projectKey();
    const uuid = this.uuid();
    if (!key || !uuid) {
      return null;
    }
    return linkFor(key, this.assetType(), uuid);
  }

  constructor() {
    effect(
      () => {
        const key = this.projectKey();
        const uuid = this.uuid();
        if (!key || !uuid) {
          this.lastResolvedUuid = null;
          this.resolvedLabel.set(null);
          return;
        }
        if (uuid === this.lastResolvedUuid) {
          return;
        }
        this.lastResolvedUuid = uuid;
        untracked(() => this.resolveLabel(key, uuid));
      },
      { allowSignalWrites: true },
    );
  }

  field(name: string): FormControl {
    return this.control().get(name) as FormControl;
  }

  protected uuid(): string | null {
    return (String(this.field('uuid').value ?? '').trim() || null);
  }

  protected assetType(): string | null {
    return (String(this.field('assetType').value ?? '').trim() || null);
  }

  onDrop(event: DragEvent): void {
    const data =
      event.dataTransfer?.getData('application/json') ||
      event.dataTransfer?.getData('text/plain') ||
      '';
    if (!data) {
      return;
    }
    try {
      const parsed = JSON.parse(data) as { uuid?: string; assetType?: string };
      if (parsed.uuid) {
        this.select(parsed.uuid, parsed.assetType ?? '');
        this.refreshLabel(parsed.uuid);
      }
    } catch {
      this.select(data, '');
      this.refreshLabel(data);
    }
  }

  protected openPicker(): void {
    if (this.definition().readOnly) {
      return;
    }
    this.pickerOpen.set(true);
  }

  protected closePicker(): void {
    this.pickerOpen.set(false);
  }

  protected onPicked(result: AssetPicked): void {
    this.select(result.uuid, result.assetType);
    this.resolvedLabel.set(result.label);
    this.pickerOpen.set(false);
  }

  protected reset(): void {
    this.field('uuid').setValue(null);
    this.field('assetType').setValue(null);
    this.control().markAsDirty();
    this.lastResolvedUuid = null;
    this.resolvedLabel.set(null);
  }

  private select(uuid: string, assetType: string): void {
    this.field('uuid').setValue(uuid);
    if (assetType) {
      this.field('assetType').setValue(assetType);
    }
    this.control().markAsDirty();
    this.lastResolvedUuid = uuid;
  }

  /** Fetches the display name for a uuid we don't already have a label for (e.g. a raw drag-drop payload). */
  private refreshLabel(uuid: string): void {
    const key = this.projectKey();
    if (!key) {
      return;
    }
    this.resolveLabel(key, uuid);
  }

  private resolveLabel(projectKey: string, uuid: string): void {
    this.api.assetDetail(projectKey, uuid).subscribe({
      next: (detail) => this.resolvedLabel.set(detail.displayName ?? detail.uid ?? uuid),
      error: () => this.resolvedLabel.set(null),
    });
  }
}
