import { signal } from '@angular/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ChannelsService } from '../channels/channels.service';
import { LocalesStore } from '../../core/project/locales.store';
import { ProjectSettingsUrlRegistryComponent } from './project-settings-url-registry.component';
import { UrlRegistryEntryView, UrlRegistryService } from './url-registry.service';

const entryA: UrlRegistryEntryView = {
  id: 1,
  channelKey: 'html',
  targetType: 'PAGE',
  targetUuid: 'page-a',
  targetLabel: 'Home',
  targetUid: 'home',
  targetPath: '/pages_root/',
  targetDeleted: false,
  locale: '',
  variant: '',
  pageNumber: 1,
  area: 'PREVIEW',
  url: '/home/',
  overridden: false,
  assignedAt: '2026-01-01T00:00:00Z',
  assignedRevision: 1,
};

const entryB: UrlRegistryEntryView = {
  id: 2,
  channelKey: 'html',
  targetType: 'PAGE',
  targetUuid: 'page-b',
  targetLabel: 'About',
  targetUid: 'about',
  targetPath: '/pages_root/',
  targetDeleted: false,
  locale: '',
  variant: '',
  pageNumber: 1,
  area: 'GENERATED',
  url: '/about/',
  overridden: true,
  assignedAt: '2026-01-02T00:00:00Z',
  assignedRevision: 2,
};

function page(content: UrlRegistryEntryView[]) {
  return {
    content,
    totalElements: content.length,
    totalPages: 1,
    number: 0,
    size: 20,
  };
}

function makeApiStub(overrides: Partial<Record<keyof UrlRegistryService, unknown>> = {}) {
  return {
    list: vi.fn().mockReturnValue(of(page([entryA, entryB]))),
    override: vi.fn().mockReturnValue(of({ ...entryA, url: '/new-home/', overridden: true })),
    reset: vi.fn().mockReturnValue(of(undefined)),
    ...overrides,
  };
}

function makeChannelsStub() {
  return {
    list: vi.fn().mockReturnValue(of([{ key: 'html', name: 'HTML' }])),
  };
}

