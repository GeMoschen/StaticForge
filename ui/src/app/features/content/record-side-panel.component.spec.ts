import '@angular/compiler';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { RecordSidePanelComponent, checkCounts, type ContentIssue, type RecordSidePanelTab } from './record-side-panel.component';

type UsageDto = components['schemas']['UsageDto'];

const ISSUES: ContentIssue[] = [
  { path: 'name', severity: 'WARNING', message: 'Name is short' },
  { path: 'email', severity: 'ERROR', message: 'Email is required' },
  { path: 'bio', severity: 'INFO', message: 'Bio is empty' },
  { path: 'x', severity: 'HINT', message: 'A hint' },
];

const USAGES: UsageDto[] = [
  { fromUuid: 'page-1', fromUid: 'team', fromType: 'PAGE', kind: 'REFERENCE', sourcePath: 'sections[0].person' },
  { fromUuid: 'tpl-1', fromUid: 'staff-list', fromType: 'PAGE_TEMPLATE', kind: 'REFERENCE', sourcePath: 'body' },
];

async function open(tab: RecordSidePanelTab | null, issues = ISSUES, usages = USAGES) {
  return render(RecordSidePanelComponent, {
    componentInputs: { projectKey: 'proj', issues, usages, tab },
    providers: [provideRouter([])],
  });
}

describe('checkCounts', () => {
  it('counts errors and warnings; notes are listed but not counted, hints only show at their field', () => {
    expect(checkCounts(ISSUES)).toEqual({ count: 2, errors: 1 });
    expect(checkCounts([])).toEqual({ count: 0, errors: 0 });
  });
});

describe('RecordSidePanelComponent', () => {
  it('renders nothing while it is closed', async () => {
    await open(null);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists the checks most severe first, without the hints, each with its level in words', async () => {
    await open('issues');

    const items = screen.getAllByRole('listitem').map((item) => item.textContent ?? '');
    expect(items).toHaveLength(3);
    expect(items[0]).toContain('Error: Email is required');
    expect(items[1]).toContain('Warning: Name is short');
    expect(items[2]).toContain('Note: Bio is empty');
  });

  it('says so when nothing is wrong', async () => {
    await open('issues', []);
    expect(screen.getByRole('heading', { name: 'No problems found' })).toBeTruthy();
  });

  it('lists what uses the record, linking pages, with the kind of each', async () => {
    await open('usages');

    expect(screen.getByRole('link', { name: 'team' }).getAttribute('href')).toBe('/p/proj/pages/page-1');
    expect(screen.getByText('Template')).toBeTruthy();
    expect(screen.getByText('staff-list')).toBeTruthy();
  });

  it('switches between the tabs', async () => {
    await open('issues');

    fireEvent.click(screen.getByRole('tab', { name: /Used by/ }));

    expect(await screen.findByRole('link', { name: 'team' })).toBeTruthy();
  });
});
