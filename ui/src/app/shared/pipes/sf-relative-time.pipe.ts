import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nFormatService, toDate } from '../../core/i18n/i18n-format.service';

/**
 * "5 min ago" / "3 h from now" style relative time, worded by the active language (`common.time.*` in `en.json`).
 * Invalid input is an em dash. Impure because the wording follows the language, which is a signal and not an input.
 */
@Pipe({
  name: 'sfRelativeTime',
  standalone: true,
  pure: false,
})
export class SfRelativeTimePipe implements PipeTransform {
  private readonly format = inject(I18nFormatService);

  transform(
    value: Date | string | number | null | undefined,
    now: Date = new Date(),
  ): string {
    return formatRelativeTime(this.format, value, now);
  }
}

/**
 * The relative wording of `value` seen from `now` (shared by the pipe and `sf-relative-time`); an em dash for invalid
 * input. Reads the language signal, so a `computed` calling it follows language switches.
 */
export function formatRelativeTime(
  format: I18nFormatService,
  value: Date | string | number | null | undefined,
  now: Date,
): string {
  format.lang(); // re-render when the language changes
  const date = toDate(value);
  if (!date) {
    return '—';
  }

  const diffMs = date.getTime() - now.getTime();
  const absSeconds = Math.round(Math.abs(diffMs) / 1000);
  const direction = diffMs < 0 ? 'ago' : 'fromNow';

  if (absSeconds < 60) {
    return format.translate('common.time.justNow');
  }
  const minutes = Math.round(absSeconds / 60);
  if (minutes < 60) {
    return format.translate(`common.time.${direction}.minute`, { n: minutes });
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return format.translate(`common.time.${direction}.hour`, { n: hours });
  }
  const days = Math.round(hours / 24);
  if (days < 30) {
    return format.translate(`common.time.${direction}.day`, { n: days });
  }
  const months = Math.round(days / 30);
  if (months < 12) {
    return format.translate(`common.time.${direction}.month`, { n: months });
  }
  const years = Math.round(months / 12);
  return format.translate(`common.time.${direction}.year`, { n: years });
}
