import type { MergePatch } from './preferences.types';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Applies an RFC 7386 merge patch to a document without mutating either. */
export function applyMergePatch(target: unknown, patch: unknown): unknown {
  if (!isObject(patch)) {
    return patch;
  }
  const result: Record<string, unknown> = isObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete result[key];
    } else {
      result[key] = applyMergePatch(result[key], value);
    }
  }
  return result;
}

/**
 * Composes two patches into one that has the effect of `older` followed by `newer`. Unlike {@link applyMergePatch}
 * a `null` is kept (it still has to reach the server), and the newer value wins per key.
 */
export function composePatches(older: MergePatch, newer: MergePatch): MergePatch {
  const result: MergePatch = { ...older };
  for (const [key, value] of Object.entries(newer)) {
    const existing = result[key];
    result[key] = isObject(value) && isObject(existing) ? composePatches(existing, value) : value;
  }
  return result;
}

/** Builds the patch that sets (or, for `undefined`/`null`, deletes) the value at a path. */
export function patchAt(path: readonly string[], value: unknown): MergePatch {
  const leaf = value === undefined ? null : value;
  return path.reduceRight<unknown>((inner, key) => ({ [key]: inner }), leaf) as MergePatch;
}

export function readPath(doc: unknown, path: readonly string[]): unknown {
  let node: unknown = doc;
  for (const key of path) {
    if (!isObject(node)) {
      return undefined;
    }
    node = node[key];
  }
  return node;
}

export function isEmptyPatch(patch: MergePatch): boolean {
  return Object.keys(patch).length === 0;
}
