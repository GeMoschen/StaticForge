import type { SfFinding } from '../../../../shared/components/forms/sf-finding.component';

/**
 * The findings a field shows (M35.17). A **required** error is shown once: the client's "This field is required" only
 * appears for an empty required field that has no error of its own — when a server rule already says it is missing
 * (or anything else is wrong), that finding stands alone. Findings keep their order, errors first, then warnings, info,
 * hints. Pure.
 */
export function mergeFindings(options: {
  findings: readonly SfFinding[];
  required: boolean;
  empty: boolean;
  requiredMessage: string;
}): SfFinding[] {
  const { findings, required, empty, requiredMessage } = options;
  const list = [...findings];
  if (required && empty && !list.some((finding) => finding.level === 'error')) {
    list.unshift({ level: 'error', message: requiredMessage });
  }
  const rank = { error: 0, warning: 1, info: 2, hint: 3 } as const;
  return list.sort((a, b) => rank[a.level] - rank[b.level]);
}

/** A link target the link dialog accepts: a web address, a mail link, a site-relative path or an anchor. */
export function isValidLinkTarget(value: string): boolean {
  const target = value.trim();
  return /^(https?:\/\/[^\s/$.?#][^\s]*|mailto:[^\s@]+@[^\s@]+|tel:[+\d][\d\s-]*|\/[^\s]*|#[^\s]+)$/i.test(target);
}

/** Moves the item at `from` to `to`; returns the same list when nothing changes. Pure. */
export function moveItem<T>(list: readonly T[], from: number, to: number): readonly T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return list;
  }
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
