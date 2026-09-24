import { describe, expect, it } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { userActionStates } from './admin-user.util';

type AdminUserDetail = components['schemas']['AdminUserDetail'];

const user: AdminUserDetail = {
  id: 5,
  username: 'ed',
  email: 'ed@example.com',
  status: 'ACTIVE',
  systemRole: 'USER',
  mustChangePassword: false,
  failedLogins: 0,
  memberships: [],
};
const admin: AdminUserDetail = { ...user, id: 6, username: 'root', systemRole: 'INSTANCE_ADMIN' };

describe('userActionStates', () => {
  it('offers disable, not enable or unlock, for an active user', () => {
    const a = userActionStates(user, 1, 3);
    expect(a.disable).toEqual({ shown: true, allowed: true });
    expect(a.enable.shown).toBe(false);
    expect(a.unlock.shown).toBe(false);
    expect(a.delete.allowed).toBe(true);
    expect(a.toggleAdmin.allowed).toBe(true);
  });

  it('offers enable for a disabled user, and unlock for a locked one', () => {
    expect(userActionStates({ ...user, status: 'DISABLED' }, 1, 3).enable.shown).toBe(true);
    expect(userActionStates({ ...user, status: 'DISABLED' }, 1, 3).disable.shown).toBe(false);
    expect(userActionStates({ ...user, status: 'LOCKED' }, 1, 3).unlock.shown).toBe(true);
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(userActionStates({ ...user, lockedUntil: future }, 1, 3).unlock.shown).toBe(true);
  });

  it("refuses to disable, delete or demote yourself, with the reason", () => {
    const a = userActionStates(admin, admin.id!, 3);
    expect(a.disable).toEqual({ shown: true, allowed: false, reason: "You can't disable your own account." });
    expect(a.delete.reason).toBe("You can't delete your own account.");
    expect(a.toggleAdmin.reason).toBe("You can't demote your own account.");
    expect(a.resetPassword.allowed).toBe(true);
  });

  it('protects the last active instance admin, but not while another one exists', () => {
    const last = userActionStates(admin, 1, 1);
    expect(last.disable.allowed).toBe(false);
    expect(last.delete.reason).toBe("The last active instance admin can't be deleted.");
    expect(last.toggleAdmin.reason).toBe("The last active instance admin can't be demoted.");
    expect(userActionStates(admin, 1, 2).delete.allowed).toBe(true);
    // A disabled admin isn't one of the active ones the rule counts.
    expect(userActionStates({ ...admin, status: 'DISABLED' }, 1, 1).delete.allowed).toBe(true);
  });

  it('offers nothing for a deleted account', () => {
    const a = userActionStates({ ...user, status: 'DELETED' }, 1, 3);
    expect(Object.values(a).every((s) => !s.shown)).toBe(true);
  });
});
