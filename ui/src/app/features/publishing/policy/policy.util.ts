import type { PublishPermission } from '../../../core/project/publish-permissions';

/** One switch of the "Publishing by editors" card (M28.3.2), in the server's order. */
export interface PolicySwitch {
  permission: PublishPermission;
  /** The key of its texts: `publishing.policy.actions.<key>` and `.hints.<key>`. */
  key: 'release' | 'schedule' | 'incremental' | 'full';
  /** The permission this one needs (epic decision 3). */
  requires?: PublishPermission;
}

export const POLICY_SWITCHES: readonly PolicySwitch[] = [
  { permission: 'RELEASE', key: 'release' },
  { permission: 'SCHEDULE_RELEASE', key: 'schedule', requires: 'RELEASE' },
  { permission: 'INCREMENTAL_BUILD', key: 'incremental' },
  { permission: 'FULL_BUILD', key: 'full', requires: 'INCREMENTAL_BUILD' },
];

const ORDER = POLICY_SWITCHES.map((s) => s.permission);

/** The text key of `permission` (`release` ...); an unknown permission keeps its name. */
export function policyKey(permission: string | null | undefined): string {
  return POLICY_SWITCHES.find((s) => s.permission === permission)?.key ?? permission ?? '';
}

/**
 * `current` with `permission` switched on or off. Switching a permission off also switches off what needs it, so the
 * card never holds a policy the server refuses (`SCHEDULE_RELEASE` needs `RELEASE`, `FULL_BUILD` needs
 * `INCREMENTAL_BUILD`). The result is in the server's order.
 */
export function togglePolicy(current: readonly string[], permission: PublishPermission, on: boolean): string[] {
  const next = new Set(current);
  if (on) {
    next.add(permission);
  } else {
    next.delete(permission);
    POLICY_SWITCHES.filter((s) => s.requires === permission).forEach((s) => next.delete(s.permission));
  }
  return ORDER.filter((p) => next.has(p));
}

/** Whether two policies grant the same permissions, whatever their order. */
export function samePolicy(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((p) => b.includes(p));
}
