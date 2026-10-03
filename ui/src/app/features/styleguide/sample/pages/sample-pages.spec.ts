import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { ISSUES, SECTION_TEMPLATES } from './pages-data';
import { SampleState } from '../sample-state';
import { SamplePagesReview } from './sample-pages-review';
import { SampleIssuesDrawerComponent } from './sample-issues-drawer.component';
import { SamplePagesEmptyComponent } from './sample-pages-empty.component';
import { SampleSectionPaletteComponent } from './sample-section-palette.component';

const providers = [
  provideHttpClient(),
  provideHttpClientTesting(),
  provideRouter([]),
  SampleState,
  SamplePagesReview,
  { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
];

describe('sample section palette', () => {
  it('lists every template as an option and disables one whose maximum is reached', async () => {
    await render(SampleSectionPaletteComponent, { providers, inputs: { after: 'Hero', counts: { hero: 1 } } });

    expect(screen.getAllByRole('option')).toHaveLength(SECTION_TEMPLATES.length);
    expect(screen.getByRole('option', { name: /Hero/ })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Insert after: Hero')).toBeTruthy();
  });

  it('filters by typing and offers Clear filter when nothing matches', async () => {
    await render(SampleSectionPaletteComponent, { providers });
    const filter = screen.getByRole('combobox');

    fireEvent.input(filter, { target: { value: 'quote' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);

    fireEvent.input(filter, { target: { value: 'zzz' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(screen.getAllByRole('option')).toHaveLength(SECTION_TEMPLATES.length);
  });

  it('inserts the active template with Enter, skipping a full one', async () => {
    const { fixture } = await render(SampleSectionPaletteComponent, { providers, inputs: { counts: { hero: 1 } } });
    let inserted = '';
    fixture.componentInstance.insert.subscribe((tpl) => (inserted = tpl.id));

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(inserted).toBe('banner');
  });
});

describe('sample issues drawer', () => {
  it('groups findings by level with counts and filters by the moment they are checked', async () => {
    await render(SampleIssuesDrawerComponent, { providers });

    expect(screen.getByRole('heading', { name: /Errors/ })).toBeTruthy();
    const before = screen.getAllByRole('button', { name: /Go to it/ }).length;
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThanOrEqual(ISSUES.length);

    fireEvent.click(screen.getByRole('button', { name: 'Building' }));
    expect(screen.getAllByRole('button', { name: /Go to it/ }).length).toBeLessThan(before);
  });
});

describe('sample pages empty state', () => {
  it('sends an editor to a developer instead of offering a dead button', async () => {
    const { fixture } = await render(SamplePagesEmptyComponent, { providers });
    fixture.debugElement.injector.get(SampleState).devMode.set(false);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(screen.getByText('No pages yet')).toBeTruthy();
    expect(screen.getByText(/Ask a developer/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Go to Templates' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Create a folder' })).toBeTruthy();
  });
});
