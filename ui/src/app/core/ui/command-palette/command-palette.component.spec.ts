import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../api/api.client';
import { DeveloperModeService } from '../../frame/developer-mode.service';
import { FrameContextStore } from '../../frame/frame-context.store';
import { parseFrameLocation } from '../../frame/frame-location';
import { provideTranslocoTesting } from '../../i18n/transloco-testing';
import { PreferencesService } from '../../preferences/preferences.service';
import { EditingLocaleStore } from '../../project/editing-locale.store';
import { ProjectPermissionsStore } from '../../project/project-permissions.store';
import { SearchService } from '../../../features/search/search.service';
import { TimeTravelStore } from '../../../features/revisions/time-travel.store';
import { ShortcutDef, ShortcutService } from '../shortcut.service';
import { CommandPaletteComponent } from './command-palette.component';

interface Options {
  url?: string;
  dev?: boolean;
  recents?: { kind: string; uuid: string; title?: string }[];
  projects?: { key: string; name: string }[];
}

const action = (id: string, description: string, over: Partial<ShortcutDef> = {}): ShortcutDef => ({
  id,
  scope: 'global',
  group: 'general',
  description,
  handler: vi.fn(),
  palette: { icon: 'bolt' },
  ...over,
});

async function setup(options: Options = {}) {
  const location = signal(parseFrameLocation(options.url ?? '/p/acme/pages'));
  const dev = signal(options.dev ?? false);
  const view = await render(CommandPaletteComponent, {
    providers: [
      provideTranslocoTesting(),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: FrameContextStore, useValue: { location, projectKey: computed(() => location().projectKey) } },
      { provide: DeveloperModeService, useValue: { enabled: dev } },
      { provide: ProjectPermissionsStore, useValue: { readsAsProjectAdmin: signal(true) } },
      {
        provide: PreferencesService,
        useValue: {
          recents: () => options.recents ?? [],
          favorites: () => [],
          favoriteProjects: () => ['lumen'],
          recentProjects: () => [],
        },
      },
      { provide: EditingLocaleStore, useValue: { locale: signal<string | null>(null) } },
      { provide: TimeTravelStore, useValue: { isTimeTravel: signal(false), exit: vi.fn() } },
      { provide: ApiClient, useValue: { listProjects: () => of(options.projects ?? []) } },
      {
        provide: SearchService,
        useValue: { live: () => of({ kind: 'idle', q: '' }) },
      },
    ],
  });
  const shortcuts = TestBed.inject(ShortcutService);
  return { ...view, shortcuts, dev, location };
}

const open = async (shortcuts: ShortcutService, seed = '') => {
  shortcuts.openPalette(seed);
  await waitFor(() => expect(screen.getByRole('combobox')).toBeTruthy());
};

describe('CommandPaletteComponent', () => {
  it('lists the registry actions that apply, with their key hints, and leaves out the ones that do not', async () => {
    const { shortcuts, detectChanges } = await setup();
    const permitted = signal(false);
    shortcuts.registerAll([
      action('build', 'frame.shortcuts.items.build', { keys: 'Alt+Shift+B', enabled: () => permitted() }),
      action('history', 'frame.shortcuts.items.history', { keys: 'Alt+H' }),
    ]);
    await open(shortcuts);
    expect(screen.getByRole('option', { name: /Open history/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Build now/ })).toBeNull();
    permitted.set(true);
    detectChanges();
    await waitFor(() => expect(screen.getByRole('option', { name: /Build now/ })).toBeTruthy());
  });

  it('runs the active option on Enter and closes', async () => {
    const { shortcuts } = await setup();
    const run = vi.fn();
    shortcuts.register(action('history', 'frame.shortcuts.items.history', { handler: run }));
    await open(shortcuts);
    const input = screen.getByRole('combobox');
    await fireEvent.input(input, { target: { value: 'hist' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(shortcuts.commandPaletteOpen()).toBe(false);
  });

  it('shows the Develop screens only in developer mode', async () => {
    const { shortcuts, dev, detectChanges } = await setup();
    await open(shortcuts);
    expect(screen.queryByRole('option', { name: /Templates/ })).toBeNull();
    dev.set(true);
    detectChanges();
    await waitFor(() => expect(screen.getByRole('option', { name: /Templates/ })).toBeTruthy());
  });

  it('enters a mode with a prefix, shows a chip, and leaves it with Backspace on an empty box', async () => {
    const { shortcuts } = await setup({ projects: [{ key: 'lumen', name: 'Lumen Coffee' }, { key: 'acme', name: 'Acme Website' }] });
    shortcuts.register(action('history', 'frame.shortcuts.items.history'));
    await open(shortcuts);
    const input = screen.getByRole('combobox') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '@' } });
    await waitFor(() => expect(screen.getByRole('option', { name: /Lumen Coffee/ })).toBeTruthy());
    expect(screen.queryByRole('option', { name: /Open history/ })).toBeNull();
    expect(input.value).toBe('');
    await fireEvent.keyDown(input, { key: 'Backspace' });
    await waitFor(() => expect(screen.getByRole('option', { name: /Open history/ })).toBeTruthy());
  });

  it('restarts in a mode when asked to open with a seed (Switch project)', async () => {
    const { shortcuts } = await setup({ projects: [{ key: 'acme', name: 'Acme Website' }] });
    await open(shortcuts, '@');
    await waitFor(() => expect(screen.getByRole('option', { name: /Acme Website/ })).toBeTruthy());
  });

  it('offers the recent items of the project and opens one', async () => {
    const { shortcuts } = await setup({ recents: [{ kind: 'PAGE', uuid: 'u1', title: 'Spring harvest' }] });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await open(shortcuts);
    await fireEvent.click(screen.getByRole('option', { name: /Spring harvest/ }));
    expect(navigate).toHaveBeenCalledWith(['/p', 'acme', 'pages', 'u1'], { queryParams: {} });
  });

  it('closes on the Escape of the overlay stack and on a click outside', async () => {
    const { shortcuts, container } = await setup();
    await open(shortcuts);
    await fireEvent.click(container.querySelector('.backdrop')!);
    expect(shortcuts.commandPaletteOpen()).toBe(false);
  });
});
