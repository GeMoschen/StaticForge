import type { QualityRuleItem, QualityRuleParam, QualityRulesRequest } from './quality-rules.service';

/** How a project treats a rule's findings (M30, epic decisions 4 and 5), in increasing order. */
export type QualitySeverity = 'OFF' | 'WARNING' | 'ERROR';

export const SEVERITIES: readonly { value: QualitySeverity; label: string }[] = [
  { value: 'OFF', label: 'Off' },
  { value: 'WARNING', label: 'Warning' },
  { value: 'ERROR', label: 'Error' },
];

/** The rule groups of the Quality tab, in the order of the code ranges (`01xx` links, `02xx` SEO, `03xx` a11y). */
export const CATEGORIES: readonly { key: string; label: string }[] = [
  { key: 'LINKS', label: 'Links' },
  { key: 'SEO', label: 'SEO' },
  { key: 'ACCESSIBILITY', label: 'Accessibility' },
];

/** An integer parameter as typed (validated before saving), a boolean one as its value. */
export type ParamDraft = string | boolean;

/** One rule as the form edits it. */
export interface RuleDraft {
  severity: QualitySeverity;
  params: Record<string, ParamDraft>;
}

/** The form: every rule's draft by code. */
export type QualityDraft = Record<string, RuleDraft>;

/** The rules grouped by category, each group in the server's (code) order; empty groups are left out. */
export function groupRules(rules: readonly QualityRuleItem[]): { key: string; label: string; rules: QualityRuleItem[] }[] {
  return CATEGORIES.map((category) => ({
    ...category,
    rules: rules.filter((rule) => rule.category === category.key),
  })).filter((group) => group.rules.length > 0);
}

/** The UI wording of a rule's `fixHint` (where its findings are usually fixed). */
export function fixHintLabel(hint: string | undefined): string {
  switch (hint) {
    case 'CONTENT':
      return 'Fix in content';
    case 'CONTENT_OR_TEMPLATE':
      return 'Content or template';
    default:
      return 'Fix in the template';
  }
}

const RANK: Record<QualitySeverity, number> = { OFF: 0, WARNING: 1, ERROR: 2 };

/** `value` as a severity; anything unknown reads as the server's default, `WARNING`. */
export function severityOf(value: string | undefined): QualitySeverity {
  return value === 'OFF' || value === 'ERROR' ? value : 'WARNING';
}

/** The highest severity `rule`'s findings get, whatever is configured (`maxSeverity`, e.g. `WARNING` for `0103`). */
export function maxSeverityOf(rule: QualityRuleItem): QualitySeverity {
  return rule.maxSeverity === undefined ? 'ERROR' : severityOf(rule.maxSeverity);
}

/** Whether `rule` can't take `severity` — it would be capped at its maximum. */
export function isCapped(rule: QualityRuleItem, severity: QualitySeverity): boolean {
  return RANK[severity] > RANK[maxSeverityOf(rule)];
}

/** The severity `rule`'s findings get when `severity` is configured: capped at the rule's maximum (as the server). */
export function effectiveSeverity(rule: QualityRuleItem, severity: QualitySeverity): QualitySeverity {
  return isCapped(rule, severity) ? maxSeverityOf(rule) : severity;
}

function paramDraft(param: QualityRuleParam, value: unknown): ParamDraft {
  if (param.type === 'BOOLEAN') {
    return value === true;
  }
  return typeof value === 'number' ? String(value) : '';
}

/** `rule` as the server says it is configured. */
export function draftOf(rule: QualityRuleItem): RuleDraft {
  const params: Record<string, ParamDraft> = {};
  for (const param of rule.params ?? []) {
    params[param.name ?? ''] = paramDraft(param, param.value ?? param.defaultValue);
  }
  return { severity: severityOf(rule.severity), params };
}

/** `rule` at its defaults ("Reset to default"). */
export function defaultDraftOf(rule: QualityRuleItem): RuleDraft {
  const params: Record<string, ParamDraft> = {};
  for (const param of rule.params ?? []) {
    params[param.name ?? ''] = paramDraft(param, param.defaultValue);
  }
  return { severity: severityOf(rule.defaultSeverity), params };
}

/** An integer parameter's text as a number; `null` when it isn't a whole number. */
export function integerOf(text: ParamDraft): number | null {
  if (typeof text !== 'string' || !/^\s*-?\d+\s*$/.test(text)) {
    return null;
  }
  return Number(text.trim());
}

