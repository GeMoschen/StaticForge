import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SfAssetImpactComponent } from '../generation/insight/sf-asset-impact.component';
import { SfAssetUrlsComponent } from '../settings/asset-urls.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfContentFormComponent } from '../forms';
import { PageEditorSectionsService } from './page-editor-sections.service';
import { PageEditorStore } from './page-editor.store';
import { SectionEditorComponent } from './section-editor.component';
import { SectionPaletteService } from './section-palette.service';
import type { SectionInstance } from './types';

/**
 * What the centre pane shows, driven by `?section=`/`?body=` (see `PageNavNodeComponent`): a single section, a single
 * body's sections, or the page's own fields.
 */
@Component({
  selector: 'sf-page-editor-scope',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SectionEditorComponent,
    SfContentFormComponent,
    SfButtonComponent,
    SfEmptyStateComponent,
    SfSpinnerComponent,
    SfAssetImpactComponent,
    SfAssetUrlsComponent,
  ],
  templateUrl: './page-editor-scope.component.html',
  styleUrl: './page-editor-scope.component.scss',
})
export class PageEditorScopeComponent {
  protected readonly editor = inject(PageEditorStore);
  protected readonly sections = inject(PageEditorSectionsService);
  protected readonly palette = inject(SectionPaletteService);
  private readonly router = inject(Router);

  protected switchBody(bodyName: string): void {
    void this.router.navigate([], { queryParams: { body: bodyName } });
  }

  protected sectionKey(section: SectionInstance): string {
    return `${section.instanceId}|${section.templateRef}`;
  }
}
