import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../../core/api/api.client';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { LocalesStore } from '../../../core/project/locales.store';
import { ProjectAccessStore } from '../../../core/project/project-access.store';
import { ProjectMembersStore } from '../../../core/project/project-members.store';
import { provideProjectPermissions } from '../../../core/project/testing/project-permissions.testing';
import { ToastService } from '../../../core/ui/toast.service';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { ChannelsService } from '../../channels/channels.service';
import { RedirectsService } from '../../settings/redirects.service';
import { PublishingRedirectsComponent } from './redirects.component';

type RedirectPageView = components['schemas']['RedirectPageView'];
type RedirectView = components['schemas']['RedirectView'];

// Rows as RedirectController#listRedirects sends them (RedirectView): paths are output paths without a leading slash.
const AUTO: RedirectView = {
  id: 1,
  channel: 'html',
  locale: 'de',
  fromPath: 'produkte/hammer.html',
  toAssetUuid: '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1a01',
  toPageNumber: 1,
  toAssetName: 'Hammer',
  kind: 'AUTO',
  state: 'ACTIVE',
  resolvedTarget: 'werkzeug/hammer.html',
  createdAt: '2026-09-20T08:00:00Z',
  sourceRunId: 5,
  version: 0,
};
const MANUAL: RedirectView = {
  id: 2,
  channel: 'html',
  locale: 'de',
  fromPath: 'alt/index.html',
  toPath: 'https://example.org/neu',
  kind: 'MANUAL',
  state: 'SHADOWED',
  resolvedTarget: 'https://example.org/neu',
  createdAt: '2026-09-21T08:00:00Z',
  createdBy: 2,
  version: 3,
};
const FILE: RedirectView = {
  id: 3,
  channel: 'files',
  locale: '',
  fromPath: 'media/old-menu.pdf',
  toPath: 'media/menu.pdf',
  kind: 'MANUAL',
  state: 'DANGLING',
  createdAt: '2026-09-22T08:00:00Z',
  createdBy: 2,
  version: 1,
};

function page(rows: RedirectView[], basisRunId: number | null = 9): RedirectPageView {
  return { rows, page: 0, size: 50, totalElements: rows.length, totalPages: 1, ...(basisRunId === null ? {} : { basisRunId }) };
}

interface Setup {
  rows?: RedirectView[];
  basisRunId?: number | null;
  role?: string;
  readOnlyLabel?: string | null;
  confirm?: boolean;
  /** How many manual redirects the project has in all (the count behind "Delete all manual redirects…"). */
  manual?: number;
  localized?: boolean;
}

async function setup({
  rows = [AUTO, MANUAL, FILE],
  basisRunId = 9,
  role = 'DEVELOPER',
  readOnlyLabel = null,
  confirm = true,
  manual = 2,
  localized = true,
}: Setup = {}) {
  const api = {
    // The count read asks for one manual row; the table reads a whole page.
    list: vi.fn().mockImplementation((_key: string, query: { kind?: string; size?: number }) =>
      of(query.kind === 'MANUAL' && query.size === 1 ? { totalElements: manual } : page(rows, basisRunId)),
    ),
    update: vi.fn().mockReturnValue(of(MANUAL)),
    get: vi.fn().mockReturnValue(of(MANUAL)),
    create: vi.fn().mockReturnValue(of(MANUAL)),
    delete: vi.fn().mockReturnValue(of(undefined)),
    deleteAllManual: vi.fn().mockReturnValue(of({ deleted: manual })),
  };
  const channels = {
    list: vi.fn().mockReturnValue(
      of([
        { key: 'html', name: 'Website', isDefault: true },
        { key: 'files', name: 'Files' },
      ]),
    ),
  };
  const locales = {
    isLocalized: signal(localized),
    locales: signal(localized ? [{ code: 'de', label: 'Deutsch' }, { code: 'en', label: 'English' }] : []),
    defaultLocale: signal(localized ? 'de' : null),
    load: vi.fn().mockReturnValue(of(null)),
  };
  const assets = { listAssets: vi.fn().mockReturnValue(of({ content: [] })) };
  const confirms = { confirm: vi.fn().mockResolvedValue(confirm) };
  const view = await render(PublishingRedirectsComponent, {
    componentInputs: { projectKey: 'proj' },
    providers: [
      provideRouter([]),
      { provide: RedirectsService, useValue: api },
      { provide: ChannelsService, useValue: channels },
      { provide: LocalesStore, useValue: locales },
      { provide: ApiClient, useValue: assets },
      { provide: ConfirmService, useValue: confirms },
      { provide: ProjectMembersStore, useValue: { load: vi.fn(), nameOf: () => 'Ana Lopez' } },
      { provide: ProjectAccessStore, useValue: { readOnly: signal(readOnlyLabel !== null), readOnlyLabel: signal(readOnlyLabel) } },
      provideProjectPermissions({ role: () => role }),
    ],
  });
  return { ...view, api, confirms, assets, toast: vi.spyOn(TestBed.inject(ToastService), 'show') };
}

