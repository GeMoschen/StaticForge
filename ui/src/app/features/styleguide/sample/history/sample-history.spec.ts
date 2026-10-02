import { Location } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from '../../../../core/ui/toast.service';
import { SampleScreenComponent } from '../sample-screen.component';
import { NO_HISTORY_FILTERS, filterHistory, formatHistoryFilter, parseHistoryFilter } from './sample-history-area.component';
import { HISTORY, inRange, versionsOf } from './history-data';

async function setup(query: Record<string, string> = {}) {
  const result = await render(SampleScreenComponent, {
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
    ],
  });
  await screen.findAllByRole('treeitem').catch(() => undefined);
  return result;
}

const confirmDialog = async () => (await screen.findAllByRole('dialog')).at(-1)!;
const lastToast = () => TestBed.inject(ToastService).toasts().at(-1);

afterEach(() => {
  delete document.documentElement.dataset['theme'];
  delete document.documentElement.dataset['density'];
  delete document.documentElement.dataset['codePalette'];
  TestBed.inject(ToastService).clear();
});

describe('history filters', () => {
  it('round-trips the URL form and filters the timeline', () => {
    const filters = parseHistoryFilter('by:anna,kind:edit,range:week,q:title');
    expect(filters).toEqual({ by: 'anna', kind: 'edit', date: { range: 'week', from: null, to: null }, q: 'title' });
    expect(formatHistoryFilter(filters)).toBe('by:anna,kind:edit,range:week,q:title');
    expect(formatHistoryFilter(NO_HISTORY_FILTERS)).toBeNull();
    expect(parseHistoryFilter('kind:bogus,range:never').kind).toBeNull();
    const rows = filterHistory(filters);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.by.id === 'anna' && r.kind === 'edit' && r.minutes <= 7 * 1440)).toBe(true);
  });

  it('filters by a custom date range, either end open', () => {
    const now = Date.parse('2026-10-02T12:00:00');
    const day = (iso: string) => ({ range: 'custom' as const, from: iso, to: null });
    // 3 days and 4 hours ago is 29 Sep.
    expect(inRange(3 * 1440 + 240, day('2026-09-29'), now)).toBe(true);
    expect(inRange(3 * 1440 + 240, day('2026-09-30'), now)).toBe(false);
    expect(inRange(3 * 1440 + 240, { range: 'custom', from: null, to: '2026-09-28' }, now)).toBe(false);
    expect(inRange(3 * 1440 + 240, { range: 'custom', from: '2026-09-29', to: '2026-09-29' }, now)).toBe(true);
    const parsed = parseHistoryFilter('range:custom,from:2026-09-01,to:2026-09-30');
    expect(parsed.date).toEqual({ range: 'custom', from: '2026-09-01', to: '2026-09-30' });
    expect(formatHistoryFilter(parsed)).toBe('range:custom,from:2026-09-01,to:2026-09-30');
    // A custom range without dates is no filter.
    expect(parseHistoryFilter('range:custom').date.range).toBe('any');
  });

  it('reduces the revisions to those of one asset, newest first', () => {
    const versions = versionsOf('spring_harvest');
    expect(versions.length).toBeGreaterThan(2);
    expect(versions.every((v) => v.assets.length === 1 && v.assets[0].asset === 'spring_harvest')).toBe(true);
    expect(versions.map((v) => v.id)).toEqual([...versions.map((v) => v.id)].sort((a, b) => b - a));
    expect(HISTORY.length).toBeGreaterThan(versions.length);
  });
});

