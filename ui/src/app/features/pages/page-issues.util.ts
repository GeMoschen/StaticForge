import type { components } from '../../core/api/generated/schema.d.ts';

type S = components['schemas'];

export type DraftCheckView = S['DraftCheckView'];
export type DraftFindingView = S['DraftFindingView'];
export type ContentIssue = S['ContentIssue'];

/** Where an issue points the editor (M30.3.2): a field, a section, an element of the preview — any of them may be missing. */
export interface IssueTarget {
  /** The content field to fix: `content.title`, `bodies.main[1].content.image`. */
  editorPath: string | null;
  /** The section instance that rendered the element. */
  sectionInstanceId: string | null;
  /** The element in the rendered page. */
  selector: string | null;
}

/** A field of the page's content, resolved against its bodies. */
export type FieldLocation =
  /** One of the page's own fields (`content.<editor>…`). */
  | { scope: 'page'; editor: string }
  /** A section of a body, and the field in it when the path names one (`bodies.<body>[<i>].content.<editor>…`). */
  | { scope: 'section'; body: string; index: number; editor: string | null };

const PAGE_FIELD = /^content\.([^.[\]]+)/;
const SECTION_FIELD = /^bodies\.([^.[\]]+)\[(\d+)\](?:\.content\.([^.[\]]+))?/;

/**
 * Where a content path points: a page field, or a section (and the top-level field inside it). A path into a list row or a
 * group member (`content.links[0].target`) points at its top-level editor, like the form's issue lines. `null` for
 * anything else (a whole body, the template reference of the page).
 */
export function locateField(path: string | null | undefined): FieldLocation | null {
  if (!path) {
    return null;
  }
  const page = PAGE_FIELD.exec(path);
  if (page) {
    return { scope: 'page', editor: page[1] };
  }
  const section = SECTION_FIELD.exec(path);
  if (section) {
    return { scope: 'section', body: section[1], index: Number(section[2]), editor: section[3] ?? null };
  }
  return null;
}

/** "Fix in content" / "Fix in template" from a rule's fix hint; `null` for none. */
export function fixHintLabel(hint: string | null | undefined): string | null {
  switch (hint) {
    case 'CONTENT':
      return 'Fix in content';
    case 'TEMPLATE':
      return 'Fix in template';
    case 'CONTENT_OR_TEMPLATE':
      return 'Fix in content or template';
    default:
      return null;
  }
}

const SEVERITY_RANK: Record<string, number> = { ERROR: 0, WARNING: 1, INFO: 2, HINT: 3 };

/** Errors first, then warnings, infos and hints (M33.8); the server's order within each. */
export function bySeverity<T extends { severity?: string | null }>(items: readonly T[]): T[] {
  const rank = (item: T) => SEVERITY_RANK[item.severity ?? ''] ?? 1;
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
    .map(({ item }) => item);
}

/** How many of `items` are errors. */
export function errorCount(items: readonly { severity?: string | null }[]): number {
  return items.filter((item) => item.severity === 'ERROR').length;
}

/** The label of a severity: "Error", "Warning", "Info", "Hint". */
export function severityLabel(severity: string | null | undefined): string {
  switch (severity) {
    case 'ERROR':
      return 'Error';
    case 'INFO':
      return 'Info';
    case 'HINT':
      return 'Hint';
    default:
      return 'Warning';
  }
}

/** "checked at 14:05". */
export function checkedAtLabel(at: Date): string {
  return `checked at ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/** Where a finding points; a content issue points at its path. */
export function findingTarget(finding: DraftFindingView): IssueTarget {
  return {
    editorPath: finding.editorPath ?? null,
    sectionInstanceId: finding.sectionInstanceId ?? null,
    selector: finding.selector ?? null,
  };
}

export function issueTarget(issue: ContentIssue): IssueTarget {
  return { editorPath: issue.path ?? null, sectionInstanceId: null, selector: null };
}

/**
 * Where the page editor goes for an issue (M30.3.2): which form to open and focus, and what to outline in the preview.
 * A page field opens the page's own fields; a section field opens that section (found by its body and index in the
 * page as it is now) and focuses the field; a finding with only a section instance opens the section; the preview
 * outlines the section — or, when the page doesn't mark sections, the element by its selector. Nothing for neither.
 *
 * @param sectionAt the instance id of section `index` of body `body`; `null` when there is none
 */
export function issueDestination(
  target: IssueTarget,
  sectionAt: (body: string, index: number) => string | null,
): IssueDestination {
  const field = locateField(target.editorPath);
  let section = target.sectionInstanceId;
  let form: IssueDestination['form'] = null;
  if (field?.scope === 'page') {
    section = null;
    form = { scope: 'page', editor: field.editor };
  } else {
    let editor: string | null = null;
    if (field?.scope === 'section') {
      section = sectionAt(field.body, field.index) ?? section;
      editor = field.editor;
    }
    if (section) {
      form = { scope: 'section', instanceId: section, editor };
    }
  }
  const preview = section || target.selector ? { instanceId: section, selector: target.selector } : null;
  return { form, preview };
}

/** What {@link issueDestination} decides. */
export interface IssueDestination {
  /** The form to open: the page's fields or one section, and the field to focus (`null`: the section itself). */
  form: { scope: 'page'; editor: string } | { scope: 'section'; instanceId: string; editor: string | null } | null;
  /** What to outline in the preview. */
  preview: { instanceId: string | null; selector: string | null } | null;
}

/**
 * The element an issue focuses in the page editor's centre column: the field `editor` of the page's own form (`section`
 * `null`) or of section `section`, else that section's card. A section counts only inside the section scope the editor
 * opens for it (`[data-sf-section-scope]`): right after `?section=` changes, the body scope's card with the same id is
 * still on screen and is about to be replaced — focusing it lost the focus and the highlight with it.
 *
 * @returns `null` while the scope isn't rendered yet
 */
export function issueFocusTarget(root: ParentNode, section: string | null, editor: string | null): HTMLElement | null {
  const scope =
    section === null
      ? root.querySelector<HTMLElement>('[data-sf-page-fields]')
      : root.querySelector<HTMLElement>(
          `[data-sf-section-scope="${cssValue(section)}"] [data-sf-section="${cssValue(section)}"]`,
        );
  const field =
    scope && editor
      ? scope.querySelector<HTMLElement>(
          `:scope ${section === null ? '' : '> .section-card__body > sf-content-form '}> .sf-content-form > [data-sf-editor="${cssValue(editor)}"]`,
        )
      : null;
  return field ?? (section === null ? null : scope);
}

/** `value` quoted for a CSS attribute selector (`[data-x="…"]`). */
function cssValue(value: string): string {
  return value.replace(/["\\]/g, (char) => `\\${char}`);
}

/** Whether clicking an issue can take the editor anywhere (else it only expands). */
export function hasTarget(target: IssueTarget): boolean {
  return target.editorPath !== null || target.sectionInstanceId !== null || target.selector !== null;
}
