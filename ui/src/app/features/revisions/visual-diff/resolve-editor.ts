import { ContentDefinition, EditorDefinition, EditorType } from '../../forms/form.model';

/**
 * Editor types whose widgets render reliably as a read-only value when given a
 * disabled control + `readOnly` definition. Complex / interactive widgets
 * (richtext contenteditable, dynamic list/catalog, nested groups) fall back to
 * the structured text view instead of showing a broken or editable-looking UI.
 */
export const READONLY_EDITOR_TYPES = new Set<EditorType>([
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'BOOLEAN',
  'DATE',
  'DATETIME',
  'SELECT',
  'MULTISELECT',
  'COLOR',
  'LINK',
  'MEDIA',
  'REFERENCE',
  'MARKDOWN',
  'JSON',
  'CATALOG',
]);

/**
 * Maps a diff field path (e.g. `content.title`, `content.group.field`) to the
 * matching {@link EditorDefinition} within a {@link ContentDefinition}, walking
 * GROUP/LIST item namespaces along the way. The leading `content.` scope
 * segment (and any array index segment) is stripped before matching.
 *
 * Returns `null` when no editor matches — callers fall back to a text/JSON view.
 */
export function resolveEditor(
  definition: ContentDefinition,
  path: string,
): EditorDefinition | null {
  const segments = path
    .split('.')
    .filter((s) => s.length > 0 && s !== 'content' && !/^\d+$/.test(s));
  if (segments.length === 0) {
    return null;
  }
  return walk(definition.editors ?? [], segments, 0);
}

function walk(
  editors: EditorDefinition[],
  segments: string[],
  index: number,
): EditorDefinition | null {
  const name = segments[index];
  const editor = editors.find((e) => e.name === name);
  if (!editor) {
    return null;
  }
  if (index === segments.length - 1) {
    return editor;
  }
  if (editor.type === 'GROUP' || editor.type === 'LIST') {
    return walk(editor.items ?? [], segments, index + 1);
  }
  return null;
}

/** Object-typed editors whose values the server differ recurses into (emitting sub-paths). */
export const OBJECT_EDITOR_TYPES = new Set<EditorType>(['REFERENCE', 'LINK', 'MEDIA', 'CATALOG']);

/**
 * Finds the object-typed editor whose field path is a prefix of `path`
 * (e.g. `content.field.uuid` → the REFERENCE editor at `content.field`).
 * Returns the editor and the segments that address it. Used to render whole
 * object-typed editor values (reference / link / media / catalog) which the
 * server differ reports as sub-path changes.
 */
export function resolveObjectEditorPrefix(
  definition: ContentDefinition,
  path: string,
): { editor: EditorDefinition; segments: string[] } | null {
  const segments = path
    .split('.')
    .filter((s) => s.length > 0 && s !== 'content' && !/^\d+$/.test(s));
  for (let len = 1; len <= segments.length; len++) {
    const prefix = segments.slice(0, len);
    const editor = walk(definition.editors ?? [], prefix, 0);
    if (editor && OBJECT_EDITOR_TYPES.has(editor.type)) {
      return { editor, segments: prefix };
    }
  }
  return null;
}

/** Reads a value from a nested object by dot-separated path segments (skips `content` scope). */
export function valueAtPath(
  root: Record<string, unknown> | undefined | null,
  segments: string[],
): unknown {
  let node: unknown = root;
  for (const seg of segments) {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      node = (node as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return node;
}
