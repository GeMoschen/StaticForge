import { provideFavoritesStub } from '../../core/assets/testing/favorites.testing';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { NavReferenceDetailComponent } from './nav-reference-detail.component';
import { NavigationService, type PageReferenceView } from './navigation.service';
import { stubReleaseBar } from '../release/testing/release-bar.stub';

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
  beforeEach(() => stubReleaseBar(NavReferenceDetailComponent));

  it('shows the live-resolved target path on load', async () => {
    const nav = makeNavStub();
    const api = makeApiStub();
    await render(NavReferenceDetailComponent, {
      componentInputs: { projectKey: 'proj', reference },
      providers: [provideFavoritesStub(), 
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
      providers: [provideFavoritesStub(), 
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
      providers: [provideFavoritesStub(), 
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
      providers: [provideFavoritesStub(), 
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
      providers: [provideFavoritesStub(), 
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

  describe('undo', () => {
    const lastToast = () => TestBed.inject(ToastService).toasts().at(-1)!;

    async function setup(options: { confirmed?: boolean; api?: Partial<Record<keyof ApiClient, unknown>> } = {}) {
      const nav = makeNavStub();
      const api = makeApiStub({ restoreAsset: vi.fn().mockReturnValue(of({})), ...options.api });
      const confirms = { confirm: vi.fn().mockResolvedValue(options.confirmed ?? true) };
      const view = await render(NavReferenceDetailComponent, {
        componentInputs: { projectKey: 'proj', reference },
        providers: [provideFavoritesStub(), 
          { provide: NavigationService, useValue: nav },
          { provide: ApiClient, useValue: api },
          { provide: ConfirmService, useValue: confirms },
        ],
      });
      return { nav, api, confirms, view };
    }

    it('asks with a danger confirmation, deletes, and offers Undo that restores the last live revision', async () => {
      const { nav, api, confirms } = await setup();

      screen.getByText('Delete reference').click();

      await waitFor(() => expect(nav.deleteReference).toHaveBeenCalledWith('proj', 'ref-uuid'));
      const options = confirms.confirm.mock.calls[0][0];
      expect(options.tone).toBe('danger');
      expect(options.irreversible).toBeUndefined();
      expect(options.typeToConfirm).toBeUndefined();
      expect(lastToast().message).toBe('Deleted “Products Home”.');
      expect(lastToast().action).toBeDefined();
      expect(api['restoreAsset']).not.toHaveBeenCalled();

      lastToast().action!.run();
      await waitFor(() => expect(api['restoreAsset']).toHaveBeenCalledWith('proj', 'ref-uuid', { fromRevision: 5 }));
    });

    it('does not delete when the confirmation is declined', async () => {
      const { nav } = await setup({ confirmed: false });

      screen.getByText('Delete reference').click();

      await waitFor(() => expect(TestBed.inject(ConfirmService).confirm).toHaveBeenCalled());
      expect(nav.deleteReference).not.toHaveBeenCalled();
    });

    it('shows the error toast when the restore fails', async () => {
      await setup({ api: { restoreAsset: vi.fn().mockReturnValue(throwError(() => new Error('409'))) } });

      screen.getByText('Delete reference').click();
      await waitFor(() => expect(lastToast().action).toBeDefined());
      lastToast().action!.run();

      await waitFor(() => expect(lastToast().kind).toBe('error'));
      expect(lastToast().message).toMatch(/Could not undo/);
    });

    it('offers Undo for a rename that renames back with the revision the rename produced', async () => {
      const renameAsset = vi.fn().mockReturnValue(of({ revision: 6 }));
      const { api, view } = await setup({ api: { renameAsset } });
      const component = view.fixture.componentInstance as unknown as {
        nameDraft: { set: (v: string) => void };
        saveName: () => void;
      };

      component.nameDraft.set('Shop');
      component.saveName();

      expect(renameAsset).toHaveBeenCalledWith('proj', 'ref-uuid', { displayName: 'Shop' }, 5);
      expect(lastToast().message).toBe('Renamed “Products Home” to “Shop”.');
      lastToast().action!.run();
      await waitFor(() =>
        expect(api['renameAsset']).toHaveBeenLastCalledWith('proj', 'ref-uuid', { displayName: 'Products Home' }, 6),
      );
    });
  });
});
