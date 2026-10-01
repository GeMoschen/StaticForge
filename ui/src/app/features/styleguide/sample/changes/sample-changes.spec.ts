import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmService } from '../../../../shared/components/dialog/confirm.service';
import { CHANGES } from './changes-data';
import { SampleChangesAreaComponent, formatChangeFilter, parseChangeFilter, sortChanges } from './sample-changes-area.component';
import { diffField } from './sample-change-diff.component';
import { SampleReleaseActionsComponent } from './sample-release-actions.component';
import { SampleSchedulesAreaComponent } from './sample-schedules-area.component';

function providers(query: Record<string, string>) {
  return [
    provideHttpClient(),
    provideHttpClientTesting(),
    provideRouter([]),
    { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
  ];
}

/** The current URL (the areas replace the history entry as they change). */
const url = () => TestBed.inject(Location).path();

const dataRows = () => screen.getAllByRole('row').filter((row) => row.closest('tbody'));

describe('sample Changes area', () => {
  it('lists one row per language with names, the default language first, under one h1', async () => {
    await render(SampleChangesAreaComponent, { providers: providers({ dev: '0' }) });

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Changes');
    const rows = dataRows();
    expect(rows).toHaveLength(CHANGES.length);
    // The newest asset first, its German (default) row before the English one.
    expect(rows[0]).toHaveTextContent('Spring harvest arrives');
    expect(rows[0]).toHaveTextContent('DE');
    expect(rows[1]).toHaveTextContent('Spring harvest arrives');
    expect(rows[1]).toHaveTextContent('EN');
    // No UIDs outside developer mode.
    expect(screen.queryByText('spring_harvest')).toBeNull();
  });

  it('keeps an asset’s languages together, default first, in every sort', () => {
    for (const sort of ['newest', 'oldest', 'az', 'za'] as const) {
      const sorted = sortChanges(CHANGES, sort);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].asset === sorted[i - 1].asset) {
          expect(sorted[i - 1].lang).toBe('de');
        }
      }
    }
  });

  it('round-trips the cfilter parameter', () => {
    const parsed = parseChangeFilter('type:page,lang:en,q:harvest,sort:az,bogus:1');
    expect(parsed).toEqual({ filters: { type: 'page', lang: 'en' }, sort: 'az', q: 'harvest' });
    expect(formatChangeFilter(parsed.filters, parsed.sort, parsed.q)).toBe('type:page,lang:en,q:harvest,sort:az');
  });

  it('applies cfilter and shows the active filters as removable chips', async () => {
    await render(SampleChangesAreaComponent, { providers: providers({ cfilter: 'type:record' }) });

    expect(dataRows()).toHaveLength(2);
    const chips = screen.getByRole('list', { name: 'Active filters' });
    fireEvent.click(within(chips).getByRole('button', { name: /Remove/ }));

    await waitFor(() => expect(dataRows()).toHaveLength(CHANGES.length));
    expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
    await waitFor(() => expect(url()).not.toContain('cfilter'));
  });

  it('opens the diff pane from diff=1 with marked removed and added text, and from a row click', async () => {
    await render(SampleChangesAreaComponent, { providers: providers({ diff: '1' }) });

    const pane = screen.getByRole('region', { name: 'Spring harvest arrives' });
    expect(within(pane).getByRole('heading', { level: 2 })).toHaveTextContent('Spring harvest arrives');
    expect(pane.querySelector('del')).toHaveTextContent('da');
    expect(pane.querySelector('ins')).toHaveTextContent('angekommen');
    expect(pane.querySelectorAll('.diff__marker')[0]).toHaveTextContent('−');

    fireEvent.click(within(pane).getByRole('button', { name: 'Close the diff' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Spring harvest arrives' })).toBeNull());

    fireEvent.click(dataRows().find((r) => r.textContent?.includes('Barista championship recap'))!.querySelector('.cell-name__text')!);
    expect(await screen.findByRole('region', { name: 'Barista championship recap' })).toHaveTextContent('Never released');
  });

  it('diffs words: the common start and end stay plain', () => {
    const diff = diffField({ label: 'Title', before: 'The spring harvest is here', after: 'The spring harvest arrives' });
    expect(diff.before?.filter((s) => s.changed).map((s) => s.text)).toEqual(['is here']);
    expect(diff.after?.filter((s) => s.changed).map((s) => s.text)).toEqual(['arrives']);
  });

  it('selects the first rows from sel=2 and offers the bulk actions', async () => {
    await render(SampleChangesAreaComponent, { providers: providers({ sel: '2' }) });

    expect(await screen.findByRole('button', { name: 'Release…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Schedule…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard…' })).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox', { checked: true }).length).toBeGreaterThanOrEqual(2);
  });

  it('confirms a bulk discard', async () => {
    await render(SampleChangesAreaComponent, { providers: providers({ sel: '2' }) });
    const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(false);

    fireEvent.click(await screen.findByRole('button', { name: 'Discard…' }));

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger', details: ['Spring harvest arrives (DE)', 'Spring harvest arrives (EN)'] }));
  });

  it('release=1: the dialog pre-ticks every changed language and gates Release on errors and the warnings', async () => {
    await render(SampleChangesAreaComponent, { providers: providers({ release: '1' }) });

    const dialog = await screen.findByRole('dialog', { name: 'Release “Spring harvest arrives”' });
    const de = within(dialog).getByRole('checkbox', { name: /Deutsch \(DE\)/ });
    const en = within(dialog).getByRole('checkbox', { name: /English \(EN\)/ });
    expect(de).toBeChecked();
    expect(en).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'All changed languages' })).toBeChecked();
    // One heading hierarchy: the dialog's h2, then h3 parts.
    expect(within(dialog).getAllByRole('heading', { level: 3 }).map((h) => h.textContent?.trim())).toContain('Languages');

    const release = within(dialog).getByRole('button', { name: 'Release' });
    expect(release).toHaveAttribute('aria-disabled', 'true');
    expect(within(dialog).getByText(/1 blocking error/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Open' })).toBeInTheDocument();

    // The error belongs to English: untick it — the warnings still need the confirmation.
    fireEvent.click(en);
    await waitFor(() => expect(within(dialog).queryByText(/blocking error/)).toBeNull());
    expect(release).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(within(dialog).getByRole('checkbox', { name: "I've read the warnings" }));
    await waitFor(() => expect(release).not.toHaveAttribute('aria-disabled'));
  });
});

