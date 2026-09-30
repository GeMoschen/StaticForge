import type { components } from '../../core/api/generated/schema.d.ts';
import type { ContentDefinition } from '../forms';

type PageView = components['schemas']['PageView'];
type AssetDetailView = components['schemas']['AssetDetailView'];

export const EMPTY_DEF: ContentDefinition = { editors: [], bodies: [] };

/** A compiled template definition as the editor's content definition (an empty one when there is none). */
export function toDefinition(compiled: unknown): ContentDefinition {
  if (compiled && typeof compiled === 'object') {
    return compiled as unknown as ContentDefinition;
  }
  return EMPTY_DEF;
}

/** The page a historical version (time travel) read shows: its payload laid out as a `PageView`. */
export function versionToPageView(detail: AssetDetailView): PageView {
  const payload = (detail.payload ?? {}) as Record<string, unknown>;
  const templateRef = payload['templateRef'];
  return {
    uuid: detail.uuid,
    uid: detail.uid,
    displayName: detail.displayName,
    revision: detail.revision,
    folderPath: detail.folderPath,
    template: typeof templateRef === 'string' ? { uuid: templateRef } : undefined,
    content: (payload['content'] ?? {}) as PageView['content'],
    bodies: (payload['bodies'] ?? {}) as PageView['bodies'],
    nav: payload['nav'] as PageView['nav'],
    output: payload['output'] as PageView['output'],
    meta: payload['meta'] as PageView['meta'],
  };
}

/** A (merged) save payload laid over `base`, the page it was made from. */
export function payloadToPageView(base: PageView, payload: Record<string, unknown>): PageView {
  const templateRef = payload['templateRef'];
  return {
    ...base,
    template: typeof templateRef === 'string' ? { uuid: templateRef } : base.template,
    content: (payload['content'] ?? {}) as PageView['content'],
    bodies: (payload['bodies'] ?? {}) as PageView['bodies'],
    nav: payload['nav'] as PageView['nav'],
    output: payload['output'] as PageView['output'],
    meta: payload['meta'] as PageView['meta'],
  };
}
