import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import { ContextMenuService } from '../../shared/services/context-menu.service';
import { TreeClipboardService } from '../../shared/services/tree-clipboard.service';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfRenameAssetDialogComponent } from '../../shared/components/sf-rename-asset-dialog.component';
import type { components } from '../../core/api/generated/schema.d.ts';
import type { TemplateAssetKind } from './types';

type TemplateSummary = components['schemas']['TemplateSummary'];

/**
 * One template, as a leaf in the templates tree — the templates-screen
 * equivalent of `sf-page-nav-node`, but much simpler (no bodies/sections):
 * a name row that selects the template into the detail pane on click, with
 * a context menu for Rename (the shared `sf-rename-asset-dialog`) and Cut
 * (moving a template between folders goes through `TreeClipboardService`
 * cut/paste, matching Pages — there's no leaf-level drag-and-drop anywhere
 * in this codebase, per M13's established pattern).
 */
@Component({
  selector: 'sf-template-nav-node',
  standalone: true,
  imports: [SfIconComponent, SfRenameAssetDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './template-nav-node.component.html',
  styleUrl: './template-nav-node.component.scss',
})
export class TemplateNavNodeComponent {
  private readonly api = inject(ApiClient);
  private readonly toast = inject(ToastService);
  private readonly menu = inject(ContextMenuService);
  private readonly clipboard = inject(TreeClipboardService);

  readonly projectKey = input.required<string>();
  readonly summary = input.required<TemplateSummary>();
  readonly depth = input<number>(0);
  readonly templateKind = input.required<TemplateAssetKind>();
  readonly selected = input<boolean>(false);

  readonly select = output<string>();
  /** Emitted after a rename succeeds, so the parent reloads the list/tree. */
  readonly changed = output<void>();

  protected readonly renameOpen = signal(false);
  protected readonly renamingName = signal(false);

  protected onSelect(): void {
    const uuid = this.summary().uuid;
    if (uuid) {
      this.select.emit(uuid);
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.onSelect();
    }
  }

  protected onContextMenu(event: MouseEvent): void {
    const uuid = this.summary().uuid;
    if (!uuid) {
      return;
    }
    const label = this.summary().displayName ?? this.summary().uid ?? 'template';
    this.menu.open(event, [
      { label: 'Rename', icon: 'edit', action: () => this.renameOpen.set(true) },
      { label: '', separator: true },
      {
        label: 'Cut',
        icon: 'content_cut',
        action: () => this.clipboard.cut('TEMPLATE', uuid, label, this.templateKind()),
      },
    ]);
  }

  protected closeRename(): void {
    this.renameOpen.set(false);
  }

  protected submitRenameDisplayName(displayName: string): void {
    const key = this.projectKey();
    const uuid = this.summary().uuid;
    if (!key || !uuid) {
      return;
    }
    this.renamingName.set(true);
    this.api.renameAsset(key, uuid, { displayName }).subscribe({
      next: () => {
        this.renamingName.set(false);
        this.renameOpen.set(false);
        this.toast.show('Template renamed', 'success');
        this.changed.emit();
      },
      error: () => {
        this.renamingName.set(false);
        this.toast.show('Could not rename template — try again in a moment.', 'error');
      },
    });
  }

  protected onRenameUidChanged(): void {
    // sf-uid-rename already toasts "UID changed" itself — just reload.
    this.changed.emit();
  }
}
