import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ChannelsService } from '../channels/channels.service';
import { ProjectSettingsUrlRegistryComponent } from './project-settings-url-registry.component';
import { UrlRegistryEntryView, UrlRegistryService } from './url-registry.service';

const entryA: UrlRegistryEntryView = {
  id: 1,
  channelKey: 'html',
  pageReferenceUuid: 'ref-a',
  pageReferenceLabel: 'Home',
  area: 'PREVIEW',
  url: '/home/',
  overridden: false,
  assignedAt: '2026-01-01T00:00:00Z',
  assignedRevision: 1,
};

const entryB: UrlRegistryEntryView = {
  id: 2,
  channelKey: 'html',
  pageReferenceUuid: 'ref-b',
  pageReferenceLabel: 'About',
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
      ],
    });

    expect(api.list).toHaveBeenCalledWith('proj', {
      channelKey: undefined,
      area: undefined,
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
        page: 0,
        size: 20,
      }),
    );

    const areaSelect = (await screen.findAllByRole('combobox'))[1] as HTMLSelectElement;
    areaSelect.value = 'PREVIEW';
    areaSelect.dispatchEvent(new Event('change'));

    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith('proj', {
        channelKey: 'html',
        area: 'PREVIEW',
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
      ],
    });
    await waitFor(() => expect(screen.getByText('Home')).toBeTruthy());

    screen.getAllByText('Reset')[0].click();
    expect(api.reset).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('Reset this URL')).toBeTruthy());

    const confirmButtons = screen.getAllByText(/^Reset$/);
    confirmButtons[confirmButtons.length - 1].click();

    expect(api.reset).toHaveBeenCalledWith('proj', { entryId: 1 });
    await waitFor(() => expect(screen.queryByText('Reset this URL')).toBeNull());
  });

  it('requires confirmation before a per-channel reset', async () => {
    const api = makeApiStub();
    await render(ProjectSettingsUrlRegistryComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: UrlRegistryService, useValue: api },
        { provide: ChannelsService, useValue: makeChannelsStub() },
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

    expect(api.reset).toHaveBeenCalledWith('proj', { channelKey: 'html' });
  });

  it('requires confirmation before a per-area reset', async () => {
    const api = makeApiStub();
    await render(ProjectSettingsUrlRegistryComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: UrlRegistryService, useValue: api },
        { provide: ChannelsService, useValue: makeChannelsStub() },
      ],
    });
    await waitFor(() => expect(screen.getByText('Home')).toBeTruthy());

    const areaSelect = (await screen.findAllByRole('combobox'))[1] as HTMLSelectElement;
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

    expect(api.reset).toHaveBeenCalledWith('proj', { area: 'GENERATED' });
  });

  it('requires confirmation before a project-wide reset all', async () => {
    const api = makeApiStub();
    await render(ProjectSettingsUrlRegistryComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: UrlRegistryService, useValue: api },
        { provide: ChannelsService, useValue: makeChannelsStub() },
      ],
    });
    await waitFor(() => expect(screen.getByText('Home')).toBeTruthy());

    screen.getByText('Reset all').click();
    await waitFor(() => expect(screen.getByText('Reset all URLs')).toBeTruthy());

    const confirmButtons = screen.getAllByText(/Reset all/);
    confirmButtons[confirmButtons.length - 1].click();

    expect(api.reset).toHaveBeenCalledWith('proj', {});
  });
});
