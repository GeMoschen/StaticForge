import { Directive, TemplateRef, ViewContainerRef, effect, inject } from '@angular/core';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';

/**
 * Renders its template only while developer mode is on (UIDs, paths, CDL hints, schema tabs): one structural check, so
 * no screen re-implements it.
 *
 * ```html
 * <code *sfDevOnly>{{ uid }}</code>
 * ```
 */
@Directive({ selector: '[sfDevOnly]', standalone: true })
export class SfDevOnlyDirective {
  private readonly template = inject<TemplateRef<unknown>>(TemplateRef);
  private readonly container = inject(ViewContainerRef);
  private readonly developerMode = inject(DeveloperModeService);

  constructor() {
    effect(() => {
      const enabled = this.developerMode.enabled();
      this.container.clear();
      if (enabled) {
        this.container.createEmbeddedView(this.template);
      }
    });
  }
}
