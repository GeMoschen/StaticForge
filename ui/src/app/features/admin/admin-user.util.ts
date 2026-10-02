import type { components } from '../../core/api/generated/schema.d.ts';
import type { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import type { SfStatusTone } from '../../shared/components/display/sf-status.component';

type AdminUserDetail = components['schemas']['AdminUserDetail'];

/** The account statuses the server knows, in the order the filter lists them. */
export const USER_STATUSES = ['ACTIVE', 'LOCKED', 'DISABLED', 'DELETED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const SYSTEM_ROLES = ['INSTANCE_ADMIN', 'USER'] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

/** How a status shows (M35.16): tone and icon of the `sf-status`; the words come from `enum.userStatus`. */
export const USER_STATUS_TONES: Readonly<Record<UserStatus, SfStatusTone>> = {
  ACTIVE: 'success',
  LOCKED: 'warning',
  DISABLED: 'neutral',
  DELETED: 'danger',
};
export const USER_STATUS_ICONS: Readonly<Record<UserStatus, string>> = {
  ACTIVE: 'check_circle',
  LOCKED: 'lock',
  DISABLED: 'block',
  DELETED: 'delete',
};

/** The tone and icon of a status as the server sent it (an unknown one shows neutral). */
export function userStatusTone(status: string | null | undefined): SfStatusTone {
  return USER_STATUS_TONES[status as UserStatus] ?? 'neutral';
}
export function userStatusIcon(status: string | null | undefined): string {
  return USER_STATUS_ICONS[status as UserStatus] ?? 'help';
}

/** The Users list's filters (search, status, role, deleted) — what the query parameters `q`, `status`, `role`, `deleted` hold. */
export interface UserFilter {
  readonly q: string;
  readonly status: UserStatus | null;
  readonly role: SystemRole | null;
  readonly deleted: boolean;
}

export const NO_USER_FILTER: UserFilter = { q: '', status: null, role: null, deleted: false };

export function isUserFiltered(filter: UserFilter): boolean {
  return filter.q !== '' || filter.status !== null || filter.role !== null || filter.deleted;
}

/** Reads the filter from query parameters; unknown values are ignored. */
export function userFilterFromQuery(get: (name: string) => string | null): UserFilter {
  const status = get('status');
  const role = get('role');
  return {
    q: get('q')?.trim() ?? '',
    status: (USER_STATUSES as readonly string[]).includes(status ?? '') ? (status as UserStatus) : null,
    role: (SYSTEM_ROLES as readonly string[]).includes(role ?? '') ? (role as SystemRole) : null,
    deleted: get('deleted') === '1',
  };
}

/** The query parameters of a filter (`null` removes one). */
export function userFilterToQuery(filter: UserFilter): Record<string, string | null> {
  return {
    q: filter.q || null,
    status: filter.status,
    role: filter.role,
    deleted: filter.deleted ? '1' : null,
  };
}

/** A single-choice filter menu with an "Any" entry first; the chosen entry is checked and named in the trigger. */
export function choiceMenu<V extends string>(
  name: string,
  any: string,
  picked: (value: string) => string,
  options: readonly V[],
  label: (option: V) => string,
  value: V | null,
  set: (value: V | null) => void,
): { name: string; text: string; items: SfMenuItem[] } {
  return {
    name,
    text: value === null ? name : picked(label(value)),
    items: [
      { id: '', label: any, icon: value === null ? 'check' : undefined, action: () => set(null) },
      ...options.map((option, index) => ({
        id: option,
        label: label(option),
        icon: option === value ? 'check' : undefined,
        separatorBefore: index === 0,
        action: () => set(option),
      })),
    ],
  };
}

export type UserAction = 'disable' | 'enable' | 'unlock' | 'resetPassword' | 'revokeSessions' | 'toggleAdmin' | 'delete';

/** Why a shown action is refused: the account is the person's own, or it is the last active instance admin. */
export type GuardReason = 'self' | 'lastAdmin';

/** Whether an action is offered, and — when it is shown but refused — why (`admin.userdetail.guard.<reason>`). */
export interface ActionState {
  shown: boolean;
  allowed: boolean;
  reason?: GuardReason;
}

/**
 * Which account actions the detail page offers (M26, epic decision 8), mirroring the server's guard rails so they
 * show as disabled entries with their reason instead of as `409`s: an admin can't disable, delete or demote
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
  const guarded = (): ActionState =>
    self
      ? { shown: true, allowed: false, reason: 'self' }
      : lastActiveAdmin
        ? { shown: true, allowed: false, reason: 'lastAdmin' }
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
    disable: user.status === 'DISABLED' ? hidden : guarded(),
    enable: user.status === 'DISABLED' ? { shown: true, allowed: true } : hidden,
    unlock: locked ? { shown: true, allowed: true } : hidden,
    resetPassword: { shown: true, allowed: true },
    revokeSessions: { shown: true, allowed: true },
    toggleAdmin: admin ? guarded() : { shown: true, allowed: true },
    delete: guarded(),
  };
}
