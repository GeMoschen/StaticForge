import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ToastService } from '../../core/ui/toast.service';
import { SfAssetPickerDialogComponent, type AssetPicked } from '../../shared/components/sf-asset-picker-dialog.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfUidRenameComponent } from '../../shared/components/sf-uid-rename.component';
import { etagFor, NavigationService, type PageReferenceView } from './navigation.service';

type FolderView = components['schemas']['FolderView'];

type TargetKind = 'PAGE' | 'FOLDER';

interface FlatFolderOption {
  uuid: string;
  depth: number;
  label: string;
}

/**
 * Detail drawer for a selected `PageReference` leaf — target picker (a
 * searchable `Page` via the shared `sf-asset-picker-dialog`, or a flat
 * page-store `Folder` select), an optional label override, the live-resolved
 * "→ /actual/page/path" preview (`GET .../resolve`, refreshed on load and
 * after every save — this is the M8.1.5 mechanism, not the URL registry,
 * which is out of scope per M8.2.5), and delete.
 */
@Component({
  selector: 'sf-nav-reference-detail',
  standalone: true,
  imports: [
    SfAssetPickerDialogComponent,
    SfButtonComponent,
    SfFieldComponent,
    SfIconComponent,
    SfUidRenameComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './nav-reference-detail.component.html',
  styleUrl: './nav-reference-detail.component.scss',
})
export class NavReferenceDetailComponent implements OnInit {
  readonly projectKey = input.required<string>();
  readonly reference = input.required<PageReferenceView>();

  readonly closed = output<void>();
  readonly changed = output<void>();
  readonly deleted = output<string>();

  private readonly nav = inject(NavigationService);
  private readonly api = inject(ApiClient);
  private readonly toast = inject(ToastService);

  protected readonly targetKind = signal<TargetKind>('PAGE');
  protected readonly targetUuid = signal<string>('');
  protected readonly targetLabel = signal<string>('');
  protected readonly labelDraft = signal<string>('');
  protected readonly pickerOpen = signal(false);
  protected readonly saving = signal(false);
  protected readonly deleting = signal(false);

  protected readonly editingName = signal(false);
  protected readonly nameDraft = signal('');
  protected readonly savingName = signal(false);

  protected readonly resolvedPath = signal<string | null>(null);
  protected readonly resolvedLoading = signal(false);
  protected readonly unresolved = signal(false);

  protected readonly folderOptions = signal<FlatFolderOption[]>([]);

  protected readonly dirty = computed(() => {
    const ref = this.reference();
    return (
      this.targetKind() !== (ref.targetKind ?? 'PAGE') ||
      this.targetUuid() !== (ref.targetAssetUuid ?? '') ||
      this.labelDraft() !== (ref.label ?? '')
    );
  });

  ngOnInit(): void {
    this.resetFromInput();
    this.loadFolderOptions();
    this.loadResolvedPath();
  }

  private resetFromInput(): void {
    const ref = this.reference();
    this.targetKind.set((ref.targetKind as TargetKind) ?? 'PAGE');
    this.targetUuid.set(ref.targetAssetUuid ?? '');
    this.targetLabel.set('');
    this.labelDraft.set(ref.label ?? '');
  }

  protected onKindChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as TargetKind;
    this.targetKind.set(value);
    this.targetUuid.set('');
    this.targetLabel.set('');
  }

  protected openPagePicker(): void {
    this.pickerOpen.set(true);
  }

  protected closePicker(): void {
    this.pickerOpen.set(false);
  }

  protected onPagePicked(picked: AssetPicked): void {
    this.targetUuid.set(picked.uuid);
    this.targetLabel.set(picked.label);
    this.pickerOpen.set(false);
  }

  protected onFolderTargetChange(event: Event): void {
    const uuid = (event.target as HTMLSelectElement).value;
    this.targetUuid.set(uuid);
    this.targetLabel.set(this.folderOptions().find((f) => f.uuid === uuid)?.label ?? '');
  }

  protected onLabelInput(event: Event): void {
    this.labelDraft.set((event.target as HTMLInputElement).value);
  }

  protected save(): void {
    const uuid = this.reference().uuid;
    if (!uuid || !this.targetUuid() || this.saving()) {
      return;
    }
    this.saving.set(true);
    this.nav
      .updateReference(
        this.projectKey(),
        uuid,
        {
          targetKind: this.targetKind(),
          targetAssetUuid: this.targetUuid(),
          label: this.labelDraft().trim() || undefined,
        },
        this.etag(),
      )
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.show('Reference updated', 'success');
          this.loadResolvedPath();
          this.changed.emit();
        },
        error: () => {
          this.saving.set(false);
          this.toast.show('Could not update reference — the target may be invalid or gone.', 'error');
        },
      });
  }

  protected requestDelete(): void {
    const uuid = this.reference().uuid;
    if (!uuid || this.deleting()) {
      return;
    }
    const name = this.reference().displayName ?? this.reference().uid ?? 'this reference';
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) {
      return;
    }
    this.deleting.set(true);
    this.nav.deleteReference(this.projectKey(), uuid).subscribe({
      next: () => {
        this.deleting.set(false);
        this.toast.show('Reference deleted', 'success');
        this.deleted.emit(uuid);
      },
      error: () => {
        this.deleting.set(false);
        this.toast.show('Could not delete reference — try again in a moment.', 'error');
      },
    });
  }

  protected closeDrawer(): void {
    this.closed.emit();
  }

  protected startEditName(): void {
    this.nameDraft.set(this.reference().displayName ?? '');
    this.editingName.set(true);
  }

  protected cancelEditName(): void {
    this.editingName.set(false);
  }

  protected onNameInput(event: Event): void {
    this.nameDraft.set((event.target as HTMLInputElement).value);
  }

  protected saveName(): void {
    const name = this.nameDraft().trim();
    const uuid = this.reference().uuid;
    if (!name || !uuid || this.savingName()) {
      return;
    }
    this.savingName.set(true);
    this.api
      .renameAsset(this.projectKey(), uuid, { displayName: name }, this.reference().revision ?? undefined)
      .subscribe({
        next: () => {
          this.savingName.set(false);
          this.editingName.set(false);
          this.toast.show('Reference renamed', 'success');
          this.changed.emit();
        },
        error: () => {
          this.savingName.set(false);
          this.toast.show('Could not rename reference — try again in a moment.', 'error');
        },
      });
  }

  protected onUidChanged(): void {
    this.toast.show('Reference UID changed', 'success');
    this.changed.emit();
  }

  private loadResolvedPath(): void {
    const uuid = this.reference().uuid;
    if (!uuid) {
      return;
    }
    this.resolvedLoading.set(true);
    this.nav.resolveReference(this.projectKey(), uuid).subscribe({
      next: (res) => {
        this.resolvedPath.set(res.path ?? null);
        this.unresolved.set(!res.pageUuid);
        this.resolvedLoading.set(false);
      },
      error: () => {
        this.resolvedPath.set(null);
        this.unresolved.set(true);
        this.resolvedLoading.set(false);
      },
    });
  }

  private loadFolderOptions(): void {
    this.api.listFolders(this.projectKey(), 'PAGES', 10).subscribe({
      next: (tree) => this.folderOptions.set(flatten(tree ?? [], 0)),
      error: () => this.folderOptions.set([]),
    });
  }

  private etag(): string | undefined {
    const revision = this.reference().revision;
    return revision != null ? etagFor(revision) : undefined;
  }
}

function flatten(nodes: FolderView[], depth: number): FlatFolderOption[] {
  const out: FlatFolderOption[] = [];
  for (const node of nodes) {
    if (!node.uuid) {
      continue;
    }
    out.push({ uuid: node.uuid, depth, label: node.displayName ?? node.uid ?? node.uuid });
    out.push(...flatten(node.children ?? [], depth + 1));
  }
  return out;
}
