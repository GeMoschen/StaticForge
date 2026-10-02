import '@angular/compiler';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import { SfUidRenameComponent } from './sf-uid-rename.component';

/** The UID change, with and without the opt-in Undo (M35.13). */

async function setup(undoable: boolean, changeUid = vi.fn().mockReturnValue(of({ oldUid: 'spring', newUid: 'summer', affectedTemplates: [] }))) {
  const changed: string[] = [];
  const view = await render(SfUidRenameComponent, {
    componentInputs: { projectKey: 'proj', uuid: 'asset-1', uid: 'spring', undoable },
    providers: [{ provide: ApiClient, useValue: { changeUid } }],
  });
  view.fixture.componentInstance.uidChanged.subscribe((uid: string) => changed.push(uid));
  fireEvent.click(screen.getByRole('button', { name: 'Change UID' }));
  fireEvent.input(await screen.findByRole('textbox'), { target: { value: 'summer' } });
  const save = screen.getByRole('button', { name: 'Save' });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() => expect(changeUid).toHaveBeenCalledWith('proj', 'asset-1', { uid: 'summer' }));
  return { changeUid, changed, toasts: view.fixture.debugElement.injector.get(ToastService) };
}

describe('SfUidRenameComponent undo', () => {
  it('keeps the plain "UID changed" toast for a caller that did not opt in', async () => {
    const { toasts } = await setup(false);

    expect(toasts.toasts().at(-1)?.message).toBe('UID changed');
    expect(toasts.toasts().at(-1)?.action).toBeUndefined();
  });

  it('offers Undo instead of the plain toast, which changes the UID back and tells the caller', async () => {
    const changeUid = vi
      .fn()
      .mockReturnValueOnce(of({ oldUid: 'spring', newUid: 'summer', affectedTemplates: [] }))
      .mockReturnValue(of({ oldUid: 'summer', newUid: 'spring', affectedTemplates: [] }));
    const { changed, toasts } = await setup(true, changeUid);
    expect(toasts.toasts().at(-1)?.message).toBe('UID changed from “spring” to “summer”.');
    expect(changed).toEqual(['summer']);

    toasts.toasts().at(-1)!.action!.run();

    await waitFor(() => expect(changeUid).toHaveBeenLastCalledWith('proj', 'asset-1', { uid: 'spring' }));
    await waitFor(() => expect(changed).toEqual(['summer', 'spring']));
  });

  it('shows the error toast when the change back is refused', async () => {
    const changeUid = vi
      .fn()
      .mockReturnValueOnce(of({ oldUid: 'spring', newUid: 'summer', affectedTemplates: [] }))
      .mockReturnValue(throwError(() => new Error('409')));
    const { toasts } = await setup(true, changeUid);

    toasts.toasts().at(-1)!.action!.run();

    await waitFor(() => expect(toasts.toasts().at(-1)?.kind).toBe('error'));
    expect(toasts.toasts().at(-1)?.message).toMatch(/Could not undo/);
  });
});
