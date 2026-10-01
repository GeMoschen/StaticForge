import { Location } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmService } from '../../../../shared/components/dialog/confirm.service';
import { SampleSettingsAreaComponent } from './sample-settings-area.component';
import { PROJECT_KEY } from './settings-data';

async function setup(query: Record<string, string> = {}) {
  const result = await render(SampleSettingsAreaComponent, {
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
    ],
  });
  await screen.findByRole('heading', { level: 1 });
  return result;
}

/** The query string the area last wrote. */
function watchQuery(): () => string {
  const replace = vi.spyOn(TestBed.inject(Location), 'replaceState');
  return () => String(replace.mock.lastCall?.[1] ?? '');
}

const sideNav = () => screen.getByRole('navigation', { name: 'Settings sections' });
const h1 = () => screen.getByRole('heading', { level: 1 });
const saveButton = () => screen.getByRole('button', { name: 'Save' });

describe('SampleSettingsAreaComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('menu and query parameters', () => {
    it('opens General with one h1 and the grouped side menu', async () => {
      await setup();

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(h1()).toHaveTextContent('General');
      const nav = sideNav();
      for (const group of ['Project', 'Maintenance', 'People']) {
        expect(within(nav).getByText(group)).toBeInTheDocument();
      }
      const project = within(nav).getByRole('list', { name: 'Project' });
      expect(within(project).getAllByRole('button').map((b) => b.querySelector('.sf-side-nav__label')?.textContent?.trim())).toEqual([
        'General',
        'Languages',
        'Channels',
        'Media',
        'Code highlighting',
      ]);
      expect(within(nav).getByRole('button', { name: /General/ })).toHaveAttribute('aria-current', 'page');
    });

    it('selects the section from ssec and writes it back when switching', async () => {
      await setup({ ssec: 'languages' });
      expect(h1()).toHaveTextContent('Languages');
      const query = watchQuery();

      fireEvent.click(within(sideNav()).getByRole('button', { name: /Import \/ export/ }));

      expect(await screen.findByRole('heading', { level: 1, name: 'Import / export' })).toBeInTheDocument();
      await waitFor(() => expect(query()).toContain('ssec=importexport'));
    });

    it('lists Channels only in developer mode and falls back to General without it', async () => {
      await setup({ ssec: 'channels', dev: '0' });

      expect(h1()).toHaveTextContent('General');
      expect(within(sideNav()).queryByRole('button', { name: /Channels/ })).not.toBeInTheDocument();
    });

    it('opens the Channels drawer for the first row from sdrawer=1', async () => {
      await setup({ ssec: 'channels', sdrawer: '1' });

      expect(h1()).toHaveTextContent('Channels');
      const drawer = screen.getByRole('dialog', { name: 'Edit Website' });
      expect(within(drawer).getByRole('switch', { name: 'Enabled' })).toHaveAttribute('aria-checked', 'true');
      // The table's enabled switches have their own names.
      expect(screen.getByRole('switch', { name: 'Shop API enabled' })).toHaveAttribute('aria-checked', 'false');
    });

    it('says that unbuilt pages are not part of the sample', async () => {
      await setup({ ssec: 'members' });

      expect(h1()).toHaveTextContent('Members');
      expect(screen.getByText('Not part of the sample')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    });
  });

  describe('General', () => {
    it('enables Save only while the form is dirty', async () => {
      await setup();
      expect(saveButton()).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByText('All changes saved')).toBeInTheDocument();

      const name = screen.getByRole('textbox', { name: /Project name/ });
      fireEvent.input(name, { target: { value: 'Nordlicht Coffee' } });

      expect(await screen.findByText('Unsaved changes')).toBeInTheDocument();
      expect(saveButton()).not.toHaveAttribute('aria-disabled');
      expect(within(sideNav()).getByRole('button', { name: /General/ })).toHaveTextContent('Unsaved');

      fireEvent.click(saveButton());
      expect(await screen.findByText('All changes saved')).toBeInTheDocument();
      expect(saveButton()).toHaveAttribute('aria-disabled', 'true');
    });

    it('archives only after a typed confirmation of the project key', async () => {
      await setup();
      const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(false);

      expect(screen.getByRole('heading', { level: 2, name: 'Danger zone' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Archive project' }));

      await waitFor(() => expect(confirm).toHaveBeenCalled());
      expect(confirm.mock.calls[0][0]).toMatchObject({ typeToConfirm: PROJECT_KEY, tone: 'danger' });
    });
  });

  describe('Languages', () => {
    it('opens the first language in the drawer from sdrawer=1 and applies an edit to the table', async () => {
      await setup({ ssec: 'languages', sdrawer: '1' });
      const drawer = screen.getByRole('dialog', { name: 'Edit English' });
      expect(within(drawer).getByRole('switch', { name: 'Default language' })).toHaveAttribute('aria-checked', 'true');
      expect(within(drawer).getByText(/pages move from \/about\.html to \/en\/about\.html/)).toBeInTheDocument();

      fireEvent.input(within(drawer).getByRole('textbox', { name: /Label/ }), { target: { value: 'English (US)' } });
      fireEvent.click(within(drawer).getByRole('button', { name: 'Apply' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      const grid = screen.getByRole('grid', { name: 'Languages' });
      // The label cell, and the fallbacks of Deutsch and Français.
      expect(within(grid).getAllByText(/English \(US\)/)).toHaveLength(3);
      expect(saveButton()).not.toHaveAttribute('aria-disabled');
    });

    it('opens a row in the drawer and asks before removing a language', async () => {
      await setup({ ssec: 'languages' });
      const query = watchQuery();
      const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(true);

      fireEvent.click(within(screen.getByRole('grid', { name: 'Languages' })).getByText('Français'));
      const drawer = await screen.findByRole('dialog', { name: 'Edit Français' });
      await waitFor(() => expect(query()).toContain('sdrawer=1'));

      fireEvent.click(within(drawer).getByRole('button', { name: 'Remove language' }));
      await waitFor(() => expect(confirm).toHaveBeenCalled());
      expect(confirm.mock.calls[0][0]).toMatchObject({ tone: 'danger' });
      await waitFor(() => expect(within(screen.getByRole('grid', { name: 'Languages' })).queryByText('Français')).not.toBeInTheDocument());
    });

    it('adds a language from a new drawer', async () => {
      await setup({ ssec: 'languages' });

      fireEvent.click(screen.getByRole('button', { name: 'Add language' }));

      const drawer = await screen.findByRole('dialog', { name: 'Add language' });
      expect(within(drawer).getByRole('button', { name: 'Add language' })).toBeDisabled();
    });
  });

  describe('Import / export', () => {
    it('shows the export steps, the selection summary beside Export and goes to Options', async () => {
      await setup({ ssec: 'importexport' });
      const query = watchQuery();

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('tab', { name: 'Export' })).toHaveAttribute('aria-selected', 'true');
      const steps = screen.getByRole('list', { name: 'Export steps' });
      expect(within(steps).getByText('Select').closest('li')).toHaveAttribute('aria-current', 'step');
      expect(screen.getByText('Selected: Pages 48 · Media 64')).toBeInTheDocument();
      // Store names, never "/ ROOT".
      expect(screen.queryByText(/ROOT/)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('checkbox', { name: /^Pages/ }));
      expect(await screen.findByText('Selected: Media 64')).toBeInTheDocument();
      // A partly ticked store shows the mixed state.
      expect((screen.getByRole('checkbox', { name: /^Media/ }) as HTMLInputElement).indeterminate).toBe(true);

      fireEvent.click(screen.getByRole('button', { name: 'Choose options' }));
      expect(await screen.findByRole('switch', { name: 'Include schedules' })).toBeInTheDocument();
      expect(within(steps).getByText('Options').closest('li')).toHaveAttribute('aria-current', 'step');
      await waitFor(() => expect(query()).toContain('istep=options'));

      fireEvent.click(screen.getByRole('button', { name: 'Export' }));
      expect(await screen.findByRole('progressbar', { name: 'Export progress' })).toBeInTheDocument();
    });

    it('shows the scripted run from istep=run', async () => {
      await setup({ ssec: 'importexport', istep: 'run' });

      expect(screen.getByRole('progressbar', { name: 'Export progress' })).toHaveAttribute('aria-valuenow', '58');
    });

    it('shows the result with the download from istep=result', async () => {
      await setup({ ssec: 'importexport', istep: 'result' });

      expect(screen.getByText('Export finished')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download archive' })).toBeInTheDocument();
    });

    it('analyses the import archive with a choice per conflict and the release state', async () => {
      await setup({ ssec: 'importexport', itab: 'import' });

      expect(screen.getByRole('tab', { name: 'Import' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText(/164 items, 5 conflicts/)).toBeInTheDocument();
      expect(screen.getByText('2 kept · 2 replaced · 1 skipped')).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /Keep the release state/ })).toBeChecked();

      const choice = screen.getByRole('combobox', { name: 'Action for Site settings' }) as HTMLSelectElement;
      fireEvent.change(choice, { target: { value: choice.options[1].value } });

      expect(await screen.findByText('2 kept · 3 replaced')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument();
    });
  });
});
