import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { ApiClient } from '../../../core/api/api.client';
import { DeveloperModeService } from '../../../core/frame/developer-mode.service';
import { SF_DIALOG_DATA, SfDialogRef } from '../../../shared/components/dialog/dialog-ref';
import { type MediaRenameDialogData, MediaRenameDialogComponent } from './media-rename-dialog.component';

async function open(data: Partial<MediaRenameDialogData> = {}, options: { dev?: boolean; changeUid?: ReturnType<typeof vi.fn> } = {}) {
  const ref = new SfDialogRef<string>();
  const close = vi.spyOn(ref, 'close');
  await render(MediaRenameDialogComponent, {
    providers: [
      { provide: DeveloperModeService, useValue: { enabled: signal(options.dev ?? false) } },
      { provide: ApiClient, useValue: { changeUid: options.changeUid ?? vi.fn() } },
      { provide: SF_DIALOG_DATA, useValue: { name: 'latte-art.jpg', folder: 'Products', taken: ['yirgacheffe.jpg'], ...data } },
      { provide: SfDialogRef, useValue: ref },
    ],
  });
  const dialog = await screen.findByRole('dialog', { name: 'Rename “latte-art.jpg”' });
  return {
    close,
    dialog,
    field: within(dialog).getByRole('textbox', { name: /File name/ }),
    apply: within(dialog).getByRole('button', { name: 'Apply' }),
  };
}

describe('MediaRenameDialogComponent (decision 93)', () => {
  it('starts with the current name and Apply disabled', async () => {
    const { field, apply } = await open();

    expect(field).toHaveValue('latte-art.jpg');
    expect(apply).toBeDisabled();
  });

  it('checks the name as you type: required, characters, length, extension, taken', async () => {
    const { dialog, field, apply } = await open();

    fireEvent.input(field, { target: { value: '' } });
    expect(await within(dialog).findByText('Enter a file name.')).toBeInTheDocument();

    fireEvent.input(field, { target: { value: 'a/b.jpg' } });
    expect(await within(dialog).findByText(/can’t contain/)).toBeInTheDocument();

    fireEvent.input(field, { target: { value: `${'a'.repeat(100)}.jpg` } });
    expect(await within(dialog).findByText('Use at most 100 characters.')).toBeInTheDocument();

    fireEvent.input(field, { target: { value: 'latte-art.png' } });
    expect(await within(dialog).findByText('Keep the .jpg extension: the file type stays the same.')).toBeInTheDocument();

    fireEvent.input(field, { target: { value: 'Yirgacheffe.jpg' } });
    expect(await within(dialog).findByText('A file named “Yirgacheffe.jpg” already exists in Products.')).toBeInTheDocument();
    expect(apply).toBeDisabled();
  });

  it('applies a valid new name with the button, and with Enter', async () => {
    const { close, field, apply } = await open();

    fireEvent.input(field, { target: { value: ' espresso.jpg ' } });
    await waitFor(() => expect(apply).toBeEnabled());
    fireEvent.click(apply);
    expect(close).toHaveBeenCalledWith('espresso.jpg');

    close.mockClear();
    fireEvent.submit(field.closest('form')!);
    expect(close).toHaveBeenCalledWith('espresso.jpg');
  });

  it('closes without a name on Cancel', async () => {
    const { close, dialog } = await open();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(close).toHaveBeenCalledWith();
  });

  describe('a folder', () => {
    const folder = { kind: 'folder' as const, name: 'Products', folder: '', taken: ['archive', 'team'] };

    async function openFolder() {
      const ref = new SfDialogRef<string>();
      const close = vi.spyOn(ref, 'close');
      await render(MediaRenameDialogComponent, {
        providers: [
          { provide: DeveloperModeService, useValue: { enabled: signal(false) } },
          { provide: SF_DIALOG_DATA, useValue: folder },
          { provide: SfDialogRef, useValue: ref },
        ],
      });
      const dialog = await screen.findByRole('dialog', { name: 'Rename “Products”' });
      return { close, dialog, field: within(dialog).getByRole('textbox', { name: /Folder name/ }), apply: within(dialog).getByRole('button', { name: 'Apply' }) };
    }

    it('needs a name that is free among the siblings, and has no extension rule', async () => {
      const { close, dialog, field, apply } = await openFolder();

      fireEvent.input(field, { target: { value: ' ' } });
      expect(await within(dialog).findByText('Enter a folder name.')).toBeInTheDocument();
      fireEvent.input(field, { target: { value: 'TEAM' } });
      expect(await within(dialog).findByText('A folder with this name already exists here.')).toBeInTheDocument();
      expect(apply).toBeDisabled();

      fireEvent.input(field, { target: { value: 'Goods.v2' } });
      await waitFor(() => expect(apply).toBeEnabled());
      fireEvent.click(apply);
      expect(close).toHaveBeenCalledWith('Goods.v2');
    });
  });

  describe('the UID (developer mode, decision 107)', () => {
    const uid = (overrides: Partial<NonNullable<MediaRenameDialogData['uid']>> = {}) => ({
      projectKey: 'proj',
      uuid: 'latte-uuid',
      uid: 'latte_art',
      changed: vi.fn(),
      undone: vi.fn(),
      ...overrides,
    });

    it('is not offered outside developer mode', async () => {
      const { dialog } = await open({ uid: uid() });

      expect(within(dialog).queryByText('UID')).toBeNull();
      expect(within(dialog).queryByText('Change UID')).toBeNull();
    });

    it('is offered in developer mode, next to the name field', async () => {
      const { dialog, field } = await open({ uid: uid() }, { dev: true });

      expect(within(dialog).getByRole('heading', { name: 'UID' })).toBeInTheDocument();
      expect(within(dialog).getByText('latte_art')).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Change UID' })).toBeInTheDocument();
      expect(field).toHaveValue('latte-art.jpg');
    });

    it('changes the UID on its own, tells the library, shows the new one, and leaves the dialog and the name alone', async () => {
      const changeUid = vi.fn().mockReturnValue(of({ oldUid: 'latte_art', newUid: 'cover', affectedTemplates: [] }));
      const data = uid();
      const { close, dialog, field, apply } = await open({ uid: data }, { dev: true, changeUid });

      fireEvent.click(within(dialog).getByRole('button', { name: 'Change UID' }));
      fireEvent.input(await within(dialog).findByPlaceholderText(/lowercase letters/), { target: { value: 'cover' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(data.changed).toHaveBeenCalledWith('cover'));
      expect(changeUid).toHaveBeenCalledWith('proj', 'latte-uuid', { uid: 'cover' });
      expect(await within(dialog).findByText('cover')).toBeInTheDocument();
      expect(close).not.toHaveBeenCalled();
      expect(field).toHaveValue('latte-art.jpg');
      expect(apply).toBeDisabled();
    });
  });
});
