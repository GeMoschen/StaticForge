import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { tap } from 'rxjs';
import { UndoService } from '../../core/ui/undo.service';
import { findFolderByPath } from '../../shared/folder-tree.util';
import { ContentService } from '../content/content.service';
import { TemplateIdeComponent } from './template-ide.component';
import { DatasetEditorComponent, type DeletedDataset } from './dataset-editor.component';
import { TemplatesLoader } from './templates-loader';
import { TemplatesStore } from './templates.store';

/**
 * The open template or dataset (the child route `/templates/:uuid` of the Templates area, M35.21): the template IDE
 * (`TemplateIdeComponent`: header, banners, Settings, CDL and channels) for a page or section template, or the dataset editor. All of
 * its state lives in the area's `TemplatesStore` (provided by `TemplatesComponent`, which follows the URL and loads the
 * template); this component only picks which of the two to show.
 */
@Component({
  selector: 'sf-template-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatasetEditorComponent,
    TemplateIdeComponent,
  ],
  templateUrl: './template-editor.component.html',
  styleUrl: './template-editor.component.scss',
})
export class TemplateEditorComponent {
  protected readonly store = inject(TemplatesStore);
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
