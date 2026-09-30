import { Injectable, InjectionToken, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';

/** `auto` follows the locale's own clock (12 h in en-US, 24 h in en-GB); `h12` / `h23` force one. */
export type HourCycle = 'auto' | 'h12' | 'h23';

/** The user's 12 h / 24 h choice. Stays `auto` until a preference feeds it. */
export const SF_HOUR_CYCLE = new InjectionToken<() => HourCycle>('SF_HOUR_CYCLE', {
  providedIn: 'root',
  factory: () => () => 'auto',
});

/** The browser's locale, used for regional formats (date order, separators, clock) of the active language. */
export const SF_BROWSER_LOCALE = new InjectionToken<string | null>('SF_BROWSER_LOCALE', {
  providedIn: 'root',
  factory: () => (typeof navigator === 'undefined' ? null : (navigator.language ?? null)),
});

export type DateTimeStyle = 'dateTime' | 'date' | 'time';

/**
 * Dates, times and numbers in the active UI language (M35.4). One place decides the locale, so the pipes and any
 * TypeScript formatting agree: the language's own locale, refined by the browser's region when the browser speaks the
 * same language (`en` + browser `en-GB` gives `en-GB`, so a UK user sees 24 h and day-first dates).
 */
@Injectable({ providedIn: 'root' })
export class I18nFormatService {
  private readonly transloco = inject(TranslocoService);
  private readonly browserLocale = inject(SF_BROWSER_LOCALE);
  private readonly hourCycle = inject(SF_HOUR_CYCLE);

  /** The active UI language; reading it in a template or `computed` tracks language switches. */
  readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  /** The BCP 47 locale all formatting uses. */
  readonly locale = computed(() => {
    const lang = this.lang();
    const browser = this.browserLocale;
    return browser && browser.split('-')[0].toLowerCase() === lang.toLowerCase() ? browser : lang;
  });

  dateTime(value: Date | string | number | null | undefined, style: DateTimeStyle = 'dateTime'): string {
    const date = toDate(value);
    if (!date) {
      return '—';
    }
    const options: Intl.DateTimeFormatOptions = {};
    if (style !== 'time') {
      Object.assign(options, { year: 'numeric', month: 'short', day: 'numeric' });
    }
    if (style !== 'date') {
      Object.assign(options, { hour: '2-digit', minute: '2-digit' });
      const cycle = this.hourCycle();
      if (cycle !== 'auto') {
        options.hourCycle = cycle;
      }
    }
    return new Intl.DateTimeFormat(this.locale(), options).format(date);
  }

  number(value: number | null | undefined, options?: Intl.NumberFormatOptions): string {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return '—';
    }
    return new Intl.NumberFormat(this.locale(), options).format(value);
  }

  /** `key` in the active language with messageformat `params` (plurals, selects, interpolation). */
  translate(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(key, params);
  }
}

/** A valid date for a `Date`, ISO string or epoch millis; `null` for anything else. */
export function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