describe('sample Schedules area', () => {
  it('lists the schedules with row menus and opens the dialog from schedule=1; the kind switch changes the title', async () => {
    await render(SampleSchedulesAreaComponent, { providers: providers({ schedule: '1' }) });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Schedules');
    expect(screen.getByRole('button', { name: 'Actions for “Incremental build · Production”' })).toBeInTheDocument();

    const dialog = await screen.findByRole('dialog', { name: 'Schedule release' });
    fireEvent.click(within(dialog).getByRole('radio', { name: /Unpublish/ }));
    expect(await screen.findByRole('dialog', { name: 'Schedule unpublish' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('radio', { name: /Generation/ }));
    const generation = await screen.findByRole('dialog', { name: 'Schedule generation' });
    expect(within(generation).getByRole('combobox', { name: 'Repeat' })).toBeInTheDocument();
  });

  it('cancels a schedule only after the confirmation', async () => {
    await render(SampleSchedulesAreaComponent, { providers: providers({}) });
    const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(true);

    fireEvent.click(screen.getByRole('button', { name: 'Actions for “Winter blend is back (DE, EN)”' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Cancel schedule/ }));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger' })));
    await waitFor(() => expect(screen.getAllByText('Cancelled').length).toBeGreaterThan(0));
  });
});

describe('sample release actions', () => {
  it('shows a pill per language and opens the release dialog with the changed languages ticked', async () => {
    await render(`<sf-sample-release-actions name="Spring harvest arrives" [statuses]="statuses" />`, {
      imports: [SampleReleaseActionsComponent],
      providers: providers({}),
      componentProperties: {
        statuses: [
          { lang: 'de', status: 'released' },
          { lang: 'en', status: 'changed' },
        ],
      },
    });

    expect(screen.getByText('DE')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Release…' }));

    const dialog = await screen.findByRole('dialog', { name: 'Release “Spring harvest arrives”' });
    expect(within(dialog).getByRole('checkbox', { name: /Deutsch \(DE\)/ })).not.toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: /English \(EN\)/ })).toBeChecked();
  });
});
