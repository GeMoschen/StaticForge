import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { tap } from 'rxjs';
import { UndoService } from '../../core/ui/undo.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { findFolderByPath } from '../../shared/folder-tree.util';
import { ContentService } from '../content/content.service';
import { DatasetSchemaEditorComponent, type DeletedDataset } from '../content/dataset-schema-editor.component';
import { SfAssetImpactComponent } from '../generation/insight/sf-asset-impact.component';
import { TemplateCdlPanelComponent } from './templates-cdl-panel.component';
import { TemplateChannelPanelComponent } from './templates-channel-panel.component';
import { TemplatesLoader } from './templates-loader';
import { TemplateMetaHeaderComponent } from './templates-meta-header.component';
import { TemplateSaveOutcomesComponent } from './templates-save-outcomes.component';
import { TemplatesSaveCoordinator } from './templates-save.coordinator';
import { TemplatesStore } from './templates.store';

/**
 * The open template or dataset (the child route `/templates/:uuid` of the Templates area, M35.21): the metadata header,
 * the save outcomes, the CDL panel and the channel panel for a page or section template, or the dataset editor. All of
 * its state lives in the area's `TemplatesStore` (provided by `TemplatesComponent`, which follows the URL and loads the
 * template); this component only lays the parts out. Phase B of M35.21 restyles it into the IDE header and splitter.
 */
@Component({
  selector: 'sf-template-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfButtonComponent,
    SfSpinnerComponent,
    SfAssetImpactComponent,
    DatasetSchemaEditorComponent,
    TemplateMetaHeaderComponent,
    TemplateSaveOutcomesComponent,
    TemplateCdlPanelComponent,
    TemplateChannelPanelComponent,
    TranslocoPipe,
  ],
  templateUrl: './template-editor.component.html',
  styleUrls: ['./template-editor.component.scss', './templates-panel.scss', './templates-editors.scss'],
})
export class TemplateEditorComponent {
  protected readonly store = inject(TemplatesStore);
  protected readonly save = inject(TemplatesSaveCoordinator);
  private readonly loader = inject(TemplatesLoader);
  private readonly content = inject(ContentService);
  private readonly undo = inject(UndoService);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);

  protected onDatasetChanged(): void {
    this.loader.onDatasetChanged();
  }

  protected onDatasetDeleted(deleted: DeletedDataset): void {
    const key = this.store.projectKey();
    const row = this.store.templates().find((t) => t.uuid === deleted.uuid);
    const folder = row?.folderPath ? findFolderByPath(this.store.templateFolderTree(), row.folderPath) : null;
    this.loader.onDatasetDeleted();
    // Undo brings the dataset back as its last live version was.
    this.undo.offer(this.transloco.translate('templates.toast.deleted', { name: deleted.name }), () =>
      this.content.restoreDataset(key, deleted.uuid).pipe(tap(() => this.loader.onTreeChanged())),
    );
    void this.router.navigate(['/p', key, 'templates'], { queryParams: folder?.uuid ? { folder: folder.uuid } : {} });
  }
}
