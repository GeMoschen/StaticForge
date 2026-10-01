import { TestBed } from '@angular/core/testing';
import { fireEvent, screen, waitFor } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { ConfirmService } from './confirm.service';

describe('ConfirmService', () => {
  function service(): ConfirmService {
    TestBed.configureTestingModule({});
    return TestBed.inject(ConfirmService);
  }

  it('resolves true only from the confirm button, which carries the action verb', async () => {
    const answer = service().confirm({ title: 'Release 3 pages?', message: 'They go live.', confirmLabel: 'Release 3 pages' });
    const dialog = await screen.findByRole('dialog', { name: 'Release 3 pages?' });
    expect(dialog).toHaveAccessibleDescription('They go live.');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Release 3 pages' })));

    fireEvent.click(screen.getByRole('button', { name: 'Release 3 pages' }));
    await expect(answer).resolves.toBe(true);
  });

  it('resolves false from Cancel and from Escape', async () => {
    const confirms = service();
    const first = confirms.confirm({ title: 'Discard?' });
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await expect(first).resolves.toBe(false);

    const second = confirms.confirm({ title: 'Discard?' });
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });
    await expect(second).resolves.toBe(false);
  });

  it('styles a danger action, starts on Cancel, lists the details and says when it cannot be undone', async () => {
    const answer = service().confirm({
      title: 'Delete 2 pages?',
      confirmLabel: 'Delete 2 pages',
      tone: 'danger',
      details: ['Home', 'About'],
      irreversible: true,
    });
    const dialog = await screen.findByRole('dialog');

    expect(screen.getByRole('button', { name: 'Delete 2 pages' })).toHaveClass('sf-button--danger');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })));
    expect(screen.getAllByRole('listitem').map((item) => item.textContent?.trim())).toEqual(['Home', 'About']);
    expect(dialog).toHaveAccessibleDescription(/This cannot be undone\./);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await answer;
  });

  it('leaves "cannot be undone" out by default (the action has an undo)', async () => {
    const answer = service().confirm({ title: 'Move 4 pages?' });
    await screen.findByRole('dialog');

    expect(screen.queryByText('This cannot be undone.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await answer;
  });

  it('requires the typed confirmation before the action is allowed', async () => {
    const answer = service().confirm({
      title: 'Delete folder "news" and 120 pages?',
      confirmLabel: 'Delete 121 items',
      tone: 'danger',
      typeToConfirm: 'news',
    });
    const field = await screen.findByRole('textbox', { name: 'Type news to confirm' });
    const confirm = screen.getByRole('button', { name: 'Delete 121 items' });
    await waitFor(() => expect(document.activeElement).toBe(field));

    expect(confirm).toBeDisabled();
    fireEvent.input(field, { target: { value: 'New' } });
    await waitFor(() => expect(confirm).toBeDisabled());
    fireEvent.input(field, { target: { value: 'news' } });
    await waitFor(() => expect(confirm).toBeEnabled());

    // Enter in the field confirms once it matches.
    fireEvent.submit(field.closest('form')!);
    await expect(answer).resolves.toBe(true);
  });
});
