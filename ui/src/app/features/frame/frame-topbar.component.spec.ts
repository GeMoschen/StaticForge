import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { AuthStore } from '../../core/auth/auth.store';
import { SessionService } from '../../core/auth/session.service';
import type { FrameItem } from '../../core/frame/breadcrumb.util';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { parseFrameLocation } from '../../core/frame/frame-location';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { BuildNowService } from '../generation/build-now.service';
import { BuildStatusStore } from './build-status.store';
import { FrameTopbarComponent } from './frame-topbar.component';

/** A second render in one test: a reset module has to bring its own translations. */
function restart(): void {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: provideTranslocoTesting() });
}

interface Options {
  url?: string;
  systemRole?: string;
  projectRoles?: Record<string, string>;
  locales?: string[];
  item?: FrameItem | null;
  canBuild?: boolean;
}

async function setup(options: Options = {}) {
  const location = signal(parseFrameLocation(options.url ?? '/p/acme/pages/p1'));
  const locales = signal((options.locales ?? []).map((code) => ({ code, label: code.toUpperCase() })));
  const editingLocale = { locale: signal(options.locales?.[0] ?? null), set: vi.fn() };
  const buildNow = { start: vi.fn() };
  const signOut = vi.fn();
  const view = await render(FrameTopbarComponent, {
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      {
        provide: FrameContextStore,
        useValue: {
          location,
          projectKey: computed(() => location().projectKey),
          projectName: signal('Acme Website'),
          item: signal(options.item ?? null),
        },
      },
      { provide: LocalesStore, useValue: { locales } },
      { provide: EditingLocaleStore, useValue: editingLocale },
      { provide: SessionService, useValue: { signOut } },
      { provide: BuildNowService, useValue: buildNow },
      { provide: BuildStatusStore, useValue: { state: signal('success'), runs: signal([]), latest: signal(null) } },
      { provide: ProjectPermissionsStore, useValue: { canIncrementalBuild: signal(options.canBuild ?? true) } },
    ],
    configureTestBed: (tb) => {
      tb.inject(AuthStore).setUser({
        id: 1,
        username: 'ada',
        displayName: 'Ada Lovelace',
        systemRole: options.systemRole ?? 'USER',
        projectRoles: options.projectRoles ?? { acme: 'EDITOR' },
      });
    },
  });
  return { ...view, editingLocale, buildNow, signOut, location };
}

describe('FrameTopbarComponent', () => {
  it('is the page header: mark, project, breadcrumb, search, history and the menus', async () => {
    await setup({ item: { label: 'Our story' } });
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'StaticForge home' }).getAttribute('href')).toBe('/');
    expect(screen.getByText('Acme Website')).toBeTruthy();
    const crumbs = screen.getByRole('navigation', { name: 'Location' });
    expect(crumbs.textContent).toContain('Pages');
    expect(crumbs.querySelector('[aria-current="page"]')?.textContent).toContain('Our story');
    expect(screen.getByRole('link', { name: 'Project history' }).getAttribute('href')).toBe('/p/acme/settings/revisions');
    expect(screen.getByRole('button', { name: 'Search or jump to…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keyboard shortcuts' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Account menu for Ada Lovelace' })).toBeTruthy();
  });

  it('opens the palette from the search button and the shortcut sheet from the ? button', async () => {
    await setup();
    const shortcuts = TestBed.inject(ShortcutService);
    fireEvent.click(screen.getByRole('button', { name: 'Search or jump to…' }));
    expect(shortcuts.commandPaletteOpen()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(shortcuts.shortcutSheetOpen()).toBe(true);
  });

  it('shows the editing language only for a project with more than one language', async () => {
    const one = await setup({ locales: ['en'] });
    expect(screen.queryByLabelText('Editing language')).toBeNull();
    one.fixture.destroy();
    restart();

    await setup({ locales: ['en', 'de'] });
    expect(screen.getByLabelText('Editing language')).toBeTruthy();
  });

  it('shows build status, Build now and History only inside a project', async () => {
    const inProject = await setup();
    expect(screen.getByRole('button', { name: 'Build now' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Project history' })).toBeTruthy();
    inProject.fixture.destroy();
    restart();

    await setup({ url: '/' });
    expect(screen.queryByRole('button', { name: 'Build now' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Project history' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Published' })).toBeNull();
  });

  it('offers Build now only to people who may start a build, and starts the incremental build', async () => {
    const allowed = await setup({ canBuild: true });
    fireEvent.click(screen.getByRole('button', { name: 'Build now' }));
    expect(allowed.buildNow.start).toHaveBeenCalledWith('acme', 'Build now');
    allowed.fixture.destroy();
    restart();

    await setup({ canBuild: false });
    expect(screen.queryByRole('button', { name: 'Build now' })).toBeNull();
  });

  it('offers the developer-mode switch to developers only', async () => {
    const editor = await setup({ projectRoles: { acme: 'EDITOR' } });
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    expect(screen.getByText('Theme')).toBeTruthy();
    expect(screen.queryByText('Developer mode')).toBeNull();
    editor.fixture.destroy();
    restart();

    await setup({ projectRoles: { acme: 'DEVELOPER' } });
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    expect(screen.getByText('Developer mode')).toBeTruthy();
  });

  it('shows Administration in the user menu to instance admins only, and signs out', async () => {
    const user = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Account menu for Ada Lovelace' }));
    expect(screen.getByRole('link', { name: 'My account' }).getAttribute('href')).toBe('/account');
    expect(screen.queryByRole('link', { name: 'Administration' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(user.signOut).toHaveBeenCalled();
    user.fixture.destroy();
    restart();

    await setup({ systemRole: 'INSTANCE_ADMIN' });
    fireEvent.click(screen.getByRole('button', { name: 'Account menu for Ada Lovelace' }));
    expect(screen.getByRole('link', { name: 'Administration' }).getAttribute('href')).toBe('/admin');
  });
});
