import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesService } from '../preferences/preferences.service';
import { CodePaletteService } from './code-palette.service';

const root = document.documentElement;

function setup(): { prefs: PreferencesService; http: HttpTestingController } {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  return { prefs: TestBed.inject(PreferencesService), http: TestBed.inject(HttpTestingController) };
}

describe('CodePaletteService', () => {
  beforeEach(() => {
    delete root.dataset['codePalette'];
    localStorage.clear();
  });
  afterEach(() => {
    delete root.dataset['codePalette'];
  });

  it('defaults to the current palette and sets no attribute', () => {
    setup();
    const service = TestBed.inject(CodePaletteService);
    expect(service.palette()).toBe('current');
    expect(root.dataset['codePalette']).toBeUndefined();
  });

  it('switches at runtime, writes through PreferencesService and sets / removes data-code-palette', () => {
    const { prefs } = setup();
    const service = TestBed.inject(CodePaletteService);
    service.set('refined');
    expect(prefs.codePalette()).toBe('refined');
    expect(root.dataset['codePalette']).toBe('refined');
    service.set('current');
    expect(prefs.codePalette()).toBe('current');
    expect(root.dataset['codePalette']).toBeUndefined();
  });

  it('persists through a debounced preferences patch, not localStorage', () => {
    vi.useFakeTimers();
    try {
      const { http } = setup();
      const setItem = vi.spyOn(Storage.prototype, 'setItem');
      TestBed.inject(CodePaletteService).set('refined');
      vi.advanceTimersByTime(600);
      const req = http.expectOne('/api/v1/me/preferences');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ codePalette: 'refined' });
      expect(setItem).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies the stored palette when the preferences load', () => {
    const { prefs, http } = setup();
    const service = TestBed.inject(CodePaletteService);
    prefs.load();
    http.expectOne('/api/v1/me/preferences').flush({ schemaVersion: 1, codePalette: 'refined' });
    TestBed.flushEffects();
    expect(service.palette()).toBe('refined');
    expect(root.dataset['codePalette']).toBe('refined');
  });
});
