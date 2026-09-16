import { describe, expect, it } from 'vitest';
import {
  childTemplates,
  concreteTemplates,
  descendantProblemsOf,
  diagnosticsOf,
  inheritanceBreadcrumb,
  inheritedGroups,
  normalizeDescendants,
  sortDiagnostics,
  templateInUseOf,
} from './inheritance.util';

const ARTICLE = {
  uuid: 'a-3',
  uid: 'article',
  ancestors: [
    { uuid: 'a-2', uid: 'docs_layout' },
    { uuid: 'a-1', uid: 'base' },
  ],
  inheritedFrom: {
    editors: { subtitle: 'docs_layout', title: 'base', _group_base_1: 'base' },
    bodies: { main: 'base' },
  },
};

describe('inheritanceBreadcrumb', () => {
  it('lists a three-level chain root first, ending at the template itself', () => {
    expect(inheritanceBreadcrumb(ARTICLE)).toEqual([
      { uuid: 'a-1', uid: 'base', current: false },
      { uuid: 'a-2', uid: 'docs_layout', current: false },
      { uuid: 'a-3', uid: 'article', current: true },
    ]);
  });

  it('is empty for a template without ancestors', () => {
    expect(inheritanceBreadcrumb({ uuid: 'x', uid: 'x', ancestors: [] })).toEqual([]);
    expect(inheritanceBreadcrumb(null)).toEqual([]);
  });
});

describe('inheritedGroups', () => {
  it('groups inherited editors and bodies by declaring ancestor, root first', () => {
    expect(inheritedGroups(ARTICLE)).toEqual([
      { uid: 'base', uuid: 'a-1', editors: ['title', '(group)'], bodies: ['main'] },
      { uid: 'docs_layout', uuid: 'a-2', editors: ['subtitle'], bodies: [] },
    ]);
  });

  it('is empty when nothing is inherited', () => {
    expect(inheritedGroups({ uid: 'solo', inheritedFrom: { editors: {}, bodies: {} } })).toEqual([]);
  });
});

describe('concreteTemplates', () => {
  it('leaves abstract templates out of page pickers', () => {
    const list = [
      { uuid: '1', uid: 'base', abstract: true },
      { uuid: '2', uid: 'article', abstract: false },
      { uuid: '3', uid: 'legacy' },
    ];
    expect(concreteTemplates(list).map((t) => t.uid)).toEqual(['article', 'legacy']);
  });
});

describe('childTemplates', () => {
  it('keeps only parent edges of templates, sorted by uid', () => {
    expect(
      childTemplates([
        { fromUuid: 'p', fromUid: 'page1', fromType: 'PAGE', kind: 'TEMPLATE', sourcePath: 'templateRef' },
        { fromUuid: 'c2', fromUid: 'landing', fromType: 'PAGE_TEMPLATE', kind: 'TEMPLATE', sourcePath: 'parentTemplateRef' },
        { fromUuid: 'c1', fromUid: 'article', fromType: 'PAGE_TEMPLATE', kind: 'TEMPLATE', sourcePath: 'parentTemplateRef' },
        { fromUuid: 'o', fromUid: 'other', fromType: 'PAGE_TEMPLATE', kind: 'OCTL_REF', sourcePath: 'channelTemplates.html' },
      ]),
    ).toEqual([
      { uuid: 'c1', uid: 'article' },
      { uuid: 'c2', uid: 'landing' },
    ]);
  });
});

/** The shape of an `HttpErrorResponse` as the util reads it. */
function problem(status: number, body: unknown): { status: number; error: unknown } {
  return { status, error: body };
}

describe('error shapes', () => {
  it('reads broken descendants from a rejected parent save', () => {
    const err = problem(422, {
      code: 'SF-DOM-0124',
      detail: 'This change would break 1 template that extends it: article',
      descendants: [
        { uuid: 'a-3', uid: 'article', channel: null, diagnostics: [{ severity: 'ERROR', code: 'SF-CDL-0109', message: 'x' }] },
      ],
    });
    expect(descendantProblemsOf(err)).toEqual([
      { uuid: 'a-3', uid: 'article', channel: null, diagnostics: [{ severity: 'ERROR', code: 'SF-CDL-0109', message: 'x' }] },
    ]);
    expect(descendantProblemsOf(problem(422, { code: 'SF-API-0422', diagnostics: [] }))).toBeNull();
  });

  it('reads the page count of a template that pages still use', () => {
    const err = problem(422, {
      code: 'SF-DOM-0122',
      pageCount: 2,
      pageUids: ['one', 'two'],
      pageUuids: ['u1', 'u2'],
      detail: '2 pages use this template',
    });
    expect(templateInUseOf(err)).toEqual({
      pageCount: 2,
      pageUids: ['one', 'two'],
      pageUuids: ['u1', 'u2'],
      message: '2 pages use this template',
    });
    expect(templateInUseOf(problem(409, { code: 'SF-DOM-0120' }))).toBeNull();
  });

  it('reads compile diagnostics and tolerates other errors', () => {
    expect(diagnosticsOf(problem(422, { diagnostics: [{ code: 'SF-TPL-0154' }] }))).toEqual([{ code: 'SF-TPL-0154' }]);
    expect(diagnosticsOf(new Error('boom'))).toEqual([]);
    expect(normalizeDescendants(undefined)).toEqual([]);
  });

  it('orders diagnostics errors first, then by position', () => {
    expect(
      sortDiagnostics([
        { severity: 'WARNING', code: 'w', line: 1 },
        { severity: 'ERROR', code: 'e2', line: 3, column: 1 },
        { severity: 'ERROR', code: 'e1', line: 1, column: 5 },
      ]).map((d) => d.code),
    ).toEqual(['e1', 'e2', 'w']);
  });
});
