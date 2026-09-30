import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { TemplateFolderNodeComponent } from './template-folder-node.component';
import { TemplatesLoader } from './templates-loader';
import { TemplatesStore } from './templates.store';
import { rootKindOf } from './templates.util';
import type { FolderMoveEvent } from './types';

/** The folder tree on the left of the templates screen: folders, their templates and datasets as leaves. */
@Component({
  selector: 'sf-templates-tree-pane',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfSpinnerComponent, TemplateFolderNodeComponent],
  templateUrl: './templates-tree-pane.component.html',
  styleUrl: './templates-tree-pane.component.scss',
})
export class TemplatesTreePaneComponent {
  protected readonly store = inject(TemplatesStore);
  private readonly loader = inject(TemplatesLoader);
  private readonly api = inject(ApiClient);
  private readonly toast = inject(ToastService);

  /** "New template" from a folder's context menu; the screen owns the create dialog. */
  readonly newTemplate = output<void>();

  protected readonly rootKind = rootKindOf;

  /** Handles both folder-onto-folder drags on the templates tree — the generic move endpoint
   * dispatches by asset type; cross-kind drags are already rejected client-side by
   * `TemplateFolderNodeComponent.onDrop`. */
  protected moveItemTo(event: FolderMoveEvent): void {
    if (!event.source || !event.target || this.store.readOnly()) {
      return;
    }
    this.api.moveAsset(this.store.projectKey(), event.source, { folderUuid: event.target }).subscribe({
      next: () => {
        this.toast.show('Moved', 'success');
        this.loader.onTreeChanged();
      },
      error: () => this.toast.show('Could not move — that may create a cycle.', 'error'),
    });
  }

  protected onTreeChanged(): void {
    this.loader.onTreeChanged();
  }
}
