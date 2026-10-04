import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { type NavEntry, buildNavIndex } from './navigation-tree.util';
import { NavigationItemActions } from './navigation-item-actions.service';
import { NavigationService } from './navigation.service';

const FOREST = [
  {
    uuid: 'root',
    type: 'FOLDER',
    revision: 9,
    children: [
      { uuid: 'a', uid: 'a', type: 'PAGE_REFERENCE', displayName: 'A', label: 'A', revision: 1, children: [] },
      { uuid: 'b', uid: 'b', type: 'PAGE_REFERENCE', displayName: 'B', label: 'B', revision: 1, children: [] },
      {
        uuid: 'f',
        uid: 'f',
        type: 'FOLDER',
        displayName: 'F',
        revision: 4,
        children: [{ uuid: 'c', uid: 'c', type: 'PAGE_REFERENCE', displayName: 'C', label: 'C', revision: 1, children: [] }],
      },
    ],
  },
] as never;

describe('NavigationItemActions', () => {
  const index = buildNavIndex(FOREST);
  const entry = (uuid: string) => index.entries.get(uuid)!;
  let nav: Record<string, ReturnType<typeof vi.fn>>;
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let confirms: { confirm: ReturnType<typeof vi.fn> };
  let actions: NavigationItemActions;

  beforeEach(() => {
    nav = {
      reorderChildren: vi.fn().mockImplementation((_k: string, _f: string, _c: string[], _e?: string) => of({ revision: 10 })),
      moveReference: vi.fn().mockReturnValue(of({})),
      setVisibleInMenu: vi.fn().mockReturnValue(of({ revision: 20 })),
      moveFolder: vi.fn().mockReturnValue(of({})),
      deleteReference: vi.fn().mockReturnValue(of(undefined)),
    };
    api = {
      deleteFolder: vi.fn().mockReturnValue(of(undefined)),
      restoreFolder: vi.fn().mockReturnValue(of({})),
      assetHistory: vi.fn().mockReturnValue(of([{ revision: 7, deleted: true }, { revision: 3, deleted: false }])),
      restoreAsset: vi.fn().mockReturnValue(of({})),
    };
    confirms = { confirm: vi.fn().mockResolvedValue(true) };
    TestBed.configureTestingModule({
      providers: [
        { provide: NavigationService, useValue: nav },
        { provide: ApiClient, useValue: api },
        { provide: ConfirmService, useValue: confirms },
      ],
    });
    actions = TestBed.inject(NavigationItemActions);
  });

  describe('reorder', () => {
    it('writes the order against the folder\'s revision (the wrapper\'s for the top level)', async () => {
      const result = await actions.reorder('proj', index, null, ['b', 'f', 'a'], ['a', 'b', 'f']);

      expect(result.ok).toBe(true);
      expect(nav['reorderChildren']).toHaveBeenCalledWith('proj', 'root', ['b', 'f', 'a'], '"rev-9"');
    });

    it('writes a folder\'s order to that folder with its own revision', async () => {
      await actions.reorder('proj', index, 'f', ['c'], ['c']);
      expect(nav['reorderChildren']).toHaveBeenCalledWith('proj', 'f', ['c'], '"rev-4"');
    });

    it('chains writes: the next one uses the revision the one before produced; Undo writes the previous list', async () => {
      const first = await actions.reorder('proj', index, null, ['b', 'a', 'f'], ['a', 'b', 'f']);
      await actions.reorder('proj', index, null, ['b', 'f', 'a'], ['b', 'a', 'f']);
      expect(nav['reorderChildren'].mock.calls[1][3]).toBe('"rev-10"');

      await first.undo!();
      expect(nav['reorderChildren']).toHaveBeenLastCalledWith('proj', 'root', ['a', 'b', 'f'], '"rev-10"');
    });

    it('reports a refused write (a stale revision) without an Undo and forgets the revision it knew', async () => {
      nav['reorderChildren'].mockReturnValueOnce(throwError(() => new Error('409')));
      const result = await actions.reorder('proj', index, null, ['b', 'a', 'f'], ['a', 'b', 'f']);
      expect(result).toEqual({ ok: false });

      await actions.reorder('proj', index, null, ['a', 'b', 'f'], ['a', 'b', 'f']);
      expect(nav['reorderChildren'].mock.calls[1][3]).toBe('"rev-9"');
    });
  });

  describe('move', () => {
    it('moves items and folders through their own endpoints and records how to go back', async () => {
      const change = await actions.move('proj', [entry('a'), entry('f')], null, (e: NavEntry) => (e.uuid === 'a' ? 'f' : null));

      expect(change.failed).toBe(false);
      expect(nav['moveReference']).toHaveBeenCalledWith('proj', 'a', undefined);
      expect(nav['moveFolder']).toHaveBeenCalledWith('proj', 'f', undefined);
      await actions.runUndo(change.steps);
      expect(nav['moveFolder']).toHaveBeenLastCalledWith('proj', 'f', undefined);
      expect(nav['moveReference']).toHaveBeenLastCalledWith('proj', 'a', 'f');
    });

    it('stops at the first failure and keeps what was moved undoable', async () => {
      nav['moveFolder'].mockReturnValueOnce(throwError(() => new Error('cycle')));
      const change = await actions.move('proj', [entry('a'), entry('f')], 'f', () => null);
      expect(change.failed).toBe(true);
      expect(change.done.map((e) => e.uuid)).toEqual(['a']);
      expect(change.steps).toHaveLength(1);
    });
  });

  describe('setVisibility', () => {
    it('writes the flag per entry against its own revision and undoes it against the revision each write produced', async () => {
      const change = await actions.setVisibility('proj', [entry('a'), entry('f')], false);

      expect(change.failed).toBe(false);
      expect(change.done.map((e) => e.uuid)).toEqual(['a', 'f']);
      expect(nav['setVisibleInMenu']).toHaveBeenNthCalledWith(1, 'proj', entry('a'), false, '"rev-1"');
      expect(nav['setVisibleInMenu']).toHaveBeenNthCalledWith(2, 'proj', entry('f'), false, '"rev-4"');

      await actions.runUndo(change.steps);
      // Last to first, back to visible, with If-Match of the produced revision.
      expect(nav['setVisibleInMenu']).toHaveBeenNthCalledWith(3, 'proj', entry('f'), true, '"rev-20"');
      expect(nav['setVisibleInMenu']).toHaveBeenNthCalledWith(4, 'proj', entry('a'), true, '"rev-20"');
    });

    it('skips entries that already have the value and the protected wrapper', async () => {
      const hidden = { ...entry('a'), visible: false };
      const wrapper = { ...entry('b'), protectedFolder: true };
      const change = await actions.setVisibility('proj', [hidden, wrapper, entry('f')], false);
      expect(change.done.map((e) => e.uuid)).toEqual(['f']);
      expect(nav['setVisibleInMenu']).toHaveBeenCalledTimes(1);
    });

    it('stops at the first failure and keeps what was changed undoable', async () => {
      nav['setVisibleInMenu'].mockReturnValueOnce(of({ revision: 20 })).mockReturnValueOnce(throwError(() => new Error('409')));
      const change = await actions.setVisibility('proj', [entry('a'), entry('b'), entry('f')], false);
      expect(change.failed).toBe(true);
      expect(change.done.map((e) => e.uuid)).toEqual(['a']);
      expect(change.steps).toHaveLength(1);
      expect(nav['setVisibleInMenu']).toHaveBeenCalledTimes(2);
    });
  });

  describe('delete', () => {
    it('deletes an item and restores it from its last live revision on Undo', async () => {
      const change = await actions.delete('proj', [entry('a')]);
      expect(nav['deleteReference']).toHaveBeenCalledWith('proj', 'a');

      await actions.runUndo(change.steps);
      expect(api['restoreAsset']).toHaveBeenCalledWith('proj', 'a', { fromRevision: 3 });
    });

    it('deletes a folder with everything inside and restores the whole subtree on Undo', async () => {
      const change = await actions.delete('proj', [entry('f')]);
      expect(api['deleteFolder']).toHaveBeenCalledWith('proj', 'f', true);

      await actions.runUndo(change.steps);
      expect(api['restoreFolder']).toHaveBeenCalledWith('proj', 'f');
    });

    it('says so when an Undo fails', async () => {
      api['restoreFolder'].mockReturnValueOnce(throwError(() => new Error('gone')));
      const change = await actions.delete('proj', [entry('f')]);
      await actions.runUndo(change.steps);
      expect(TestBed.inject(ToastService).toasts().at(-1)?.kind).toBe('error');
    });
  });

  describe('confirmDelete', () => {
    it('asks with a danger dialog that says a folder takes its entries with it', async () => {
      await actions.confirmDelete([entry('f')], index);
      const options = confirms.confirm.mock.calls[0][0];
      expect(options.tone).toBe('danger');
      expect(options.message).toContain('menu item');
      expect(options.message).toContain('1');
    });
  });
});
