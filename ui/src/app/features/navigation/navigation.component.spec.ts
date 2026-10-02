import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import { NavigationComponent } from './navigation.component';
import { NavigationService, type NavTreeView } from './navigation.service';
import { stubReleaseBar } from '../release/testing/release-bar.stub';
import { NavFolderDetailComponent } from './nav-folder-detail.component';
import { NavReferenceDetailComponent } from './nav-reference-detail.component';

// The tree endpoint always returns exactly one top-level entry — the fixed, protected
// "All Navigation" wrapper root — which the component unwraps for display (`topLevelNodes`),
// so "Main Menu" below is the first folder the page actually shows.
const tree: NavTreeView[] = [
  {
    uuid: 'nav-root-uuid',
    type: 'FOLDER',
    uid: 'navigation_root',
    displayName: 'All Navigation',
    children: [
      {
        uuid: 'main-uuid',
        type: 'FOLDER',
        uid: 'main',
        displayName: 'Main Menu',
        children: [
          {
            uuid: 'ref-uuid',
            type: 'PAGE_REFERENCE',
            uid: 'about',
            displayName: 'About',
            resolvedPageUuid: 'page-uuid',
            resolvedPagePath: '/about/',
            children: [],
          },
        ],
      },
    ],
  },
];

describe('NavigationComponent', () => {
  beforeEach(() => {
    stubReleaseBar(NavFolderDetailComponent);
    stubReleaseBar(NavReferenceDetailComponent);
  });

  it('renders the full navigation folder structure from GET .../navigation/tree', async () => {
    const nav = { tree: vi.fn().mockReturnValue(of(tree)) };
    const api = {};
    await render(NavigationComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: NavigationService, useValue: nav },
        { provide: ApiClient, useValue: api },
      ],
    });

    expect(nav.tree).toHaveBeenCalledWith('proj');
    await waitFor(() => expect(screen.getByText('Main Menu')).toBeTruthy());
    screen.getByLabelText('Toggle folder').click();
    expect(await screen.findByText('About')).toBeTruthy();
  });

  it('opens the reference detail drawer for a selected PageReference node', async () => {
    const nav = { tree: vi.fn().mockReturnValue(of(tree)), resolveReference: vi.fn().mockReturnValue(of({})) };
    const api = {
      assetDetail: vi.fn().mockReturnValue(
        of({
          uuid: 'ref-uuid',
          uid: 'about',
          type: 'PAGE_REFERENCE',
          displayName: 'About',
          revision: 1,
          folderPath: '/nav/',
          payload: { target: { kind: 'PAGE', assetUuid: 'page-uuid' }, label: null },
        }),
      ),
      listFolders: vi.fn().mockReturnValue(of([])),
    };
    await render(NavigationComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: NavigationService, useValue: nav },
        { provide: ApiClient, useValue: api },
      ],
    });

    await waitFor(() => screen.getByLabelText('Toggle folder').click());
    await waitFor(() => screen.getByText('About').click());

    await waitFor(() => expect(api.assetDetail).toHaveBeenCalledWith('proj', 'ref-uuid'));
    await waitFor(() => expect(screen.getByText('Delete reference')).toBeTruthy());
  });
  it('selects the "All Navigation" root so its entry page can be set (M31)', async () => {
    const nav = { tree: vi.fn().mockReturnValue(of(tree)) };
    // GET /assets/{uuid} for the wrapper root, as AssetController#detail sends it.
    const api = {
      assetDetail: vi.fn().mockReturnValue(
        of({
          uuid: 'nav-root-uuid',
          uid: 'navigation_root',
          type: 'FOLDER',
          displayName: 'All Navigation',
          revision: 3,
          folderPath: '/navigation_root/',
          payload: { scope: 'NAVIGATION', protected: true },
        }),
      ),
    };
    await render(NavigationComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: NavigationService, useValue: nav },
        { provide: ApiClient, useValue: api },
      ],
    });
    await screen.findByText('Main Menu');

    fireEvent.click(screen.getByRole('button', { name: /All navigation/ }));

    await waitFor(() => expect(api.assetDetail).toHaveBeenCalledWith('proj', 'nav-root-uuid'));
    expect(await screen.findByText('Entry page (startNode)')).toBeTruthy();
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.textContent?.trim())).toContain('Main Menu');
    expect(screen.queryByRole('button', { name: 'Delete folder' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename folder' })).toBeNull();
  });
});

describe('NavigationComponent (undo of a move)', () => {
  // Two folders under the root; the reference sits in "Footer".
  const moveTree: NavTreeView[] = [
    {
      uuid: 'nav-root-uuid',
      type: 'FOLDER',
      displayName: 'All Navigation',
      children: [
        {
          uuid: 'footer-uuid',
          type: 'FOLDER',
          displayName: 'Footer',
          children: [{ uuid: 'ref-uuid', type: 'PAGE_REFERENCE', displayName: 'About', children: [] }],
        },
        { uuid: 'header-uuid', type: 'FOLDER', displayName: 'Header', children: [] },
      ],
    },
  ];
  const lastToast = () => TestBed.inject(ToastService).toasts().at(-1)!;

  async function setup(nav: Record<string, unknown> = {}) {
    stubReleaseBar(NavFolderDetailComponent);
    stubReleaseBar(NavReferenceDetailComponent);
    const service = {
      tree: vi.fn().mockReturnValue(of(moveTree)),
      moveFolder: vi.fn().mockReturnValue(of({})),
      moveReference: vi.fn().mockReturnValue(of({})),
      ...nav,
    };
    const view = await render(NavigationComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: NavigationService, useValue: service },
        { provide: ApiClient, useValue: {} },
      ],
    });
    await screen.findByText('Footer');
    const component = view.fixture.componentInstance as unknown as {
      onMove: (event: { source: string; target: string }) => void;
    };
    return { service, component };
  }

  it('offers Undo for moving a reference, which moves it back into its old folder', async () => {
    const { service, component } = await setup();

    component.onMove({ source: 'ref-uuid', target: 'header-uuid' });

    expect(service.moveReference).toHaveBeenCalledWith('proj', 'ref-uuid', 'header-uuid');
    expect(lastToast().message).toBe('Moved “About” to Header.');
    lastToast().action!.run();
    await waitFor(() => expect(service.moveReference).toHaveBeenLastCalledWith('proj', 'ref-uuid', 'footer-uuid'));
  });

  it('moves a top-level folder back to the root (no folder) on Undo', async () => {
    const { service, component } = await setup();

    component.onMove({ source: 'footer-uuid', target: 'header-uuid' });

    expect(service.moveFolder).toHaveBeenCalledWith('proj', 'footer-uuid', 'header-uuid');
    lastToast().action!.run();
    await waitFor(() => expect(service.moveFolder).toHaveBeenLastCalledWith('proj', 'footer-uuid', undefined));
  });

  it('shows the error toast when moving back fails', async () => {
    const { component } = await setup({ moveReference: vi.fn().mockReturnValueOnce(of({})).mockReturnValue(throwError(() => new Error('409'))) });

    component.onMove({ source: 'ref-uuid', target: 'header-uuid' });
    lastToast().action!.run();

    await waitFor(() => expect(lastToast().kind).toBe('error'));
    expect(lastToast().message).toMatch(/Could not undo/);
  });
});
