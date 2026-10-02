import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { ContentService, type RecordDetailView } from './content.service';
import { RecordActionsService } from './record-actions.service';
import { RecordAutosaveService } from './record-autosave.service';

/** The undo of the record editor's delete and move (M35.13). */

const RECORD = {
  uuid: 'rec-1',
  uid: 'rec_1',
  displayName: 'Ada Lovelace',
  datasetUuid: 'ds-team',
  recordSet: { uuid: 'set-leads', displayName: 'Leads' },
  revision: 3,
} as unknown as RecordDetailView;

describe('record actions undo', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let content: Record<string, ReturnType<typeof vi.fn>>;
  let confirms: { confirm: ReturnType<typeof vi.fn> };
  let reload: ReturnType<typeof vi.fn>;
  let toasts: ToastService;
  let actions: RecordActionsService;
  const lastToast = () => toasts.toasts().at(-1)!;

  function bind(usages: unknown[] = []) {
    reload = vi.fn();
    actions.bind({
      projectKey: signal('proj'),
      record: signal(RECORD),
      readOnly: signal(false),
      history: signal([]),
      usages: signal(usages as never),
      reload,
    });
  }

  beforeEach(() => {
    api = {
      deleteAsset: vi.fn().mockReturnValue(of(undefined)),
      assetHistory: vi.fn().mockReturnValue(of([{ revision: 8, deleted: true }, { revision: 5, deleted: false }])),
      restoreAsset: vi.fn().mockReturnValue(of({})),
    };
    content = {
      moveAsset: vi.fn().mockReturnValue(of({})),
      listRecordSets: vi.fn().mockReturnValue(of([])),
    };
    confirms = { confirm: vi.fn().mockResolvedValue(true) };
    TestBed.configureTestingModule({
      providers: [
        RecordActionsService,
        { provide: ApiClient, useValue: api },
        { provide: ContentService, useValue: content },
        { provide: ConfirmService, useValue: confirms },
        { provide: TimeTravelStore, useValue: { isTimeTravel: () => false } },
        { provide: RecordAutosaveService, useValue: { flush: vi.fn() } },
      ],
    });
    toasts = TestBed.inject(ToastService);
    actions = TestBed.inject(RecordActionsService);
  });

  it('confirms with a danger dialog, deletes, and Undo restores from the last live revision and reloads the record', async () => {
    bind();

    await actions.remove();

    const options = confirms.confirm.mock.calls[0][0];
    expect(options.tone).toBe('danger');
    expect(options.irreversible).toBeUndefined();
    expect(api['deleteAsset']).toHaveBeenCalledWith('proj', 'rec-1', false);
    expect(lastToast().message).toBe('Deleted “Ada Lovelace”.');

    reload.mockClear();
    lastToast().action!.run();
    await vi.waitFor(() => expect(api['restoreAsset']).toHaveBeenCalledWith('proj', 'rec-1', { fromRevision: 5 }));
    await vi.waitFor(() => expect(reload).toHaveBeenCalledWith('rec-1'));
  });

  it('names the pages that use the record, and deletes with force', async () => {
    bind([{}, {}]);

    await actions.remove();

    expect(confirms.confirm.mock.calls[0][0].message).toContain('used by 2 page(s) or template(s)');
    expect(api['deleteAsset']).toHaveBeenCalledWith('proj', 'rec-1', true);
  });

  it('does nothing when the confirmation is declined', async () => {
    bind();
    confirms.confirm.mockResolvedValue(false);

    await actions.remove();

    expect(api['deleteAsset']).not.toHaveBeenCalled();
  });

  it('shows the error toast when the restore fails', async () => {
    bind();
    api['restoreAsset'].mockReturnValue(throwError(() => new Error('409')));
    await actions.remove();

    lastToast().action!.run();

    await vi.waitFor(() => expect(lastToast().kind).toBe('error'));
    expect(lastToast().message).toMatch(/Could not undo/);
  });

  it('a move offers Undo, which moves the record back into the set it came from', async () => {
    bind();
    actions.moveTargets.set([{ uuid: 'set-all', label: 'Everyone', depth: 0, current: false }]);

    actions.moveTo('set-all');

    expect(content['moveAsset']).toHaveBeenCalledWith('proj', 'rec-1', 'set-all');
    expect(lastToast().message).toBe('Moved “Ada Lovelace” to Everyone.');

    lastToast().action!.run();
    await vi.waitFor(() => expect(content['moveAsset']).toHaveBeenLastCalledWith('proj', 'rec-1', 'set-leads'));
  });

  it('shows the error toast when the move back fails', async () => {
    bind();
    actions.moveTo('set-all');
    content['moveAsset'].mockReturnValue(throwError(() => new Error('422')));

    lastToast().action!.run();

    await vi.waitFor(() => expect(lastToast().kind).toBe('error'));
  });
});
