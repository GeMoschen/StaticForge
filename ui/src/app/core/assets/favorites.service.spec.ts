import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { FrameContextStore } from '../frame/frame-context.store';
import { PreferencesService } from '../preferences/preferences.service';
import type { AssetRef } from './asset-ref';
import { FavoritesService } from './favorites.service';

const asset = (uuid: string, type = 'PAGE', displayName = 'Item'): AssetRef => ({ type, uuid, displayName, folderPath: '/x_root/' });

function setup() {
  const projectKey = signal<string | null>('acme');
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), { provide: FrameContextStore, useValue: { projectKey: computed(() => projectKey()) } }],
  });
  return { favorites: TestBed.inject(FavoritesService), prefs: TestBed.inject(PreferencesService), projectKey };
}

describe('FavoritesService', () => {
  beforeEach(() => localStorage.clear());

  it('stars and unstars an asset and reports the new state', () => {
    const { favorites } = setup();
    expect(favorites.isFavorite('a')).toBe(false);
    expect(favorites.toggle(asset('a'))).toBe(true);
    expect(favorites.isFavorite('a')).toBe(true);
    expect(favorites.toggle(asset('a'))).toBe(false);
    expect(favorites.isFavorite('a')).toBe(false);
  });

  it('is not tied to a store: pages, records, media and folders share one list in the order they were starred', () => {
    const { favorites } = setup();
    favorites.toggle(asset('p', 'PAGE', 'A page'));
    favorites.toggle(asset('f', 'FOLDER', 'A folder'));
    favorites.toggle(asset('m', 'MEDIA', 'A file'));
    favorites.toggle(asset('r', 'RECORD', 'A record'));
    expect(favorites.list().map((e) => [e.kind, e.title])).toEqual([
      ['PAGE', 'A page'],
      ['FOLDER', 'A folder'],
      ['MEDIA', 'A file'],
      ['RECORD', 'A record'],
    ]);
    favorites.remove('f');
    expect(favorites.list().map((e) => e.uuid)).toEqual(['p', 'm', 'r']);
  });

  it('is kept per project in the preferences document, with the folder path a folder needs to route', () => {
    const { favorites, prefs, projectKey } = setup();
    favorites.toggle(asset('f', 'FOLDER', 'News'));
    expect(prefs.favorites('acme')).toEqual([{ kind: 'FOLDER', uuid: 'f', title: 'News', folderPath: '/x_root/' }]);
    projectKey.set('other');
    expect(favorites.list()).toEqual([]);
    expect(favorites.toggle(asset('f'))).toBe(true);
    expect(prefs.favorites('acme')).toHaveLength(1);
    expect(prefs.favorites('other')).toHaveLength(1);
  });

  it('does nothing outside a project', () => {
    const { favorites, projectKey } = setup();
    projectKey.set(null);
    expect(favorites.toggle(asset('a'))).toBe(false);
    expect(favorites.list()).toEqual([]);
  });
});
