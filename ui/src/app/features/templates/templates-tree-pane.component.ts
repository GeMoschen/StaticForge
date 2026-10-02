import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import { tap } from 'rxjs';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { UndoService } from '../../core/ui/undo.service';
import { findFolderById, findFolderByPath, findParentFolder, moveBackBody } from '../../shared/folder-tree.util';
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
  private readonly undo = inject(UndoService);
  private readonly projectContext = inject(ProjectContextStore);

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
    const key = this.store.projectKey();
    const source = event.source;
    const tree = this.projectContext.templateFolderTree();
    // Where it lives now is the body of the move that undoes this one.
    const template = this.store.templates().find((t) => t.uuid === source);
    const parent = template ? findFolderByPath(tree, template.folderPath ?? '') : findParentFolder(tree, source);
    const back = moveBackBody(parent, tree[0]?.uuid);
    const name = template?.displayName ?? template?.uid ?? this.folderName(source);
    const target = this.folderName(event.target);
    this.api.moveAsset(key, source, { folderUuid: event.target }).subscribe({
      next: () => {
        this.undo.offer(`Moved “${name}” to ${target}.`, () =>
          this.api.moveAsset(key, source, back).pipe(tap(() => this.loader.onTreeChanged())),
        );
        this.loader.onTreeChanged();
      },
      error: () => this.toast.show('Could not move — that may create a cycle.', 'error'),
    });
  }

  private folderName(uuid: string): string {
    return findFolderById(this.projectContext.templateFolderTree(), uuid)?.displayName ?? 'the folder';
  }

  protected onTreeChanged(): void {
    this.loader.onTreeChanged();
  }
}
