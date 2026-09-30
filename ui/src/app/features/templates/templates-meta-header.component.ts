import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfUidRenameComponent } from '../../shared/components/sf-uid-rename.component';
import { DEFAULT_PAGINATION_PATH } from './pagination-path.util';
import { TemplatesLoader } from './templates-loader';
import { TemplatesSaveCoordinator } from './templates-save.coordinator';
import { TemplatesStore } from './templates.store';

/**
 * The top of the template detail pane: title, inheritance chain, Save/Delete, and the metadata form (display name,
 * category, deprecated/abstract, uid rename, pagination paths).
 */
@Component({
  selector: 'sf-template-meta-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent, SfFieldComponent, SfUidRenameComponent, RouterLink],
  templateUrl: './templates-meta-header.component.html',
  styleUrls: [
    './templates-panel.scss',
    './templates-meta-header.component.scss',
    './templates-inheritance.scss',
    './templates-pagination.scss',
  ],
})
export class TemplateMetaHeaderComponent {
  protected readonly store = inject(TemplatesStore);
  protected readonly save = inject(TemplatesSaveCoordinator);
  protected readonly loader = inject(TemplatesLoader);

  protected readonly defaultPaginationPath = DEFAULT_PAGINATION_PATH;

  protected onDisplayNameInput(event: Event): void {
    this.store.displayName.set((event.target as HTMLInputElement).value);
  }

  protected onCategoryInput(event: Event): void {
    this.store.category.set((event.target as HTMLInputElement).value);
  }

  protected onDeprecatedChange(event: Event): void {
    this.store.deprecated.set((event.target as HTMLInputElement).checked);
  }

  protected onAbstractChange(event: Event): void {
    this.store.abstractTemplate.set((event.target as HTMLInputElement).checked);
    this.store.templateInUse.set(null);
  }

  protected onPaginationPathInput(channel: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.store.paginationPaths.update((paths) => ({ ...paths, [channel]: value }));
  }
}
