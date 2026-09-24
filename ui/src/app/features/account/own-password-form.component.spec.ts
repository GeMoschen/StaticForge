import { HttpErrorResponse } from '@angular/common/http';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { SessionService } from '../../core/auth/session.service';
import { OwnPasswordFormComponent } from './own-password-form.component';

type PasswordPolicyView = components['schemas']['PasswordPolicyView'];
type MeResponse = components['schemas']['MeResponse'];

const policy: PasswordPolicyView = { minLength: 12, requireMixed: true, maxBytes: 72 };
const me: MeResponse = { id: 1, username: 'ada', mustChangePassword: false };

async function setup() {
  const session = { changeOwnPassword: vi.fn().mockReturnValue(of(me)) };
  const changed = vi.fn();
  await render(OwnPasswordFormComponent, {
    providers: [
      { provide: ApiClient, useValue: { passwordPolicy: vi.fn().mockReturnValue(of(policy)) } },
      { provide: SessionService, useValue: session },
    ],
    on: { changed },
  });
  return { session, changed };
}

function fill(current: string, next: string, confirm = next): void {
  fireEvent.input(screen.getByLabelText('Current password'), { target: { value: current } });
  fireEvent.input(screen.getByLabelText('New password'), { target: { value: next } });
  fireEvent.input(screen.getByLabelText('Confirm new password'), { target: { value: confirm } });
}

function submit(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Change password' }) as HTMLButtonElement;
}

describe('OwnPasswordFormComponent', () => {
  it('shows the policy as live checks and submits only a compliant, confirmed password', async () => {
    const { session, changed } = await setup();

    fill('temp-password', 'onlyletters');
    expect(screen.getByText('At least 12 characters').closest('li')?.className).not.toContain('--met');
    expect(submit().disabled).toBe(true);

    fill('temp-password', 'letters-and-1', 'letters-and-2');
    expect(screen.getByText("The passwords don't match.")).toBeTruthy();
    expect(submit().disabled).toBe(true);

    fill('temp-password', 'letters-and-1');
    expect(screen.getByText('At least 12 characters').closest('li')?.className).toContain('--met');
    expect(submit().disabled).toBe(false);
    fireEvent.click(submit());

    expect(session.changeOwnPassword).toHaveBeenCalledWith('temp-password', 'letters-and-1');
    await waitFor(() => expect(changed).toHaveBeenCalled());
  });

  it('puts a wrong current password on that field and lists broken rules', async () => {
    const { session } = await setup();
    session.changeOwnPassword.mockReturnValueOnce(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { detail: 'Current password is incorrect.', field: 'currentPassword' },
          }),
      ),
    );
    fill('wrong', 'letters-and-1');
    fireEvent.click(submit());
    expect(await screen.findByText('Current password is incorrect.')).toBeTruthy();

    session.changeOwnPassword.mockReturnValueOnce(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              detail: 'The password does not meet the password policy.',
              errors: ['Password must be at least 16 characters long.'],
            },
          }),
      ),
    );
    fireEvent.click(submit());
    expect(await screen.findByText('Password must be at least 16 characters long.')).toBeTruthy();
  });
});
