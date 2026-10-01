import { Component, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { fireEvent, screen, within } from '@testing-library/angular';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../assets/i18n/en.json';
import { DensityPreference } from '../../core/preferences/preferences.types';
import { DensityService } from '../../core/ui/density.service';
import { Theme, ThemeService } from '../../core/ui/theme.service';
import { StyleguidePageComponent } from './styleguide-page.component';
import { STYLEGUIDE_SECTIONS } from './styleguide.sections';

@Component({ standalone: true, template: '' })
class ElsewhereComponent {}

const texts = en.styleguide.page;
const sectionTitles = STYLEGUIDE_SECTIONS.map((s) => texts.sections[s.key.split('.').pop() as keyof typeof texts.sections]);

/** A controllable IntersectionObserver: the spec reports entries through `trigger`. */
class FakeIntersectionObserver {
  static last: FakeIntersectionObserver | null = null;
  readonly observed: Element[] = [];
  constructor(readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.last = this;
  }
  observe(element: Element): void {
    this.observed.push(element);
  }
  disconnect(): void {}
  trigger(states: Record<string, boolean>): void {
    const entries = Object.entries(states).map(([id, isIntersecting]) => ({
      target: this.observed.find((e) => e.id === id)!,
      isIntersecting,
    }));
    this.callback(entries as unknown as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

describe('StyleguidePageComponent', () => {
  const services = {
    theme: signal<Theme>('light'),
    density: signal<DensityPreference>('compact'),
    setTheme: vi.fn(),
    setDensity: vi.fn(),
  };
  const html = document.documentElement;

  beforeEach(() => {
    services.theme.set('light');
    services.density.set('compact');
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'styleguide', component: StyleguidePageComponent },
          { path: 'styleguide/sample', component: ElsewhereComponent },
        ]),
        { provide: ThemeService, useValue: { theme: services.theme, set: services.setTheme } },
        { provide: DensityService, useValue: { density: services.density, set: services.setDensity } },
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete html.dataset['theme'];
    delete html.dataset['density'];
  });

  async function open(url = '/styleguide') {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, StyleguidePageComponent);
    harness.detectChanges();
    return harness;
  }

  it('renders one h1, an h2 per section in index order, and the index links', async () => {
    await open();

    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent?.trim())).toEqual([texts.title]);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent?.trim())).toEqual(sectionTitles);
    const index = screen.getByRole('navigation', { name: texts.index.label });
    const links = within(index).getAllByRole('link');
    expect(links.map((a) => a.textContent?.trim())).toEqual(sectionTitles);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(STYLEGUIDE_SECTIONS.map((s) => `#${s.id}`));
    for (const section of STYLEGUIDE_SECTIONS) {
      expect(document.getElementById(section.id)?.tagName).toBe('SECTION');
    }
  });

  it('starts from the services and previews the switches on <html> without writing preferences', async () => {
    services.theme.set('dark');
    const harness = await open();
    expect(html.dataset['theme']).toBe('dark');
    expect(html.dataset['density']).toBe('compact');

    const themeSwitch = screen.getByRole('radiogroup', { name: texts.themeSwitch.label });
    fireEvent.click(within(themeSwitch).getByRole('radio', { name: texts.themeSwitch.light }));
    const densitySwitch = screen.getByRole('radiogroup', { name: texts.densitySwitch.label });
    fireEvent.click(within(densitySwitch).getByRole('radio', { name: texts.densitySwitch.comfortable }));
    harness.detectChanges();

    expect(html.dataset['theme']).toBe('light');
    expect(html.dataset['density']).toBe('comfortable');
    expect(within(themeSwitch).getByRole('radio', { name: texts.themeSwitch.light })).toHaveAttribute('aria-checked', 'true');
    expect(services.setTheme).not.toHaveBeenCalled();
    expect(services.setDensity).not.toHaveBeenCalled();
  });

  it('honours ?theme and ?density, and ignores values it does not know', async () => {
    await open('/styleguide?theme=dark&density=comfortable');
    expect(html.dataset['theme']).toBe('dark');
    expect(html.dataset['density']).toBe('comfortable');
  });

  it('falls back to the services for unknown query values', async () => {
    services.density.set('comfortable');
    await open('/styleguide?theme=sepia&density=roomy');
    expect(html.dataset['theme']).toBe('light');
    expect(html.dataset['density']).toBe('comfortable');
  });

  it('puts the services’ values back on <html> when the page is left', async () => {
    const harness = await open('/styleguide?theme=dark&density=comfortable');
    expect(html.dataset['theme']).toBe('dark');

    await harness.navigateByUrl('/styleguide/sample');

    expect(html.dataset['theme']).toBe('light');
    expect(html.dataset['density']).toBe('compact');
  });

  it('marks the current section in the index: on scroll (IntersectionObserver) and on a click', async () => {
    const harness = await open();
    const index = screen.getByRole('navigation', { name: texts.index.label });
    const current = () => within(index).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'location');

    expect(current().map((a) => a.textContent?.trim())).toEqual([texts.sections.colors]);

    const spy = FakeIntersectionObserver.last!;
    expect(spy.observed.map((e) => e.id)).toEqual(STYLEGUIDE_SECTIONS.map((s) => s.id));
    spy.trigger({ 'sg-colors': false, 'sg-forms': true, 'sg-buttons': true });
    harness.detectChanges();
    expect(current().map((a) => a.textContent?.trim())).toEqual([texts.sections.buttons]);

    fireEvent.click(within(index).getByRole('link', { name: texts.sections.data }));
    harness.detectChanges();
    expect(current().map((a) => a.textContent?.trim())).toEqual([texts.sections.data]);
    expect(document.activeElement?.id).toBe('sg-data-title');
  });
});
