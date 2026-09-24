/** Project roles, lowest first, with the names the UI shows (spec §8.3). */
export const PROJECT_ROLES: readonly { value: string; label: string }[] = [
  { value: 'VIEWER', label: 'Viewer' },
  { value: 'EDITOR', label: 'Editor' },
  { value: 'DEVELOPER', label: 'Developer' },
  { value: 'PROJECT_ADMIN', label: 'Project admin' },
];

/** "Project admin" for `PROJECT_ADMIN`; an unknown role shows as it is. */
export function projectRoleLabel(role: string | null | undefined): string {
  return PROJECT_ROLES.find((r) => r.value === role)?.label ?? role ?? '—';
}
