import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { DeveloperModeService } from '../../../../core/frame/developer-mode.service';
import { LocalesStore } from '../../../../core/project/locales.store';
import { EditingLocaleStore } from '../../../../core/project/editing-locale.store';
import { FindingFacetsView, GenerationService } from '../../../generation/generation.service';
import type { GenerationRunView } from '../runs.util';
import { RunFindingsComponent } from './run-findings.component';
import type { FindingView, QualityRuleItem } from './run-findings.util';

const PAGE_A = '852d2ed6-741b-40e0-bc03-193d760ff9cd';
const PAGE_B = 'c7969335-210e-4a59-8110-1fe2261a5e88';

const RUN: GenerationRunView = {
  id: 47,
  status: 'PARTIAL',
  findingCounts: { errors: 1, warnings: 2, byCategory: { links: 1, seo: 2 }, truncated: 0 },
};

// Findings as GET /findings sends them: sorted by output path, then code.
const FINDINGS: FindingView[] = [
  { id: 1, code: 'SF-CHK-0101', category: 'LINKS', severity: 'ERROR', message: 'Link to /shop/x.html is broken.', outputPath: 'de/news/a.html', locale: 'de', channel: 'html', page: { uuid: PAGE_A, uid: 'a', displayName: 'Spring harvest' } },
  { id: 2, code: 'SF-CHK-0204', category: 'SEO', severity: 'WARNING', message: 'Meta description is too short.', outputPath: 'de/team.html', locale: 'de', channel: 'html', carried: true, page: { uuid: PAGE_B, uid: 'team', displayName: 'Team' } },
  { id: 3, code: 'SF-CHK-0204', category: 'SEO', severity: 'WARNING', message: 'Meta description is too short.', outputPath: 'en/careers.html', locale: 'en', channel: 'html', page: { uuid: 'gone', uid: 'careers', displayName: 'Careers' } },
];
const FACETS: FindingFacetsView = {
  total: 3,
  severity: { ERROR: 1, WARNING: 2 },
  category: { LINKS: 1, SEO: 2, ACCESSIBILITY: 0 },
  code: [
    { code: 'SF-CHK-0101', name: 'Link to a missing page', count: 1 },
    { code: 'SF-CHK-0204', name: 'Meta description length', count: 2 },
  ],
  locale: { de: 2, en: 1 },
};
const RULES: QualityRuleItem[] = [
  { code: 'SF-CHK-0101', name: 'Link to a missing page or file', fixHint: 'Correct the link in the page.' },
  { code: 'SF-CHK-0204', name: 'Meta description length', fixHint: 'Write 50-160 characters.' },
];

interface Setup {
  run?: GenerationRunView;
  query?: Record<string, string>;
  findings?: FindingView[];
  total?: number;
  failing?: boolean;
}

async function setup({ run = RUN, query = {}, findings = FINDINGS, total = findings.length, failing = false }: Setup = {}) {
  const api = {
    findings: vi.fn().mockReturnValue(failing ? throwError(() => new HttpErrorResponse({ status: 500 })) : of({ content: findings, page: { totalElements: total } })),
    findingFacets: vi.fn().mockReturnValue(of(FACETS)),
    qualityRules: vi.fn().mockReturnValue(of(RULES)),
  };
  const queryParamMap = new BehaviorSubject(convertToParamMap(query));
  const editingLocale = { set: vi.fn() };
  const view = await render(RunFindingsComponent, {
    componentInputs: { projectKey: 'proj', run },
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      { provide: GenerationService, useValue: api },
      { provide: DeveloperModeService, useValue: { enabled: signal(false) } },
      { provide: LocalesStore, useValue: { locales: signal([{ code: 'de' }, { code: 'en' }]) } },
      { provide: EditingLocaleStore, useValue: editingLocale },
      { provide: ActivatedRoute, useValue: { queryParamMap, snapshot: { queryParamMap: queryParamMap.value } } },
    ],
  });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  return { ...view, api, navigate, queryParamMap, editingLocale };
}