const rows = () => screen.getAllByRole('row').slice(1);

async function tableLoaded(): Promise<void> {
  await waitFor(() => expect(rows().length).toBeGreaterThan(0));
}

async function rowMenu(index: number, item: string): Promise<void> {
  fireEvent.click(within(rows()[index]).getByRole('button', { name: /^Actions for/ }));
  fireEvent.click(await screen.findByRole('menuitem', { name: item }));
}

/** Opens the Filters popover (a pick navigates, which closes it) and toggles one option of a filter group. */
async function pickFilter(group: string, option: string): Promise<void> {
  if (!screen.queryByRole('group', { name: group })) {
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  }
  fireEvent.click(within(await screen.findByRole('group', { name: group })).getByRole('button', { name: option }));
}

function conflict() {
  return throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'SF-API-0409', detail: 'stale' } }));
}

describe('PublishingRedirectsComponent', () => {
  it('lists the redirects with their target, kind, state and origin', async () => {
    const { api } = await setup();
    await tableLoaded();

    expect(api.list).toHaveBeenCalledWith('proj', expect.objectContaining({ page: 0, size: 50 }));
    expect(rows()).toHaveLength(3);
    const auto = within(rows()[0]);
    expect(auto.getByText('/produkte/hammer.html')).toBeInTheDocument();
    expect(auto.getByText('Hammer')).toBeInTheDocument();
    expect(auto.getByText('/werkzeug/hammer.html')).toBeInTheDocument();
    expect(auto.getByText('Automatic')).toBeInTheDocument();
    expect(auto.getByText('Active')).toBeInTheDocument();
    // An automatic row links to the run that made it.
    const run = auto.getByRole('link', { name: 'from run #5' });
    expect(run.getAttribute('href')).toBe('/p/proj/publishing/runs?run=5');
    // A manual one says who made it.
    const manual = within(rows()[1]);
    expect(manual.getByText('/alt/index.html')).toBeInTheDocument();
    expect(manual.getByText('Manual')).toBeInTheDocument();
    expect(manual.getByText(/by Ana Lopez/)).toBeInTheDocument();
    expect(manual.getByText('Shadowed')).toBeInTheDocument();
    expect(screen.getByText('States are as of run #9 on the default target.')).toBeInTheDocument();
  });

  it('shows "Not built" instead of a state while nothing is published, and offers no state filter', async () => {
    await setup({ rows: [{ ...MANUAL, state: undefined, resolvedTarget: undefined }], basisRunId: null });
    await tableLoaded();

    expect(within(rows()[0]).getByText('Not built')).toBeInTheDocument();
    expect(screen.getByText(/Nothing is published on the default target yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.queryByRole('group', { name: 'State' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Kind' })).toBeInTheDocument();
  });

  it('filters on the server, one value per filter, and maps "No language" to noLocale', async () => {
    const { api } = await setup();
    await tableLoaded();

    await pickFilter('Channel', 'Files');
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith('proj', expect.objectContaining({ channel: 'files', page: 0 })));

    // Another channel replaces the first: the API takes one value.
    await pickFilter('Channel', 'Website');
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith('proj', expect.objectContaining({ channel: 'html' })));
    expect(screen.queryByRole('button', { name: 'Remove Channel: Files' })).toBeNull();

    await pickFilter('Language', 'No language');
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith('proj', expect.objectContaining({ noLocale: true, channel: 'html' })));
    expect(api.list).toHaveBeenLastCalledWith('proj', expect.not.objectContaining({ locale: expect.anything() }));

    await pickFilter('State', 'Loop');
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith('proj', expect.objectContaining({ state: 'LOOP' })));
  });

  it('shows the language column and filter only in a project with languages', async () => {
    await setup({ rows: [FILE], localized: false });
    await tableLoaded();

    expect(screen.queryByRole('columnheader', { name: /Language/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.queryByRole('group', { name: 'Language' })).toBeNull();
  });

  it('is read-only for editors: no Add, no row menu, rows do not open', async () => {
    await setup({ role: 'EDITOR' });
    await tableLoaded();

    expect(screen.queryByRole('button', { name: 'Add redirect' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
  });

  it('shows the read-only note of an archived project', async () => {
    await setup({ readOnlyLabel: 'This project is archived.' });
    expect(await screen.findByText('This project is archived.')).toBeInTheDocument();
  });

  describe('deleting one', () => {
    it('asks, then deletes at the version read, tells and reloads', async () => {
      const { api, confirms, toast } = await setup();
      await tableLoaded();
      const reads = api.list.mock.calls.length;

      await rowMenu(1, 'Delete');

      await waitFor(() => expect(api.delete).toHaveBeenCalledWith('proj', 2, 3));
      expect(confirms.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete this redirect?', tone: 'danger' }));
      expect(toast).toHaveBeenCalledWith('Redirect deleted.', 'success');
      await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThan(reads));
    });

    it('does nothing when the confirmation is declined', async () => {
      const { api } = await setup({ confirm: false });
      await tableLoaded();

      await rowMenu(1, 'Delete');

      await waitFor(() => expect(api.list).toHaveBeenCalled());
      expect(api.delete).not.toHaveBeenCalled();
    });

    it('never deletes a row whose version is unknown', async () => {
      const { api, confirms } = await setup({ rows: [{ ...MANUAL, version: undefined }] });
      await tableLoaded();

      await rowMenu(0, 'Delete');

      expect(confirms.confirm).not.toHaveBeenCalled();
      expect(api.delete).not.toHaveBeenCalled();
    });

    it('answers a stale version with the Reload banner, which reads the list again', async () => {
      const { api } = await setup();
      api.delete.mockReturnValue(conflict());
      await tableLoaded();

      await rowMenu(1, 'Delete');
      expect(await screen.findByText(/changed elsewhere in the meantime/)).toBeInTheDocument();
      const reads = api.list.mock.calls.length;
      fireEvent.click(screen.getByRole('button', { name: 'Reload' }));

      await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThan(reads));
      expect(screen.queryByText(/changed elsewhere in the meantime/)).toBeNull();
    });
  });

  describe('delete all manual redirects', () => {
    async function openBarMenu(): Promise<void> {
      fireEvent.click(await screen.findByRole('button', { name: 'More redirect actions' }));
    }

    it('asks for the typed project key, deletes through the new endpoint, tells how many and reloads', async () => {
      const { api, confirms, toast } = await setup({ role: 'PROJECT_ADMIN', manual: 2 });
      await tableLoaded();
      const reads = api.list.mock.calls.length;

      await openBarMenu();
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete all manual redirects…' }));

      await waitFor(() => expect(api.deleteAllManual).toHaveBeenCalledWith('proj'));
      expect(confirms.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Delete 2 manual redirects?', typeToConfirm: 'proj', irreversible: true, tone: 'danger' }),
      );
      expect(toast).toHaveBeenCalledWith('2 manual redirects deleted.', 'success');
      await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThan(reads));
    });

    it('is not offered to a developer, only to project admins', async () => {
      await setup({ role: 'DEVELOPER', manual: 2 });
      await tableLoaded();
      expect(screen.queryByRole('button', { name: 'More redirect actions' })).toBeNull();
    });

    it('is hidden when there are no manual redirects', async () => {
      await setup({ role: 'PROJECT_ADMIN', manual: 0, rows: [AUTO] });
      await tableLoaded();
      expect(screen.queryByRole('button', { name: 'More redirect actions' })).toBeNull();
    });
  });

  describe('Add / Edit', () => {
    it('adds a redirect to a path and reloads', async () => {
      const { api, toast } = await setup();
      await tableLoaded();

      fireEvent.click(screen.getByRole('button', { name: 'Add redirect' }));
      const dialog = await screen.findByRole('dialog', { name: 'Add redirect' });
      fireEvent.input(within(dialog).getByLabelText(/Old path/), { target: { value: '/old/page/' } });
      expect(within(dialog).getByText('Saved as /old/page/index.html')).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('radio', { name: 'A path or URL' }));
      fireEvent.input(await within(dialog).findByLabelText(/Path or URL/), { target: { value: '/new/page/' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(api.create).toHaveBeenCalledWith('proj', {
          channel: 'html',
          locale: 'de',
          fromPath: 'old/page/index.html',
          toPath: 'new/page/index.html',
        }),
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(toast).toHaveBeenCalledWith('Redirect saved.', 'success');
    });

    it('edits a row from its menu and sends the version it was read at', async () => {
      const { api } = await setup();
      await tableLoaded();

      await rowMenu(1, 'Edit');
      const dialog = await screen.findByRole('dialog', { name: 'Edit redirect' });
      expect(within(dialog).getByLabelText(/Old path/)).toHaveValue('/alt/index.html');
      fireEvent.input(within(dialog).getByLabelText(/Path or URL/), { target: { value: 'https://example.org/andere' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(api.update).toHaveBeenCalledWith('proj', 2, 3, {
          channel: 'html',
          locale: 'de',
          fromPath: 'alt/index.html',
          toPath: 'https://example.org/andere',
        }),
      );
    });

    it('keeps the dialog open with a Reload banner when the redirect was changed meanwhile', async () => {
      const { api } = await setup();
      api.update.mockReturnValue(conflict());
      api.get.mockReturnValue(of({ ...MANUAL, version: 4 }));
      await tableLoaded();

      await rowMenu(1, 'Edit');
      const dialog = await screen.findByRole('dialog', { name: 'Edit redirect' });
      fireEvent.input(within(dialog).getByLabelText(/Path or URL/), { target: { value: '/x/' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

      expect(await within(dialog).findByText(/changed elsewhere in the meantime/)).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      const reads = api.list.mock.calls.length;
      fireEvent.click(within(dialog).getByRole('button', { name: 'Reload' }));
      await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThan(reads));
    });
  });
});
