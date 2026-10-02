import '@angular/compiler';
import { Component, computed, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, RouterOutlet, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionService } from '../../core/auth/session.service';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { parseFrameLocation } from '../../core/frame/frame-location';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { DensityService } from '../../core/ui/density.service';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { ThemeService } from '../../core/ui/theme.service';
import { BuildNowService } from '../generation/build-now.service';
import { HistoryDrawerStore } from '../history/history-drawer.store';
import { BuildStatusStore } from './build-status.store';
import { useFrameShortcuts } from './frame-shortcuts';

const press = (init: KeyboardEventInit & { key: string }) =>
  document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));

@Component({ standalone: true, template: '' })
class Frame {
  constructor() {
    useFrameShortcuts();
  }
}

function setup(options: { url?: string; dev?: boolean; canBuild?: boolean; building?: boolean } = {}) {
  const location = signal(parseFrameLocation(options.url ?? '/p/acme/pages'));
  const dev = signal(options.dev ?? false);
  const canBuild = signal(options.canBuild ?? true);
  const state = signal(options.building ? 'running' : 'success');
  const buildNow = { start: vi.fn() };
  const history = { toggle: vi.fn() };
  const preferences = { railCollapsed: signal(false), setRailCollapsed: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: FrameContextStore, useValue: { location, projectKey: computed(() => location().projectKey) } },
      { provide: DeveloperModeService, useValue: { enabled: dev, available: signal(true), set: vi.fn() } },
      { provide: ProjectPermissionsStore, useValue: { canIncrementalBuild: canBuild } },
      { provide: PreferencesService, useValue: preferences },
      { provide: HistoryDrawerStore, useValue: history },
      { provide: BuildNowService, useValue: buildNow },
      { provide: BuildStatusStore, useValue: { state } },
      { provide: ThemeService, useValue: { theme: signal('light'), toggle: vi.fn() } },
      { provide: DensityService, useValue: { density: signal('compact'), toggle: vi.fn() } },
      { provide: SessionService, useValue: { signOut: vi.fn() } },
    ],
  });
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(Frame);
  return { fixture, navigate, buildNow, history, preferences, dev, canBuild, location, shortcuts: TestBed.inject(ShortcutService) };
}

describe('frame shortcuts', () => {
  afterEach(() => vi.restoreAllMocks());

  it('opens the palette and the sheet', () => {
    const { shortcuts } = setup();
    press({ key: 'k', ctrlKey: true });
    expect(shortcuts.commandPaletteOpen()).toBe(true);
    press({ key: '?', shiftKey: true });
    expect(shortcuts.shortcutSheetOpen()).toBe(true);
  });

  it('goes to a screen with a g chord, and to the settings with g and a comma', () => {
    const { navigate } = setup();
    press({ key: 'g' });
    press({ key: 'p' });
    expect(navigate).toHaveBeenLastCalledWith(['/p', 'acme', 'pages']);
    press({ key: 'g' });
    press({ key: 'h' });
    expect(navigate).toHaveBeenLastCalledWith(['/p', 'acme']);
    press({ key: 'g' });
    press({ key: ',' });
    expect(navigate).toHaveBeenLastCalledWith(['/p', 'acme', 'settings']);
  });

  it('offers Templates only in developer mode, and no chords outside a project', () => {
    const { navigate, dev, location } = setup();
    press({ key: 'g' });
    press({ key: 't' });
    expect(navigate).not.toHaveBeenCalled();
    dev.set(true);
    press({ key: 'g' });
    press({ key: 't' });
    expect(navigate).toHaveBeenCalledWith(['/p', 'acme', 'templates']);
    navigate.mockClear();
    location.set(parseFrameLocation('/'));
    press({ key: 'g' });
    press({ key: 'p' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('toggles the sidebar with [ and the history with Alt+H', () => {
    const { preferences, history } = setup();
    press({ key: '[' });
    expect(preferences.setRailCollapsed).toHaveBeenCalledWith(true);
    press({ key: 'h', code: 'KeyH', altKey: true });
    expect(history.toggle).toHaveBeenCalledTimes(1);
  });

  it('starts a build with Alt+Shift+B only for whoever may build, and not while one runs', () => {
    const { buildNow, canBuild, shortcuts } = setup();
    press({ key: 'B', code: 'KeyB', altKey: true, shiftKey: true });
    expect(buildNow.start).toHaveBeenCalledWith('acme', 'Build now');
    expect(shortcuts.actions().map((c) => c.id)).toContain('build');

    buildNow.start.mockClear();
    canBuild.set(false);
    press({ key: 'B', code: 'KeyB', altKey: true, shiftKey: true });
    expect(buildNow.start).not.toHaveBeenCalled();
    expect(shortcuts.actions().map((c) => c.id)).not.toContain('build');
  });

  it('keeps Build now away while a build runs', () => {
    const { buildNow } = setup({ building: true });
    press({ key: 'B', code: 'KeyB', altKey: true, shiftKey: true });
    expect(buildNow.start).not.toHaveBeenCalled();
  });

  it('offers the palette-only actions, and takes everything back with the frame', () => {
    const { shortcuts, fixture } = setup();
    expect(shortcuts.actions().map((c) => c.id)).toEqual(expect.arrayContaining(['theme', 'density', 'developer', 'switchProject', 'signOut', 'history']));
    fixture.destroy();
    expect(shortcuts.commands()).toEqual([]);
  });
});

describe('screen shortcuts follow the route', () => {
  it('are on while their screen is open and off after navigating away', async () => {
    const run = vi.fn();
    @Component({ selector: 'x-pages', standalone: true, template: '' })
    class Pages {
      constructor() {
        inject(ShortcutService).use([
          { id: 'create', keys: 'n', scope: 'screen', group: 'screen', description: 'frame.shortcuts.items.create', handler: run },
        ]);
      }
    }
    @Component({ selector: 'x-media', standalone: true, template: '' })
    class Media {}
    @Component({ standalone: true, imports: [RouterOutlet], template: '<router-outlet />' })
    class Root {}
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'pages', component: Pages }, { path: 'media', component: Media }])],
    });
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(Root);
    await router.navigateByUrl('/pages');
    fixture.detectChanges();
    press({ key: 'n' });
    expect(run).toHaveBeenCalledTimes(1);

    await router.navigateByUrl('/media');
    fixture.detectChanges();
    press({ key: 'n' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(TestBed.inject(ShortcutService).commands()).toEqual([]);
  });
});
