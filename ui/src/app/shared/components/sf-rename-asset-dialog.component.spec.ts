import { render, screen } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { SfRenameAssetDialogComponent } from './sf-rename-asset-dialog.component';

function apiStub() {
  return {
    changeUid: vi.fn(),
    renameAsset: vi.fn(),
    renameFolder: vi.fn(),
  };
}

describe('SfRenameAssetDialogComponent', () => {
  it('emits renameDisplayName with the trimmed value and makes zero HTTP calls of its own', async () => {
    const renameDisplayName = vi.fn();
    const api = apiStub();
    await render(SfRenameAssetDialogComponent, {
      componentInputs: {
        open: true,
        projectKey: 'proj',
        uuid: 'uuid-1',
        uid: 'my_uid',
        displayName: 'Old name',
      },
      providers: [{ provide: ApiClient, useValue: api }],
      on: { renameDisplayName },
    });

    const nameInput = screen.getByLabelText('Display name') as HTMLInputElement;
    nameInput.value = '  New name  ';
    nameInput.dispatchEvent(new Event('input'));

    screen.getByRole('button', { name: 'Save' }).click();

    expect(renameDisplayName).toHaveBeenCalledTimes(1);
    expect(renameDisplayName).toHaveBeenCalledWith('New name');
    expect(api.renameAsset).not.toHaveBeenCalled();
    expect(api.renameFolder).not.toHaveBeenCalled();
    expect(api.changeUid).not.toHaveBeenCalled();
  });

  it('blocks the emit and shows an inline error when displayName is blank', async () => {
    const renameDisplayName = vi.fn();
    await render(SfRenameAssetDialogComponent, {
      componentInputs: {
        open: true,
        projectKey: 'proj',
        uuid: 'uuid-1',
        uid: 'my_uid',
        displayName: 'Old name',
      },
      providers: [{ provide: ApiClient, useValue: apiStub() }],
      on: { renameDisplayName },
    });

    const nameInput = screen.getByLabelText('Display name') as HTMLInputElement;
    nameInput.value = '   ';
    nameInput.dispatchEvent(new Event('input'));

    screen.getByRole('button', { name: 'Save' }).click();

    expect(renameDisplayName).not.toHaveBeenCalled();
    expect(await screen.findByText('A name is required')).toBeTruthy();
  });

  it('closes on Escape', async () => {
    const closed = vi.fn();
    await render(SfRenameAssetDialogComponent, {
      componentInputs: {
        open: true,
        projectKey: 'proj',
        uuid: 'uuid-1',
        uid: 'my_uid',
        displayName: 'Old name',
      },
      providers: [{ provide: ApiClient, useValue: apiStub() }],
      on: { closed },
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('re-emits uidChanged from the embedded sf-uid-rename after it completes its own successful save', async () => {
    const uidChanged = vi.fn();
    const api = apiStub();
    api.changeUid.mockReturnValue(of({ newUid: 'new_uid', oldUid: 'my_uid', affectedTemplates: [] }));
    await render(SfRenameAssetDialogComponent, {
      componentInputs: {
        open: true,
        projectKey: 'proj',
        uuid: 'uuid-1',
        uid: 'my_uid',
        displayName: 'Old name',
      },
      providers: [{ provide: ApiClient, useValue: api }],
      on: { uidChanged },
    });

    screen.getByRole('button', { name: 'Change UID' }).click();
    const uidInput = (await screen.findByPlaceholderText(
      'lowercase letters, numbers, underscores',
    )) as HTMLInputElement;
    uidInput.value = 'new_uid';
    uidInput.dispatchEvent(new Event('input'));
    // Two "Save" buttons coexist once UID editing starts (displayName's own
    // Save, plus sf-uid-rename's) — the UID one renders after it in the DOM.
    const saveButtons = screen.getAllByRole('button', { name: 'Save' });
    saveButtons[saveButtons.length - 1].click();

    expect(uidChanged).toHaveBeenCalledTimes(1);
    expect(uidChanged).toHaveBeenCalledWith('new_uid');
  });
});
