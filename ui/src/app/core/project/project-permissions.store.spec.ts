import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ProjectPermissionsStore } from './project-permissions.store';
import { provideProjectPermissions } from './testing/project-permissions.testing';
import { ALL_PUBLISH_PERMISSIONS } from './testing/project-detail.fixture';

const ROLES = ['VIEWER', 'EDITOR', 'DEVELOPER', 'PROJECT_ADMIN'] as const;
/** The editor policies the server can store (implications hold), as `ProjectDetail.permissions` reports them. */
const EDITOR_PERMISSION_SETS: string[][] = [
  [],
  ['RELEASE'],
  ['RELEASE', 'SCHEDULE_RELEASE'],
  ['INCREMENTAL_BUILD'],
  ['INCREMENTAL_BUILD', 'FULL_BUILD'],
  ['RELEASE', 'SCHEDULE_RELEASE', 'INCREMENTAL_BUILD', 'FULL_BUILD'],
];

function store(options: { role: string | null; permissions?: string[]; readOnly?: boolean; userId?: number }) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideProjectPermissions({
        role: () => options.role,
        permissions: () => options.permissions ?? [],
        readOnly: () => options.readOnly ?? false,
        userId: () => options.userId ?? 1,
      }),
    ],
  });
  return TestBed.inject(ProjectPermissionsStore);
}

/** What the server sends for `role`: everything for developers and admins, the policy for editors, nothing else. */
function serverPermissions(role: string, editorPolicy: string[]): string[] {
  return role === 'DEVELOPER' || role === 'PROJECT_ADMIN' ? ALL_PUBLISH_PERMISSIONS : role === 'EDITOR' ? editorPolicy : [];
}

describe('ProjectPermissionsStore', () => {
  it('follows role × server permissions × read-only for every capability', () => {
    for (const role of ROLES) {
      for (const policy of EDITOR_PERMISSION_SETS) {
        for (const readOnly of [false, true]) {
          const permissions = serverPermissions(role, policy);
          const s = store({ role, permissions, readOnly });
          const rank = ROLES.indexOf(role);
          const writable = !readOnly;
          const label = `${role} ${JSON.stringify(permissions)} readOnly=${readOnly}`;
          expect(s.canEditContent(), label).toBe(rank >= 1 && writable);
          expect(s.canEditTemplates(), label).toBe(rank >= 2 && writable);
          expect(s.canCreateTargets(), label).toBe(rank >= 2 && writable);
          expect(s.canManageTargets(), label).toBe(rank >= 3 && writable);
          expect(s.canAdminProject(), label).toBe(rank >= 3 && writable);
          expect(s.canEditRedirects(), label).toBe(rank >= 2 && writable);
          expect(s.canOverrideUrls(), label).toBe(rank >= 2 && writable);
          expect(s.canDeleteAllRedirects(), label).toBe(rank >= 3 && writable);
          expect(s.canResetUrls(), label).toBe(rank >= 3 && writable);
          expect(s.canPromote(), label).toBe(rank >= 2 && writable);
          expect(s.canScheduleGeneration(), label).toBe(rank >= 2 && writable);
          expect(s.canRelease(), label).toBe(permissions.includes('RELEASE') && writable);
          expect(s.canScheduleRelease(), label).toBe(permissions.includes('SCHEDULE_RELEASE') && writable);
          expect(s.canIncrementalBuild(), label).toBe(permissions.includes('INCREMENTAL_BUILD') && writable);
          expect(s.canFullBuild(), label).toBe(permissions.includes('FULL_BUILD') && writable);
        }
      }
    }
  });

  it('reads publish rights from the server, never from the role', () => {
    // A developer whose detail (still) lists nothing gets no publish control: the server is the authority.
    const developer = store({ role: 'DEVELOPER', permissions: [] });
    expect(developer.canRelease()).toBe(false);
    expect(developer.canIncrementalBuild()).toBe(false);
    // Promote stays a role rule.
    expect(developer.canPromote()).toBe(true);
  });

  it('cancels runs: developers any, editors with a build permission only their own, even while read-only', () => {
    const own = { startedBy: { id: 1, displayName: 'Me' } };
    const foreign = { startedBy: { id: 2, displayName: 'Ana' } };
    const unknown = { startedBy: null };

    const editor = store({ role: 'EDITOR', permissions: ['INCREMENTAL_BUILD'], userId: 1 });
    expect(editor.canCancelRun(own)).toBe(true);
    expect(editor.canCancelRun(foreign)).toBe(false);
    expect(editor.canCancelRun(unknown)).toBe(false);

    const withoutBuild = store({ role: 'EDITOR', permissions: ['RELEASE'], userId: 1 });
    expect(withoutBuild.canCancelRun(own)).toBe(false);

    const developer = store({ role: 'DEVELOPER', permissions: ALL_PUBLISH_PERMISSIONS, readOnly: true });
    expect(developer.canCancelRun(foreign)).toBe(true);
    expect(store({ role: 'VIEWER' }).canCancelRun(own)).toBe(false);
  });

  it('checks a schedule against what it needs, and someone else\'s against a developer too', () => {
    const release = { type: 'RELEASE', ownerUserId: 1, thenGenerate: null };
    const thenDefault = { type: 'RELEASE', ownerUserId: 1, thenGenerate: { targetId: null } };
    const thenPrimary = { type: 'UNPUBLISH', ownerUserId: 1, thenGenerate: { targetId: 7 } };
    const thenOther = { type: 'RELEASE', ownerUserId: 1, thenGenerate: { targetId: 8 } };
    const generation = { type: 'GENERATION', ownerUserId: 1 };
    const othersRelease = { ...release, ownerUserId: 2 };

    const scheduler = store({ role: 'EDITOR', permissions: ['RELEASE', 'SCHEDULE_RELEASE'], userId: 1 });
    expect(scheduler.canChangeSchedule(release, 7)).toBe(true);
    expect(scheduler.canChangeSchedule(thenDefault, 7)).toBe(false);
    expect(scheduler.canChangeSchedule(generation, 7)).toBe(false);
    expect(scheduler.canChangeSchedule(othersRelease, 7)).toBe(false);
    expect(scheduler.satisfiesSchedule(othersRelease, 7)).toBe(true);

    const builder = store({ role: 'EDITOR', permissions: ['RELEASE', 'SCHEDULE_RELEASE', 'INCREMENTAL_BUILD'], userId: 1 });
    expect(builder.canChangeSchedule(thenDefault, 7)).toBe(true);
    expect(builder.canChangeSchedule(thenPrimary, 7)).toBe(true);
    expect(builder.canChangeSchedule(thenOther, 7)).toBe(false);

    const developer = store({ role: 'DEVELOPER', permissions: ALL_PUBLISH_PERMISSIONS, userId: 5 });
    expect(developer.canChangeSchedule(othersRelease, 7)).toBe(true);
    expect(developer.canChangeSchedule(generation, 7)).toBe(true);
    expect(store({ role: 'DEVELOPER', permissions: ALL_PUBLISH_PERMISSIONS, readOnly: true }).canChangeSchedule(release, 7)).toBe(
      false,
    );
  });
});
