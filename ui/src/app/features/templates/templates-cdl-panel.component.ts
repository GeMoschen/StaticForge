import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  diagnosticsIn,
  errorCount,
  SECTION_LABEL_KEYS,
  type CdlSection,
} from '../../shared/code-editor/cdl-sections';
import { SfCodePanelComponent } from '../../shared/code-editor/sf-code-panel.component';
import { sfUniqueId } from '../../shared/components/forms/sf-field-context';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { panelIdOf, SfTabsComponent, tabIdOf, type SfTab } from '../../shared/components/sf-tabs.component';
import { TemplatesEditing } from './templates-editing';
import { TemplatesStore } from './templates.store';

/**
 * The content definition (CDL) of the open template (M35.21 B): one tab per section (Content, Bodies for page templates,
 * Rules) with its error count and unsaved dot, each section in an `sf-code-panel` (header strip with *Format*, *Find* and
 * *Validate*, problems with jump to line, status line). The editors stay alive while another tab shows, so their undo
 * history and caret survive. The editors and bodies inherited from ancestors are listed above the tab that holds them.
 */
@Component({
  selector: 'sf-template-cdl-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent, SfCodePanelComponent, SfTabsComponent, TranslocoPipe],
  templateUrl: './templates-cdl-panel.component.html',
  styleUrls: ['./templates-inheritance.scss', './templates-cdl-panel.component.scss'],
})
export class TemplateCdlPanelComponent {
  protected readonly store = inject(TemplatesStore);
  protected readonly editing = inject(TemplatesEditing);
  private readonly transloco = inject(TranslocoService);

  protected readonly idPrefix = sfUniqueId('tpl-cdl');

  protected readonly tabs = computed<SfTab[]>(() => {
    const sections = this.store.sections();
    const saved = this.store.savedSections();
    const diagnostics = this.store.cdlDiagnostics();
    return this.store.cdlTabs().map((section) => ({
      id: section,
      label: this.transloco.translate(SECTION_LABEL_KEYS[section]),
      errors: errorCount(diagnosticsIn(diagnostics, section)),
      dirty: saved !== null && sections[section] !== saved[section],
    }));
  });

  protected diagnosticsOf(section: CdlSection) {
    return diagnosticsIn(this.store.cdlDiagnostics(), section);
  }

  protected tabId(section: CdlSection): string {
    return tabIdOf(this.idPrefix, section);
  }

  protected panelId(section: CdlSection): string {
    return panelIdOf(this.idPrefix, section);
  }

  protected labelOf(section: CdlSection): string {
    return this.transloco.translate('templates.cdl.editorLabel', {
      name: this.store.detail()?.displayName || this.store.detail()?.uid || '',
      section: this.transloco.translate(SECTION_LABEL_KEYS[section]),
    });
  }

  protected selectSection(id: string): void {
    this.store.cdlTab.set(id as CdlSection);
  }
}
