import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { LocalesStore } from '../../../core/project/locales.store';
import { ProjectAccessStore } from '../../../core/project/project-access.store';
import { provideProjectPermissions } from '../../../core/project/testing/project-permissions.testing';
import { ToastService } from '../../../core/ui/toast.service';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { ChannelsService } from '../../channels/channels.service';
import { UrlRegistryService } from '../../settings/url-registry.service';
import { PublishingUrlsComponent } from './urls.component';

type Entry = components['schemas']['UrlRegistryEntryView'];

const PAGE_UUID = '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1a01';
const MEDIA_UUID = '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1a02';

// Rows as UrlRegistryController sends them: URLs without a leading slash, media without a channel or (maybe) language.
const HOME: Entry = {
  id: 1,
  channelKey: 'html',
  area: 'GENERATED',
  locale: 'de',
  targetType: 'PAGE',
  targetUuid: PAGE_UUID,
  targetLabel: 'Home',
  url: 'de/index.html',
  overridden: false,
  assignedAt: '2026-09-20T08:00:00Z',
};
const TEAM: Entry = { ...HOME, id: 2, locale: 'en', targetLabel: 'Team', url: 'en/about/team.html', overridden: true, targetDeleted: true };
const LOGO: Entry = {
  id: 3,
  channelKey: '',
  area: 'GENERATED',
  locale: '',
  targetType: 'MEDIA',
  targetUuid: MEDIA_UUID,
  targetLabel: 'logo.svg',
  variant: 'thumb',
  url: 'media/logo.svg',
  overridden: false,
  assignedAt: '2026-09-20T08:00:00Z',
};
const ROOT: Entry = { ...HOME, id: 4, targetLabel: 'Start', url: './' };

interface Setup {
  rows?: Entry[];
  total?: number;
  role?: string;
  readOnlyLabel?: string | null;
  confirm?: boolean;
}

async function setup({ rows = [HOME, TEAM, LOGO], total, role = 'PROJECT_ADMIN', readOnlyLabel = null, confirm = true }: Setup = {}) {
  const api = {
    list: vi.fn().mockReturnValue(of({ content: rows, totalElements: total ?? rows.length, totalPages: 1 })),
    override: vi.fn().mockImplementation((_key: string, id: number, url: string) => of({ ...TEAM, id, url, overridden: true })),
    reset: vi.fn().mockReturnValue(of(undefined)),
  };
  const channels = { list: vi.fn().mockReturnValue(of([{ key: 'html', name: 'Website' }, { key: 'rss', name: 'Feed' }])) };
  const locales = {
    isLocalized: signal(true),
    locales: signal([{ code: 'de', label: 'Deutsch' }, { code: 'en', label: 'English' }]),
    load: vi.fn().mockReturnValue(of(null)),
  };
  const confirms = { confirm: vi.fn().mockResolvedValue(confirm) };
  const view = await render(PublishingUrlsComponent, {
    componentInputs: { projectKey: 'proj' },
    providers: [
      { provide: UrlRegistryService, useValue: api },
      { provide: ChannelsService, useValue: channels },
      { provide: LocalesStore, useValue: locales },
      { provide: ConfirmService, useValue: confirms },
      { provide: ProjectAccessStore, useValue: { readOnly: signal(readOnlyLabel !== null), readOnlyLabel: signal(readOnlyLabel) } },
      provideProjectPermissions({ role: () => role }),
    ],
  });
  return { ...view, api, confirms, toast: vi.spyOn(TestBed.inject(ToastService), 'show') };
}

const rows = () => screen.getAllByRole('row').slice(1);

async function tableLoaded(): Promise<void> {
  await waitFor(() => expect(rows().length).toBeGreaterThan(0));
}

/** Opens the Filters popover (a pick navigates, which closes it) and toggles one option of a filter group. */
async function pickFilter(group: string, option: string): Promise<void> {
  if (!screen.queryByRole('group', { name: group })) {
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  }
  fireEvent.click(within(await screen.findByRole('group', { name: group })).getByRole('button', { name: option }));
}

async function barMenu(item: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'More URL actions' }));
  return screen.findByRole('menuitem', { name: item });
}

function problem(status: number, body: Record<string, unknown>) {
  return throwError(() => new HttpErrorResponse({ status, error: body }));
}

