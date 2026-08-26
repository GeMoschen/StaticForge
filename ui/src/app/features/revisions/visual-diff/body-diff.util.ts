/**
 * Front-end field-path differ for section `content` objects, mirroring the
 * server's `JsonDiffer.walk` (spec §7.6): recurses into objects, compares
 * arrays as whole units, and emits dotted `path` changes. Used to render
 * per-field visual diffs for page-body sections, which the server reports as a
 * single whole-array `bodies.<name>` change.
 */

export interface ObjChange {
  path: string;
  before: unknown;
  after: unknown;
  add: boolean;
  remove: boolean;
}

function absent(v: unknown): boolean {
  return v === null || v === undefined;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function diffObjects(before: unknown, after: unknown): ObjChange[] {
  const out: ObjChange[] = [];
  walk(before, after, '', out);
  return out;
}

function walk(
  a: unknown,
  b: unknown,
  path: string,
  out: ObjChange[],
): void {
  if (absent(a) && absent(b)) {
    return;
  }
  if (absent(a)) {
    out.push({ path, before: a, after: b, add: true, remove: false });
    return;
  }
  if (absent(b)) {
    out.push({ path, before: a, after: b, add: false, remove: true });
    return;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      walk(a[key], b[key], path ? `${path}.${key}` : key, out);
    }
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (!arraysEqual(a, b)) {
      out.push({ path, before: a, after: b, add: false, remove: false });
    }
    return;
  }
  if (a !== b) {
    out.push({ path, before: a, after: b, add: false, remove: false });
  }
}

function arraysEqual(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((v, i) => v === b[i] || JSON.stringify(v) === JSON.stringify(b[i]));
}

export interface BodySection {
  instanceId: string;
  templateRef: string;
  content?: Record<string, unknown>;
}

export type SectionStatus = 'added' | 'removed' | 'unchanged' | 'moved';

export interface SectionDiff {
  instanceId: string;
  templateRef: string;
  status: SectionStatus;
  beforeIndex?: number;
  afterIndex?: number;
  beforeContent?: Record<string, unknown>;
  afterContent?: Record<string, unknown>;
  /** Per-field content changes for sections present on both sides. */
  changes: ObjChange[];
}

function asSection(v: unknown): BodySection {
  if (v && typeof v === 'object') {
    const s = v as BodySection;
    return {
      instanceId: s.instanceId ?? '',
      templateRef: s.templateRef ?? '',
      content: s.content && typeof s.content === 'object' ? s.content : {},
    };
  }
  return { instanceId: '', templateRef: '', content: {} };
}

function key(s: BodySection): string {
  return s.instanceId;
}

function sameKey(a: BodySection, b: BodySection): boolean {
  return key(a) !== '' && key(a) === key(b);
}

/**
 * Aligns a body's before/after section arrays by `instanceId` using a
 * longest-common-subsequence pass, then flags each section as added, removed,
 * unchanged, or moved (a matched section whose array index changed). Sections
 * present on both sides get their `content` field-diffed.
 */
export function matchSections(before: unknown, after: unknown): SectionDiff[] {
  const beforeSections = (Array.isArray(before) ? before : []).map(asSection);
  const afterSections = (Array.isArray(after) ? after : []).map(asSection);

  const m = beforeSections.length;
  const n = afterSections.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = sameKey(beforeSections[i], afterSections[j])
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: SectionDiff[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (sameKey(beforeSections[i], afterSections[j])) {
      const b = beforeSections[i];
      const a = afterSections[j];
      out.push({
        instanceId: b.instanceId,
        templateRef: b.templateRef || a.templateRef,
        status: i === j ? 'unchanged' : 'moved',
        beforeIndex: i,
        afterIndex: j,
        beforeContent: b.content,
        afterContent: a.content,
        changes: diffObjects(b.content, a.content),
      });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({
        instanceId: beforeSections[i].instanceId,
        templateRef: beforeSections[i].templateRef,
        status: 'removed',
        beforeIndex: i,
        beforeContent: beforeSections[i].content,
        afterContent: undefined,
        changes: [],
      });
      i++;
    } else {
      out.push({
        instanceId: afterSections[j].instanceId,
        templateRef: afterSections[j].templateRef,
        status: 'added',
        afterIndex: j,
        beforeContent: undefined,
        afterContent: afterSections[j].content,
        changes: [],
      });
      j++;
    }
  }
  while (i < m) {
    out.push({
      instanceId: beforeSections[i].instanceId,
      templateRef: beforeSections[i].templateRef,
      status: 'removed',
      beforeIndex: i,
      beforeContent: beforeSections[i].content,
      afterContent: undefined,
      changes: [],
    });
    i++;
  }
  while (j < n) {
    out.push({
      instanceId: afterSections[j].instanceId,
      templateRef: afterSections[j].templateRef,
      status: 'added',
      afterIndex: j,
      beforeContent: undefined,
      afterContent: afterSections[j].content,
      changes: [],
    });
    j++;
  }
  return out;
}

