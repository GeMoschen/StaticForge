/**
 * Template inheritance (M20.4.1) as the template screen and the pickers see it — framework-free functions over the
 * API shapes, so the rules are unit-tested without rendering a component.
 */

export interface InheritanceDiagnostic {
  severity?: string;
  code?: string;
  message?: string;
  line?: number;
  column?: number;
}

export interface TemplateRef {
  uuid?: string;
  uid?: string;
}

/** The parts of a template detail inheritance reads. */
export interface InheritanceDetail {
  uuid?: string;
  uid?: string;
  displayName?: string;
  ancestors?: TemplateRef[];
  effectiveDefinition?: unknown;
  inheritedFrom?: { editors?: Record<string, string>; bodies?: Record<string, string> } | null;
}

export interface BreadcrumbItem {
  uuid: string;
  uid: string;
  current: boolean;
}

/** Root layout first, the template itself last: `base › docs_layout › article`. Empty without ancestors. */
export function inheritanceBreadcrumb(detail: InheritanceDetail | null | undefined): BreadcrumbItem[] {
  const ancestors = detail?.ancestors ?? [];
  if (!detail || ancestors.length === 0) {
    return [];
  }
  const items: BreadcrumbItem[] = [...ancestors]
    .reverse()
    .map((ancestor) => ({ uuid: ancestor.uuid ?? '', uid: ancestor.uid ?? ancestor.uuid ?? '', current: false }));
  items.push({ uuid: detail.uuid ?? '', uid: detail.uid ?? detail.uuid ?? '', current: true });
  return items;
}

export interface InheritedGroup {
  /** The declaring ancestor's uid. */
  uid: string;
  /** Its UUID when it is one of the detail's ancestors, for a link. */
  uuid: string | null;
  editors: string[];
  bodies: string[];
}

/**
 * Inherited editors and bodies grouped by the ancestor that declares them, root layout first (the order of the
 * breadcrumb). Read-only by design: editing a parent's editor from a child would change every sibling.
 */
export function inheritedGroups(detail: InheritanceDetail | null | undefined): InheritedGroup[] {
  const editors = detail?.inheritedFrom?.editors ?? {};
  const bodies = detail?.inheritedFrom?.bodies ?? {};
  const ancestors = [...(detail?.ancestors ?? [])].reverse();
  const order = ancestors.map((a) => a.uid ?? '');
  const groups = new Map<string, InheritedGroup>();
  const group = (uid: string): InheritedGroup => {
    let found = groups.get(uid);
    if (!found) {
      const ancestor = ancestors.find((a) => a.uid === uid);
      found = { uid, uuid: ancestor?.uuid ?? null, editors: [], bodies: [] };
      groups.set(uid, found);
    }
    return found;
  };
  for (const [name, uid] of Object.entries(editors)) {
    group(uid).editors.push(displayEditorName(name));
  }
  for (const [name, uid] of Object.entries(bodies)) {
    group(uid).bodies.push(name);
  }
  const rank = (uid: string) => {
    const index = order.indexOf(uid);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  return [...groups.values()].sort((a, b) => rank(a.uid) - rank(b.uid));
}

/** Synthetic group wrappers (`_group_base_1`) have no name of their own worth showing. */
function displayEditorName(name: string): string {
  return name.startsWith('_group_') ? '(group)' : name;
}

/** Page templates a page may use: every template not marked `abstract`. */
export function concreteTemplates<T extends { abstract?: boolean }>(templates: readonly T[]): T[] {
  return templates.filter((template) => !template.abstract);
}

export interface UsageLike {
  fromUuid?: string;
  fromUid?: string;
  fromType?: string;
  kind?: string;
  sourcePath?: string;
}

/** The templates that extend this one, from its usages: `TEMPLATE` edges recorded from `parentTemplateRef`. */
export function childTemplates(usages: readonly UsageLike[] | null | undefined): TemplateRef[] {
  return (usages ?? [])
    .filter((u) => u.kind === 'TEMPLATE' && u.sourcePath === 'parentTemplateRef')
    .map((u) => ({ uuid: u.fromUuid, uid: u.fromUid }))
    .sort((a, b) => (a.uid ?? '').localeCompare(b.uid ?? ''));
}

export interface DescendantProblem {
  uuid: string;
  uid: string;
  channel: string | null;
  diagnostics: InheritanceDiagnostic[];
}

/** The problem body of an HTTP error response (`HttpErrorResponse.error`), or `null`. */
function problemBody(err: unknown): Record<string, unknown> | null {
  const body = typeof err === 'object' && err !== null ? (err as { error?: unknown }).error : null;
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/** Compile diagnostics of a rejected save (`422 SF-API-0422`), or `[]`. */
export function diagnosticsOf(err: unknown): InheritanceDiagnostic[] {
  const body = problemBody(err);
  return Array.isArray(body?.['diagnostics']) ? (body['diagnostics'] as InheritanceDiagnostic[]) : [];
}

/** The broken descendants of a rejected parent save (`422 SF-DOM-0124`), or `null` for any other error. */
export function descendantProblemsOf(err: unknown): DescendantProblem[] | null {
  const body = problemBody(err);
  if (body?.['code'] !== 'SF-DOM-0124' || !Array.isArray(body['descendants'])) {
    return null;
  }
  return normalizeDescendants(body['descendants']);
}

/** Descendant warnings as the API returns them on a successful save. */
export function normalizeDescendants(raw: unknown): DescendantProblem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    return {
      uuid: String(item['uuid'] ?? ''),
      uid: String(item['uid'] ?? item['uuid'] ?? ''),
      channel: typeof item['channel'] === 'string' ? item['channel'] : null,
      diagnostics: Array.isArray(item['diagnostics']) ? (item['diagnostics'] as InheritanceDiagnostic[]) : [],
    };
  });
}

export interface TemplateInUse {
  pageCount: number;
  pageUids: string[];
  /** The UUIDs of the listed pages, index-aligned with `pageUids`, for links. */
  pageUuids: string[];
  message: string;
}

/** A template that pages still use can't become abstract (`422 SF-DOM-0122`); `null` for any other error. */
export function templateInUseOf(err: unknown): TemplateInUse | null {
  const body = problemBody(err);
  if (body?.['code'] !== 'SF-DOM-0122') {
    return null;
  }
  return {
    pageCount: Number(body['pageCount'] ?? 0),
    pageUids: Array.isArray(body['pageUids']) ? (body['pageUids'] as string[]) : [],
    pageUuids: Array.isArray(body['pageUuids']) ? (body['pageUuids'] as string[]) : [],
    message: String(body['detail'] ?? ''),
  };
}

/** `line:col — message` ordering for diagnostics lists: errors first, then by position. */
export function sortDiagnostics(diagnostics: readonly InheritanceDiagnostic[]): InheritanceDiagnostic[] {
  const severity = (d: InheritanceDiagnostic) => (d.severity === 'ERROR' ? 0 : 1);
  return [...diagnostics].sort(
    (a, b) => severity(a) - severity(b) || (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0),
  );
}
