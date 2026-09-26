import { render, screen, waitFor } from '@testing-library/angular';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
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
});
