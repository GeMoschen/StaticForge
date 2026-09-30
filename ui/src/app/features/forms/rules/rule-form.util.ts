import { AbstractControl, FormArray, FormGroup } from '@angular/forms';
import type { EditorDefinition } from '../form.model';
import type { FieldState, RuleFill, RuleFinding } from './rule-evaluator';

/** One step of a content path: a field name, then the list rows after it (`gallery[2]` → `gallery`, `[2]`). */
interface Step {
  name: string;
  rows: number[];
}

/** `content.gallery[2].caption` under prefix `content` → `gallery[2]`, `caption`; `null` outside the prefix. */
export function pathSteps(path: string, prefix: string): Step[] | null {
  const head = prefix ? `${prefix}.` : '';
  if (!path.startsWith(head)) {
    return null;
  }
  const rest = path.slice(head.length);
  if (!rest) {
    return null;
  }
  const steps: Step[] = [];
  for (const part of rest.split('.')) {
    const match = /^([^[\]]+)((?:\[\d+\])*)$/.exec(part);
    if (!match) {
      return null;
    }
    const rows = [...match[2].matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    steps.push({ name: match[1], rows });
  }
  return steps;
}

/**
 * The control a content path names in a form built from `editors`. Groups are transparent in stored content
 * (`content.title` may live in a group's form group), so a name is looked up among the editors of one level, groups
 * included. `null` when the path doesn't reach a control (a removed row, an unknown field).
 */
export function controlAt(
  form: FormGroup,
  editors: readonly EditorDefinition[],
  path: string,
  prefix = 'content',
): AbstractControl | null {
  const steps = pathSteps(path, prefix);
  if (!steps) {
    return null;
  }
  let group: FormGroup = form;
  let level: readonly EditorDefinition[] = editors;
  for (let i = 0; i < steps.length; i++) {
    const found = find(group, level, steps[i].name);
    if (!found) {
      return null;
    }
    let control: AbstractControl | null = found.control;
    let editor = found.editor;
    for (const row of steps[i].rows) {
      control = control instanceof FormArray ? control.at(row) ?? null : null;
      if (!control) {
        return null;
      }
    }
    if (i === steps.length - 1) {
      return control;
    }
    if (!(control instanceof FormGroup)) {
      return null;
    }
    group = control;
    level = editor.items ?? [];
  }
  return null;
}

/** An editor named `name` at one level, looking through groups; with the control holding it. */
function find(
  group: FormGroup,
  editors: readonly EditorDefinition[],
  name: string,
): { editor: EditorDefinition; control: AbstractControl } | null {
  for (const editor of editors) {
    if (editor.type === 'GROUP') {
      const inner = group.get(editor.name);
      if (inner instanceof FormGroup) {
        const nested = find(inner, editor.items ?? [], name);
        if (nested) {
          return nested;
        }
      }
    } else if (editor.name === name) {
      const control = group.get(editor.name);
      return control ? { editor, control } : null;
    }
  }
  return null;
}

/** A form value is empty the way the server sees it: null, blank text, an empty list or object. */
export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim() === '';
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if ('value' in object && Object.keys(object).length <= 2) {
      return isEmptyValue(object['value']);
    }
    if ('uuid' in object) {
      return isEmptyValue(object['uuid']);
    }
    return Object.keys(object).length === 0;
  }
  return false;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * The live fills of one form (M33.8, epic decision 12). A `mode empty` fill writes a field that is empty or still holds
 * what the last fill wrote — so the slug follows the title until the user types their own; a `mode always` fill always
 * writes (its field is read-only). Fills are set without an event: applying one doesn't count as an edit by itself; the
 * next save carries it.
 *
 * <p>The server fills a `mode empty` field only when it is empty, so {@link prepare} blanks the fields that still hold
 * the last fill before a request: the server then computes them again from the new value.
 */
export class FillTracker {
  private readonly filled = new Map<string, unknown>();

  constructor(readonly prefix = 'content') {}

  /** A copy of the request `content` with every field still holding its last live fill blanked. */
  prepare(
    content: Record<string, unknown>,
    form: FormGroup,
    editors: readonly EditorDefinition[],
  ): Record<string, unknown> {
    if (this.filled.size === 0) {
      return content;
    }
    const copy = structuredClone(content);
    for (const [path, value] of this.filled) {
      const control = controlAt(form, editors, path, this.prefix);
      if (!control || !same(control.value, value)) {
        this.filled.delete(path);
        continue;
      }
      const steps = pathSteps(path, this.prefix);
      if (steps) {
        blank(copy, steps);
      }
    }
    return copy;
  }

  /**
   * Blanks, in a request `root` whose keys are the path roots (`{content, bodies}`), every field of this form that
   * still holds its last live fill — as {@link prepare} does for a content object, for forms nested deeper in the
   * request (a body section, a catalog card).
   */
  blankFilled(root: Record<string, unknown>, form: FormGroup, editors: readonly EditorDefinition[]): void {
    for (const [path, value] of this.filled) {
      const control = controlAt(form, editors, path, this.prefix);
      if (!control || !same(control.value, value)) {
        this.filled.delete(path);
        continue;
      }
      const steps = pathSteps(path, '');
      if (steps) {
        blank(root, steps);
      }
    }
  }

