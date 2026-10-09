import '@angular/compiler';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../../core/api/api.client';
import { DeveloperModeService } from '../../../core/frame/developer-mode.service';
import { RunSummaryComponent } from './run-summary.component';
import { RunsStore } from './runs.store';
import type { GenerationRunView } from './runs.util';

const TARGETS = [{ id: 1, name: 'Live site', isDefault: true, outputPath: 'proj/live' }];
const PAGE = '852d2ed6-741b-40e0-bc03-193d760ff9cd';

const RUN: GenerationRunView = {
  id: 47,
  status: 'PARTIAL',
  mode: 'INCREMENTAL',
  trigger: 'RELEASE',
  targetId: 1,
  revisionId: 1842,
  startedAt: '2026-10-09T10:00:00Z',
  finishedAt: '2026-10-09T10:03:24Z',
  startedBy: { id: 2, displayName: 'Mira Okafor' },
  comment: 'Build after release',
  filesWritten: 120,
  filesSkipped: 40,
  bytesWritten: 4_404_019,
  channels: ['html', 'rss'],
  planState: 'STORED',
  planSummary: { pageCount: 14, entryCount: 20, redirectsAdded: 2 },
  findingCounts: { errors: 1, warnings: 3 },
};

interface Setup {
  run?: GenerationRunView;
  developer?: boolean;
}

async function setup({ run = RUN, developer = false }: Setup = {}) {
  const showFindings = vi.fn();
  const pages = { listPages: vi.fn().mockReturnValue(of([{ uuid: PAGE }])) };
  const store = { targets: signal(TARGETS), defaultTarget: signal(TARGETS[0]) };
  const view = await render(RunSummaryComponent, {
    componentInputs: { projectKey: 'proj', run },
    on: { showFindings },
    providers: [
      provideRouter([]),
      { provide: RunsStore, useValue: store },
      { provide: ApiClient, useValue: pages },
      { provide: DeveloperModeService, useValue: { enabled: signal(developer) } },
    ],
  });
  return { ...view, showFindings, pages };
}

/** The value next to a fact's name. */
const fact = (name: string): HTMLElement => screen.getByText(name, { selector: 'dt' }).nextElementSibling as HTMLElement;

describe('RunSummaryComponent', () => {
  it('lists the facts of the run', async () => {
    await setup();

    expect(fact('Started by')).toHaveTextContent('Mira Okafor');
    expect(fact('Trigger')).toHaveTextContent('After a release');
    expect(fact('Files')).toHaveTextContent('120 written · 40 unchanged · 4.2 MB');
    expect(fact('Channels')).toHaveTextContent('html, rss');
    expect(fact('Redirects added')).toHaveTextContent('2');
    expect(fact('Revision')).toHaveTextContent('r1842');
    expect(fact('Comment')).toHaveTextContent('Build after release');
    expect(screen.getByText('Finished', { selector: 'dt' })).toBeInTheDocument();
    expect(screen.queryByText('Output', { selector: 'dt' })).toBeNull();
  });

  it('names all enabled channels, and leaves out what the run does not have', async () => {
    await setup({ run: { ...RUN, channels: [], comment: undefined, finishedAt: undefined, planSummary: { pageCount: 1, redirectsAdded: 0 } } });

    expect(fact('Channels')).toHaveTextContent('All enabled');
    expect(screen.queryByText('Comment', { selector: 'dt' })).toBeNull();
    expect(screen.queryByText('Finished', { selector: 'dt' })).toBeNull();
    expect(screen.queryByText('Redirects added', { selector: 'dt' })).toBeNull();
  });

  it('shows the output folder in developer mode', async () => {
    await setup({ developer: true });

    expect(fact('Output')).toHaveTextContent('proj/live');
  });

  it('links the findings line to the Findings tab', async () => {
    const { showFindings } = await setup();

    expect(fact('Findings')).toHaveTextContent('1 errors · 3 warnings');
    fireEvent.click(within(fact('Findings')).getByRole('button', { name: 'Show findings' }));

    expect(showFindings).toHaveBeenCalledWith(false);
  });

  it('says a checked run without findings has none', async () => {
    await setup({ run: { ...RUN, findingCounts: { errors: 0, warnings: 0 } } });

    expect(fact('Findings')).toHaveTextContent('No findings');
    expect(within(fact('Findings')).queryByRole('button')).toBeNull();
  });

  it('has no findings line while the run is running', async () => {
    await setup({ run: { ...RUN, status: 'RUNNING', finishedAt: undefined, findingCounts: undefined } });

    expect(screen.queryByText('Findings', { selector: 'dt' })).toBeNull();
  });

  it('lists the pages the run held back, with a link to their errors', async () => {
    const { showFindings } = await setup({
      run: { ...RUN, heldBack: [{ assetUuid: PAGE, name: 'Spring harvest', locale: 'de', channel: 'html' }, { assetUuid: 'x', name: undefined, locale: undefined, channel: 'html' }] },
    });

    const held = screen.getByRole('region', { name: '2 pages were held back' });
    expect(within(held).getByText('Spring harvest')).toBeInTheDocument();
    expect(within(held).getByText('DE')).toBeInTheDocument();
    expect(within(held).getByText('Deleted page')).toBeInTheDocument();
    fireEvent.click(within(held).getByRole('button', { name: 'Show findings' }));

    expect(showFindings).toHaveBeenCalledWith(true);
  });

  it('names the channel of a held-back page only when the run held pages back in several', async () => {
    await setup({
      run: { ...RUN, heldBack: [{ assetUuid: PAGE, name: 'Team', locale: 'de', channel: 'html' }, { assetUuid: PAGE, name: 'Team', locale: 'de', channel: 'rss' }] },
    });

    expect(screen.getByText('html')).toBeInTheDocument();
    expect(screen.getByText('rss')).toBeInTheDocument();
  });

  it('shows what the build reported, with the pages it names linked while they exist', async () => {
    await setup({
      developer: true,
      run: {
        ...RUN,
        diagnostics: {
          errors: [
            {
              code: 'SF-GEN-0111',
              count: 2,
              messages: ['Template error in about.'],
              pages: [
                { uuid: PAGE, uid: 'about', displayName: 'About us', path: '/about' },
                { uuid: 'gone', uid: 'old', displayName: null, path: null },
              ],
            },
          ],
          warnings: [{ code: 'SF-GEN-0210', count: 1, messages: ['A media file is large.'] }],
        } as unknown as GenerationRunView['diagnostics'],
      },
    });

    const problems = screen.getByRole('region', { name: 'Reported by the build' });
    expect(within(problems).getByText('Template error in about.')).toBeInTheDocument();
    expect(within(problems).getByText('SF-GEN-0111')).toBeInTheDocument();
    expect(within(problems).getByText('A media file is large.')).toBeInTheDocument();
    await waitFor(() => expect(within(problems).getByRole('link', { name: 'About us (/about)' })).toHaveAttribute('href', `/p/proj/pages/${PAGE}`));
    expect(within(problems).getByText('old')).toBeInTheDocument();
    expect(within(problems).queryByRole('link', { name: 'old' })).toBeNull();
  });

  it('leaves the held-back errors out of what the build reported when the pages are listed above', async () => {
    await setup({
      run: {
        ...RUN,
        heldBack: [{ assetUuid: PAGE, name: 'Team', locale: 'de', channel: 'html' }],
        diagnostics: { errors: [{ code: 'SF-GEN-0125', count: 1, messages: ['Page held back.'] }], warnings: [] } as unknown as GenerationRunView['diagnostics'],
      },
    });

    expect(screen.queryByText('Page held back.')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Reported by the build' })).toBeNull();
  });
});