/** Two values of one parameter mean the same (`060` and `60` are the same number). */
function sameParam(x: ParamDraft | undefined, y: ParamDraft | undefined): boolean {
  if (typeof x === 'string' && typeof y === 'string') {
    const nx = integerOf(x);
    const ny = integerOf(y);
    return nx !== null && ny !== null ? nx === ny : x.trim() === y.trim();
  }
  return x === y;
}

/** Two drafts of the same rule configure the same thing. */
export function sameDraft(a: RuleDraft | undefined, b: RuleDraft | undefined): boolean {
  if (!a || !b) {
    return a === b;
  }
  const names = new Set([...Object.keys(a.params), ...Object.keys(b.params)]);
  return a.severity === b.severity && [...names].every((name) => sameParam(a.params[name], b.params[name]));
}

/** Why an integer parameter's text isn't valid, as the server checks it (`RuleParam.problemWith`); `null` if it is. */
export function paramError(param: QualityRuleParam, value: ParamDraft): string | null {
  if (param.type === 'BOOLEAN') {
    return null;
  }
  const number = integerOf(value);
  const { min, max } = param;
  // The API sends `null` for a bound a parameter doesn't have.
  const range =
    min != null && max != null
      ? `from ${min} to ${max}`
      : min != null
        ? `of at least ${min}`
        : max != null
          ? `of at most ${max}`
          : '';
  if (number === null || (min != null && number < min) || (max != null && number > max)) {
    return `Enter a whole number${range ? ` ${range}` : ''}.`;
  }
  return null;
}

/**
 * What is wrong with `draft` before it is sent: each invalid parameter, and a `min` above the `max` — the length
 * rules' `paramsProblem`, which the server enforces too.
 */
export function ruleErrors(rule: QualityRuleItem, draft: RuleDraft | undefined): string[] {
  if (!draft) {
    return [];
  }
  const errors: string[] = [];
  for (const param of rule.params ?? []) {
    const problem = paramError(param, draft.params[param.name ?? '']);
    if (problem) {
      errors.push(`${paramLabel(param.name)}: ${problem}`);
    }
  }
  const integer = (name: string) =>
    rule.params?.some((param) => param.name === name && param.type === 'INTEGER') ? integerOf(draft.params[name]) : null;
  const min = integer('min');
  const max = integer('max');
  if (errors.length === 0 && min !== null && max !== null && min > max) {
    errors.push(`The minimum (${min}) must not be greater than the maximum (${max}).`);
  }
  return errors;
}

/** A parameter's label from its name (`min` → "Minimum", `required` → "Required", `maxDepth` → "Max depth"). */
export function paramLabel(name: string | undefined): string {
  if (name === 'min') {
    return 'Minimum';
  }
  if (name === 'max') {
    return 'Maximum';
  }
  const words = (name ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The `PUT` body for `draft`: only what differs from a rule's defaults, since a rule left out is at its default — so
 * "Reset to default" really removes the rule's configuration. Call it only when {@link ruleErrors} finds nothing.
 */
export function requestOf(rules: readonly QualityRuleItem[], draft: QualityDraft): QualityRulesRequest {
  const body: NonNullable<QualityRulesRequest['rules']> = {};
  for (const rule of rules) {
    const code = rule.code ?? '';
    const current = draft[code];
    if (!current) {
      continue;
    }
    const defaults = defaultDraftOf(rule);
    const entry: { severity?: string; params?: Record<string, number | boolean> } = {};
    if (current.severity !== defaults.severity) {
      entry.severity = current.severity;
    }
    for (const param of rule.params ?? []) {
      const name = param.name ?? '';
      const value = current.params[name];
      if (!sameParam(value, defaults.params[name])) {
        entry.params = { ...entry.params, [name]: typeof value === 'boolean' ? value : (integerOf(value) ?? 0) };
      }
    }
    if (entry.severity !== undefined || entry.params !== undefined) {
      body[code] = entry as NonNullable<QualityRulesRequest['rules']>[string];
    }
  }
  return { rules: body };
}

/**
 * The server's validation messages (`"SF-CHK-0201: min (70) must not be greater than max (60)."`) by the rule they
 * name; a message naming no listed rule goes to `other`.
 */
export function errorsByRule(
  errors: readonly string[],
  codes: readonly string[],
): { byCode: Record<string, string[]>; other: string[] } {
  const byCode: Record<string, string[]> = {};
  const other: string[] = [];
  for (const error of errors) {
    const separator = error.indexOf(':');
    const code = separator > 0 ? error.slice(0, separator).trim() : '';
    if (codes.includes(code)) {
      (byCode[code] ??= []).push(error.slice(separator + 1).trim());
    } else {
      other.push(error);
    }
  }
  return { byCode, other };
}
