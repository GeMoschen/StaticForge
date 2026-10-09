import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../../core/api/api.client';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { LocalesStore } from '../../../core/project/locales.store';
import { RedirectsService } from '../../settings/redirects.service';
import { RedirectDialogComponent } from './redirect-dialog.component';

type RedirectView = components['schemas']['RedirectView'];
type ChannelView = components['schemas']['ChannelView'];

const CHANNELS: ChannelView[] = [
  { key: 'html', name: 'Website', isDefault: true, fileExtension: 'html' },
  { key: 'files', name: 'Files', fileExtension: 'bin' },
];
const HAMMER = { uuid: '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1a01', uid: 'hammer', displayName: 'Hammer', folderPath: '/pages_root/tools/' };
const HAMBURG = { uuid: '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1a02', uid: 'hamburg', displayName: 'Hamburg', folderPath: '/pages_root/offices/' };

const AUTO: RedirectView = {
  id: 7,
  channel: 'html',
  locale: 'en',
  fromPath: 'old/hammer.html',
  toAssetUuid: HAMMER.uuid,
  toAssetName: 'Hammer',
  toPageNumber: 2,
  kind: 'AUTO',
  version: 4,
};

function problem(status: number, body: Record<string, unknown>) {
  return throwError(() => new HttpErrorResponse({ status, error: body }));
}

async function setup({ redirect = null, localized = true }: { redirect?: RedirectView | null; localized?: boolean } = {}) {
  const api = {
    create: vi.fn().mockReturnValue(of({ ...AUTO, id: 8, kind: 'MANUAL' })),
    update: vi.fn().mockReturnValue(of({ ...AUTO, kind: 'MANUAL' })),
    get: vi.fn().mockReturnValue(of({ ...AUTO, version: 5 })),
  };
  const assets = {
    listAssets: vi.fn().mockImplementation((_key: string, query: { q?: string }) =>
      of({ content: query.q === 'ham' ? [HAMMER, HAMBURG] : [HAMBURG] }),
    ),
  };
  const locales = {
    isLocalized: signal(localized),
    locales: signal(localized ? [{ code: 'de', label: 'Deutsch' }, { code: 'en', label: 'English' }] : []),
    defaultLocale: signal(localized ? 'de' : null),
  };
  const saved = vi.fn();
  const stale = vi.fn();
  const closed = vi.fn();
  const view = await render(RedirectDialogComponent, {
    componentInputs: { projectKey: 'proj', redirect, channels: CHANNELS },
    componentOutputs: { saved: { emit: saved } as never, stale: { emit: stale } as never, closed: { emit: closed } as never },
    providers: [
      { provide: RedirectsService, useValue: api },
      { provide: ApiClient, useValue: assets },
      { provide: LocalesStore, useValue: locales },
    ],
  });
  return { ...view, api, assets, saved, stale, closed };
}

const dialog = () => screen.getByRole('dialog');
const save = () => fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));

