import { signal } from '@angular/core';
import { render, screen, waitFor, fireEvent } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ChannelsService } from '../channels/channels.service';
import { LocalesStore } from '../../core/project/locales.store';
import { SfAssetUrlsComponent } from './asset-urls.component';
import { UrlRegistryAssetView, UrlRegistryEntryView, UrlRegistryService } from './url-registry.service';

const row: UrlRegistryEntryView = {
  id: 7,
  channelKey: 'html',
  area: 'GENERATED',
  locale: '',
  targetType: 'PAGE',
  targetUuid: 'page-1',
  targetLabel: 'About',
  targetUid: 'about',
  targetPath: '/pages_root/',
  targetDeleted: false,
  variant: '',
  pageNumber: 1,
  url: 'about.html',
  overridden: false,
  assignedAt: '2026-09-29T00:00:00Z',
  assignedRevision: 3,
};

function permissions(developer: boolean, admin: boolean) {
  return { canEditTemplates: signal(developer), canAdminProject: signal(admin) };
}

async function setup(view: UrlRegistryAssetView, developer = true, admin = true, forAsset = vi.fn().mockReturnValue(of(view))) {
  const api = {
    forAsset,
    override: vi.fn().mockReturnValue(of({ ...row, url: 'company/about.html', overridden: true })),
    assign: vi.fn().mockReturnValue(of(row)),
    reset: vi.fn().mockReturnValue(of(undefined)),
  };
  await render(SfAssetUrlsComponent, {
    componentInputs: { projectKey: 'proj', assetUuid: view.uuid },
    providers: [
      { provide: UrlRegistryService, useValue: api },
      { provide: ChannelsService, useValue: { list: vi.fn().mockReturnValue(of([{ key: 'html' }, { key: 'amp' }])) } },
      { provide: ProjectPermissionsStore, useValue: permissions(developer, admin) },
      { provide: LocalesStore, useValue: { locales: signal([]) } },
    ],
  });
  return api;
}

describe('SfAssetUrlsComponent', () => {
  it('lists the asset URLs and overrides one', async () => {
    const api = await setup({ uuid: 'page-1', targetType: 'PAGE', indexPages: [], entries: [row] });

    await waitFor(() => expect(screen.getByText('about.html')).toBeTruthy());
    expect(screen.getByText('Build · html')).toBeTruthy();

    screen.getByText('Override').click();
    const input = await screen.findByLabelText('URL');
    fireEvent.input(input, { target: { value: 'company/about.html' } });
    screen.getByText('Save').click();

    expect(api.override).toHaveBeenCalledWith('proj', 7, 'company/about.html');
  });

  it('sets a URL for an output without one', async () => {
    const api = await setup({ uuid: 'page-1', targetType: 'PAGE', indexPages: [], entries: [] });
    await waitFor(() => expect(screen.getByText(/No URL yet/)).toBeTruthy());

    screen.getByText('Set URL').click();
    const input = await screen.findByLabelText('New URL');
    fireEvent.input(input, { target: { value: 'team.html' } });
    screen.getByText('Save').click();

    expect(api.assign).toHaveBeenCalledWith('proj', expect.objectContaining({
      targetType: 'PAGE',
      targetUuid: 'page-1',
      channelKey: 'html',
      area: 'GENERATED',
      url: 'team.html',
    }));
  });

  it("names a folder's index page instead of a URL of its own", async () => {
    await setup({
      uuid: 'folder-1',
      targetType: 'FOLDER',
      indexPages: [{ channelKey: 'html', pageUuid: 'page-9', pageLabel: 'Products home' }],
      entries: [],
    });
    await waitFor(() => expect(screen.getByText('Products home')).toBeTruthy());
    expect(screen.getByText(/Uses the URL of its index page/)).toBeTruthy();
  });

  it('hides override and reset without the roles', async () => {
    await setup({ uuid: 'page-1', targetType: 'PAGE', indexPages: [], entries: [row] }, false, false);
    await waitFor(() => expect(screen.getByText('about.html')).toBeTruthy());
    expect(screen.queryByText('Override')).toBeNull();
    expect(screen.queryByText('Reset')).toBeNull();
    expect(screen.queryByText('Set URL')).toBeNull();
  });

  it('says quietly that the URLs are not available (a project without output) and reads again on Retry', async () => {
    const view: UrlRegistryAssetView = { uuid: 'media-1', targetType: 'MEDIA', indexPages: [], entries: [row] };
    const forAsset = vi.fn().mockReturnValueOnce(throwError(() => new Error('500'))).mockReturnValue(of(view));
    await setup(view, true, true, forAsset);

    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent('The URLs of this file are not available yet.');
    expect(screen.queryByRole('alert')).toBeNull();

    screen.getByRole('button', { name: 'Retry' }).click();

    await waitFor(() => expect(screen.getByText('about.html')).toBeTruthy());
    expect(screen.queryByRole('status')).toBeNull();
    expect(forAsset).toHaveBeenCalledTimes(2);
  });
});