describe('ProjectSettingsUrlRegistryComponent', () => {
  it('loads and renders the registry list against the backend', async () => {
    const api = makeApiStub();
    await render(ProjectSettingsUrlRegistryComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: UrlRegistryService, useValue: api },
        { provide: ChannelsService, useValue: makeChannelsStub() },
        { provide: LocalesStore, useValue: { locales: signal([]) } },
      ],
    });

    expect(api.list).toHaveBeenCalledWith('proj', {
      channelKey: undefined,
      area: undefined,
      targetType: undefined,
      locale: undefined,
      q: undefined,
      page: 0,
      size: 20,
    });
    await waitFor(() => expect(screen.getByText('Home')).toBeTruthy());
    expect(screen.getByText('About')).toBeTruthy();
  });

  it('filters by channel and area', async () => {
    const api = makeApiStub();
    await render(ProjectSettingsUrlRegistryComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: UrlRegistryService, useValue: api },
        { provide: ChannelsService, useValue: makeChannelsStub() },
        { provide: LocalesStore, useValue: { locales: signal([]) } },
      ],
    });
    await waitFor(() => expect(screen.getByText('Home')).toBeTruthy());

    const channelSelect = (await screen.findAllByRole('combobox'))[0] as HTMLSelectElement;
    channelSelect.value = 'html';
    channelSelect.dispatchEvent(new Event('change'));

    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith('proj', {
        channelKey: 'html',
        area: undefined,
        targetType: undefined,
        locale: undefined,
        q: undefined,
        page: 0,
        size: 20,
      }),
    );

    const areaSelect = (await screen.findAllByRole('combobox'))[2] as HTMLSelectElement;
    areaSelect.value = 'PREVIEW';
    areaSelect.dispatchEvent(new Event('change'));

    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith('proj', {
        channelKey: 'html',
        area: 'PREVIEW',
        targetType: undefined,
        locale: undefined,
        q: undefined,
        page: 0,
        size: 20,
      }),
    );
  });

  it('persists a manual override and reflects it immediately in the table', async () => {
    const api = makeApiStub();
    await render(ProjectSettingsUrlRegistryComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: UrlRegistryService, useValue: api },
        { provide: ChannelsService, useValue: makeChannelsStub() },
        { provide: LocalesStore, useValue: { locales: signal([]) } },
      ],
    });
    await waitFor(() => expect(screen.getByText('Home')).toBeTruthy());

    screen.getAllByText('Override')[0].click();
    const input = (await screen.findAllByRole('textbox')).find(
      (el) => (el as HTMLInputElement).value === '/home/',
    ) as HTMLInputElement;
    input.value = '/new-home/';
    input.dispatchEvent(new Event('input'));

    screen.getByText('Save').click();

    expect(api.override).toHaveBeenCalledWith('proj', 1, '/new-home/');
    await waitFor(() => expect(screen.getByText('/new-home/')).toBeTruthy());
  });

  it('requires confirmation before a per-row reset and removes the row after confirming', async () => {
    const api = makeApiStub({
      list: vi
        .fn()
        .mockReturnValueOnce(of(page([entryA, entryB])))
        .mockReturnValueOnce(of(page([entryB]))),
    });
    await render(ProjectSettingsUrlRegistryComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: UrlRegistryService, useValue: api },
        { provide: ChannelsService, useValue: makeChannelsStub() },
        { provide: LocalesStore, useValue: { locales: signal([]) } },
      ],
    });
    await waitFor(() => expect(screen.getByText('Home')).toBeTruthy());

    screen.getAllByText('Reset')[0].click();
    expect(api.reset).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('Reset this URL')).toBeTruthy());

    const confirmButtons = screen.getAllByText(/^Reset$/);
    confirmButtons[confirmButtons.length - 1].click();

    await waitFor(() => expect(api.reset).toHaveBeenCalledWith('proj', { entryId: 1 }));
    await waitFor(() => expect(screen.queryByText('Reset this URL')).toBeNull());
  });

  it('requires confirmation before a per-channel reset', async () => {
    const api = makeApiStub();
    await render(ProjectSettingsUrlRegistryComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: UrlRegistryService, useValue: api },
        { provide: ChannelsService, useValue: makeChannelsStub() },
        { provide: LocalesStore, useValue: { locales: signal([]) } },
      ],
    });
    await waitFor(() => expect(screen.getByText('Home')).toBeTruthy());

    const channelSelect = (await screen.findAllByRole('combobox'))[0] as HTMLSelectElement;
    fireEvent.change(channelSelect, { target: { value: 'html' } });
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));

    // The scoped reset stays `[disabled]` until the chosen channel has been rendered into the
    // binding, so wait for that rather than clicking a still-disabled button.
    const reset = await waitFor(() => {
      const btn = screen.getByRole('button', { name: 'Reset channel' }) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
      return btn;
    });
    reset.click();
    await waitFor(() => expect(screen.getByText('Reset channel URLs')).toBeTruthy());

    const confirmButtons = screen.getAllByRole('button', { name: 'Reset channel' });
    confirmButtons[confirmButtons.length - 1].click();

    await waitFor(() => expect(api.reset).toHaveBeenCalledWith('proj', { channelKey: 'html' }));
  });

  it('requires confirmation before a per-area reset', async () => {
    const api = makeApiStub();
    await render(ProjectSettingsUrlRegistryComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: UrlRegistryService, useValue: api },
        { provide: ChannelsService, useValue: makeChannelsStub() },
        { provide: LocalesStore, useValue: { locales: signal([]) } },
      ],
    });
    await waitFor(() => expect(screen.getByText('Home')).toBeTruthy());

    const areaSelect = (await screen.findAllByRole('combobox'))[2] as HTMLSelectElement;
    fireEvent.change(areaSelect, { target: { value: 'GENERATED' } });
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));

    const reset = await waitFor(() => {
      const btn = screen.getByRole('button', { name: 'Reset area' }) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
      return btn;
    });
    reset.click();
    await waitFor(() => expect(screen.getByText('Reset area URLs')).toBeTruthy());

    const confirmButtons = screen.getAllByRole('button', { name: 'Reset area' });
    confirmButtons[confirmButtons.length - 1].click();

    await waitFor(() => expect(api.reset).toHaveBeenCalledWith('proj', { area: 'GENERATED' }));
  });

  it('requires confirmation before a project-wide reset all', async () => {
    const api = makeApiStub();
    await render(ProjectSettingsUrlRegistryComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: UrlRegistryService, useValue: api },
        { provide: ChannelsService, useValue: makeChannelsStub() },
        { provide: LocalesStore, useValue: { locales: signal([]) } },
      ],
    });
    await waitFor(() => expect(screen.getByText('Home')).toBeTruthy());

    screen.getByText('Reset all').click();
    await waitFor(() => expect(screen.getByText('Reset all URLs')).toBeTruthy());

    const confirmButtons = screen.getAllByText(/Reset all/);
    confirmButtons[confirmButtons.length - 1].click();

    await waitFor(() => expect(api.reset).toHaveBeenCalledWith('proj', {}));
  });

  it('disables every reset while one runs, so a second confirmed reset cannot get lost', async () => {
    const pending = new Subject<void>();
    const api = makeApiStub({ reset: vi.fn().mockReturnValue(pending) });
    await render(ProjectSettingsUrlRegistryComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: UrlRegistryService, useValue: api },
        { provide: ChannelsService, useValue: makeChannelsStub() },
        { provide: LocalesStore, useValue: { locales: signal([]) } },
      ],
    });
    await waitFor(() => expect(screen.getByText('Home')).toBeTruthy());

    screen.getByText('Reset all').click();
    await waitFor(() => expect(screen.getByText('Reset all URLs')).toBeTruthy());
    const confirmButtons = screen.getAllByText(/Reset all/);
    confirmButtons[confirmButtons.length - 1].click();
    await waitFor(() => expect(api.reset).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Reset all' })).toBeDisabled());
    for (const button of screen.getAllByRole('button', { name: 'Reset' })) {
      expect(button).toBeDisabled();
    }
    pending.next();
    pending.complete();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reset all' })).toBeEnabled());
  });

  it('filters by target type and searches by name or URL on Enter', async () => {
    const api = makeApiStub();
    await render(ProjectSettingsUrlRegistryComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: UrlRegistryService, useValue: api },
        { provide: ChannelsService, useValue: makeChannelsStub() },
        { provide: LocalesStore, useValue: { locales: signal([]) } },
      ],
    });
    await waitFor(() => expect(screen.getByText('Home')).toBeTruthy());

    const typeSelect = (await screen.findAllByRole('combobox'))[1] as HTMLSelectElement;
    fireEvent.change(typeSelect, { target: { value: 'MEDIA' } });
    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith('proj', expect.objectContaining({ targetType: 'MEDIA', page: 0 })),
    );

    const search = screen.getByPlaceholderText('Name or URL') as HTMLInputElement;
    fireEvent.input(search, { target: { value: 'logo' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith('proj', expect.objectContaining({ targetType: 'MEDIA', q: 'logo' })),
    );
  });

  it('shows what a row names: its type, a media variant or a page number', async () => {
    const media: UrlRegistryEntryView = {
      ...entryA,
      id: 3,
      channelKey: '',
      targetType: 'MEDIA',
      targetLabel: 'Logo',
      variant: 'thumb',
      url: 'assets/media/logo-thumb.jpg',
    };
    const blogPage2: UrlRegistryEntryView = { ...entryB, id: 4, targetLabel: 'Blog', pageNumber: 2, url: 'blog-2.html' };
    const api = makeApiStub({ list: vi.fn().mockReturnValue(of(page([media, blogPage2]))) });
    await render(ProjectSettingsUrlRegistryComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: UrlRegistryService, useValue: api },
        { provide: ChannelsService, useValue: makeChannelsStub() },
        { provide: LocalesStore, useValue: { locales: signal([]) } },
      ],
    });

    await waitFor(() => expect(screen.getByText('Logo · variant thumb')).toBeTruthy());
    expect(screen.getByText('Blog · page 2')).toBeTruthy();
    expect(screen.getAllByText('Media').some((el) => el.classList.contains('badge--type'))).toBe(true);
    expect(screen.getByText('all')).toBeTruthy();
  });

  it('shows the server reason when an override is refused', async () => {
    const api = makeApiStub({
      override: vi.fn().mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { code: 'SF-DOM-0200', detail: "'about.html' is already the URL of page b." },
            }),
        ),
      ),
    });
    await render(ProjectSettingsUrlRegistryComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: UrlRegistryService, useValue: api },
        { provide: ChannelsService, useValue: makeChannelsStub() },
        { provide: LocalesStore, useValue: { locales: signal([]) } },
      ],
    });
    await waitFor(() => expect(screen.getByText('Home')).toBeTruthy());

    screen.getAllByText('Override')[0].click();
    (await screen.findByText('Save')).click();

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('already the URL of page b'));
  });

  it('resets every URL of an asset after confirming', async () => {
    const api = makeApiStub();
    await render(ProjectSettingsUrlRegistryComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: UrlRegistryService, useValue: api },
        { provide: ChannelsService, useValue: makeChannelsStub() },
        { provide: LocalesStore, useValue: { locales: signal([]) } },
      ],
    });
    await waitFor(() => expect(screen.getByText('Home')).toBeTruthy());

    screen.getAllByText('Reset asset')[0].click();
    await waitFor(() => expect(screen.getByText('Reset all URLs of this asset')).toBeTruthy());
    const confirm = screen.getAllByRole('button', { name: 'Reset asset' });
    confirm[confirm.length - 1].click();

    await waitFor(() => expect(api.reset).toHaveBeenCalledWith('proj', { targetUuid: 'page-a' }));
  });
});
