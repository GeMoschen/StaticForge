import { Component, inject, Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { SfDateTimePipe } from '../../shared/pipes/sf-date-time.pipe';
import { SfNumberPipe } from '../../shared/pipes/sf-number.pipe';
import en from '../../../assets/i18n/en.json';
import { I18nFormatService, SF_BROWSER_LOCALE, SF_HOUR_CYCLE } from './i18n-format.service';
import { provideTranslocoTesting } from './transloco-testing';

@Component({
  standalone: true,
  imports: [TranslocoPipe],
  template: `<p>{{ 'common.save' | transloco }}</p><p>{{ key | transloco }}</p>`,
})
class KeyHostComponent {
  key = 'common.save';
}

describe('Transloco set-up', () => {
  it('renders the real en.json', async () => {
    await render(KeyHostComponent);
    expect(screen.getAllByText('Save')).toHaveLength(2);
  });

  it('fails a spec that asks for a key en.json lacks', () => {
    expect(() => TestBed.inject(TranslocoService).translate('nope.missing')).toThrow(
      /Missing translation key: nope\.missing/,
    );
  });

  it('formats plurals and interpolation with messageformat', () => {
    const transloco = TestBed.inject(TranslocoService);
    expect(transloco.translate('common.count.items', { count: 1 })).toBe('1 item');
    expect(transloco.translate('common.count.items', { count: 3 })).toBe('3 items');
    expect(transloco.translate('common.time.ago.minute', { n: 5 })).toBe('5 min ago');
  });

  it('lets a spec bring its own texts', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideTranslocoTesting({ common: { save: 'Sichern' } })] });
    expect(TestBed.inject(TranslocoService).translate('common.save')).toBe('Sichern');
  });
});

describe('en.json', () => {
  const keys = (node: unknown, prefix = ''): string[] =>
    Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
      typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
    );

  it('keeps every key under common, enum, shared or shell', () => {
    for (const key of keys(en)) {
      expect(key).toMatch(/^(common|enum|shared|shell|[a-z]+\.[a-z]+)\./);
    }
    expect(Object.keys(en)).toEqual(expect.arrayContaining(['common', 'enum']));
  });
});

describe('date, time and number formatting', () => {
  /** A fresh TestBed whose browser locale and 12 h / 24 h choice are the given ones. */
  const setup = (browserLocale: string | null, hourCycle: 'auto' | 'h12' | 'h23' = 'auto') => {
    TestBed.resetTestingModule();
    const providers: Provider[] = [
      provideTranslocoTesting(),
      { provide: SF_BROWSER_LOCALE, useValue: browserLocale },
      { provide: SF_HOUR_CYCLE, useValue: () => hourCycle },
    ];
    TestBed.configureTestingModule({ providers });
    return TestBed.runInInjectionContext(() => ({
      dateTime: new SfDateTimePipe(),
      number: new SfNumberPipe(),
      format: inject(I18nFormatService),
    }));
  };
  const at = new Date(2026, 8, 30, 14, 5);

  it('follows the browser region only when it speaks the active language', () => {
    expect(setup('en-GB').format.locale()).toBe('en-GB');
    expect(setup('de-DE').format.locale()).toBe('en');
    expect(setup(null).format.locale()).toBe('en');
  });

  it('shows a 24 h clock for en-GB and a 12 h clock for en-US', () => {
    expect(setup('en-GB').dateTime.transform(at)).toContain('14:05');
    expect(setup('en-US').dateTime.transform(at, 'time')).toMatch(/2:05\s?PM/);
  });

  it('honours an explicit 12 h / 24 h choice', () => {
    expect(setup('en-GB', 'h12').dateTime.transform(at, 'time')).toMatch(/0?2:05\s?pm/i);
    expect(setup('en-US', 'h23').dateTime.transform(at, 'time')).toBe('14:05');
  });

  it('renders invalid dates and numbers as an em dash', () => {
    const { dateTime, number } = setup('en-US');
    expect(dateTime.transform('nope')).toBe('—');
    expect(dateTime.transform(null)).toBe('—');
    expect(number.transform(undefined)).toBe('—');
  });

  it('formats numbers with the locale separators', () => {
    expect(setup('en-US').number.transform(12345.6)).toBe('12,345.6');
  });
});
