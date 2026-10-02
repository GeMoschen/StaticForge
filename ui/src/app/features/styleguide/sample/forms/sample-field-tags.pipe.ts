import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import type { SfFieldTag } from '../../../../shared/components/sf-field.component';

/**
 * The badges of a field's label line in the content form (M35.17 sample): the **language chip** — the editing language,
 * or "All languages" for a field every language shares, nothing at all when the template is not localized (`null`) — and,
 * for a value the CMS fills in, a **Computed** cue. `[tags]="language | fieldTags: computed"`.
 */
@Pipe({ name: 'fieldTags', standalone: true })
export class SampleFieldTagsPipe implements PipeTransform {
  private readonly transloco = inject(TranslocoService);

  transform(language: string | null | undefined, computed = false): readonly SfFieldTag[] {
    const tags: SfFieldTag[] = [];
    if (language) {
      tags.push({
        label: language === 'all' ? this.transloco.translate('styleguide.sample.forms.allLanguages') : language,
        icon: language === 'all' ? 'public' : 'translate',
      });
    }
    if (computed) {
      tags.push({ label: this.transloco.translate('styleguide.sample.forms.computed'), icon: 'functions', tone: 'info' });
    }
    return tags;
  }
}
