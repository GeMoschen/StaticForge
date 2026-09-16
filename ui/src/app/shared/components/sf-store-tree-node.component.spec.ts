import '@angular/compiler';
import { render, screen } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { TimeTravelStore } from '../../features/revisions/time-travel.store';
import { SfStoreTreeNodeComponent, type StoreTreeNode } from './sf-store-tree-node.component';

const NODE: StoreTreeNode = {
  uuid: 'folder-uuid',
  uid: 'branding',
  displayName: 'Branding',
  kind: 'FOLDER',
  children: [
    { uuid: 'set-uuid', uid: 'site', displayName: 'Site', kind: 'LEAF', icon: 'tune' },
    {
      uuid: 'ref-uuid',
      uid: 'about',
      displayName: 'About',
      kind: 'LEAF',
      icon: 'link',
      badge: { text: '→ /about/' },
    },
  ],
};

function setup(node: StoreTreeNode, timeTravel = new TimeTravelStore()) {
  return render(SfStoreTreeNodeComponent, {
    componentInputs: { node, projectKey: 'proj', leafNoun: 'Property set' },
    providers: [
      { provide: ApiClient, useValue: { renameAsset: vi.fn().mockReturnValue(of({})) } },
      { provide: TimeTravelStore, useValue: timeTravel },
    ],
  });
}

describe('SfStoreTreeNodeComponent', () => {
  it('renders a folder with its leaf children', async () => {
    await setup(NODE);

    expect(screen.getByText('Branding')).toBeTruthy();
    expect(screen.getByText('Site')).toBeTruthy();
    expect(screen.getByText('About')).toBeTruthy();
  });

  /** The badge is how a store annotates a leaf — the navigation store puts a resolved path there. */
  it('renders a leaf badge when the store supplies one', async () => {
    await setup(NODE);

    expect(screen.getByText('→ /about/')).toBeTruthy();
  });

  it('emits the selected uuid on click', async () => {
    const { fixture } = await setup(NODE);
    const selected: string[] = [];
    fixture.componentInstance.select.subscribe((uuid: string) => selected.push(uuid));

    screen.getByText('Site').click();

    expect(selected).toEqual(['set-uuid']);
  });

  /**
   * The fixed store root is the one node that can never be renamed, moved or deleted, so it gets
   * no drag handle — the reduced affordance every store used to re-implement for itself.
   */
  it('gives the protected root no drag affordance', async () => {
    await setup({ ...NODE, protectedFolder: true, displayName: 'All Globals' });

    const row = screen.getByText('All Globals').closest('[role="treeitem"]');
    expect(row?.getAttribute('draggable')).toBeNull();
  });

  it('drops the drag affordance for every node during time travel', async () => {
    const timeTravel = new TimeTravelStore();
    timeTravel.enter(5);
    await setup(NODE, timeTravel);

    const row = screen.getByText('Branding').closest('[role="treeitem"]');
    expect(row?.getAttribute('draggable')).toBeNull();
  });
});
