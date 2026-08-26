import { render, screen, waitFor } from '@testing-library/angular';
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

    const labelInput = screen.getByPlaceholderText('Optional label') as HTMLInputElement;
    labelInput.value = 'Custom label';
    labelInput.dispatchEvent(new Event('input'));

    const saveButton = await waitFor(() => {
      const btn = screen.getByText('Save') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
      return btn;
    });
    saveButton.click();

    expect(nav.updateReference).toHaveBeenCalledWith(
      'proj',
      'ref-uuid',
      { targetKind: 'PAGE', targetAssetUuid: 'page-uuid', label: 'Custom label' },
      '"rev-5"',
    );
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
