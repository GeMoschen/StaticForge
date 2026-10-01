import { Location } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmService } from '../../../../shared/components/dialog/confirm.service';
import { PROJECT_KEY } from './publishing-data';
import { SamplePublishingAreaComponent } from './sample-publishing-area.component';
import { LOG_TICK, LOG_TICK_REDUCED } from './sample-run-log.component';

async function setup(query: Record<string, string> = {}) {
  const result = await render(SamplePublishingAreaComponent, {
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
    ],
  });
  // No whenStable(): relative times keep a timer running.
  await screen.findByRole('heading', { level: 1 });
  return result;
}

/** The query string the area last wrote. */
function watchQuery(): () => string {
  const replace = vi.spyOn(TestBed.inject(Location), 'replaceState');
  return () => String(replace.mock.lastCall?.[1] ?? '');
}

const sideNav = () => screen.getByRole('navigation', { name: 'Publishing sections' });

describe('SamplePublishingAreaComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('has one h1, the last build status, Build now and the side nav on Runs', async () => {
    await setup();

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Publishing');
    expect(screen.getByText('Last build #47')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Build now' })).toBeInTheDocument();
    expect(within(sideNav()).getByRole('button', { name: /Runs/ })).toHaveAttribute('aria-current', 'page');
    // The running run: a spinner and a progress bar.
    const grid = screen.getByRole('grid', { name: 'Build runs' });
    expect(within(grid).getByRole('progressbar', { name: 'Build progress' })).toHaveAttribute('aria-valuenow', '58');
    expect(within(grid).getAllByText('Partial').length).toBeGreaterThan(0);
  });

  it('switches sections from the side nav and writes psec to the URL', async () => {
    await setup();
    const query = watchQuery();

    fireEvent.click(within(sideNav()).getByRole('button', { name: /Targets/ }));

    expect(await screen.findByRole('heading', { level: 2, name: 'Targets' })).toBeInTheDocument();
    expect(within(sideNav()).getByRole('button', { name: /Targets/ })).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(query()).toContain('psec=targets'));
    expect(query()).not.toContain('run=');
  });

  it('opens a run from run= with its summary and switches tabs to the grouped findings', async () => {
    await setup({ run: 'r-47', dev: '1' });

    expect(screen.getByRole('heading', { level: 2, name: 'Run #47' })).toBeInTheDocument();
    const tabs = screen.getByRole('tablist', { name: 'Run details' });
    expect(within(tabs).getByRole('tab', { name: 'Summary' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(within(tabs).getByRole('tab', { name: /Findings/ }));

    const finding = (await screen.findByRole('heading', { level: 3, name: 'Link to a missing page or file' })).closest('li')!;
    expect(finding).toHaveTextContent('2 errors');
    expect(finding).toHaveTextContent('SF-CHK-0101');
    expect(within(finding as HTMLElement).getAllByRole('button', { name: 'Spring harvest arrives' })).toHaveLength(2);
    expect(finding).toHaveTextContent('How to fix:');
  });

  it('opens the running run on its log, which appends lines and follows the tail', async () => {
    const intervals: (() => void)[] = [];
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: () => void, ms?: number) => {
      // Only the log's tail timer (relative times tick too).
      if (ms === LOG_TICK || ms === LOG_TICK_REDUCED) {
        intervals.push(fn);
      }
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    const { fixture } = await setup({ run: 'r-48' });

    expect(screen.getByRole('tab', { name: 'Log' })).toHaveAttribute('aria-selected', 'true');
    const log = screen.getByRole('region', { name: 'Build log of run #48' });
    expect(screen.getByText('144 lines')).toBeInTheDocument();
    expect(screen.getByText('Following the newest lines')).toBeInTheDocument();
    expect(intervals).toHaveLength(1);

    intervals[0]();
    intervals[0]();
    fixture.detectChanges();

    expect(await screen.findByText('148 lines')).toBeInTheDocument();
    expect(screen.getByText('Following the newest lines')).toBeInTheDocument();
    expect(log.querySelectorAll('.log__line').length).toBeGreaterThan(0);
  });

  it('opens the Build now dialog from build=1 with the default target preselected', async () => {
    await setup({ build: '1' });

    const dialog = screen.getByRole('dialog', { name: 'Build now' });
    const target = within(dialog).getByRole('combobox', { name: 'Target' }) as HTMLSelectElement;
    expect(target.options[target.selectedIndex].textContent?.trim()).toBe('Live site (default)');
    expect(within(dialog).getByRole('radio', { name: /Incremental/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(dialog).getByRole('heading', { level: 3, name: 'Dry-run plan' })).toBeInTheDocument();
    expect(within(dialog).getByText('Spring harvest arrives')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('radio', { name: /Full build/ }));
    expect(await within(dialog).findByText('338')).toBeInTheDocument();
  });

  it('updates the quality summary when a rule is switched off', async () => {
    await setup({ psec: 'quality' });

    const on = () => document.querySelector('[data-sf-summary="on"]')!.textContent?.trim();
    const off = () => document.querySelector('[data-sf-summary="off"]')!.textContent?.trim();
    expect(on()).toBe('20');
    expect(off()).toBe('3');

    const group = screen.getByRole('radiogroup', { name: 'Level of “Image without alt attribute”' });
    fireEvent.click(within(group).getByRole('radio', { name: /Off/ }));

    await waitFor(() => expect(on()).toBe('19'));
    expect(off()).toBe('4');
    // Capped rule: Error is not available.
    const capped = screen.getByRole('radiogroup', { name: 'Level of “Link to a page held back in this build”' });
    expect(within(capped).getByRole('radio', { name: /Error/ })).toBeDisabled();
  });

  it('asks for the project key before Reset all, and hides it once the registry is empty', async () => {
    await setup({ psec: 'urls' });
    const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(true);

    fireEvent.click(screen.getByRole('button', { name: 'More URL actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Reset all URLs/ }));

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm.mock.calls[0][0]).toMatchObject({ typeToConfirm: PROJECT_KEY, tone: 'danger' });
    expect(await screen.findByText('No URLs registered')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More URL actions' })).toBeNull();
  });
});