  /**
   * Applies `fills` to the form; `locale` is the language edited (`null` without languages) — a fill of another
   * language is left to the save. Returns the paths it wrote.
   */
  apply(
    fills: readonly RuleFill[],
    form: FormGroup,
    editors: readonly EditorDefinition[],
    locale: string | null = null,
  ): string[] {
    const written: string[] = [];
    for (const fill of fills) {
      const path = fill.path ?? '';
      if (fill.locale && locale && fill.locale !== locale) {
        continue;
      }
      const control = controlAt(form, editors, path, this.prefix);
      if (!control) {
        continue;
      }
      const current = control.value;
      if (fill.mode === 'EMPTY' && !isEmptyValue(current) && !same(current, this.filled.get(path))) {
        continue;
      }
      if (same(current, fill.value)) {
        this.filled.set(path, fill.value);
        continue;
      }
      control.setValue(fill.value ?? null, { emitEvent: false });
      this.filled.set(path, fill.value);
      written.push(path);
    }
    return written;
  }

  /** Whether `path` currently holds a live fill (for the "computed" hint). */
  holdsFill(path: string): boolean {
    return this.filled.has(path);
  }
}

function blank(target: Record<string, unknown>, steps: Step[]): void {
  let node: unknown = target;
  for (let i = 0; i < steps.length; i++) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      return;
    }
    const object = node as Record<string, unknown>;
    const step = steps[i];
    const last = i === steps.length - 1;
    if (last && step.rows.length === 0) {
      object[step.name] = null;
      return;
    }
    let child: unknown = object[step.name];
    for (let r = 0; r < step.rows.length; r++) {
      if (!Array.isArray(child)) {
        return;
      }
      if (last && r === step.rows.length - 1) {
        child[step.rows[r]] = null;
        return;
      }
      child = child[step.rows[r]];
    }
    node = child;
  }
}

/**
 * Applies the field states to the form (M33.8): a field read-only by a rule (a `readOnlyWhen` that holds, a
 * `mode always` fill) is disabled, and enabled again when the state goes — but never a field the definition makes
 * read-only. Returns the paths now disabled by rules, for the next call.
 */
export function applyFieldStates(
  states: readonly FieldState[],
  form: FormGroup,
  editors: readonly EditorDefinition[],
  previouslyDisabled: ReadonlySet<string>,
  locale: string | null = null,
  prefix = 'content',
): Set<string> {
  const disabled = new Set<string>();
  for (const state of states) {
    if (!state.readOnly || (state.locale && locale && state.locale !== locale)) {
      continue;
    }
    const path = state.path ?? '';
    const control = controlAt(form, editors, path, prefix);
    if (!control) {
      continue;
    }
    if (control.enabled) {
      control.disable({ emitEvent: false });
      disabled.add(path);
    } else if (previouslyDisabled.has(path)) {
      disabled.add(path);
    }
  }
  for (const path of previouslyDisabled) {
    if (disabled.has(path)) {
      continue;
    }
    const control = controlAt(form, editors, path, prefix);
    if (control?.disabled) {
      control.enable({ emitEvent: false });
    }
  }
  return disabled;
}

/**
 * The content path of `target` inside `form` built from `editors`, under `prefix` — how a nested editor (a catalog)
 * learns where its value sits (`content.rows[2].cards`). Groups are transparent; `null` when it isn't in the form.
 */
export function pathOfControl(
  form: FormGroup,
  editors: readonly EditorDefinition[],
  target: AbstractControl,
  prefix: string,
): string | null {
  const visit = (group: FormGroup, level: readonly EditorDefinition[], base: string): string | null => {
    for (const editor of level) {
      const control = group.get(editor.name);
      if (!control) {
        continue;
      }
      if (editor.type === 'GROUP') {
        const inner = control instanceof FormGroup ? visit(control, editor.items ?? [], base) : null;
        if (inner) {
          return inner;
        }
        continue;
      }
      const path = base ? `${base}.${editor.name}` : editor.name;
      if (control === target) {
        return path;
      }
      if (editor.type === 'LIST' && control instanceof FormArray) {
        for (let i = 0; i < control.length; i++) {
          const row = control.at(i);
          const found = row instanceof FormGroup ? visit(row, editor.items ?? [], `${path}[${i}]`) : null;
          if (found) {
            return found;
          }
        }
      }
    }
    return null;
  };
  return visit(form, editors, prefix);
}

/** The levels a finding can have, most severe first; hints only show in the editor. */
export type FindingLevel = 'ERROR' | 'WARNING' | 'INFO' | 'HINT';

export function levelOf(finding: { severity?: string | null }): FindingLevel {
  switch (finding.severity) {
    case 'ERROR':
    case 'WARNING':
    case 'INFO':
    case 'HINT':
      return finding.severity;
    default:
      return 'WARNING';
  }
}

const LEVEL_RANK: Record<FindingLevel, number> = { ERROR: 0, WARNING: 1, INFO: 2, HINT: 3 };

/** Findings most severe first, the server's order within a level. */
export function byLevel<T extends { severity?: string | null }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => LEVEL_RANK[levelOf(a.item)] - LEVEL_RANK[levelOf(b.item)] || a.index - b.index)
    .map(({ item }) => item);
}

/** Whether a finding concerns the language being edited (a finding of another language doesn't show here). */
export function inLocale(finding: RuleFinding, locale: string | null): boolean {
  return !locale || !finding.locale || finding.locale === locale;
}
