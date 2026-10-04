import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfBannerComponent } from '../../shared/components/layout/sf-banner.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { TemplatesSaveCoordinator } from './templates-save.coordinator';
import { TemplatesStore } from './templates.store';

/**
 * The banners of the template view (M35.21 B, decisions 160, 161): a refused save (with the number of compile errors),
 * the templates a rejected save would have broken, the warnings a save produced on the templates extending this one, and
 * the info line that others extend it (with *Used by*). Banners that answer an action are live regions.
 */
@Component({
  selector: 'sf-template-save-outcomes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfBannerComponent, SfButtonComponent, TranslocoPipe],
  templateUrl: './templates-save-outcomes.component.html',
  styleUrl: './templates-save-outcomes.component.scss',
})
export class TemplateSaveOutcomesComponent {
  protected readonly store = inject(TemplatesStore);
  protected readonly save = inject(TemplatesSaveCoordinator);

  /**
   * A refused save says so once: the broken descendants have their own banner, and a template that pages still use is
   * explained under *Abstract*, so those two do not repeat here.
   */
  protected readonly refused = computed(() => {
    const error = this.save.error();
    return error && this.store.descendantProblems().length === 0 ? error : null;
  });

  protected readonly any = computed(
    () =>
      !!this.refused() ||
      this.store.descendantProblems().length > 0 ||
      this.store.descendantWarnings().length > 0 ||
      this.store.childTemplates().length > 0,
  );
}
