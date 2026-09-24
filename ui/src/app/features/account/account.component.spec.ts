import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AuthStore } from '../../core/auth/auth.store';
import { SessionService } from '../../core/auth/session.service';
import { AccountComponent } from './account.component';

type MeResponse = components['schemas']['MeResponse'];
type PasswordPolicyView = components['schemas']['PasswordPolicyView'];

const me: MeResponse = {
  id: 7,
  username: 'ada',
  displayName: 'Ada Lovelace',
  email: 'ada@example.com',
  systemRole: 'USER',
  mustChangePassword: false,
  projectRoles: { acme: 'EDITOR' },
  memberships: [{ projectKey: 'acme', projectName: 'ACME Website', role: 'EDITOR' }],
};

const policy: PasswordPolicyView = { minLength: 12, requireMixed: false, maxBytes: 72 };

async function setup() {
  const api = {
    updateMe: vi.fn().mockReturnValue(of({ ...me, displayName: 'Ada King' })),
    passwordPolicy: vi.fn().mockReturnValue(of(policy)),
  };
  const session = {
    reloadUser: vi.fn().mockReturnValue(of(me)),
    signOutEverywhere: vi.fn().mockReturnValue(of(undefined)),
    changeOwnPassword: vi.fn(),
  };
  const view = await render(AccountComponent, {
    providers: [
      provideRouter([]),
      { provide: ApiClient, useValue: api },
      { provide: SessionService, useValue: session },
    ],
    configureTestBed: (tb) => tb.inject(AuthStore).setUser(me),
  });
  return { api, session, view };
}

/** The Profile section: the Password section below it has a "Current password" of its own. */
function profile() {
  return within(screen.getByRole('region', { name: 'Profile' }));
}

function field(label: string): HTMLInputElement {
  return profile().getByLabelText(new RegExp(`^${label}`)) as HTMLInputElement;
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Save profile' }) as HTMLButtonElement;
}

describe('AccountComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fills the profile and keeps Save disabled until something changes', async () => {
    await setup();

    expect(field('Display name').value).toBe('Ada Lovelace');
    expect(field('Username').value).toBe('ada');
    expect(field('Email').value).toBe('ada@example.com');
    expect(saveButton().disabled).toBe(true);
  });

  it('saves a display name without asking for the current password', async () => {
    const { api } = await setup();

    fireEvent.input(field('Display name'), { target: { value: 'Ada King' } });

    expect(profile().queryByLabelText(/^Current password/)).toBeNull();
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());

    expect(api.updateMe).toHaveBeenCalledWith({ displayName: 'Ada King', username: 'ada', email: 'ada@example.com' });
    await waitFor(() => expect(saveButton().disabled).toBe(true));
  });

  it('asks for the current password once the username or email changes', async () => {
    const { api } = await setup();

    fireEvent.input(field('Username'), { target: { value: 'ada.king' } });

    const current = await profile().findByLabelText(/^Current password/);
    expect(saveButton().disabled).toBe(true);
    fireEvent.input(current, { target: { value: 'old-secret' } });
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());

    expect(api.updateMe).toHaveBeenCalledWith({
      displayName: 'Ada Lovelace',
      username: 'ada.king',
      email: 'ada@example.com',
      currentPassword: 'old-secret',
    });

    // Changing it back hides the field again.
    fireEvent.input(field('Username'), { target: { value: 'ada' } });
    await waitFor(() => expect(profile().queryByLabelText(/^Current password/)).toBeNull());
  });

  it('shows a duplicate on the field the server names', async () => {
    const { api } = await setup();
    api.updateMe.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { code: 'SF-API-0409', detail: 'Email already in use.', field: 'email' },
          }),
      ),
    );

    fireEvent.input(field('Email'), { target: { value: 'grace@example.com' } });
    fireEvent.input(await profile().findByLabelText(/^Current password/), { target: { value: 'pw' } });
    fireEvent.click(saveButton());

    const message = await screen.findByText('Email already in use.');
    expect(message.previousElementSibling?.textContent).toContain('Email');
  });

  it('lists the projects with their role', async () => {
    await setup();

    const link = screen.getByRole('link', { name: 'ACME Website' });
    expect(link.getAttribute('href')).toBe('/p/acme/pages');
    expect(screen.getByText('Editor')).toBeTruthy();
  });

  it('signs out everywhere only after confirming', async () => {
    const { session } = await setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    expect(session.signOutEverywhere).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    expect(session.signOutEverywhere).toHaveBeenCalledTimes(1);
  });
});