/** What a browser sends for a press on an option: the list must stay open until the click. */
function press(element: HTMLElement): void {
  element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

async function choosePage(typed: string, name: string): Promise<void> {
  const combo = within(dialog()).getByRole('combobox', { name: /Page/ });
  fireEvent.focus(combo);
  fireEvent.input(combo, { target: { value: typed } });
  const option = await screen.findByRole('option', { name: new RegExp(name) });
  press(option);
}

describe('RedirectDialogComponent', () => {
  it('asks for what is missing and sends nothing', async () => {
    const { api } = await setup();

    save();

    expect(await within(dialog()).findByText('Enter the old path.')).toBeInTheDocument();
    expect(within(dialog()).getByText('Choose a page.')).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('shows how the old path is saved and refuses a query or fragment', async () => {
    await setup();
    const from = within(dialog()).getByLabelText(/Old path/);

    fireEvent.input(from, { target: { value: '/news/old/' } });
    expect(within(dialog()).getByText('Saved as /news/old/index.html')).toBeInTheDocument();

    fireEvent.input(from, { target: { value: '/news/old?utm=1' } });
    save();
    expect(await within(dialog()).findByText(/has no query/)).toBeInTheDocument();
  });

  it('finds a page by name, chooses it with the full press sequence and saves a redirect to it', async () => {
    const { api, assets, saved, closed } = await setup();
    fireEvent.input(within(dialog()).getByLabelText(/Old path/), { target: { value: '/tools/old-hammer.html' } });

    await choosePage('ham', 'Hammer');

    await waitFor(() => expect(assets.listAssets).toHaveBeenCalledWith('proj', { type: 'PAGE', q: 'ham', size: 20 }));
    await waitFor(() => expect(within(dialog()).getByRole('combobox', { name: /Page/ })).toHaveValue('Hammer'));
    save();

    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith('proj', {
        channel: 'html',
        locale: 'de',
        fromPath: 'tools/old-hammer.html',
        toAssetUuid: HAMMER.uuid,
        toPageNumber: 1,
      }),
    );
    expect(saved).toHaveBeenCalled();
    expect(closed).toHaveBeenCalled();
  });

  it('leaves the language out in a project without languages', async () => {
    const { api } = await setup({ localized: false });
    expect(within(dialog()).queryByText('Language')).toBeNull();
    fireEvent.input(within(dialog()).getByLabelText(/Old path/), { target: { value: '/a.html' } });
    fireEvent.click(within(dialog()).getByRole('radio', { name: 'A path or URL' }));
    fireEvent.input(await within(dialog()).findByLabelText(/Path or URL/), { target: { value: 'https://example.org/x' } });

    save();

    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith('proj', { channel: 'html', locale: '', fromPath: 'a.html', toPath: 'https://example.org/x' }),
    );
  });

  describe('editing', () => {
    it('opens with the redirect, names the page it leads to, and warns that saving makes an automatic one manual', async () => {
      await setup({ redirect: AUTO });

      expect(within(dialog()).getByLabelText(/Old path/)).toHaveValue('/old/hammer.html');
      expect(within(dialog()).getByRole('combobox', { name: /Page/ })).toHaveValue('Hammer');
      expect(within(dialog()).getByText(/A build added this redirect/)).toBeInTheDocument();
    });

    it('sends the version it was opened with and keeps the page number of the same page', async () => {
      const { api } = await setup({ redirect: AUTO });
      fireEvent.input(within(dialog()).getByLabelText(/Old path/), { target: { value: '/old/hammer-2.html' } });

      save();

      await waitFor(() =>
        expect(api.update).toHaveBeenCalledWith('proj', 7, 4, {
          channel: 'html',
          locale: 'en',
          fromPath: 'old/hammer-2.html',
          toAssetUuid: HAMMER.uuid,
          toPageNumber: 2,
        }),
      );
    });

    it('cannot save a redirect whose version is unknown', async () => {
      const { api } = await setup({ redirect: { ...AUTO, version: undefined } });

      save();

      expect(api.update).not.toHaveBeenCalled();
    });

    it('goes back to page 1 when another page is chosen', async () => {
      const { api } = await setup({ redirect: AUTO });

      await choosePage('ham', 'Hamburg');
      save();

      await waitFor(() => expect(api.update).toHaveBeenCalledWith('proj', 7, 4, expect.objectContaining({ toAssetUuid: HAMBURG.uuid, toPageNumber: 1 })));
    });
  });

  describe('when the server refuses', () => {
    it('puts a duplicate old path on the old path field and stays open', async () => {
      const { api, closed } = await setup({ redirect: AUTO });
      api.update.mockReturnValue(problem(409, { code: 'SF-DOM-0191', detail: 'A redirect from this path exists.' }));

      save();

      expect(await within(dialog()).findByText('A redirect from this path exists.')).toBeInTheDocument();
      expect(closed).not.toHaveBeenCalled();
      expect(within(dialog()).getByRole('button', { name: 'Save' })).toBeEnabled();
    });

    it('puts a loop on the target field', async () => {
      const { api } = await setup({ redirect: AUTO });
      api.update.mockReturnValue(problem(422, { code: 'SF-DOM-0192', detail: 'This would loop.' }));

      save();

      expect(await within(dialog()).findByText('This would loop.')).toBeInTheDocument();
    });

    it('shows anything else in the dialog', async () => {
      const { api } = await setup({ redirect: AUTO });
      api.update.mockReturnValue(problem(500, { detail: 'Disk full.' }));

      save();

      expect(await within(dialog()).findByText('Disk full.')).toBeInTheDocument();
    });

    it('keeps the dialog open with a Reload banner on a conflict, then saves against the current version with the input kept', async () => {
      const { api, stale, closed } = await setup({ redirect: AUTO });
      api.update.mockReturnValueOnce(problem(409, { code: 'SF-API-0409', detail: 'stale' }));
      fireEvent.input(within(dialog()).getByLabelText(/Old path/), { target: { value: '/old/mine.html' } });

      save();

      expect(await within(dialog()).findByText(/changed elsewhere in the meantime/)).toBeInTheDocument();
      expect(closed).not.toHaveBeenCalled();
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Reload' }));
      await waitFor(() => expect(api.get).toHaveBeenCalledWith('proj', 7));
      await waitFor(() => expect(within(dialog()).queryByText(/changed elsewhere/)).toBeNull());
      expect(stale).toHaveBeenCalled();
      expect(within(dialog()).getByLabelText(/Old path/)).toHaveValue('/old/mine.html');

      save();
      await waitFor(() => expect(api.update).toHaveBeenLastCalledWith('proj', 7, 5, expect.objectContaining({ fromPath: 'old/mine.html' })));
    });

    it('says the redirect is gone when Reload finds it deleted', async () => {
      const { api } = await setup({ redirect: AUTO });
      api.update.mockReturnValue(problem(404, { detail: 'nope' }));
      api.get.mockReturnValue(problem(404, { detail: 'nope' }));

      save();
      fireEvent.click(await within(dialog()).findByRole('button', { name: 'Reload' }));

      expect(await within(dialog()).findByText('This redirect was deleted in the meantime.')).toBeInTheDocument();
    });
  });
});
