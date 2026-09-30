import { ChangeDetectionStrategy, Component, inject, viewChildren } from '@angular/core';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { SfOctlEditorComponent } from '../../shared/components/sf-octl-editor.component';
import { SfTabsComponent } from '../../shared/components/sf-tabs.component';
import type { Diagnostic } from './content.service';
import { DatasetTemplatesStore } from './dataset-templates.store';
import { recordTemplateMetaHelpers, type RecordTemplateHelper } from './record-template.util';

/**
 * The dataset editor's "Record templates (OCTL)" panel (M35.2): one tab and one editor per channel, the
 * click-to-insert helpers and the empty / disabled notes. State lives in the editor's
 * {@link DatasetTemplatesStore}.
 */
@Component({
  selector: 'sf-dataset-record-templates',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfOctlEditorComponent, SfTabsComponent],
  templateUrl: './dataset-record-templates.component.html',
  styleUrl: './dataset-record-templates.component.scss',
})
export class DatasetRecordTemplatesComponent {
  protected readonly store = inject(DatasetTemplatesStore);
  protected readonly canEdit = inject(ProjectPermissionsStore).canEditTemplates;
  protected readonly metaHelpers: readonly RecordTemplateHelper[] = recordTemplateMetaHelpers();

  private readonly octlEditors = viewChildren(SfOctlEditorComponent);

  /** The open channel's record template editor: one exists per channel that shows an editor, in tab order. */
  private octlEditor(): SfOctlEditorComponent | undefined {
    const shown = this.store.channelTabs().filter((tab) => this.canEdit() || this.store.sourceOf(tab.key).trim());
    const index = shown.findIndex((tab) => tab.key === this.store.activeChannel());
    return index < 0 ? undefined : this.octlEditors()[index];
  }

  protected insertHelper(helper: RecordTemplateHelper): void {
    this.octlEditor()?.insert(helper.snippet, helper.caret);
  }

  /** Moves the caret of the open editor to a diagnostic (after a rejected save opened its tab). */
  goTo(target: Diagnostic): void {
    this.octlEditor()?.goTo(target);
  }
}
