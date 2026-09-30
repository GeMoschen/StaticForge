import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nFormatService } from '../../core/i18n/i18n-format.service';

/** A number with the active language's separators (M35.4): `{{ 12345.6 | sfNumber }}` is "12,345.6" in English. */
@Pipe({ name: 'sfNumber', standalone: true, pure: false })
export class SfNumberPipe implements PipeTransform {
  private readonly format = inject(I18nFormatService);

  transform(value: number | null | undefined, options?: Intl.NumberFormatOptions): string {
    return this.format.number(value, options);
  }
}
