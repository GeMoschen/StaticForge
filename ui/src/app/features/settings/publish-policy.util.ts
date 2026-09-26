import type { PublishPermission } from '../../core/project/publish-permissions';

/** One switch of the "Publishing by editors" card (M28.3.2), in the server's order. */
export interface PolicySwitch {
  permission: PublishPermission;
  label: string;
  hint: string;
  /** The permission this one needs (epic decision 3), with the label the "Needs …" hint names. */
  requires?: PublishPermission;
}

export const POLICY_SWITCHES: readonly PolicySwitch[] = [
  {
    permission: 'RELEASE',
    label: 'Release, discard and unpublish content',
    hint: 'Editors put their changes online in the next build, or take content offline.',
  },
  {
    permission: 'SCHEDULE_RELEASE',
    label: 'Schedule releases and unpublishing',
    hint: 'Editors plan a release or unpublish for a later time, optionally with a build right after.',
    requires: 'RELEASE',
  },
  {
    permission: 'INCREMENTAL_BUILD',
    label: 'Start incremental builds to the default target',
    hint: 'Editors rebuild what changed — or a folder or single pages — to the default target.',
  },
  {
    permission: 'FULL_BUILD',
    label: 'Start full builds and builds to any target',
    hint: 'Editors rebuild the whole site and choose the target.',
    requires: 'INCREMENTAL_BUILD',
  },
];

const ORDER = POLICY_SWITCHES.map((s) => s.permission);

/** The label of `permission`, for "Needs …" hints and the impact dialog. */
export function policyLabel(permission: string | null | undefined): string {
  return POLICY_SWITCHES.find((s) => s.permission === permission)?.label ?? permission ?? '—';
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
