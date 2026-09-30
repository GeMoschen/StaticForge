import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { TemplatesStore } from './templates.store';

/** What a save did to the templates extending this one: the descendants it would break, or their new warnings. */
@Component({
  selector: 'sf-template-save-outcomes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent],
  templateUrl: './templates-save-outcomes.component.html',
  styleUrls: ['./templates-panel.scss', './templates-save-outcomes.component.scss', './templates-inheritance.scss'],
})
export class TemplateSaveOutcomesComponent {
  protected readonly store = inject(TemplatesStore);
}
