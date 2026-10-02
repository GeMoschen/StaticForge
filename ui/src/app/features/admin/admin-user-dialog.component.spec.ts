import { HttpErrorResponse } from '@angular/common/http';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AdminUserDialogComponent } from './admin-user-dialog.component';

type AdminUserDetail = components['schemas']['AdminUserDetail'];

const nina: AdminUserDetail = {
  id: 9,
  username: 'nina',
  displayName: 'Nina Park',
  email: 'nina@example.com',
  status: 'ACTIVE',
  systemRole: 'USER',
  mustChangePassword: true,
  memberships: [],
};

async function setup(mode: 'create' | 'reset', response: AdminUserDetail = nina, options: { failWith?: HttpErrorResponse } = {}) {
  const call = options.failWith ? throwError(() => options.failWith) : of(response);
  const api = {
    adminCreateUser: vi.fn().mockReturnValue(call),
    adminResetPassword: vi.fn().mockReturnValue(call),
    passwordPolicy: vi.fn().mockReturnValue(of({ minLength: 12, requireMixed: false, maxBytes: 72 })),
  };
  const created = vi.fn();
  const resetDone = vi.fn();
  const closed = vi.fn();
  await render(AdminUserDialogComponent, {
    inputs: { mode, user: mode === 'reset' ? nina : null },
    providers: [{ provide: ApiClient, useValue: api }],
    on: { created, resetDone, closed },
  });
  return { api, created, resetDone, closed };
}

const dialog = () => within(screen.getByRole('dialog'));
const type = (label: RegExp, value: string) => fireEvent.input(dialog().getByLabelText(label), { target: { value } });

function fillIdentity(): void {
  type(/^Username/, ' nina ');
  type(/^Display name/, 'Nina Park');
  type(/^Email/, 'nina@example.com');
}

describe('AdminUserDialogComponent', () => {
  it('creates a user with a generated password, shows it once with a copy button, then reports the account', async () => {
    const { api, created, closed } = await setup('create', { ...nina, generatedPassword: 'Xy7!generated-pw' });
    fillIdentity();
    fireEvent.click(dialog().getByRole('button', { name: 'Create user' }));

    await waitFor(() =>
      expect(api.adminCreateUser).toHaveBeenCalledWith({
        username: 'nina',
        email: 'nina@example.com',
        displayName: 'Nina Park',
        systemRole: 'USER',
        mustChangePassword: true,
        generatePassword: true,
      }),
    );
    expect(await dialog().findByText('Xy7!generated-pw')).toBeTruthy();
    expect(dialog().getByText('This is the only time it is shown. Copy it now.')).toBeTruthy();
    expect(dialog().getByRole('button', { name: /Copy/ })).toBeTruthy();
    expect(created).not.toHaveBeenCalled();

    fireEvent.click(dialog().getByRole('button', { name: 'Done' }));
    // The account is reported without the password, and the password is gone.
    expect(created).toHaveBeenCalledWith(expect.not.objectContaining({ generatedPassword: expect.anything() }));
    expect(closed).toHaveBeenCalled();
  });

  it('says what is missing only after the first submit, inline, and sends nothing', async () => {
    const { api } = await setup('create');
    expect(dialog().queryByText('Enter a username.')).toBeNull();
    fireEvent.click(dialog().getByRole('button', { name: 'Create user' }));
    expect(await dialog().findByText('Enter a username.')).toBeTruthy();
    expect(dialog().getByText('Enter a display name.')).toBeTruthy();
    expect(dialog().getByText('Enter a valid email address.')).toBeTruthy();
    expect(api.adminCreateUser).not.toHaveBeenCalled();
  });

  it('asks for a password of the policy length when one is typed, and sends it as typed', async () => {
    const { api } = await setup('create');
    fillIdentity();
    fireEvent.click(dialog().getByRole('radio', { name: /Set a password/ }));
    type(/^New password/, 'short');
    fireEvent.click(dialog().getByRole('button', { name: 'Create user' }));
    expect(await dialog().findByText('Use at least 12 characters.')).toBeTruthy();
    expect(api.adminCreateUser).not.toHaveBeenCalled();
    type(/^New password/, 'a-long-enough-pw');
    fireEvent.click(dialog().getByRole('button', { name: 'Create user' }));
    await waitFor(() => expect(api.adminCreateUser).toHaveBeenCalledWith(expect.objectContaining({ password: 'a-long-enough-pw' })));
  });

  it('puts a refusal of the server under its field', async () => {
    const failWith = new HttpErrorResponse({ status: 409, error: { detail: 'That username is taken.', field: 'username' } });
    const { created } = await setup('create', nina, { failWith });
    fillIdentity();
    fireEvent.click(dialog().getByRole('button', { name: 'Create user' }));
    expect(await dialog().findByText('That username is taken.')).toBeTruthy();
    expect(created).not.toHaveBeenCalled();
  });

  it('resets a password: names the person, generates one-time by default, and shows it once', async () => {
    const { api, resetDone, closed } = await setup('reset', { ...nina, generatedPassword: 'Gen-3rated-pw!' });
    expect(screen.getByRole('dialog', { name: 'Reset the password of Nina Park' })).toBeTruthy();
    expect(dialog().getByText(/Nina Park is signed out everywhere/)).toBeTruthy();
    expect(dialog().queryByLabelText(/^Username/)).toBeNull();
    fireEvent.click(dialog().getByRole('button', { name: 'Reset password' }));
    await waitFor(() => expect(api.adminResetPassword).toHaveBeenCalledWith(9, { generatePassword: true, mustChangePassword: true }));
    expect(await dialog().findByText('Gen-3rated-pw!')).toBeTruthy();
    fireEvent.click(dialog().getByRole('button', { name: 'Done' }));
    expect(resetDone).toHaveBeenCalled();
    expect(closed).toHaveBeenCalled();
  });

  it('closes on Cancel without calling the server', async () => {
    const { api, closed } = await setup('create');
    fireEvent.click(dialog().getByRole('button', { name: 'Cancel' }));
    expect(closed).toHaveBeenCalled();
    expect(api.adminCreateUser).not.toHaveBeenCalled();
  });
});
