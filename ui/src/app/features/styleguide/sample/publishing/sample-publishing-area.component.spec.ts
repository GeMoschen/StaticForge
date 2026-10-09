import { Location } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from '../../../../core/ui/toast.service';
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
    // The plan is computed only on request.
    expect(within(dialog).getByText(/not computed automatically/)).toBeInTheDocument();
  });

  it('sets every rule of a quality group at once and folds the group away', async () => {
    await setup({ psec: 'quality' });

    const off = () => document.querySelector('[data-sf-summary="off"]')!.textContent?.trim();
    const seo = screen.getByRole('radiogroup', { name: 'Set all SEO rules' });
    expect(within(seo).queryAllByRole('radio', { checked: true })).toHaveLength(0); // the rules differ
    fireEvent.click(within(seo).getByRole('radio', { name: /Off/ }));
    await waitFor(() => expect(within(seo).getByRole('radio', { name: /Off/ })).toBeChecked());
    expect(Number(off())).toBeGreaterThanOrEqual(8);

    // Error on a group takes Warning for a capped rule; the control still reads Error.
    const links = screen.getByRole('radiogroup', { name: 'Set all Links rules' });
    fireEvent.click(within(links).getByRole('radio', { name: /Error/ }));
    await waitFor(() => expect(within(links).getByRole('radio', { name: /Error/ })).toBeChecked());
    const capped = screen.getByRole('radiogroup', { name: 'Level of “Link to a page held back in this build”' });
    expect(within(capped).getByRole('radio', { name: /Warning/ })).toBeChecked();

    const toggle = screen.getByRole('button', { name: /^SEO/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('sample-quality-rules-seo')).not.toBeVisible();
  });

  it('opens quality groups folded with qcollapsed', async () => {
    await setup({ psec: 'quality', qcollapsed: 'links,accessibility' });

    expect(screen.getByRole('button', { name: /^Links/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /^SEO/ })).toHaveAttribute('aria-expanded', 'true');
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

describe('Build now, Targets and Policy (M35.24 round 17)', () => {
  afterEach(() => vi.restoreAllMocks());

  const dialog = () => screen.getByRole('dialog', { name: 'Build now' });

  it('keeps the last channel checked and disabled, and computes the plan only on Preview plan', async () => {
    await setup({ build: '1' });
    const d = within(dialog());

    fireEvent.click(d.getByRole('checkbox', { name: 'RSS' }));
    fireEvent.click(d.getByRole('checkbox', { name: 'Markdown' }));
    expect(d.getByRole('checkbox', { name: 'HTML' })).toBeDisabled();
    expect(d.getByRole('checkbox', { name: 'HTML' })).toBeChecked();
    expect(d.getByText(/not computed automatically/)).toBeInTheDocument();

    fireEvent.click(d.getByRole('button', { name: 'Preview plan' }));
    expect(await d.findByText('Planning…')).toBeInTheDocument();
    expect(await d.findByText('Computed at revision 1482', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(d.getByRole('button', { name: 'Refresh preview' })).toBeInTheDocument();
    expect(d.queryByText(/form changed since this preview/)).toBeNull();

    fireEvent.click(d.getByRole('checkbox', { name: 'RSS' }));
    expect(await d.findByText(/form changed since this preview/)).toBeInTheDocument();
  });

  it('shows the previewed plan with its groups, assets and redirects (bplan=1)', async () => {
    await setup({ build: '1', bplan: '1', bvalidate: '1' });
    const d = within(dialog());

    expect(d.getByText('Computed at revision 1482')).toBeInTheDocument();
    expect(d.getByText('Templates validate cleanly.')).toBeInTheDocument();
    fireEvent.click(d.getByRole('button', { name: /Show changed assets \(4\)/ }));
    expect(d.getByText('page:shop/old-grinder')).toBeInTheDocument();
    fireEvent.click(d.getByRole('button', { name: /Show automatic redirects/ }));
    expect(d.getByText('/en/shop/old-grinder.html → /en/shop/grinders.html')).toBeInTheDocument();
  });

  it('shows the fallback warning', async () => {
    await setup({ build: '1', bplan: '1', bfallback: '1' });
    expect(within(dialog()).getByText(/falls back to a full build/)).toBeInTheDocument();
  });

  it('shows the nothing-to-rebuild state', async () => {
    await setup({ build: '1', bplan: '1', bempty: '1' });
    expect(within(dialog()).getByText('Nothing to rebuild. You can still start the run.')).toBeInTheDocument();
  });

  it('disables Start without a target and links to Targets', async () => {
    await setup({ build: '1', notargets: '1' });
    const d = within(dialog());

    expect(d.getByRole('button', { name: 'Start build' })).toBeDisabled();
    expect(d.getByRole('button', { name: 'Create one in Targets' })).toBeInTheDocument();
  });

  it('limits an editor to incremental builds of the default target', async () => {
    await setup({ build: '1', role: 'editor' });
    const d = within(dialog());

    expect(d.getByText('You can start incremental builds of the default target in this project.')).toBeInTheDocument();
    expect(d.queryByRole('combobox', { name: 'Target' })).toBeNull();
    expect(d.queryByRole('radio', { name: /Full build/ })).toBeNull();
    expect(d.getByRole('button', { name: 'Start build' })).toBeEnabled();
  });

  it('answers Start with the 409 inline error (berror=1)', async () => {
    await setup({ build: '1', berror: '1' });
    const d = within(dialog());

    fireEvent.click(d.getByRole('button', { name: 'Start build' }));
    expect(await d.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent('A build is already running.');
  });

  it('opens the target drawer for a new target with the hints', async () => {
    await setup({ psec: 'targets', tdrawer: 'new' });
    const drawer = within(screen.getByRole('dialog'));

    expect(drawer.getByText(/Relative to the project’s output root/)).toBeInTheDocument();
    expect(drawer.getByText('Public site URL, used for the sitemap and absolute links.')).toBeInTheDocument();
    expect(drawer.queryByText(/starts a fresh folder/)).toBeNull();
  });

  it('opens the drawer of the default target with the edit hint and the server error', async () => {
    await setup({ psec: 'targets', tdrawer: 't-live', terror: '1' });
    const drawer = within(screen.getByRole('dialog'));

    expect(drawer.getByText(/Changing it or the type starts a fresh folder/)).toBeInTheDocument();
    expect(drawer.getByText('A target with this name already exists.')).toBeInTheDocument();
    expect(drawer.getByRole('radio', { name: /ZIP/ })).toBeInTheDocument();
  });

  it('shows the empty Targets state', async () => {
    await setup({ psec: 'targets', notargets: '1' });

    expect(screen.getByText('No generation targets yet')).toBeInTheDocument();
    expect(screen.getByText('Create a target to be able to generate and publish this project.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New target/ })).toBeInTheDocument();
  });

  it('shows Targets read-only for editors', async () => {
    await setup({ psec: 'targets', role: 'editor' });

    expect(screen.getByText('Only project admins can change targets.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New target/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Actions for/ })).toBeNull();
  });

  it('confirms a target delete with the real wording', async () => {
    await setup({ psec: 'targets' });
    const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(false);

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Staging' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete/ }));

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm.mock.calls[0][0]).toMatchObject({
      title: 'Delete “Staging”?',
      message: 'Past runs published to it can no longer be promoted. Files already written to roastery-staging stay on the server.',
    });
  });

  it('turns the dependents of an editor permission off and asks before dropping schedules', async () => {
    await setup({ psec: 'policy' });
    const release = screen.getByRole('switch', { name: /Release, discard and unpublish/ });
    const schedule = screen.getByRole('switch', { name: /Schedule releases and unpublishing/ });
    expect(screen.getByText('Developers and admins can always do all of this.')).toBeInTheDocument();
    expect(screen.getByText('All changes saved')).toBeInTheDocument();

    fireEvent.click(release);
    expect(schedule).toBeDisabled();
    expect(schedule).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Needs “Release, discard and unpublish”')).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const impact = await screen.findByRole('dialog', { name: 'These schedules would fail' });
    expect(within(impact).getByRole('button', { name: 'Save anyway' })).toBeInTheDocument();
    fireEvent.click(within(impact).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('opens the impact dialog from pdialog=impact', async () => {
    await setup({ psec: 'policy', pdialog: 'impact' });
    const impact = screen.getByRole('dialog', { name: 'These schedules would fail' });

    expect(within(impact).getByRole('table', { name: 'Schedules that would fail' })).toBeInTheDocument();
  });

  it('shows Policy read-only for editors', async () => {
    await setup({ psec: 'policy', role: 'editor' });

    expect(screen.getByText('Only project admins can change this.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Release, discard and unpublish/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});

describe('Publishing › Runs and run detail (round 17)', () => {
  afterEach(() => vi.restoreAllMocks());

  const tabs = () => screen.getByRole('tablist', { name: 'Run details' });

  it('lists a queued run and the toolbar filters, and opens the row menu with Live log and Cancel', async () => {
    await setup();

    const grid = screen.getByRole('grid', { name: 'Build runs' });
    expect(within(grid).getByText('Queued')).toBeInTheDocument();
    for (const filter of ['Status', 'Mode', 'Target', 'Trigger']) {
      expect(screen.getAllByText(filter).length).toBeGreaterThan(0);
    }

    fireEvent.click(screen.getByRole('button', { name: 'Actions for run #49' }));
    expect(await screen.findByRole('menuitem', { name: 'Open' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Live log' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Cancel run' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Promote' })).toBeNull();
  });

  it('offers Promote on a succeeded run and asks before it', async () => {
    await setup();
    const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(true);

    fireEvent.click(screen.getByRole('button', { name: 'Actions for run #47' }));
    expect(screen.queryByRole('menuitem', { name: 'Cancel run' })).toBeNull();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Promote' }));

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm.mock.calls[0][0].title).toBe('Promote run #47 to CDN mirror?');
  });

  it('disables Build now with a reason and a link to Targets without a target (notargets=1)', async () => {
    await setup({ notargets: '1' });

    expect(screen.getByRole('button', { name: /Build now/ })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('grid', { name: 'Build runs' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Go to Targets' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Targets' })).toBeInTheDocument();
  });

  it('hides Build now, Promote and a foreign Cancel for an editor (role=editor)', async () => {
    await setup({ role: 'editor' });

    expect(screen.queryByRole('button', { name: /Build now/ })).toBeNull();
    expect(screen.getByText('Builds are started by developers in this project.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for run #47' }));
    await screen.findByRole('menuitem', { name: 'Open' });
    expect(screen.queryByRole('menuitem', { name: 'Promote' })).toBeNull();
  });

  it('opens the queued run on its log with the awaiting line', async () => {
    await setup({ run: 'r-49' });

    expect(within(tabs()).getByRole('tab', { name: 'Log' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/Awaiting events/)).toBeInTheDocument();
    expect(screen.getByText('0 files')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel run' })).toBeInTheDocument();
  });

  it('takes the tab from rtab and writes it back', async () => {
    await setup({ run: 'r-47', rtab: 'findings' });
    const query = watchQuery();

    expect(within(tabs()).getByRole('tab', { name: /Findings/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(tabs()).getByRole('tab', { name: 'Summary' }));
    await waitFor(() => expect(query()).toContain('rtab=summary'));
  });

  it('summarises a partial run: finished, channels, redirects, findings link and the held-back pages', async () => {
    await setup({ run: 'r-47' });

    expect(screen.getByText('Finished')).toBeInTheDocument();
    expect(screen.getByText('HTML, RSS')).toBeInTheDocument();
    expect(screen.getByText('Redirects added')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /2 pages were held back/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Promote' })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Show findings' })[1]);
    expect(await screen.findByRole('tab', { name: /Findings/, selected: true })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^Errors/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('filters the findings by severity, shows chips and clears them; flags carried pages and the findings limit', async () => {
    await setup({ run: 'r-47', rtab: 'findings' });

    expect(screen.getByText(/212 more findings were not stored/)).toBeInTheDocument();
    expect(screen.getAllByText('Carried').length).toBe(2);
    expect(screen.getByRole('radio', { name: 'Errors 2' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Errors 2' }));
    await waitFor(() => expect(screen.queryByRole('heading', { level: 3, name: 'Meta description length' })).toBeNull());
    expect(screen.getByRole('heading', { level: 3, name: 'Link to a missing page or file' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Meta description length' })).toBeInTheDocument();
  });

  it('filters by output path and language from the URL (fpath, flang)', async () => {
    await setup({ run: 'r-47', rtab: 'findings', fpath: '/en/', flang: 'EN' });

    expect(screen.queryByRole('heading', { level: 3, name: 'Heading level skipped' })).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'Image without alt attribute' })).toBeInTheDocument();
  });

  it('shows the plan, its changes and kinds of change on Rebuilt', async () => {
    await setup({ run: 'r-47', rtab: 'rebuilt' });

    expect(screen.getByText(/Plan: 10 pages rebuilt because of/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Changes behind the rebuild' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Kind of change' })).toBeInTheDocument();
  });

  it('shows the plan and the findings of a run that failed at the upload (r-44)', async () => {
    await setup({ run: 'r-44', rtab: 'rebuilt' });
    expect(screen.getByText(/Plan: 10 pages rebuilt because of/)).toBeInTheDocument();
  });

  it('lists the findings of the failed run r-44', async () => {
    await setup({ run: 'r-44', rtab: 'findings' });
    expect(screen.getByRole('heading', { level: 3, name: 'Meta description length' })).toBeInTheDocument();
  });

  it.each([
    ['r-41', 'No plan was stored for this run'],
    ['r-42', 'The plan was removed by retention'],
    ['r-43', 'Nothing was rebuilt'],
    ['r-49', 'The plan is made when the run starts'],
  ])('shows the empty Rebuilt state of %s', async (run, title) => {
    await setup({ run, rtab: 'rebuilt' });

    expect(screen.getByText(title)).toBeInTheDocument();
  });
});

describe('Quality, Redirects and URLs (M35.24 round 17)', () => {
  afterEach(() => vi.restoreAllMocks());

  const toasts = () => vi.spyOn(TestBed.inject(ToastService), 'show');

  it('saves quality rules from the bar and says the next build is a full one', async () => {
    await setup({ psec: 'quality' });
    const toast = toasts();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(save).toBeDisabled();

    const group = screen.getByRole('radiogroup', { name: 'Level of “Image without alt attribute”' });
    fireEvent.click(within(group).getByRole('radio', { name: /Off/ }));
    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument();
    expect(save).toBeEnabled();

    fireEvent.click(save);

    expect(toast).toHaveBeenCalled();
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('The next incremental build runs as a full build because the rules changed.')).toBeInTheDocument();
    expect(save).toBeDisabled();
  });

  it('marks an invalid setting, says so in the bar and blocks Save (qinvalid=1)', async () => {
    await setup({ psec: 'quality', qinvalid: '1' });

    expect(screen.getByText('Fix the marked values to save.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: /Longest description/ })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a number from 50 to 400.')).toBeInTheDocument();
    expect(screen.getByText('Default 160, allowed 50 to 400')).toBeInTheDocument();
  });

  it('marks the default level and resets a rule that differs from it', async () => {
    await setup({ psec: 'quality' });
    const group = () => screen.getByRole('radiogroup', { name: 'Level of “Link to missing media”' });

    expect(within(group()).getByRole('radio', { name: /Error \(default\)/ })).toBeInTheDocument();
    expect(within(group()).getByRole('radio', { name: /Warning/ })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Reset “Link to missing media” to default' }));

    await waitFor(() => expect(within(group()).getByRole('radio', { name: /Error/ })).toHaveAttribute('aria-checked', 'true'));
    expect(screen.queryByRole('button', { name: 'Reset “Link to missing media” to default' })).toBeNull();
  });

  it('says a capped rule stored as Error is applied as Warning (qcapped=1) and which channels are checked', async () => {
    await setup({ psec: 'quality', qcapped: '1' });
    const errors = () => document.querySelector('[data-sf-summary="errors"]')!.textContent?.trim();

    expect(screen.getByText('Configured as Error, applied as Warning')).toBeInTheDocument();
    // Applied as Warning: the capped rule does not hold pages back, so the count is the same as without it.
    const without = Number(errors());
    expect(without).toBeGreaterThan(0);
    expect(screen.getAllByText(/Other channels \(Markdown, …\) are not checked/).length).toBeGreaterThan(0);
  });

  it('shows the quality rules read-only for viewers', async () => {
    await setup({ psec: 'quality', role: 'viewer' });

    expect(screen.getByText('Only developers can change the quality rules.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByRole('radiogroup', { name: 'Level of “Missing anchor”' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('opens the Add redirect dialog with the live-normalised path and its errors (rdialog=new)', async () => {
    await setup({ psec: 'redirects', rdialog: 'new' });
    const dialog = screen.getByRole('dialog', { name: 'Add redirect' });
    const old = within(dialog).getByRole('textbox', { name: /Old path/ });

    fireEvent.input(old, { target: { value: 'news/old' } });
    expect(await within(dialog).findByText('Saved as /news/old/')).toBeInTheDocument();

    fireEvent.input(old, { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Enter the old path.')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose a page.')).toBeInTheDocument();
  });

  it('shows the old path error from rerror=1 and the hint of the path option', async () => {
    await setup({ psec: 'redirects', rerror: '1' });
    const dialog = screen.getByRole('dialog', { name: 'Add redirect' });

    expect(within(dialog).getByText('The old path has no query (?…) or fragment (#…).')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'A path or URL' }));
    expect(await within(dialog).findByText('The query and fragment of the request are kept.')).toBeInTheDocument();
  });

  it('edits any redirect: rdialog=<id> preselects the page and offers the language', async () => {
    await setup({ psec: 'redirects', rdialog: 'rd-1' });
    const dialog = screen.getByRole('dialog', { name: 'Edit redirect' });

    expect(within(dialog).getByRole('radio', { name: 'A page' })).toBeChecked();
    expect(within(dialog).getByText('The redirect follows the page when it moves again.')).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'Language' })).toBeInTheDocument();
  });

  it('shows no language field for a channel without languages (rdialog=rd-9)', async () => {
    await setup({ psec: 'redirects', rdialog: 'rd-9' });
    const dialog = screen.getByRole('dialog', { name: 'Edit redirect' });

    expect(within(dialog).queryByRole('combobox', { name: 'Language' })).toBeNull();
    expect(within(dialog).getByRole('radio', { name: 'A path or URL' })).toBeChecked();
  });

  it('shows the saving state of the dialog (rsaving=1)', async () => {
    await setup({ psec: 'redirects', rdialog: 'rd-4', rsaving: '1' });
    const dialog = screen.getByRole('dialog', { name: 'Edit redirect' });

    expect(within(dialog).getByRole('button', { name: /Save/ })).toHaveAttribute('aria-busy', 'true');
  });

  it('shows the intro, the run link of automatic redirects, the conflict banner and no Export', async () => {
    await setup({ psec: 'redirects', rconflict: '1' });

    expect(screen.getByText('States are as of run #47 on the default target.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'from run #47' }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/by Jonas Weber/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'More redirect actions' }));
    expect(await screen.findByRole('menuitem', { name: /Delete all manual redirects/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Export/ })).toBeNull();
  });

  it('says nothing is built yet and shows Not built (nobuild=1)', async () => {
    await setup({ psec: 'redirects', nobuild: '1' });

    expect(screen.getByText(/Nothing is published on the default target yet/)).toBeInTheDocument();
    expect(screen.getAllByText('Not built').length).toBeGreaterThan(0);
  });

  it('edits a URL inline with its validation error (uerror=1) and pages the registry', async () => {
    await setup({ psec: 'urls', uerror: '1' });

    expect(screen.getByRole('alert')).toHaveTextContent('This URL is already used by Team.');
    expect(screen.getByRole('textbox', { name: /URL of Spring harvest arrives/ })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/Page 1 of 4/)).toBeInTheDocument();
    expect(screen.getByText('16 URLs in total')).toBeInTheDocument();
  });

  it('offers Reset only on overridden rows and disables the channel and area resets without their filters', async () => {
    await setup({ psec: 'urls' });

    // Page 1 has no overridden row; page 2 has two (Careers, the price list), and they alone offer Reset.
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Reset every URL of this asset' })).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findAllByRole('button', { name: 'Reset' })).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'More URL actions' }));
    expect(await screen.findByRole('menuitem', { name: /Reset channel/ })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: /Reset area/ })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: /Reset all URLs/ })).toBeInTheDocument();
  });

  it('resets a row after a plain danger confirm and toasts success', async () => {
    await setup({ psec: 'urls' });
    const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(true);
    const toast = toasts();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    fireEvent.click((await screen.findAllByRole('button', { name: 'Reset' }))[0]);

    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(confirm.mock.calls[0][0]).toMatchObject({ tone: 'danger', irreversible: true });
    expect(confirm.mock.calls[0][0].typeToConfirm).toBeUndefined();
    expect(toast).toHaveBeenCalledWith('Reset complete - the next build or preview assigns the current computed URLs.', 'success');
  });

  it('toasts the error variant when the reset fails (uerror=2)', async () => {
    await setup({ psec: 'urls', uerror: '2' });
    vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(true);
    const toast = toasts();

    fireEvent.click(screen.getAllByRole('button', { name: 'Reset every URL of this asset' })[0]);

    await waitFor(() => expect(toast).toHaveBeenCalledWith('The reset failed. Nothing was changed.', 'error'));
  });
});
