import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { ReactiveFormsModule, FormControl, FormGroup } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiClient } from '../../../core/api/api.client';
import { ContentService } from '../../content/content.service';
import { recordCountLabel } from '../../../shared/components/asset-picker.util';
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
    case 'DATASET':
      return ['/p', projectKey, 'templates'];
    case 'RECORD':
      return ['/p', projectKey, 'content', 'records', uuid];
    case 'RECORD_SET':
      return ['/p', projectKey, 'content', 'sets', uuid];
    default:
      return null;
  }
}

/** What the editor knows about the referenced asset beyond its uuid. */
export interface ResolvedReference {
  label: string;
  /** The target's type as the server reports it — fills in for a value stored without `assetType`. */
  assetType?: string;
  /** Record sets (M25.5.3): the dataset's name and the live record count. */
  dataset?: string;
  recordCount?: number;
  /** The target is gone (`missing`: no such asset) or in the trash (`deleted`) — a broken reference. */
  broken?: 'missing' | 'deleted';
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
  private readonly content = inject(ContentService);

  protected readonly pickerOpen = signal(false);
  protected readonly resolved = signal<ResolvedReference | null>(null);
  protected readonly recordCountLabel = recordCountLabel;
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
    return linkFor(key, this.targetType(), uuid);
  }

  /** The value's asset type, or — for a value without one (a raw drag-drop payload) — the resolved target's. */
  protected targetType(): string | null {
    return this.assetType() ?? this.resolved()?.assetType ?? null;
  }

  constructor() {
    effect(
      () => {
        const key = this.projectKey();
        const uuid = this.uuid();
        if (!key || !uuid) {
          this.lastResolvedUuid = null;
          this.resolved.set(null);
          return;
        }
        if (uuid === this.lastResolvedUuid) {
          return;
        }
        this.lastResolvedUuid = uuid;
        untracked(() => this.resolve(key, uuid, this.assetType()));
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
        this.refreshLabel(parsed.uuid, parsed.assetType ?? null);
      }
    } catch {
      this.select(data, '');
      this.refreshLabel(data, null);
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
    this.resolved.set({
      label: result.label,
      assetType: result.assetType,
      dataset: result.dataset,
      recordCount: result.recordCount,
    });
    this.pickerOpen.set(false);
  }

  protected reset(): void {
    this.field('uuid').setValue(null);
    this.field('assetType').setValue(null);
    this.control().markAsDirty();
    this.lastResolvedUuid = null;
    this.resolved.set(null);
  }

  private select(uuid: string, assetType: string): void {
    this.field('uuid').setValue(uuid);
    if (assetType) {
      this.field('assetType').setValue(assetType);
    }
    this.control().markAsDirty();
    this.lastResolvedUuid = uuid;
  }

  /**
   * Fetches the display name for a uuid we don't already have a label for (e.g. a raw drag-drop payload). Only the
   * dropped type counts — the control may still hold the previous value's — and without one the generic lookup
   * finds out.
   */
  private refreshLabel(uuid: string, assetType: string | null): void {
    const key = this.projectKey();
    if (!key) {
      return;
    }
    this.resolve(key, uuid, assetType);
  }

  /**
   * Looks the target up: a record set through the set endpoint (name, dataset, record count), anything else
   * through the generic asset detail. A `404` or a deleted target is a broken reference; any other failure
   * leaves just the uuid on show, since it says nothing about the target.
   */
  private resolve(projectKey: string, uuid: string, assetType: string | null): void {
    const failed = (error: unknown) =>
      this.resolved.set(
        error instanceof HttpErrorResponse && error.status === 404 ? { label: uuid, broken: 'missing' } : null,
      );
    if (assetType === 'RECORD_SET') {
      this.content.getRecordSet(projectKey, uuid).subscribe({
        next: (set) =>
          this.resolved.set({
            label: set.displayName ?? set.uid ?? uuid,
            assetType: 'RECORD_SET',
            dataset: set.dataset?.displayName ?? set.dataset?.uid,
            recordCount: set.recordCount ?? 0,
            broken: set.deleted ? 'deleted' : undefined,
          }),
        error: failed,
      });
      return;
    }
    this.api.assetDetail(projectKey, uuid).subscribe({
      next: (detail) => {
        if (detail.type === 'RECORD_SET') {
          // A value without its asset type (a raw drag-drop payload) that turns out to be a set.
          this.resolve(projectKey, uuid, 'RECORD_SET');
          return;
        }
        this.resolved.set({
          label: detail.displayName ?? detail.uid ?? uuid,
          assetType: detail.type,
          broken: detail.deleted ? 'deleted' : undefined,
        });
      },
      error: failed,
    });
  }
}
