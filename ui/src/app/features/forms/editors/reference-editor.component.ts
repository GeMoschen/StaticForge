import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { ReactiveFormsModule, FormControl, FormGroup } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { RouterLink } from '@angular/router';
import { ApiClient } from '../../../core/api/api.client';
import { assetIcon, assetLocation } from '../../../core/assets/asset-ref';
import { DeveloperModeService } from '../../../core/frame/developer-mode.service';
import { assetRoute } from '../../../shared/asset-route.util';
import { SfBadgeComponent } from '../../../shared/components/display/sf-badge.component';
import { SfCopyableComponent } from '../../../shared/components/display/sf-copyable.component';
import { SfEditorBase } from '../editor-base';
import { ContentService } from '../../content/content.service';
import { recordCountLabel } from '../../../shared/components/asset-picker.util';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SfDropTargetDirective } from '../../../shared/directives/sf-drop-target.directive';
import { SfAssetPickerDialogComponent, AssetPicked } from '../../../shared/components/sf-asset-picker-dialog.component';
import { EditorDefinition } from '../form.model';

/** What the editor knows about the referenced asset beyond its uuid. */
export interface ResolvedReference {
  label: string;
  /** The target's type as the server reports it — fills in for a value stored without `assetType`. */
  assetType?: string;
  /** Record sets (M25.5.3): the dataset's name and the live record count. */
  dataset?: string;
  recordCount?: number;
  /** Where it lives (`/pages_root/news/`). */
  folderPath?: string;
  /** The lookup failed for a reason that says nothing about the target (offline, a server error). */
  unreachable?: boolean;
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
    SfBadgeComponent,
    SfButtonComponent,
    SfCopyableComponent,
    SfIconComponent,
    SfDropTargetDirective,
    SfAssetPickerDialogComponent,
    TranslocoPipe,
  ],
  templateUrl: './reference-editor.component.html',
  styleUrl: './reference-editor.component.scss',
})
export class SfReferenceEditor extends SfEditorBase<FormGroup> {
  readonly projectKey = input<string>();

  private readonly api = inject(ApiClient);
  private readonly content = inject(ContentService);

  protected readonly pickerOpen = signal(false);
  protected readonly resolved = signal<ResolvedReference | null>(null);
  protected readonly developer = inject(DeveloperModeService).enabled;
  protected recordCountLabel(count: number | null | undefined): string {
    return recordCountLabel(count, (key, params) => this.transloco.translate(key, params));
  }
  private lastResolvedUuid: string | null = null;

  /** Where the target opens (in a new tab, so editing here is not interrupted); `null` for a target that is gone. */
  protected link(): { commands: string[]; queryParams: Record<string, string> } | null {
    const key = this.projectKey();
    const uuid = this.uuid();
    const type = this.targetType();
    if (!key || !uuid || !type || this.resolved()?.broken === 'missing') {
      return null;
    }
    const route = assetRoute(key, { type, uuid, folderPath: this.resolved()?.folderPath });
    return { commands: route.commands, queryParams: route.queryParams };
  }

  protected icon(): string {
    return this.resolved()?.broken ? 'link_off' : assetIcon(this.targetType() ?? '');
  }

  /** Where the target lives, as a muted line (the folder path; nothing at the root). */
  protected location(): string | null {
    const resolved = this.resolved();
    return resolved?.folderPath ? assetLocation(resolved.folderPath, this.targetType() ?? '') : null;
  }

  /** The value's asset type, or — for a value without one (a raw drag-drop payload) — the resolved target's. */
  protected targetType(): string | null {
    return this.assetType() ?? this.resolved()?.assetType ?? null;
  }

  /** A reference is filled when it has a target; a value without one is empty. */
  protected override isEmpty(value: unknown): boolean {
    const uuid = (value as { uuid?: string | null } | null)?.uuid;
    return !uuid || String(uuid).trim() === '';
  }

  constructor() {
    super();
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
        error instanceof HttpErrorResponse && error.status === 404 ? { label: uuid, broken: 'missing' } : { label: '', unreachable: true },
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
          folderPath: detail.folderPath,
          broken: detail.deleted ? 'deleted' : undefined,
        });
      },
      error: failed,
    });
  }
}
