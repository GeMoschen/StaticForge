import type { components } from '../../core/api/generated/schema.d.ts';

type AdminUserDetail = components['schemas']['AdminUserDetail'];

export const USER_STATUSES: readonly { value: string; label: string }[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'LOCKED', label: 'Locked' },
  { value: 'DISABLED', label: 'Disabled' },
  { value: 'DELETED', label: 'Deleted' },
];

export function statusLabel(status: string | null | undefined): string {
  return USER_STATUSES.find((s) => s.value === status)?.label ?? status ?? '—';
}

export function statusChipClass(status: string | null | undefined): string {
  switch (status) {
    case 'ACTIVE':
      return 'chip chip--ok';
    case 'LOCKED':
      return 'chip chip--warn';
    case 'DISABLED':
      return 'chip chip--danger';
    default:
      return 'chip';
  }
}

export type UserAction = 'disable' | 'enable' | 'unlock' | 'resetPassword' | 'revokeSessions' | 'toggleAdmin' | 'delete';

/** Whether an action is offered, and — when it is shown but refused — why. */
export interface ActionState {
  shown: boolean;
  allowed: boolean;
  reason?: string;
}

/**
 * Which account actions the detail page offers (M26, epic decision 8), mirroring the server's guard rails so they
 * show as disabled buttons with their reason instead of as `409`s: an admin can't disable, delete or demote
 * themselves (`SF-DOM-0132`), and the last active instance admin can't be disabled, deleted or demoted
 * (`SF-DOM-0131`). A deleted account offers nothing.
 *
 * @param activeAdminCount how many `ACTIVE` instance admins exist
 */
export function userActionStates(
  user: AdminUserDetail,
  selfId: number | null,
  activeAdminCount: number,
): Record<UserAction, ActionState> {
  const deleted = user.status === 'DELETED';
  const self = user.id != null && user.id === selfId;
  const admin = user.systemRole === 'INSTANCE_ADMIN';
  const lastActiveAdmin = admin && user.status === 'ACTIVE' && activeAdminCount <= 1;
  const locked = user.status === 'LOCKED' || (!!user.lockedUntil && Date.parse(user.lockedUntil) > Date.now());

  const hidden: ActionState = { shown: false, allowed: false };
  const guarded = (verb: string): ActionState =>
    self
      ? { shown: true, allowed: false, reason: `You can't ${verb} your own account.` }
      : lastActiveAdmin
        ? { shown: true, allowed: false, reason: `The last active instance admin can't be ${verb}d.` }
        : { shown: true, allowed: true };

  if (deleted) {
    return {
      disable: hidden,
      enable: hidden,
      unlock: hidden,
      resetPassword: hidden,
      revokeSessions: hidden,
      toggleAdmin: hidden,
      delete: hidden,
    };
  }
  return {
    disable: user.status === 'DISABLED' ? hidden : guarded('disable'),
    enable: user.status === 'DISABLED' ? { shown: true, allowed: true } : hidden,
    unlock: locked ? { shown: true, allowed: true } : hidden,
    resetPassword: { shown: true, allowed: true },
    revokeSessions: { shown: true, allowed: true },
    toggleAdmin: admin ? guarded('demote') : { shown: true, allowed: true },
    delete: guarded('delete'),
  };
}
