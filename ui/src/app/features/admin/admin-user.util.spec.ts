import { describe, expect, it, vi } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import {
  NO_USER_FILTER,
  choiceMenu,
  isUserFiltered,
  userActionStates,
  userFilterFromQuery,
  userFilterToQuery,
} from './admin-user.util';

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
    expect(a.disable).toEqual({ shown: true, allowed: false, reason: 'self' });
    expect(a.delete.reason).toBe('self');
    expect(a.toggleAdmin.reason).toBe('self');
    expect(a.resetPassword.allowed).toBe(true);
  });

  it('protects the last active instance admin, but not while another one exists', () => {
    const last = userActionStates(admin, 1, 1);
    expect(last.disable.allowed).toBe(false);
    expect(last.delete.reason).toBe('lastAdmin');
    expect(last.toggleAdmin.reason).toBe('lastAdmin');
    expect(userActionStates(admin, 1, 2).delete.allowed).toBe(true);
    // A disabled admin isn't one of the active ones the rule counts.
    expect(userActionStates({ ...admin, status: 'DISABLED' }, 1, 1).delete.allowed).toBe(true);
  });

  it('offers nothing for a deleted account', () => {
    const a = userActionStates({ ...user, status: 'DELETED' }, 1, 3);
    expect(Object.values(a).every((s) => !s.shown)).toBe(true);
  });
});

describe('the Users filter', () => {
  const read = (params: Record<string, string>) => userFilterFromQuery((name) => params[name] ?? null);

  it('reads the query parameters and ignores unknown values', () => {
    expect(read({ q: ' ada ', status: 'LOCKED', role: 'INSTANCE_ADMIN', deleted: '1' })).toEqual({
      q: 'ada',
      status: 'LOCKED',
      role: 'INSTANCE_ADMIN',
      deleted: true,
    });
    expect(read({ status: 'bogus', role: 'root' })).toEqual(NO_USER_FILTER);
  });

  it('writes only what is set, and round-trips', () => {
    expect(userFilterToQuery(NO_USER_FILTER)).toEqual({ q: null, status: null, role: null, deleted: null });
    const filter = { q: 'ada', status: 'DISABLED', role: null, deleted: true } as const;
    const query = userFilterToQuery(filter) as Record<string, string>;
    expect(read(query)).toEqual(filter);
    expect(isUserFiltered(filter)).toBe(true);
    expect(isUserFiltered(NO_USER_FILTER)).toBe(false);
  });
});

describe('choiceMenu', () => {
  it('lists Any first, checks the picked entry and names it in the trigger', () => {
    const set = vi.fn();
    const menu = choiceMenu('Status', 'Any', (v) => `Status: ${v}`, ['ACTIVE', 'LOCKED'] as const, (o) => o.toLowerCase(), 'LOCKED', set);
    expect(menu.text).toBe('Status: locked');
    expect(menu.items.map((i) => [i.label, i.icon])).toEqual([
      ['Any', undefined],
      ['active', undefined],
      ['locked', 'check'],
    ]);
    menu.items[1].action?.();
    expect(set).toHaveBeenCalledWith('ACTIVE');
    menu.items[0].action?.();
    expect(set).toHaveBeenLastCalledWith(null);
    expect(choiceMenu('Status', 'Any', (v) => v, ['ACTIVE'] as const, (o) => o, null, set).items[0].icon).toBe('check');
  });
});
