import { Pipe, PipeTransform, inject } from '@angular/core';
import { DateTimeStyle, I18nFormatService } from '../../core/i18n/i18n-format.service';

/**
 * An absolute date and/or time in the user's locale (M35.4): `{{ at | sfDateTime }}` is "30 Sep 2026, 14:05" (or
 * "2:05 PM" for a 12 h locale); `'date'` and `'time'` show one half. Invalid input is an em dash.
 *
 * Impure on purpose: the text follows the active language, which is a signal and not an input.
 */
@Pipe({ name: 'sfDateTime', standalone: true, pure: false })
export class SfDateTimePipe implements PipeTransform {
  private readonly format = inject(I18nFormatService);

  transform(value: Date | string | number | null | undefined, style: DateTimeStyle = 'dateTime'): string {
    return this.format.dateTime(value, style);
  }
}
