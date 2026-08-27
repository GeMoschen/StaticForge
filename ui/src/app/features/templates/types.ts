/**
 * Shared contracts for the TEMPLATES feature (StaticForge milestone M13.3).
 */

/** Re-exported so template-tree components use the same drag-move event shape as Pages/Media. */
export type { FolderMoveEvent } from '../pages/types';

/** A template folder's inherited kind — every node under the "Page Templates" root is
 * `PAGE_TEMPLATE`, every node under "Section Templates" is `SECTION_TEMPLATE`. The backend
 * doesn't surface this on `FolderView` directly, so the UI threads it down explicitly from
 * whichever of the two fixed roots a node descends from (see `TemplatesComponent.rootKind`). */
export type TemplateAssetKind = 'PAGE_TEMPLATE' | 'SECTION_TEMPLATE';

/** Folder-tree selection event — carries the selected folder's inherited kind alongside its
 * uuid so `TemplatesComponent` never has to re-derive it by walking the tree. */
export interface TemplateFolderSelectEvent {
  uuid: string;
  templateKind: TemplateAssetKind;
}

/** Well-known `uid`s of the two fixed, protected `TEMPLATES`-scope roots (mirrors
 * `FolderScope.PAGE_TEMPLATES_UID`/`SECTION_TEMPLATES_UID` server-side). */
export const PAGE_TEMPLATES_ROOT_UID = 'page_templates';
export const SECTION_TEMPLATES_ROOT_UID = 'section_templates';
