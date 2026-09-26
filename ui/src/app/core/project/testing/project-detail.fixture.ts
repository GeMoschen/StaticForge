import type { components } from '../../api/generated/schema.d.ts';
import { PUBLISH_PERMISSIONS } from '../publish-permissions';

type ProjectDetail = components['schemas']['ProjectDetail'];

/** Every publish permission, as the server sends it for a developer, a project admin or an instance admin. */
export const ALL_PUBLISH_PERMISSIONS: string[] = [...PUBLISH_PERMISSIONS];

/** `GET /projects/{key}` as the server sends it (M28): the policy for editors and the caller's own permissions. */
export function projectDetail(permissions: string[], editorPolicy: string[] = [], key = 'proj'): ProjectDetail {
  return {
    key,
    name: key,
    archived: false,
    createdAt: '2026-09-01T10:00:00Z',
    createdBy: 1,
    allowedMimeTypes: [],
    publishPolicy: { editor: editorPolicy },
    permissions,
  };
}
