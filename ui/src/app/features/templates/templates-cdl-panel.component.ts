import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import type { CdlSection } from '../../shared/code-editor/cdl-sections';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfCdlSectionsEditorComponent } from '../../shared/components/sf-cdl-sections-editor.component';
import { TemplatesEditing } from './templates-editing';
import { TemplatesStore } from './templates.store';

/** The help line above each CDL tab (M34). */
const CDL_HINTS: Partial<Record<CdlSection, string>> = {
  content: 'The editors this template exposes: editor and group declarations.',
  bodies: 'The bodies pages of this template fill with sections: body declarations.',
  rules: 'Checks, required/read-only states and fills on the editors: rule, state and fill entries.',
};

/** The content definition (CDL) of the open template: the section tabs, the inherited declarations and Validate. */
@Component({
  selector: 'sf-template-cdl-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent, SfCdlSectionsEditorComponent],
  templateUrl: './templates-cdl-panel.component.html',
  styleUrls: ['./templates-panel.scss', './templates-inheritance.scss', './templates-cdl-panel.component.scss'],
})
export class TemplateCdlPanelComponent {
  protected readonly store = inject(TemplatesStore);
  protected readonly editing = inject(TemplatesEditing);
  protected readonly cdlHints = CDL_HINTS;
}
