/**
 * The per-project publish permissions (M28, spec §8.3). Which ones a user holds comes from the server
 * (`ProjectDetail.permissions`); the UI never derives them from the role (epic decision 12).
 */
export type PublishPermission = 'RELEASE' | 'SCHEDULE_RELEASE' | 'INCREMENTAL_BUILD' | 'FULL_BUILD';

export const PUBLISH_PERMISSIONS: readonly PublishPermission[] = ['RELEASE', 'SCHEDULE_RELEASE', 'INCREMENTAL_BUILD', 'FULL_BUILD'];

/** What each permission lets a user do, as the end of "You no longer have permission to …". */
const ACTIONS: Record<string, string> = {
  RELEASE: 'release, discard or unpublish content',
  SCHEDULE_RELEASE: 'schedule releases',
  INCREMENTAL_BUILD: 'start builds',
  FULL_BUILD: 'start full builds or builds to other targets',
  'ROLE:EDITOR': 'do this in this project',
  'ROLE:DEVELOPER': 'do this — it needs a developer',
  'ROLE:PROJECT_ADMIN': 'do this — it needs a project admin',
};

/**
 * The message for a `403` naming what the caller lacks (`permission` problem extension, epic decision 6): a publish
 * permission or `ROLE:<role>`. The policy may have changed while the app was open.
 */
export function permissionDeniedMessage(permission: string): string {
  return `You no longer have permission to ${ACTIONS[permission] ?? 'do this'}.`;
}