describe('history drawer', () => {
  it('lists the project timeline with filters and opens the full history', async () => {
    await setup({ hdrawer: 'project' });
    const dialog = await screen.findByText('Project history');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Filter the history' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Details/ }).length).toBeGreaterThan(5);

    fireEvent.click(screen.getByRole('button', { name: 'Open full history' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'History' })).toBeInTheDocument());
    expect(screen.queryByText('Project history')).toBeNull();
  });

  it("shows an item's versions with Compare and Restore, and Restore asks first and then offers Undo", async () => {
    await setup({ hdrawer: 'page' });
    await screen.findByText(/History of “Spring harvest arrives”/);
    expect(screen.getByText('Current')).toBeInTheDocument();
    // The current version has neither Compare nor Restore.
    const compare = screen.getAllByRole('button', { name: 'Compare with current' });
    fireEvent.click(compare[0]);
    expect(await screen.findByText(/against the current state/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[0]);
    const confirm = await confirmDialog();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(lastToast()?.message).toMatch(/restored to revision/));
    expect(lastToast()?.action).toBeDefined();
  });

  it('time travels from View: the drawer closes and the banner and frame accent appear', async () => {
    await setup({ hdrawer: 'project' });
    await screen.findByText('Project history');
    fireEvent.click(screen.getAllByRole('button', { name: 'View' })[0]);
    expect(await screen.findByText(/Viewing revision 90/)).toBeInTheDocument();
    expect(screen.queryByText('Project history')).toBeNull();
    expect(screen.getByRole('main')).toHaveClass('is-time-travel');
    expect(screen.getByText('Read-only')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to now' }));
    await waitFor(() => expect(screen.queryByText(/Viewing revision/)).toBeNull());
    expect(screen.getByRole('main')).not.toHaveClass('is-time-travel');
  });
});

describe('full history page', () => {
  it('shows a revision with the changed items by name and a field diff', async () => {
    await setup({ area: 'history', hrev: '1' });
    const detail = await screen.findByRole('region', { name: 'Revision 86' });
    expect(within(detail).getByRole('heading', { level: 2, name: 'Revision 86' })).toBeInTheDocument();
    expect(within(detail).getByText('Spring harvest arrives')).toBeInTheDocument();
    expect(within(detail).getByText('Single origins')).toBeInTheDocument();
    expect(within(detail).getByText('2 items changed')).toBeInTheDocument();
    // No raw ids anywhere in the detail.
    expect(detail.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it('keeps the filters and the open revision in the URL', async () => {
    await setup({ area: 'history', hfilter: 'kind:release', hrev: '81' });
    await screen.findByRole('region', { name: 'Revision 81' });
    // Only releases are listed.
    expect(screen.getByText('2 revisions')).toBeInTheDocument();
    const replace = vi.spyOn(TestBed.inject(Location), 'replaceState');
    fireEvent.click(screen.getByRole('button', { name: 'Close the revision' }));
    await waitFor(() => {
      const query = String(replace.mock.lastCall?.[1] ?? '');
      expect(query).toContain('hfilter=kind%3Arelease');
      expect(query).not.toContain('hrev');
    });
  });

  it('offers a custom date range and the types with their icons', async () => {
    await setup({ area: 'history' });
    await screen.findByRole('button', { name: 'Date' });
    fireEvent.click(screen.getByRole('button', { name: 'Type' }));
    const edit = await screen.findByRole('menuitem', { name: /Edit/ });
    expect(edit.querySelector('sf-icon')?.textContent?.trim() ?? edit.innerHTML).toContain('edit_note');
    fireEvent.keyDown(edit, { key: 'Escape' });

    fireEvent.click(screen.getByRole('button', { name: 'Date' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Custom range…' }));
    const dialog = await confirmDialog();
    expect(within(dialog).getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('highlights the open revision row', async () => {
    await setup({ area: 'history', hrev: '1' });
    await screen.findByRole('region', { name: 'Revision 86' });
    const current = document.querySelector('tr[aria-current="true"]');
    expect(current).not.toBeNull();
    expect(current?.classList.contains('is-current')).toBe(true);
    expect(current?.textContent).toContain('86');
  });

  it('rolls the project back only after the project key is typed', async () => {
    await setup({ area: 'history', hrev: '1' });
    await screen.findByRole('region', { name: 'Revision 86' });
    fireEvent.click(screen.getByRole('button', { name: 'Roll back project…' }));
    const confirm = await confirmDialog();
    const roll = within(confirm).getByRole('button', { name: 'Roll back to revision 86' });
    expect(roll).toBeDisabled();
    fireEvent.input(within(confirm).getByRole('textbox'), { target: { value: 'DEMO' } });
    await waitFor(() => expect(roll).toBeEnabled());
    fireEvent.click(roll);
    await waitFor(() => expect(lastToast()?.message).toBe('Project rolled back to revision 86.'));
  });

  it('time travels from the detail pane and keeps the frame', async () => {
    await setup({ area: 'history', hrev: '1' });
    await screen.findByRole('region', { name: 'Revision 86' });
    fireEvent.click(screen.getByRole('button', { name: 'View this state' }));
    expect(await screen.findByText(/Viewing revision 86/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore this state' })).toBeInTheDocument();
  });
});
