import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { SF_DIALOG_DATA, SfDialogRef } from '../../../shared/components/dialog/dialog-ref';
import { MEDIA_TREE } from './media-library.testing';
import { type MediaMoveDialogData, MediaMoveDialogComponent } from './media-move-dialog.component';

async function open(data: Partial<MediaMoveDialogData> = {}) {
  const ref = new SfDialogRef<{ target: string | null }>();
  const close = vi.spyOn(ref, 'close');
  await render(MediaMoveDialogComponent, {
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SF_DIALOG_DATA, useValue: { title: 'Move 2 files', tree: MEDIA_TREE, current: 'products-uuid', excluded: [], ...data } },
      { provide: SfDialogRef, useValue: ref },
    ],
  });
  const dialog = await screen.findByRole('dialog', { name: 'Move 2 files' });
  return { close, dialog, move: within(dialog).getByRole('button', { name: 'Move' }) };
}

const item = (dialog: HTMLElement, name: RegExp) => within(dialog).findByRole('treeitem', { name });

describe('MediaMoveDialogComponent (decision 94)', () => {
  it('lists All media first and then the folders; Move is disabled until a target is chosen', async () => {
    const { dialog, move } = await open();

    expect(await item(dialog, /^All media/)).toBeInTheDocument();
    expect(await item(dialog, /^Archive/)).toBeInTheDocument();
    expect(move).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows the current folder as such and cannot choose it', async () => {
    const { dialog, move, close } = await open();

    const current = await item(dialog, /^Products/);
    expect(current).toHaveTextContent('Current folder');
    fireEvent.click(current);
    expect(move).toHaveAttribute('aria-disabled', 'true');
    expect(close).not.toHaveBeenCalled();
  });

  it('closes with the chosen folder', async () => {
    const { dialog, move, close } = await open();

    fireEvent.click(await item(dialog, /^Archive/));
    await waitFor(() => expect(move).not.toHaveAttribute('aria-disabled'));
    fireEvent.click(move);

    expect(close).toHaveBeenCalledWith({ target: 'archive-uuid' });
  });

  it('closes with the top level (null) when All media is chosen', async () => {
    const { dialog, move, close } = await open();

    fireEvent.click(await item(dialog, /^All media/));
    await waitFor(() => expect(move).not.toHaveAttribute('aria-disabled'));
    fireEvent.click(move);

    expect(close).toHaveBeenCalledWith({ target: null });
  });

  it('shows the top level as current for something that lives there', async () => {
    const { dialog } = await open({ current: null });

    expect(await item(dialog, /^All media/)).toHaveTextContent('Current folder');
  });

  it('blocks a moved folder and what lies inside it', async () => {
    const { dialog, move } = await open({ title: 'Move 2 files', current: 'team-uuid', excluded: ['products-uuid'] });

    const blocked = await item(dialog, /^Products/);
    expect(blocked).toHaveTextContent('Inside the folder being moved');
    fireEvent.click(blocked);
    expect(move).toHaveAttribute('aria-disabled', 'true');
    // Its sub-folder is blocked too (it is lazily opened with the arrow key).
    fireEvent.keyDown(blocked, { key: 'ArrowRight' });
    expect(await item(dialog, /^Roastery/)).toHaveTextContent('Inside the folder being moved');
  });

  it('closes without a target on Cancel', async () => {
    const { dialog, close } = await open();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(close).toHaveBeenCalledWith();
  });
});
