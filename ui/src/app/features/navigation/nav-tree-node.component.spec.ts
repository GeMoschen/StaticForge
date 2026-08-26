import { render, screen } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { NavTreeNodeComponent } from './nav-tree-node.component';
import type { NavTreeView } from './navigation.service';

const tree: NavTreeView = {
  uuid: 'root-uuid',
  type: 'FOLDER',
  uid: 'root',
  displayName: 'Navigation',
  label: 'Navigation',
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
      componentInputs: { node: tree, isRoot: true },
    });

    expect(screen.getByText('Navigation')).toBeTruthy();
    expect(screen.getByText('Products')).toBeTruthy();
    expect(screen.getByText('Products Home')).toBeTruthy();
    expect(screen.getByText('About')).toBeTruthy();
    expect(screen.getByText('→ /products/')).toBeTruthy();
  });

  it('shows "unresolved" for a PageReference with no resolved path', async () => {
    await render(NavTreeNodeComponent, {
      componentInputs: { node: tree, isRoot: true },
    });

    expect(screen.getByText('unresolved')).toBeTruthy();
  });

  it('emits select with the clicked node uuid', async () => {
    const onSelect = vi.fn();
    await render(NavTreeNodeComponent, {
      componentInputs: { node: tree, isRoot: true },
      on: { select: onSelect },
    });

    screen.getByText('Products').click();

    expect(onSelect).toHaveBeenCalledWith('folder-uuid');
  });
});
