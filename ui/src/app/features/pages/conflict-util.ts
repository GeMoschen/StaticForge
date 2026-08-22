import type { ResolveMode } from './types';

export interface FieldConflict {
  path: string;
  base: unknown;
  theirs: unknown;
}

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === 'object' && value !== null;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (!isContainer(a) || !isContainer(b)) {
    return false;
  }
  const aArr = Array.isArray(a);
  if (aArr !== Array.isArray(b)) {
    return false;
  }
  if (aArr && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) {
    return false;
  }
  for (const key of aKeys) {
    if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false;
    }
  }
  return true;
}

/**
 * Walks two payloads and returns the leaf paths where they differ. Object
 * keys become `.key` segments, array indices become `[i]`.
 */
export function diffFields(base: unknown, theirs: unknown, prefix = ''): FieldConflict[] {
  if (!isContainer(base) || !isContainer(theirs) || Array.isArray(base) !== Array.isArray(theirs)) {
    return deepEqual(base, theirs) ? [] : [{ path: prefix, base, theirs }];
  }
  const out: FieldConflict[] = [];
  if (Array.isArray(base) && Array.isArray(theirs)) {
    const len = Math.max(base.length, theirs.length);
    for (let i = 0; i < len; i++) {
      out.push(...diffFields(base[i], theirs[i], `${prefix}[${i}]`));
    }
    return out;
  }
  const keys = new Set<string>([...Object.keys(base), ...Object.keys(theirs)]);
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.push(
      ...diffFields(
        (base as Record<string, unknown>)[key],
        (theirs as Record<string, unknown>)[key],
        path,
      ),
    );
  }
  return out;
}

function parsePath(path: string): (string | number)[] {
  const segments: (string | number)[] = [];
  let i = 0;
  while (i < path.length) {
    if (path[i] === '.') {
      i++;
      continue;
    }
    if (path[i] === '[') {
      const end = path.indexOf(']', i);
      segments.push(Number(path.slice(i + 1, end)));
      i = end + 1;
      continue;
    }
    let j = i;
    while (j < path.length && path[j] !== '.' && path[j] !== '[') {
      j++;
    }
    segments.push(path.slice(i, j));
    i = j;
  }
  return segments;
}

function getAt(root: unknown, path: string): unknown {
  let cursor = root;
  for (const segment of parsePath(path)) {
    if (cursor == null) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment as never];
  }
  return cursor;
}

function setAt(root: unknown, path: string, value: unknown): void {
  const segments = parsePath(path);
  let cursor = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const next = segments[i + 1];
    const nextContainer: unknown = typeof next === 'number' ? [] : {};
    if (Array.isArray(cursor)) {
      const idx = segments[i] as number;
      if (cursor[idx] == null) {
        cursor[idx] = nextContainer;
      }
      cursor = cursor[idx];
    } else {
      const obj = cursor as Record<string, unknown>;
      const key = segments[i] as string;
      if (obj[key] == null) {
        obj[key] = nextContainer;
      }
      cursor = obj[key];
    }
  }
  const last = segments[segments.length - 1];
  if (Array.isArray(cursor)) {
    cursor[last as number] = value;
  } else {
    (cursor as Record<string, unknown>)[last as string] = value;
  }
}

/**
 * Merges the server payload (`theirs`) with the local payload, taking the
 * local value for every path the user chose "mine".
 */
export function mergePayload(
  theirs: unknown,
  local: unknown,
  fields: Record<string, ResolveMode>,
): unknown {
  const out = JSON.parse(JSON.stringify(theirs)) as unknown;
  for (const [path, decision] of Object.entries(fields)) {
    if (decision === 'mine') {
      setAt(out, path, getAt(local, path));
    }
  }
  return out;
}
