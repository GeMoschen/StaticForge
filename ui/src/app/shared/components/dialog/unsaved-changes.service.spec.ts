import '@angular/compiler';
import { fireEvent, render, screen, within } from '@testing-library/angular';
import { Component, inject } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { SaveResult, UnsavedChangesService } from './unsaved-changes.service';

@Component({ standalone: true, template: '' })
class HostComponent {
  readonly service = inject(UnsavedChangesService);
}

async function setup(save: () => Promise<SaveResult>, discard?: () => void) {
  const view = await render(HostComponent);
  const promise = view.fixture.componentInstance.service.confirmLeave({ name: 'Spring harvest arrives', save, discard });
  const dialog = await screen.findByRole('dialog');
  return { promise, dialog, view };
}

describe('UnsavedChangesService', () => {
  it('names what has changes and offers Discard, Cancel and Save', async () => {
    const { dialog, promise } = await setup(async () => ({ ok: true }));
    expect(within(dialog).getByText('Unsaved changes')).toBeInTheDocument();
    expect(within(dialog).getByText('“Spring harvest arrives” has changes that are not saved yet.')).toBeInTheDocument();
    for (const name of ['Discard', 'Cancel', 'Save']) {
      expect(within(dialog).getByRole('button', { name })).toBeInTheDocument();
    }
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await promise).toBe(false);
  });

  it('lets the person leave after a save', async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const { dialog, promise } = await setup(save);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await promise).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('lets the person leave after discarding, and runs the discard first', async () => {
    const discard = vi.fn();
    const { dialog, promise } = await setup(async () => ({ ok: true }), discard);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    expect(await promise).toBe(true);
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it('keeps the person on the page when the save is refused: it says why, and Save becomes Try again', async () => {
    const save = vi.fn().mockResolvedValueOnce({ ok: false, message: '2 errors' }).mockResolvedValueOnce({ ok: true });
    const { dialog, promise } = await setup(save);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Not saved — 2 errors. Fix it, or discard the changes.')).toBeInTheDocument();
    const retry = within(dialog).getByRole('button', { name: 'Try again' });
    // Still open: nothing has settled.
    let settled = false;
    void promise.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    fireEvent.click(retry);
    expect(await promise).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('counts Escape as Cancel', async () => {
    const { dialog, promise } = await setup(async () => ({ ok: true }));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(await promise).toBe(false);
  });
});
