import '@angular/compiler';
import { fireEvent, render, screen } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { TimeTravelStore } from '../../features/revisions/time-travel.store';
import { ContextMenuService } from '../services/context-menu.service';
import { SfStoreTreeNodeComponent, type StoreTreeMenuFn, type StoreTreeNode } from './sf-store-tree-node.component';

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

  /** The display-name endpoint answers `412` without `If-Match`, so a leaf rename must carry its revision. */
  it('renames a leaf with its revision as the concurrency token', async () => {
    const renameAsset = vi.fn().mockReturnValue(of({}));
    const { fixture } = await render(SfStoreTreeNodeComponent, {
      componentInputs: {
        node: { uuid: 'set-uuid', displayName: 'Site', kind: 'LEAF', revision: 42 } satisfies StoreTreeNode,
        projectKey: 'proj',
        leafNoun: 'Property set',
      },
      providers: [{ provide: ApiClient, useValue: { renameAsset } }],
    });

    (fixture.componentInstance as unknown as { submitRenameDisplayName(name: string): void }).submitRenameDisplayName(
      'Site settings',
    );

    expect(renameAsset).toHaveBeenCalledWith('proj', 'set-uuid', { displayName: 'Site settings' }, 42);
  });

  it("hands a folder's revision to the store's folder rename", async () => {
    const renameFolder = vi.fn().mockReturnValue(of({}));
    const { fixture } = await render(SfStoreTreeNodeComponent, {
      componentInputs: {
        node: { uuid: 'folder-uuid', displayName: 'Branding', kind: 'FOLDER', revision: 7 } satisfies StoreTreeNode,
        projectKey: 'proj',
        renameFolder,
      },
      providers: [{ provide: ApiClient, useValue: { renameAsset: vi.fn() } }],
    });

    (fixture.componentInstance as unknown as { submitRenameDisplayName(name: string): void }).submitRenameDisplayName(
      'Brand',
    );

    expect(renameFolder).toHaveBeenCalledWith('proj', 'folder-uuid', 'Brand', 7);
  });

  describe('record set leaves (M25.5.1)', () => {
    const SETS: StoreTreeNode = {
      uuid: 'folder-uuid',
      displayName: 'Team',
      kind: 'FOLDER',
      children: [
        { uuid: 'leads', displayName: 'Leads', kind: 'LEAF', icon: 'table_rows', badge: { text: '3', label: '3 records' } },
        {
          uuid: 'staff',
          displayName: 'Staff',
          kind: 'LEAF',
          icon: 'table_rows',
          badge: { text: '0', label: '0 records' },
          warning: 'The set query is invalid.',
        },
      ],
    };

    function setupSets(menuItems: StoreTreeMenuFn | null, menu: ContextMenuService, timeTravel = new TimeTravelStore()) {
      return render(SfStoreTreeNodeComponent, {
        componentInputs: { node: SETS, projectKey: 'proj', leafNoun: 'Record set', menuItems },
        providers: [
          { provide: ApiClient, useValue: { renameAsset: vi.fn().mockReturnValue(of({})) } },
          { provide: TimeTravelStore, useValue: timeTravel },
          { provide: ContextMenuService, useValue: menu },
        ],
      });
    }

    it('shows the record count with an accessible label', async () => {
      await setupSets(null, new ContextMenuService());

      expect(screen.getByText('3')).toBeTruthy();
      expect(screen.getByText('3 records')).toBeTruthy();
    });

    it('marks only the set with a warning, with its text as tooltip and for screen readers', async () => {
      await setupSets(null, new ContextMenuService());

      const warnings = document.querySelectorAll('.store-node__warning');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].getAttribute('title')).toBe('The set query is invalid.');
      expect(warnings[0].closest('[role="treeitem"]')?.textContent).toContain('Staff');
      expect(screen.getByText('The set query is invalid.')).toBeTruthy();
    });

    it("appends the store's own entries after Rename, per node", async () => {
      const menu = new ContextMenuService();
      const open = vi.spyOn(menu, 'open');
      const menuItems: StoreTreeMenuFn = (node) =>
        node.kind === 'LEAF' ? [{ label: 'Delete…', danger: true }] : [{ label: 'New record set' }];
      await setupSets(menuItems, menu);

      fireEvent.contextMenu(screen.getByText('Leads'));
      fireEvent.contextMenu(screen.getByText('Team'));

      expect(open.mock.calls[0][1].map((item) => item.label)).toEqual(['Rename', 'Delete…']);
      expect(open.mock.calls[1][1].map((item) => item.label)).toEqual(['Rename', 'New record set']);
    });

    it('opens no menu at all during time travel', async () => {
      const menu = new ContextMenuService();
      const open = vi.spyOn(menu, 'open');
      const timeTravel = new TimeTravelStore();
      timeTravel.enter(4);
      await setupSets(() => [{ label: 'Delete…' }], menu, timeTravel);

      fireEvent.contextMenu(screen.getByText('Leads'));

      expect(open).not.toHaveBeenCalled();
    });
  });
});
