import { HttpErrorResponse } from '@angular/common/http';
import { fireEvent, render, screen } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AdminCreateUserDialogComponent } from './admin-create-user-dialog.component';

type AdminUserDetail = components['schemas']['AdminUserDetail'];
type AdminProjectRow = components['schemas']['AdminProjectRow'];

const projects: AdminProjectRow[] = [
  { key: 'acme', name: 'ACME', archived: false, memberCount: 3 },
  { key: 'beta', name: 'Beta', archived: false, memberCount: 1 },
];

const created: AdminUserDetail = {
  id: 9,
  username: 'nina',
  email: 'nina@example.com',
  status: 'ACTIVE',
  systemRole: 'USER',
  mustChangePassword: true,
  memberships: [],
};

async function setup(response: AdminUserDetail = created) {
  const api = {
    adminListProjects: vi.fn().mockReturnValue(of(projects)),
    adminCreateUser: vi.fn().mockReturnValue(of(response)),
    passwordPolicy: vi.fn().mockReturnValue(of({ minLength: 12, requireMixed: false, maxBytes: 72 })),
  };
  const onCreated = vi.fn();
  const onClosed = vi.fn();
  await render(AdminCreateUserDialogComponent, {
    providers: [{ provide: ApiClient, useValue: api }],
    on: { created: onCreated, closed: onClosed },
  });
  return { api, onCreated, onClosed };
}

function type(label: string, value: string): void {
  fireEvent.input(screen.getByLabelText(new RegExp(`^${label}`)), { target: { value } });
}

function createButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Create user' }) as HTMLButtonElement;
}

describe('AdminCreateUserDialogComponent', () => {
  it('creates a user with a generated password and shows it once before reporting the account', async () => {
    const { api, onCreated } = await setup({ ...created, generatedPassword: 'Xy7!generated-pw' });

    expect(createButton().disabled).toBe(true);
    type('Username', ' nina ');
    type('Email', 'nina@example.com');
    fireEvent.click(createButton());

    expect(api.adminCreateUser).toHaveBeenCalledWith({
      username: 'nina',
      email: 'nina@example.com',
      displayName: undefined,
      systemRole: 'USER',
      mustChangePassword: true,
      generatePassword: true,
    });
    expect(await screen.findByLabelText('Generated password')).toHaveTextContent('Xy7!generated-pw');
    expect(screen.getByText(/won't be shown again/)).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onCreated).toHaveBeenCalledWith(created);
    expect(onCreated.mock.calls[0][0]).not.toHaveProperty('generatedPassword');
    expect(screen.queryByText('Xy7!generated-pw')).toBeNull();
  });

  it('creates an instance admin with a typed password and project memberships', async () => {
    const { api, onCreated } = await setup();

    type('Username', 'nina');
    type('Email', 'nina@example.com');
    type('Display name', 'Nina New');
    fireEvent.click(screen.getByLabelText('Instance administrator'));
    fireEvent.click(screen.getByLabelText('Set a password'));
    fireEvent.input(screen.getByLabelText('New password'), { target: { value: 'short' } });
    expect(createButton().disabled).toBe(true);
    fireEvent.input(screen.getByLabelText('New password'), { target: { value: 'long-enough-password' } });
    fireEvent.click(screen.getByLabelText('Must change password at the next sign-in'));

    fireEvent.click(await screen.findByRole('button', { name: 'Add project' }));
    expect(createButton().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Project 1'), { target: { value: 'beta' } });
    fireEvent.change(screen.getByLabelText('Role in project 1'), { target: { value: 'DEVELOPER' } });
    fireEvent.click(createButton());

    expect(api.adminCreateUser).toHaveBeenCalledWith({
      username: 'nina',
      email: 'nina@example.com',
      displayName: 'Nina New',
      systemRole: 'INSTANCE_ADMIN',
      mustChangePassword: false,
      password: 'long-enough-password',
      memberships: [{ projectKey: 'beta', role: 'DEVELOPER' }],
    });
    expect(onCreated).toHaveBeenCalledWith(created);
  });

  it('puts a duplicate username on its field', async () => {
    const { api } = await setup();
    api.adminCreateUser.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({ status: 409, error: { detail: 'Username already taken.', field: 'username' } }),
      ),
    );
    type('Username', 'ed');
    type('Email', 'x@example.com');
    fireEvent.click(createButton());

    expect(await screen.findByText('Username already taken.')).toBeTruthy();
  });

  it('closes without creating anything on cancel', async () => {
    const { api, onClosed } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClosed).toHaveBeenCalled();
    expect(api.adminCreateUser).not.toHaveBeenCalled();
  });
});
