import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { NavReferenceDetailComponent } from './nav-reference-detail.component';
import { NavigationService, type PageReferenceView } from './navigation.service';

const reference: PageReferenceView = {
  uuid: 'ref-uuid',
  uid: 'products_home',
  displayName: 'Products Home',
  revision: 5,
  folderPath: '/nav/products/',
  targetKind: 'PAGE',
  targetAssetUuid: 'page-uuid',
  label: undefined,
};

function makeNavStub(overrides: Partial<Record<keyof NavigationService, unknown>> = {}) {
  return {
    updateReference: vi.fn().mockReturnValue(of({})),
    deleteReference: vi.fn().mockReturnValue(of(undefined)),
    resolveReference: vi.fn().mockReturnValue(of({ pageUuid: 'page-uuid', path: '/products/' })),
    ...overrides,
  };
}

function makeApiStub(overrides: Partial<Record<keyof ApiClient, unknown>> = {}) {
  return {
    listFolders: vi.fn().mockReturnValue(of([])),
    changeUid: vi.fn().mockReturnValue(of({ oldUid: 'products_home', newUid: 'new_uid', affectedTemplates: [] })),
    renameAsset: vi.fn().mockReturnValue(of({})),
    ...overrides,
  };
}

describe('NavReferenceDetailComponent', () => {
  it('shows the live-resolved target path on load', async () => {
    const nav = makeNavStub();
    const api = makeApiStub();
    await render(NavReferenceDetailComponent, {
      componentInputs: { projectKey: 'proj', reference },
      providers: [
        { provide: NavigationService, useValue: nav },
        { provide: ApiClient, useValue: api },
      ],
    });

    expect(nav.resolveReference).toHaveBeenCalledWith('proj', 'ref-uuid');
    await waitFor(() => expect(screen.getByText('→ /products/')).toBeTruthy());
  });

  it('shows an unresolved state when the resolve endpoint has no target', async () => {
    const nav = makeNavStub({
      resolveReference: vi.fn().mockReturnValue(of({ pageUuid: undefined, path: undefined })),
    });
    const api = makeApiStub();
    await render(NavReferenceDetailComponent, {
      componentInputs: { projectKey: 'proj', reference },
      providers: [
        { provide: NavigationService, useValue: nav },
        { provide: ApiClient, useValue: api },
      ],
    });

    await waitFor(() => expect(screen.getByText(/Could not resolve/)).toBeTruthy());
  });

  it('saves label changes via NavigationService.updateReference with the If-Match etag', async () => {
    const nav = makeNavStub();
    const api = makeApiStub();
    await render(NavReferenceDetailComponent, {
      componentInputs: { projectKey: 'proj', reference },
      providers: [
        { provide: NavigationService, useValue: nav },
        { provide: ApiClient, useValue: api },
      ],
    });

    fireEvent.input(screen.getByPlaceholderText('Optional label'), {
      target: { value: 'Custom label' },
    });

    const saveButton = await waitFor(() => {
      const btn = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
      return btn;
    });
    saveButton.click();

    expect(nav.updateReference).toHaveBeenCalledWith(
      'proj',
      'ref-uuid',
      { targetKind: 'PAGE', targetAssetUuid: 'page-uuid', label: 'Custom label' },
      '"rev-5"',
      // The editing language (M24), `undefined` in a project without languages.
      undefined,
    );
  });

  it('renames the display name via ApiClient.renameAsset with the If-Match revision', async () => {
    const nav = makeNavStub();
    const api = makeApiStub();
    await render(NavReferenceDetailComponent, {
      componentInputs: { projectKey: 'proj', reference },
      providers: [
        { provide: NavigationService, useValue: nav },
        { provide: ApiClient, useValue: api },
      ],
    });

    screen.getByLabelText('Rename reference').click();
    // `findBy*`/`fireEvent` run change detection — the rename field only renders on the pass
    // after the click.
    fireEvent.input(await screen.findByDisplayValue('Products Home'), {
      target: { value: 'New Name' },
    });
    screen.getAllByRole('button', { name: 'Save' })[0].click();

    expect(api.renameAsset).toHaveBeenCalledWith('proj', 'ref-uuid', { displayName: 'New Name' }, 5);
  });

  it('changes the UID via ApiClient.changeUid', async () => {
    const nav = makeNavStub();
    const api = makeApiStub();
    await render(NavReferenceDetailComponent, {
      componentInputs: { projectKey: 'proj', reference },
      providers: [
        { provide: NavigationService, useValue: nav },
        { provide: ApiClient, useValue: api },
      ],
    });

    screen.getByRole('button', { name: 'Change UID' }).click();
    fireEvent.input(await screen.findByDisplayValue('products_home'), {
      target: { value: 'new_uid' },
    });
    screen.getAllByRole('button', { name: 'Save' })[0].click();

    expect(api.changeUid).toHaveBeenCalledWith('proj', 'ref-uuid', { uid: 'new_uid' });
  });

  it('deletes the reference via NavigationService.deleteReference on confirm', async () => {
    const nav = makeNavStub();
    const api = makeApiStub();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await render(NavReferenceDetailComponent, {
      componentInputs: { projectKey: 'proj', reference },
      providers: [
        { provide: NavigationService, useValue: nav },
        { provide: ApiClient, useValue: api },
      ],
    });

    screen.getByText('Delete reference').click();

    expect(nav.deleteReference).toHaveBeenCalledWith('proj', 'ref-uuid');
    confirmSpy.mockRestore();
  });
});
