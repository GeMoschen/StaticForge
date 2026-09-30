import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesService } from '../preferences/preferences.service';
import { DensityService } from './density.service';
import { ThemeService } from './theme.service';

/** A controllable `window.matchMedia` for `(prefers-color-scheme: dark)`. */
class FakeMedia {
  matches: boolean;
  private listeners = new Set<(e: MediaQueryListEvent) => void>();
  constructor(initial: boolean) {
    this.matches = initial;
  }
  addEventListener(_: string, fn: (e: MediaQueryListEvent) => void): void {
    this.listeners.add(fn);
  }
  removeEventListener(_: string, fn: (e: MediaQueryListEvent) => void): void {
    this.listeners.delete(fn);
  }
  get listenerCount(): number {
    return this.listeners.size;
  }
  change(matches: boolean): void {
    this.matches = matches;
    this.listeners.forEach((fn) => fn({ matches } as MediaQueryListEvent));
  }
}

function setup(systemDark = false): { media: FakeMedia; prefs: PreferencesService; http: HttpTestingController } {
  const media = new FakeMedia(systemDark);
  vi.stubGlobal('matchMedia', () => media);
  window.matchMedia = (() => media) as unknown as typeof window.matchMedia;
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  return { media, prefs: TestBed.inject(PreferencesService), http: TestBed.inject(HttpTestingController) };
}

const root = document.documentElement;

describe('ThemeService', () => {
  beforeEach(() => {
    root.removeAttribute('data-theme');
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies the system theme synchronously, before any preference has loaded', () => {
    setup(true);
    const theme = TestBed.inject(ThemeService);
    expect(theme.preference()).toBe('system');
    expect(theme.theme()).toBe('dark');
    expect(root.dataset['theme']).toBe('dark');
  });

  it('follows prefers-color-scheme live while the preference is system', () => {
    const { media } = setup(false);
    const theme = TestBed.inject(ThemeService);
    expect(root.dataset['theme']).toBe('light');
    media.change(true);
    expect(theme.theme()).toBe('dark');
    expect(root.dataset['theme']).toBe('dark');
    media.change(false);
    expect(root.dataset['theme']).toBe('light');
  });

  it('ignores the system once an explicit theme is chosen', () => {
    const { media, prefs } = setup(false);
    const theme = TestBed.inject(ThemeService);
    theme.set('dark');
    expect(prefs.theme()).toBe('dark');
    expect(root.dataset['theme']).toBe('dark');
    media.change(false);
    media.change(true);
    media.change(false);
    expect(root.dataset['theme']).toBe('dark');
    theme.set('system');
    expect(root.dataset['theme']).toBe('light');
  });

  it('persists through PreferencesService (server patch) and never touches localStorage', () => {
    vi.useFakeTimers();
    try {
      const { http } = setup(false);
      const setItem = vi.spyOn(Storage.prototype, 'setItem');
      TestBed.inject(ThemeService).set('dark');
      vi.advanceTimersByTime(600);
      const req = http.expectOne('/api/v1/me/preferences');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ theme: 'dark' });
      expect(setItem).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies a preference that arrives from the server after start-up', () => {
    const { prefs, http } = setup(false);
    const theme = TestBed.inject(ThemeService);
    expect(root.dataset['theme']).toBe('light');
    prefs.load();
    http.expectOne('/api/v1/me/preferences').flush({ schemaVersion: 1, theme: 'dark' });
    TestBed.flushEffects();
    expect(theme.theme()).toBe('dark');
    expect(root.dataset['theme']).toBe('dark');
  });

  it('toggle() flips the shown theme to an explicit choice', () => {
    const { prefs } = setup(true);
    const theme = TestBed.inject(ThemeService);
    expect(theme.toggle()).toBe('light');
    expect(prefs.theme()).toBe('light');
    expect(theme.toggle()).toBe('dark');
  });

  it('stops listening to the system when destroyed', () => {
    const { media } = setup(false);
    TestBed.inject(ThemeService);
    expect(media.listenerCount).toBe(1);
    TestBed.resetTestingModule();
    expect(media.listenerCount).toBe(0);
  });

  it('works without matchMedia', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const original = window.matchMedia;
    (window as unknown as { matchMedia: unknown }).matchMedia = undefined;
    try {
      expect(TestBed.inject(ThemeService).theme()).toBe('light');
    } finally {
      window.matchMedia = original;
    }
  });
});

describe('DensityService', () => {
  beforeEach(() => {
    root.removeAttribute('data-density');
    localStorage.clear();
  });

  it('defaults to compact, applied synchronously', () => {
    setup();
    const density = TestBed.inject(DensityService);
    expect(density.density()).toBe('compact');
    expect(root.dataset['density']).toBe('compact');
  });

  it('switches at runtime and writes through PreferencesService', () => {
    const { prefs } = setup();
    const density = TestBed.inject(DensityService);
    density.set('comfortable');
    expect(prefs.density()).toBe('comfortable');
    expect(root.dataset['density']).toBe('comfortable');
    expect(density.toggle()).toBe('compact');
    expect(root.dataset['density']).toBe('compact');
  });

  it('persists through a debounced preferences patch, not localStorage', () => {
    vi.useFakeTimers();
    try {
      const { http } = setup();
      const setItem = vi.spyOn(Storage.prototype, 'setItem');
      TestBed.inject(DensityService).set('comfortable');
      vi.advanceTimersByTime(600);
      expect(http.expectOne('/api/v1/me/preferences').request.body).toEqual({ density: 'comfortable' });
      expect(setItem).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies the stored density when the preferences load', () => {
    const { prefs, http } = setup();
    const density = TestBed.inject(DensityService);
    prefs.load();
    http.expectOne('/api/v1/me/preferences').flush({ schemaVersion: 1, density: 'comfortable' });
    TestBed.flushEffects();
    expect(density.density()).toBe('comfortable');
    expect(root.dataset['density']).toBe('comfortable');
  });
});