describe('PublishingUrlsComponent', () => {
  it('lists the URLs as paths, with channel "all" and "No language" for media, and the total', async () => {
    const { api } = await setup({ rows: [HOME, TEAM, LOGO, ROOT], total: 57 });
    await tableLoaded();

    expect(api.list).toHaveBeenCalledWith('proj', expect.objectContaining({ page: 0, size: 20, quiet: true }));
    expect(screen.getByText('57 URLs')).toBeInTheDocument();
    expect(within(rows()[0]).getByText('/de/index.html')).toBeInTheDocument();
    expect(within(rows()[0]).getByText('Automatic')).toBeInTheDocument();
    // The root page is stored as "./".
    expect(within(rows()[3]).getByText('/')).toBeInTheDocument();
    const team = within(rows()[1]);
    expect(team.getByText('Overridden')).toBeInTheDocument();
    expect(team.getByText('deleted')).toBeInTheDocument();
    const logo = within(rows()[2]);
    expect(logo.getByText('logo.svg · variant thumb')).toBeInTheDocument();
    expect(logo.getByText('all')).toBeInTheDocument();
    expect(logo.getByText('No language')).toBeInTheDocument();
  });

  it('filters on the server, one value per filter, and maps "No language" to noLocale', async () => {
    const { api } = await setup();
    await tableLoaded();

    await pickFilter('Type', 'Media');
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith('proj', expect.objectContaining({ targetType: 'MEDIA', page: 0 })));
    await pickFilter('Channel', 'Website');
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith('proj', expect.objectContaining({ channelKey: 'html' })));
    await pickFilter('Language', 'No language');
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith('proj', expect.objectContaining({ noLocale: true })));
    expect(api.list).toHaveBeenLastCalledWith('proj', expect.not.objectContaining({ locale: expect.anything() }));
    await pickFilter('Area', 'Preview');
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith('proj', expect.objectContaining({ area: 'PREVIEW' })));
  });

  it('shows an empty state without a Reset menu when nothing is registered', async () => {
    await setup({ rows: [] });
    expect(await screen.findByText('No URLs registered')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More URL actions' })).toBeNull();
  });

  describe('permissions', () => {
    it('gives developers Override only', async () => {
      await setup({ role: 'DEVELOPER' });
      await tableLoaded();

      expect(within(rows()[1]).getByRole('button', { name: 'Override' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Reset every URL of this asset' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'More URL actions' })).toBeNull();
    });

    it('gives project admins every reset, Reset only on overridden rows', async () => {
      await setup({ role: 'PROJECT_ADMIN' });
      await tableLoaded();

      expect(within(rows()[0]).queryByRole('button', { name: 'Reset' })).toBeNull();
      expect(within(rows()[1]).getByRole('button', { name: 'Reset' })).toBeInTheDocument();
      expect(within(rows()[0]).getByRole('button', { name: 'Reset every URL of this asset' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'More URL actions' })).toBeInTheDocument();
    });

    it('shows editors a plain table', async () => {
      await setup({ role: 'EDITOR' });
      await tableLoaded();

      expect(screen.queryByRole('button', { name: 'Override' })).toBeNull();
      expect(screen.queryByRole('columnheader', { name: 'Actions' })).toBeNull();
    });

    it('offers no actions in a read-only project', async () => {
      await setup({ role: 'PROJECT_ADMIN', readOnlyLabel: 'This project is archived.' });
      await tableLoaded();

      expect(screen.getByText('This project is archived.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Override' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'More URL actions' })).toBeNull();
    });
  });

  describe('override', () => {
    function startEdit(): HTMLInputElement {
      fireEvent.click(within(rows()[1]).getByRole('button', { name: 'Override' }));
      return screen.getByRole('textbox', { name: 'URL of Team' }) as HTMLInputElement;
    }

    it('edits the URL in place, validates, and saves the override', async () => {
      const { api, toast } = await setup({ role: 'DEVELOPER' });
      await tableLoaded();

      const input = startEdit();
      expect(input).toHaveValue('/en/about/team.html');
      fireEvent.input(input, { target: { value: '/en/about us.html' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save override' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Enter a path inside the site');
      expect(api.override).not.toHaveBeenCalled();

      fireEvent.input(input, { target: { value: '/en/crew.html' } });
      expect(screen.queryByRole('alert')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Save override' }));

      await waitFor(() => expect(api.override).toHaveBeenCalledWith('proj', 2, '/en/crew.html', true));
      await waitFor(() => expect(screen.queryByRole('textbox', { name: 'URL of Team' })).toBeNull());
      expect(toast).toHaveBeenCalledWith('URL override saved. The next build moves the output there.', 'success');
      expect(within(rows()[1]).getByText('/en/crew.html')).toBeInTheDocument();
    });

    it('shows the server’s refusal at the field and keeps editing', async () => {
      const { api } = await setup({ role: 'DEVELOPER' });
      api.override.mockReturnValue(problem(409, { code: 'SF-DOM-0200', detail: 'Already used by "Home".' }));
      await tableLoaded();

      startEdit();
      fireEvent.click(screen.getByRole('button', { name: 'Save override' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Already used by "Home".');
      expect(screen.getByRole('textbox', { name: 'URL of Team' })).toBeInTheDocument();
    });

    it('saves on Enter and cancels on Escape', async () => {
      const { api } = await setup({ role: 'DEVELOPER' });
      await tableLoaded();

      fireEvent.keyDown(startEdit(), { key: 'Escape' });
      expect(screen.queryByRole('textbox', { name: 'URL of Team' })).toBeNull();

      fireEvent.keyDown(startEdit(), { key: 'Enter' });
      await waitFor(() => expect(api.override).toHaveBeenCalledWith('proj', 2, '/en/about/team.html', true));
    });
  });

  describe('resets', () => {
    it('resets one URL after asking, tells and reads the list again', async () => {
      const { api, confirms, toast } = await setup();
      await tableLoaded();
      const reads = api.list.mock.calls.length;

      fireEvent.click(within(rows()[1]).getByRole('button', { name: 'Reset' }));

      await waitFor(() => expect(api.reset).toHaveBeenCalledWith('proj', { entryId: 2 }, true));
      expect(confirms.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Reset this URL?', tone: 'danger', irreversible: true }));
      expect(toast).toHaveBeenCalledWith('Reset complete - the next build or preview assigns the current computed URLs.', 'success');
      await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThan(reads));
    });

    it('resets every URL of an asset', async () => {
      const { api, confirms } = await setup();
      await tableLoaded();

      fireEvent.click(within(rows()[2]).getByRole('button', { name: 'Reset every URL of this asset' }));

      await waitFor(() => expect(api.reset).toHaveBeenCalledWith('proj', { targetUuid: MEDIA_UUID }, true));
      expect(confirms.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Reset all URLs of logo.svg?' }));
    });

    it('does nothing when the confirmation is declined', async () => {
      const { api } = await setup({ confirm: false });
      await tableLoaded();

      fireEvent.click(within(rows()[1]).getByRole('button', { name: 'Reset' }));

      await waitFor(() => expect(api.list).toHaveBeenCalled());
      expect(api.reset).not.toHaveBeenCalled();
    });

    it('says so, and changes nothing, when the reset fails', async () => {
      const { api, toast } = await setup();
      api.reset.mockReturnValue(problem(500, { detail: 'boom' }));
      await tableLoaded();

      fireEvent.click(within(rows()[1]).getByRole('button', { name: 'Reset' }));

      await waitFor(() => expect(toast).toHaveBeenCalledWith('The reset failed. Nothing was changed.', 'error'));
    });

    it('keeps Reset channel and Reset area disabled, with the reason, until that filter is set', async () => {
      await setup();
      await tableLoaded();

      expect(await barMenu('Reset channel…')).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByRole('menuitem', { name: 'Reset area…' })).toHaveAttribute('aria-disabled', 'true');
    });

    it('resets the filtered channel and the filtered area', async () => {
      const { api, confirms } = await setup();
      await tableLoaded();

      await pickFilter('Channel', 'Feed');
      await waitFor(() => expect(api.list).toHaveBeenLastCalledWith('proj', expect.objectContaining({ channelKey: 'rss' })));
      fireEvent.click(await barMenu('Reset channel…'));
      await waitFor(() => expect(api.reset).toHaveBeenLastCalledWith('proj', { channelKey: 'rss' }, true));
      expect(confirms.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Reset all URLs of the channel Feed?' }));

      await pickFilter('Area', 'Preview');
      await waitFor(() => expect(api.list).toHaveBeenLastCalledWith('proj', expect.objectContaining({ area: 'PREVIEW' })));
      fireEvent.click(await barMenu('Reset area…'));
      await waitFor(() => expect(api.reset).toHaveBeenLastCalledWith('proj', { area: 'PREVIEW' }, true));
    });

    it('resets everything only after the project key is typed', async () => {
      const { api, confirms } = await setup();
      await tableLoaded();

      fireEvent.click(await barMenu('Reset all URLs…'));

      await waitFor(() => expect(api.reset).toHaveBeenCalledWith('proj', {}, true));
      expect(confirms.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Reset all URLs?', typeToConfirm: 'proj', irreversible: true, tone: 'danger' }),
      );
    });
  });
});
