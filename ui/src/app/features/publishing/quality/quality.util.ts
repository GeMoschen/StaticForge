import type { QualityRuleItem, QualityRuleParam, QualityRulesRequest } from './quality-rules.service';

/** How a project treats a rule's findings (M30, epic decisions 4 and 5), in increasing order. */
export type QualitySeverity = 'OFF' | 'WARNING' | 'ERROR';

export const SEVERITIES: readonly QualitySeverity[] = ['OFF', 'WARNING', 'ERROR'];

export const SEVERITY_ICONS: Readonly<Record<QualitySeverity, string>> = { OFF: 'block', WARNING: 'warning', ERROR: 'error' };

/** The rule groups, in the order of the code ranges (`01xx` links, `02xx` SEO, `03xx` accessibility). */
export const CATEGORIES = ['LINKS', 'SEO', 'ACCESSIBILITY'] as const;
export type QualityCategory = (typeof CATEGORIES)[number];

/** A rule setting as edited: a number (`null` while the field is empty) or a switch. */
export type ParamValue = number | boolean | null;

/** One rule as the form edits it. */
export interface RuleDraft {
  severity: QualitySeverity;
  params: Record<string, ParamValue>;
}

/** The form: every rule's draft by code. */
export type QualityDraft = Record<string, RuleDraft>;

export interface RuleGroup {
  category: QualityCategory;
  rules: QualityRuleItem[];
}

const RANK: Record<QualitySeverity, number> = { OFF: 0, WARNING: 1, ERROR: 2 };

/** `value` as a severity; anything unknown reads as the server's default, `WARNING`. */
export function severityOf(value: string | undefined): QualitySeverity {
  return value === 'OFF' || value === 'ERROR' ? value : 'WARNING';
}

/** The rules grouped by category, each group in the server's (code) order; empty groups are left out. */
export function groupRules(rules: readonly QualityRuleItem[]): RuleGroup[] {
  return CATEGORIES.map((category) => ({ category, rules: rules.filter((rule) => rule.category === category) })).filter(
    (group) => group.rules.length > 0,
  );
}

/** The highest severity `rule`'s findings get, whatever is configured (`maxSeverity`, e.g. `WARNING` for `0103`). */
export function maxSeverityOf(rule: QualityRuleItem): QualitySeverity {
  return rule.maxSeverity === undefined ? 'ERROR' : severityOf(rule.maxSeverity);
}

/** Whether `rule` can't take `severity`: it would be capped at its maximum. */
export function isCapped(rule: QualityRuleItem, severity: QualitySeverity): boolean {
  return RANK[severity] > RANK[maxSeverityOf(rule)];
}

/** The severity `rule`'s findings get when `severity` is configured: capped at the rule's maximum (as the server). */
export function effectiveSeverity(rule: QualityRuleItem, severity: QualitySeverity): QualitySeverity {
  return isCapped(rule, severity) ? maxSeverityOf(rule) : severity;
}

/**
 * The severity every rule of the group has under `draft`, or `null` while they differ. A rule capped at Warning counts
 * as Warning for a group-wide Error (what setting the group to Error gives it).
 */
export function groupSeverity(rules: readonly QualityRuleItem[], draft: QualityDraft): QualitySeverity | null {
  return SEVERITIES.find((level) => rules.every((rule) => draft[rule.code ?? '']?.severity === effectiveSeverity(rule, level))) ?? null;
}

function paramValue(param: QualityRuleParam, value: unknown): ParamValue {
  if (param.type === 'BOOLEAN') {
    return value === true;
  }
  return typeof value === 'number' ? value : null;
}

/** `rule` as the server says it is configured. */
export function draftOf(rule: QualityRuleItem): RuleDraft {
  return {
    severity: severityOf(rule.severity),
    params: Object.fromEntries((rule.params ?? []).map((p) => [p.name ?? '', paramValue(p, p.value ?? p.defaultValue)])),
  };
}

/** `rule` at its defaults ("Reset to default"). */
export function defaultDraftOf(rule: QualityRuleItem): RuleDraft {
  return {
    severity: severityOf(rule.defaultSeverity),
    params: Object.fromEntries((rule.params ?? []).map((p) => [p.name ?? '', paramValue(p, p.defaultValue)])),
  };
}

/** Two drafts of the same rule configure the same thing. */
export function sameDraft(a: RuleDraft | undefined, b: RuleDraft | undefined): boolean {
  if (!a || !b) {
    return a === b;
  }
  const names = new Set([...Object.keys(a.params), ...Object.keys(b.params)]);
  return a.severity === b.severity && [...names].every((name) => a.params[name] === b.params[name]);
}

/** Whether a number setting is empty, not a whole number or outside the range the server checks (`RuleParam`). */
export function paramInvalid(param: QualityRuleParam, value: ParamValue | undefined): boolean {
  if (param.type === 'BOOLEAN') {
    return false;
  }
  return (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    (param.min != null && value < param.min) ||
    (param.max != null && value > param.max)
  );
}

/** The settings of `rule` that are invalid in `draft`, by name. */
export function invalidParams(rule: QualityRuleItem, draft: RuleDraft | undefined): string[] {
  return (rule.params ?? []).filter((param) => paramInvalid(param, draft?.params[param.name ?? ''])).map((param) => param.name ?? '');
}

/** A `min` above the `max` of the same rule (the length rules' `paramsProblem`, which the server enforces too). */
export function minAboveMax(rule: QualityRuleItem, draft: RuleDraft | undefined): boolean {
  const number = (name: string) => {
    const value = draft?.params[name];
    return rule.params?.some((p) => p.name === name && p.type === 'INTEGER') && typeof value === 'number' ? value : null;
  };
  const min = number('min');
  const max = number('max');
  return min !== null && max !== null && min > max;
}

/**
 * The `PUT` body for `draft`: only what differs from a rule's defaults, since a rule left out is at its default, so
 * "Reset to default" really removes the rule's configuration. Call it only for a valid draft.
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
      if (value !== defaults.params[name] && value !== null && value !== undefined) {
        entry.params = { ...entry.params, [name]: value };
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

/** A setting's label from its name (`min` -> "Minimum", `required` -> "Required", `maxDepth` -> "Max depth"). */
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
