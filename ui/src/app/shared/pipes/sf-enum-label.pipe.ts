import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslocoService, getValue } from '@jsverse/transloco';
import { I18nFormatService } from '../../core/i18n/i18n-format.service';

/**
 * The human label of an enum value (M35.4): `{{ role | sfEnumLabel: 'projectRole' }}` reads
 * `enum.projectRole.<VALUE>` from `en.json`. A value without a label (a status the server added) shows as it is, and
 * nothing shows as an em dash, so an unknown enum never breaks a screen.
 */
@Pipe({ name: 'sfEnumLabel', standalone: true, pure: false })
export class SfEnumLabelPipe implements PipeTransform {
  private readonly transloco = inject(TranslocoService);
  private readonly format = inject(I18nFormatService);

  transform(value: string | null | undefined, enumName: string): string {
    if (value === null || value === undefined || value === '') {
      return '—';
    }
    const lang = this.format.lang();
    const key = `enum.${enumName}.${value}`;
    return getValue(this.transloco.getTranslation(lang), key) === undefined ? value : this.transloco.translate(key);
  }
}
