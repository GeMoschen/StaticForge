import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ConflictDrawerComponent } from './conflict-drawer.component';
import { mergePayload } from './conflict-util';
import { EMPTY_DEF, payloadToPageView } from './page-editor.mapping';
import { PageEditorStore } from './page-editor.store';
import type { FieldResolveEvent, ResolveMode } from './types';

/** Shows the conflict drawer while a save hit a newer revision, and applies the way the editor resolved it. */
@Component({
  selector: 'sf-page-editor-conflict',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConflictDrawerComponent],
  template: `
    @if (editor.autosave.conflict(); as conflict) {
      <sf-conflict-drawer
        [conflict]="conflict"
        [changedKeys]="editor.changedKeys()"
        (keepMine)="onResolve('mine')"
        (takeTheirs)="onResolve('theirs')"
        (resolve)="onResolveFields($event)"
      />
    }
  `,
  styles: [':host { display: contents; }'],
})
export class PageEditorConflictComponent {
  protected readonly editor = inject(PageEditorStore);

  protected onResolve(mode: ResolveMode): void {
    this.editor.autosave.resolveConflict(mode);
  }

  protected onResolveFields(event: FieldResolveEvent): void {
    const { autosave } = this.editor;
    const conflict = autosave.conflict();
    if (!conflict || conflict.base == null || conflict.theirs == null) {
      return;
    }
    const local = this.editor.composePayload();
    const merged = mergePayload(conflict.theirs, local, event.fields) as Record<string, unknown>;
    const mergedPage = payloadToPageView(this.editor.page() ?? ({} as never), merged);
    this.editor.page.set(mergedPage);
    this.editor.fields.buildFieldsForm(this.editor.contentDefinition() ?? EMPTY_DEF, merged['content']);
    this.editor.loadSectionDefs(this.editor.projectKey(), mergedPage);
    autosave.resolveFields(conflict.currentRevision);
    autosave.flush();
  }
}
