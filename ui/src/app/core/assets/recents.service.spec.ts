import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameContextStore } from '../frame/frame-context.store';
import { PreferencesService } from '../preferences/preferences.service';
import { RECENTS_CAP } from '../preferences/preferences.types';
import type { AssetRef } from './asset-ref';
import { FavoritesService } from './favorites.service';
import { RecentsService } from './recents.service';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const C = '33333333-3333-3333-3333-333333333333';
const page = (uuid: string, displayName = 'Page'): AssetRef => ({ type: 'PAGE', uuid, displayName, folderPath: '/pages_root/' });

function setup() {
  const projectKey = signal<string | null>('acme');
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: FrameContextStore, useValue: { projectKey: computed(() => projectKey()) } },
    ],
  });
  return {
    recents: TestBed.inject(RecentsService),
    favorites: TestBed.inject(FavoritesService),
    prefs: TestBed.inject(PreferencesService),
    http: TestBed.inject(HttpTestingController),
    projectKey,
  };
}

const detail = (uuid: string) => `/api/v1/projects/acme/assets/${uuid}`;

describe('RecentsService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('records a visit newest first, moves a repeat to the front and caps the list', () => {
    const { recents } = setup();
    recents.visit('acme', page(A, 'One'));
    recents.visit('acme', page(B, 'Two'));
    recents.visit('acme', page(A, 'One again'));
    expect(recents.list().map((e) => [e.uuid, e.title])).toEqual([
      [A, 'One again'],
      [B, 'Two'],
    ]);
    for (let i = 0; i < RECENTS_CAP + 5; i++) {
      recents.visit('acme', page(`00000000-0000-0000-0000-${String(i).padStart(12, '0')}`));
    }
    expect(recents.list()).toHaveLength(RECENTS_CAP);
  });

  it('keeps recents per project and survives in the preferences document', () => {
    const { recents, prefs, projectKey } = setup();
    recents.visit('acme', page(A));
    recents.visit('other', page(B));
    expect(prefs.recents('acme').map((e) => e.uuid)).toEqual([A]);
    projectKey.set('other');
    expect(recents.list().map((e) => e.uuid)).toEqual([B]);
  });

  it('resolves an opened asset and records it with its type, name and place', () => {
    const { recents, http } = setup();
    recents.visitByUuid('acme', A);
    http.expectOne(detail(A)).flush({ uuid: A, type: 'RECORD', displayName: 'Yirgacheffe', folderPath: '/content_root/shop/' });
    expect(recents.list()[0]).toMatchObject({ kind: 'RECORD', uuid: A, title: 'Yirgacheffe', folderPath: '/content_root/shop/' });
  });

  it('drops an opened asset that no longer exists from both lists', () => {
    const { recents, favorites, http } = setup();
    recents.visit('acme', page(A));
    favorites.toggle(page(A));
    recents.visitByUuid('acme', A);
    http.expectOne(detail(A)).flush(null, { status: 404, statusText: 'Not Found' });
    expect(recents.list()).toEqual([]);
    expect(favorites.list()).toEqual([]);
  });

  describe('verify', () => {
    it('removes deleted assets from recents and favorites and refreshes renamed ones', () => {
      const { recents, favorites, http } = setup();
      recents.visit('acme', page(A, 'Old name'));
      recents.visit('acme', page(B, 'Gone'));
      favorites.toggle(page(A, 'Old name'));
      favorites.toggle(page(C, 'Also gone'));

      recents.verify('acme', true).subscribe();
      http.expectOne(detail(A)).flush({ uuid: A, type: 'PAGE', displayName: 'New name', folderPath: '/pages_root/news/' });
      http.expectOne(detail(B)).flush(null, { status: 404, statusText: 'Not Found' });
      http.expectOne(detail(C)).flush({ uuid: C, type: 'PAGE', deleted: true });

      expect(recents.list().map((e) => [e.uuid, e.title, e.folderPath])).toEqual([[A, 'New name', '/pages_root/news/']]);
      expect(favorites.list().map((e) => [e.uuid, e.title])).toEqual([[A, 'New name']]);
    });

    it('leaves the lists alone when the server cannot say (offline, an error)', () => {
      const { recents, http } = setup();
      recents.visit('acme', page(A, 'Kept'));
      recents.verify('acme', true).subscribe();
      http.expectOne(detail(A)).flush(null, { status: 500, statusText: 'Server Error' });
      expect(recents.list().map((e) => e.title)).toEqual(['Kept']);
    });

    it('checks a project at most every half minute unless forced', () => {
      const { recents, http } = setup();
      recents.visit('acme', page(A));
      recents.verify('acme').subscribe();
      http.expectOne(detail(A)).flush({ uuid: A, type: 'PAGE', displayName: 'Page' });
      recents.verify('acme').subscribe();
      http.expectNone(detail(A));
      vi.advanceTimersByTime(31_000);
      recents.verify('acme').subscribe();
      http.expectOne(detail(A)).flush({ uuid: A, type: 'PAGE', displayName: 'Page' });
    });

    it('asks only once for an asset that is both a recent and a favorite', () => {
      const { recents, favorites, http } = setup();
      recents.visit('acme', page(A));
      favorites.toggle(page(A));
      recents.verify('acme', true).subscribe();
      http.expectOne(detail(A)).flush({ uuid: A, type: 'PAGE', displayName: 'Page' });
    });
  });
});