describe('RunFindingsComponent', () => {
  it('groups the findings by rule, errors first, with the pages named and linked and how to fix', async () => {
    const { api } = await setup();

    const groups = await screen.findAllByRole('heading', { level: 3 });
    expect(groups.map((g) => g.textContent)).toEqual(['Link to a missing page or file', 'Meta description length']);
    expect(api.findings).toHaveBeenCalledWith('proj', 47, expect.objectContaining({ rules: [] }));
    expect(screen.getByText('1 error')).toBeInTheDocument();
    expect(screen.getByText('2 warnings')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Spring harvest' });
    expect(link).toHaveAttribute('href', `/p/proj/pages/${PAGE_A}`);
    expect(screen.getByText('Correct the link in the page.')).toBeInTheDocument();
    expect(screen.getAllByText('How to fix:')).toHaveLength(2);
  });

  it('marks a finding carried over from an earlier build', async () => {
    await setup();

    const team = (await screen.findByRole('link', { name: 'Team' })).closest('li') as HTMLElement;
    expect(within(team).getByText('Carried')).toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: 'Spring harvest' }).closest('li') as HTMLElement).queryByText('Carried')).toBeNull();
  });

  it('shows the counts of the facets on the severity and category segments', async () => {
    await setup();

    expect(await screen.findAllByRole('radio', { name: 'All 3' })).toHaveLength(2);
    expect(screen.getByRole('radio', { name: 'Errors 1' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Warnings 2' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Links 1' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'SEO 2' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Accessibility 0' })).toBeInTheDocument();
  });

  it('reads the filter from the URL, sends it to the server and shows it as removable chips', async () => {
    const { api } = await setup({ query: { fsev: 'warning', frule: 'SF-CHK-0204', flang: 'de', fpath: 'de/' } });

    await screen.findAllByRole('heading', { level: 3 });
    const filter = { severity: 'warning', category: null, rules: ['SF-CHK-0204'], lang: 'de', path: 'de/' };
    expect(api.findings).toHaveBeenCalledWith('proj', 47, filter);
    expect(api.findingFacets).toHaveBeenCalledWith('proj', 47, filter);
    expect(screen.getByText('Warnings')).toBeInTheDocument();
    expect(screen.getByText('Rule: Meta description length')).toBeInTheDocument();
    expect(screen.getByText('Language: DE')).toBeInTheDocument();
    expect(screen.getByText('Path: de/')).toBeInTheDocument();
  });

  it('writes a picked severity to the URL without a history entry, and Clear filters removes them all', async () => {
    const { navigate } = await setup({ query: { fsev: 'error', flang: 'de' } });

    fireEvent.click(await screen.findByRole('radio', { name: 'Warnings 2' }));
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({
        queryParams: { fsev: 'warning', fcat: null, frule: null, flang: 'de', fpath: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { fsev: null, fcat: null, frule: null, flang: null, fpath: null } }));
  });

  it('removes one chip', async () => {
    const { navigate } = await setup({ query: { fsev: 'error', flang: 'de' } });
    await screen.findAllByRole('heading', { level: 3 });

    fireEvent.click(screen.getByRole('button', { name: /Remove.*Language: DE/ }));

    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ fsev: 'error', flang: null }) }));
  });

  it('waits for the path to settle before it changes the URL', async () => {
    vi.useFakeTimers();
    try {
      const { navigate } = await setup();
      fireEvent.input(screen.getByRole('searchbox', { name: 'Output path starts with' }), { target: { value: 'de/n' } });
      expect(navigate).not.toHaveBeenCalled();

      vi.advanceTimersByTime(300);

      expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ fpath: 'de/n' }) }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the page in the language of the finding', async () => {
    const { editingLocale } = await setup();

    fireEvent.click(await screen.findByRole('link', { name: 'Spring harvest' }));

    expect(editingLocale.set).toHaveBeenCalledWith('proj', 'de');
  });

  it('lists a page that no longer exists as a plain name', async () => {
    await setup({ findings: [{ ...FINDINGS[0], page: undefined }] });

    expect(await screen.findByText('Deleted page')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Deleted page' })).toBeNull();
  });

  it('says the findings limit was reached', async () => {
    await setup({ run: { ...RUN, findingCounts: { errors: 1, warnings: 2, truncated: 40 } } });

    expect(await screen.findByText(/40 more findings were not stored/)).toBeInTheDocument();
  });

  it('reads the next page with Show more, until all findings are there', async () => {
    const { api } = await setup({ findings: [FINDINGS[0], FINDINGS[1]], total: 3 });
    expect(await screen.findByText('Showing 2 of 3')).toBeInTheDocument();
    api.findings.mockReturnValue(of({ content: [FINDINGS[2]], page: { totalElements: 3 } }));

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull());
    expect(api.findings).toHaveBeenLastCalledWith('proj', 47, expect.anything(), 1);
    expect(screen.getByRole('link', { name: 'Careers' })).toBeInTheDocument();
  });

  it('says so when the filters match nothing, and offers to clear them', async () => {
    await setup({ query: { fpath: 'zz/' }, findings: [], total: 0 });

    expect(await screen.findByText('No findings match these filters')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Clear filters' }).length).toBeGreaterThan(0);
  });

  it('says a run without findings passed the checks', async () => {
    await setup({ run: { ...RUN, findingCounts: { errors: 0, warnings: 0 } }, findings: [], total: 0 });

    expect(await screen.findByText('No findings')).toBeInTheDocument();
    expect(screen.getByText('Every checked page passed the quality rules.')).toBeInTheDocument();
  });

  it('does not ask the server while the run is still running', async () => {
    const { api } = await setup({ run: { id: 48, status: 'RUNNING' } });

    expect(screen.getByText('The checks run when the build has rendered the pages')).toBeInTheDocument();
    expect(api.findings).not.toHaveBeenCalled();
  });

  it('does not ask the server for a run that never checked', async () => {
    const { api } = await setup({ run: { id: 41, status: 'FAILED' } });

    expect(screen.getByText('This run did not check any pages')).toBeInTheDocument();
    expect(api.findings).not.toHaveBeenCalled();
  });

  it('offers a retry when the findings cannot be read', async () => {
    const { api } = await setup({ failing: true });
    expect(await screen.findByText('The findings could not be loaded.')).toBeInTheDocument();
    api.findings.mockReturnValue(of({ content: FINDINGS, page: { totalElements: 3 } }));

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('link', { name: 'Team' })).toBeInTheDocument();
  });
});
