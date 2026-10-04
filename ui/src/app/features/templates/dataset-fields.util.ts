import type { EditorDefinition } from '../forms/form.model';

/** One row of the dataset overview's fields table. */
export interface DatasetField {
  readonly name: string;
  readonly label: string;
  /** The editor type as the CDL names it (`text`, `select`, …). */
  readonly type: string;
  readonly required: boolean;
  readonly localized: boolean;
  /** How many `rule`, `state` and `fill` entries of the Rules tab target the field. */
  readonly rules: number;
}

/**
 * The record fields of a dataset for the overview table: the top-level editors of the compiled definition (groups are
 * flattened — a group is only layout), with how many rules target each one in the Rules source.
 */
export function datasetFields(editors: readonly EditorDefinition[] | null | undefined, rulesCdl: string): DatasetField[] {
  const out: DatasetField[] = [];
  const walk = (list: readonly EditorDefinition[] | undefined) => {
    for (const editor of list ?? []) {
      if (editor.type === 'GROUP') {
        walk(editor.items);
        continue;
      }
      out.push({
        name: editor.name,
        label: editor.label || editor.name,
        type: String(editor.type).toLowerCase(),
        required: !!editor.required,
        localized: !!editor.localizable,
        rules: ruleCount(rulesCdl, editor.name),
      });
    }
  };
  walk(editors ?? undefined);
  return out;
}

/** The entries of a Rules source that target `field`: `rule "…" on field`, `state field` and `fill field` (also `field[]`). */
export function ruleCount(rulesCdl: string, field: string): number {
  if (!rulesCdl) {
    return 0;
  }
  const name = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:\\brule\\s+"[^"]*"\\s+on|\\bstate|\\bfill)\\s+${name}(?![\\w-])`, 'g');
  return (rulesCdl.match(pattern) ?? []).length;
}
