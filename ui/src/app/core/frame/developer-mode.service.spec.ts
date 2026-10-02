import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { AuthStore } from '../auth/auth.store';
import { PreferencesService } from '../preferences/preferences.service';
import { DeveloperModeService } from './developer-mode.service';
import { FrameContextStore } from './frame-context.store';

interface Who {
  systemRole?: string;
  projectRoles?: Record<string, string>;
}

function setup(who: Who, projectKey: string | null) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: FrameContextStore, useValue: { projectKey: signal(projectKey) } },
    ],
  });
  TestBed.inject(AuthStore).setUser({ id: 1, username: 'u', systemRole: who.systemRole ?? 'USER', projectRoles: who.projectRoles ?? {} });
  return { mode: TestBed.inject(DeveloperModeService), prefs: TestBed.inject(PreferencesService) };
}

describe('DeveloperModeService', () => {
  it('is available to the developers and admins of the open project, and on until switched off', () => {
    for (const role of ['DEVELOPER', 'PROJECT_ADMIN']) {
      TestBed.resetTestingModule();
      const { mode } = setup({ projectRoles: { acme: role } }, 'acme');
      expect(mode.available()).toBe(true);
      expect(mode.enabled()).toBe(true);
    }
  });

  it('is not available to an editor or viewer, whatever they stored', () => {
    for (const role of ['EDITOR', 'VIEWER']) {
      TestBed.resetTestingModule();
      const { mode, prefs } = setup({ projectRoles: { acme: role } }, 'acme');
      prefs.setDeveloperMode(true);
      expect(mode.available()).toBe(false);
      expect(mode.enabled()).toBe(false);
    }
  });

  it('follows the role in the open project, not the best role elsewhere', () => {
    const { mode } = setup({ projectRoles: { acme: 'EDITOR', other: 'DEVELOPER' } }, 'acme');
    expect(mode.available()).toBe(false);
  });

  it('answers for a given project before the frame follows the URL (route guards)', () => {
    const { mode, prefs } = setup({ projectRoles: { acme: 'EDITOR', other: 'DEVELOPER' } }, 'acme');
    expect(mode.enabledIn('acme')).toBe(false);
    expect(mode.enabledIn('other')).toBe(true);
    prefs.setDeveloperMode(false);
    expect(mode.enabledIn('other')).toBe(false);
  });

  it('counts an instance admin as a developer everywhere', () => {
    const { mode } = setup({ systemRole: 'INSTANCE_ADMIN' }, 'acme');
    expect(mode.available()).toBe(true);
  });

  it('outside a project asks for developer rights in any project, or instance admin', () => {
    expect(setup({ projectRoles: { a: 'EDITOR', b: 'DEVELOPER' } }, null).mode.available()).toBe(true);
    TestBed.resetTestingModule();
    expect(setup({ projectRoles: { a: 'EDITOR' } }, null).mode.available()).toBe(false);
    TestBed.resetTestingModule();
    expect(setup({ systemRole: 'INSTANCE_ADMIN' }, null).mode.available()).toBe(true);
  });

  it('turns off and on through the preferences', () => {
    const { mode, prefs } = setup({ projectRoles: { acme: 'DEVELOPER' } }, 'acme');
    mode.set(false);
    expect(prefs.developerMode()).toBe(false);
    expect(mode.enabled()).toBe(false);
    mode.set(true);
    expect(mode.enabled()).toBe(true);
  });
});
