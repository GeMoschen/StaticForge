import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { ReleaseEventsStore } from '../release/release-events.store';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { HistoryActions } from './history-actions.service';
import { HistoryDrawerStore } from './history-drawer.store';
import { HistoryAssetRef, HistoryRow } from './history-rows';
import { HistoryService } from './history.service';

const asset: HistoryAssetRef = { uuid: 'u-1', uid: 'spring', name: 'Spring harvest arrives', type: 'PAGE', action: 'update', locales: ['de'] };

function row(id: number, over: Partial<HistoryRow> = {}): HistoryRow {
  return { id, at: 0, byId: 1, byName: 'Anna', kind: 'edit', changeType: 'UPDATE', comment: null, assets: [asset], locales: ['DE'], compacted: false, ...over };
}

function setup(answer = true) {
  const confirm = vi.fn().mockResolvedValue(answer);
  const service = {
    restoreAsset: vi.fn().mockReturnValue(of({})),
    rollBack: vi.fn().mockReturnValue(of(row(95))),
    list: vi.fn().mockReturnValue(of({ rows: [row(92, { assets: [{ ...asset, name: 'Footer' }] }), row(90)], total: 2 })),
  };
  TestBed.configureTestingModule({
    providers: [
      provideTranslocoTesting(),
      { provide: HistoryService, useValue: service },
      { provide: ConfirmService, useValue: { confirm } },
      { provide: FrameContextStore, useValue: { projectKey: signal('acme') } },
    ],
  });
  return { confirm, service, actions: TestBed.inject(HistoryActions), toasts: TestBed.inject(ToastService) };
}

beforeEach(() => {
  TestBed.resetTestingModule();
});

describe('HistoryActions', () => {
  it('views a revision: the drawer closes and time travel starts', () => {
    const { actions } = setup();
    TestBed.inject(HistoryDrawerStore).open();
    actions.view(row(88));
    expect(TestBed.inject(HistoryDrawerStore).isOpen()).toBe(false);
    expect(TestBed.inject(TimeTravelStore).activeRevision()).toBe(88);
  });

  describe('restoring an item', () => {
    it('asks first, restores, tells the screens and offers Undo that restores the version it replaced', async () => {
      const { actions, confirm, service, toasts } = setup();
      const events = TestBed.inject(ReleaseEventsStore);
      const before = events.version();

      expect(await actions.restoreAsset(row(88), asset, 90)).toBe(true);
      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Restore “Spring harvest arrives” to revision 88?' }));
      expect(service.restoreAsset).toHaveBeenCalledWith('acme', 'u-1', 88);
      expect(events.version()).toBe(before + 1);

      const toast = toasts.toasts().at(-1)!;
      expect(toast.message).toBe('“Spring harvest arrives” restored to revision 88.');
      expect(toast.action).toBeDefined();
      toast.action!.run();
      await vi.waitFor(() => expect(service.restoreAsset).toHaveBeenLastCalledWith('acme', 'u-1', 90));
    });

    it('does nothing when the confirmation is declined', async () => {
      const { actions, service } = setup(false);
      expect(await actions.restoreAsset(row(88), asset, 90)).toBe(false);
      expect(service.restoreAsset).not.toHaveBeenCalled();
    });

    it('says so when the restore fails, and offers no Undo without a current revision', async () => {
      const { actions, service, toasts } = setup();
      service.restoreAsset.mockReturnValueOnce(throwError(() => new Error('conflict')));
      expect(await actions.restoreAsset(row(88), asset, 90)).toBe(false);
      expect(toasts.toasts().at(-1)?.kind).toBe('error');

      expect(await actions.restoreAsset(row(88), asset)).toBe(true);
      expect(toasts.toasts().at(-1)?.action).toBeUndefined();
    });

    it('refuses an item without an id', async () => {
      const { actions, confirm } = setup();
      expect(await actions.restoreAsset(row(88), { ...asset, uuid: null })).toBe(false);
      expect(confirm).not.toHaveBeenCalled();
    });

    it('adds the compacted notice to the question for a compacted revision', async () => {
      const { actions, confirm } = setup();
      await actions.restoreAsset(row(88, { compacted: true }), asset, 90);
      expect(confirm.mock.calls[0][0].message).toContain('compacted');
    });
  });

  describe('rolling the project back', () => {
    it('is a danger action that needs the project key typed and lists what changes after the revision', async () => {
      const { actions, confirm } = setup();
      await actions.rollBack(row(89));
      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({ tone: 'danger', typeToConfirm: 'acme', confirmLabel: 'Roll back to revision 89', details: ['Footer', 'Spring harvest arrives'] }),
      );
    });

    it('rolls back, ends time travel, and Undo rolls forward to where the project was', async () => {
      const { actions, service, toasts } = setup();
      const timeTravel = TestBed.inject(TimeTravelStore);
      timeTravel.enter(89);

      expect(await actions.rollBack(row(89))).toBe(true);
      expect(service.rollBack).toHaveBeenCalledWith('acme', 89);
      expect(timeTravel.isTimeTravel()).toBe(false);

      const toast = toasts.toasts().at(-1)!;
      expect(toast.message).toBe('Project rolled back to revision 89.');
      toast.action!.run();
      // The head before the roll-back was revision 92.
      await vi.waitFor(() => expect(service.rollBack).toHaveBeenLastCalledWith('acme', 92));
    });

    it('does nothing when declined, and stays in time travel when the server refuses', async () => {
      const declined = setup(false);
      expect(await declined.actions.rollBack(row(89))).toBe(false);
      expect(declined.service.rollBack).not.toHaveBeenCalled();

      TestBed.resetTestingModule();
      const refused = setup();
      refused.service.rollBack.mockReturnValueOnce(throwError(() => new Error('403')));
      const timeTravel = TestBed.inject(TimeTravelStore);
      timeTravel.enter(89);
      expect(await refused.actions.rollBack(row(89))).toBe(false);
      expect(timeTravel.isTimeTravel()).toBe(true);
      expect(refused.toasts.toasts().at(-1)?.kind).toBe('error');
    });
  });
});
