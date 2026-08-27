import { TestBed } from '@angular/core/testing';
import { render, screen } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { ContextMenuService } from '../../shared/services/context-menu.service';
import { NavTreeNodeComponent } from './nav-tree-node.component';
import { NavigationService, type NavTreeView } from './navigation.service';

const tree: NavTreeView = {
  uuid: 'main-uuid',
  type: 'FOLDER',
  uid: 'main',
  displayName: 'Main Menu',
  label: 'Main Menu',
  children: [
    {
      uuid: 'folder-uuid',
      type: 'FOLDER',
      uid: 'products',
      displayName: 'Products',
      label: 'Products',
      children: [
        {
          uuid: 'ref-uuid',
          type: 'PAGE_REFERENCE',
          uid: 'products_home',
          displayName: 'Products Home',
          label: 'Products Home',
          resolvedPageUuid: 'page-uuid',
          resolvedPagePath: '/products/',
          children: [],
        },
      ],
    },
    {
      uuid: 'ref2-uuid',
      type: 'PAGE_REFERENCE',
      uid: 'about',
      displayName: 'About',
      label: 'About',
      children: [],
    },
  ],
};

describe('NavTreeNodeComponent', () => {
  it('renders the full navigation folder structure with folder and PageReference leaves', async () => {
    await render(NavTreeNodeComponent, {
      componentInputs: { node: tree },
    });

    expect(screen.getByText('Main Menu')).toBeTruthy();
    expect(screen.getByText('Products')).toBeTruthy();
    expect(screen.getByText('Products Home')).toBeTruthy();
    expect(screen.getByText('About')).toBeTruthy();
    expect(screen.getByText('→ /products/')).toBeTruthy();
  });

  it('shows "unresolved" for a PageReference with no resolved path', async () => {
    await render(NavTreeNodeComponent, {
      componentInputs: { node: tree },
    });

    expect(screen.getByText('unresolved')).toBeTruthy();
  });

  it('emits select with the clicked node uuid', async () => {
    const onSelect = vi.fn();
    await render(NavTreeNodeComponent, {
      componentInputs: { node: tree },
      on: { select: onSelect },
    });

    screen.getByText('Products').click();

    expect(onSelect).toHaveBeenCalledWith('folder-uuid');
  });

  it('opens a context menu with a single Rename item on any folder node, including the top-level one', async () => {
    const nav = { renameFolder: vi.fn().mockReturnValue(of({})) };
    const api = { renameAsset: vi.fn() };
    await render(NavTreeNodeComponent, {
      componentInputs: { node: tree, projectKey: 'proj' },
      providers: [
        { provide: NavigationService, useValue: nav },
        { provide: ApiClient, useValue: api },
      ],
    });
    const menu = TestBed.inject(ContextMenuService);

    screen.getByText('Main Menu').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

    const state = menu.state();
    expect(state).not.toBeNull();
    expect(state?.items.map((i) => i.label)).toEqual(['Rename']);
  });
});
