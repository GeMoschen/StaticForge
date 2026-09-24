import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import type { components } from '../api/generated/schema.d.ts';
import { TimeTravelStore } from '../../features/revisions/time-travel.store';
import { ProjectAccessStore } from '../project/project-access.store';
import { instanceAdminGuard } from './auth.guard';
import { AuthStore } from './auth.store';

type MeResponse = components['schemas']['MeResponse'];

const editor: MeResponse = {
  id: 2,
  username: 'ed',
  systemRole: 'USER',
  mustChangePassword: false,
  projectRoles: { acme: 'EDITOR', beta: 'PROJECT_ADMIN' },
};

describe('AuthStore effective role (M26)', () => {
  let store: AuthStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    store = TestBed.inject(AuthStore);
  });

  it('is the membership role, and null outside the user’s projects', () => {
    store.setUser(editor);
    expect(store.roleFor('acme')).toBe('EDITOR');
    expect(store.roleFor('other')).toBeNull();
  });

  it('makes an instance admin a project admin everywhere, like the server', () => {
    store.setUser({ ...editor, systemRole: 'INSTANCE_ADMIN', projectRoles: {} });
    expect(store.roleFor('any-project')).toBe('PROJECT_ADMIN');
  });

  it('drops every role to VIEWER in an archived project, and restores it on unarchive', () => {
    store.setUser(editor);
    store.setProjectArchived('beta', true);
    expect(store.roleFor('beta')).toBe('VIEWER');
    expect(store.roleFor('acme')).toBe('EDITOR');

    store.setUser({ ...editor, systemRole: 'INSTANCE_ADMIN' });
    expect(store.roleFor('beta')).toBe('VIEWER');

    store.setProjectArchived('beta', false);
    expect(store.roleFor('beta')).toBe('PROJECT_ADMIN');
  });

  it('forgets archived projects on sign-out', () => {
    store.setProjectArchived('beta', true);
    store.clear();
    expect(store.isArchived('beta')).toBe(false);
  });
});

describe('ProjectAccessStore', () => {
  it('is read-only in time travel and in an archived project', () => {
    TestBed.configureTestingModule({});
    const access = TestBed.inject(ProjectAccessStore);
    const timeTravel = TestBed.inject(TimeTravelStore);

    access.enterProject('acme', false);
    expect(access.readOnly()).toBe(false);

    timeTravel.enter(4);
    expect(access.readOnly()).toBe(true);
    timeTravel.exit();

    access.enterProject('acme', true);
    expect(access.archived()).toBe(true);
    expect(access.readOnly()).toBe(true);

    access.enterProject('beta', false);
    expect(access.readOnly()).toBe(false);
  });
});

describe('instanceAdminGuard', () => {
  it('lets instance admins in and sends everyone else to the dashboard', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const store = TestBed.inject(AuthStore);
    const run = () => TestBed.runInInjectionContext(() => instanceAdminGuard({}, []));

    store.setUser(editor);
    const result = run();
    expect(result instanceof UrlTree && TestBed.inject(Router).serializeUrl(result)).toBe('/');

    store.setUser({ ...editor, systemRole: 'INSTANCE_ADMIN' });
    expect(run()).toBe(true);
  });
});
