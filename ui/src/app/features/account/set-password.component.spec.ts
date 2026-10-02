import '@angular/compiler';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AuthStore } from '../../core/auth/auth.store';
import { SessionService } from '../../core/auth/session.service';
import { PasswordPolicyStore } from './password-policy.store';
import { SetPasswordComponent } from './set-password.component';

async function setup(changeOwnPassword = vi.fn().mockReturnValue(of({}))) {
  const session = { changeOwnPassword, signOut: vi.fn() };
  await render(SetPasswordComponent, {
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: SessionService, useValue: session },
      { provide: AuthStore, useValue: { displayName: signal('Ada Lovelace'), username: signal('ada') } },
      { provide: PasswordPolicyStore, useValue: { policy: signal({ minLength: 12, requireMixed: true, maxBytes: 72 }), load: vi.fn() } },
    ],
  });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  return { session, navigate };
}

const field = (name: string) => screen.getByLabelText(name);
const submit = () => screen.getByRole('button', { name: /Set password and continue|Setting password/ }) as HTMLButtonElement;
const rule = (text: string) => screen.getByText(text).closest('li')!;

async function fill(temp: string, next: string, confirm = next) {
  await fireEvent.input(field('Temporary password'), { target: { value: temp } });
  await fireEvent.input(field('New password'), { target: { value: next } });
  await fireEvent.input(field('Repeat the new password'), { target: { value: confirm } });
}

describe('SetPasswordComponent', () => {
  it('greets the person, and keeps every rule neutral while nothing is typed', async () => {
    await setup();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Choose a new password');
    expect(screen.getByText(/Hello Ada Lovelace/)).toBeTruthy();
    for (const text of ['At least 12 characters', 'At least one letter', 'At least one digit or symbol', 'Both passwords match']) {
      expect(rule(text).className).toContain('is-idle');
    }
    expect(submit().getAttribute('aria-disabled')).toBe('true');
  });

  it('marks rules met or unmet only after typing, and enables the button only when everything holds', async () => {
    const { session, navigate } = await setup();
    await fill('temp-pass', 'onlyletterslong');
    await waitFor(() => expect(rule('At least one digit or symbol').className).toContain('is-unmet'));
    expect(rule('At least 12 characters').className).toContain('is-met');
    expect(submit().getAttribute('aria-disabled')).toBe('true');

    await fill('temp-pass', 'letters-and-1', 'letters-and-2');
    await waitFor(() => expect(rule('Both passwords match').className).toContain('is-unmet'));

    await fill('temp-pass', 'letters-and-1');
    await waitFor(() => expect(submit().getAttribute('aria-disabled')).not.toBe('true'));
    await fireEvent.click(submit());
    expect(session.changeOwnPassword).toHaveBeenCalledWith('temp-pass', 'letters-and-1');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
  });

  it('says the limit in characters, and only once it is exceeded', async () => {
    await setup();
    await fill('temp-pass', 'a1'.repeat(30));
    expect(screen.queryByText(/the limit is/)).toBeNull();
    await fill('temp-pass', 'a1'.repeat(40));
    expect((await screen.findByText(/That is 80 characters; the limit is 72\./)).textContent).not.toMatch(/byte/i);
    expect(submit().getAttribute('aria-disabled')).toBe('true');
  });

  it('puts a refused temporary password on its field and the broken rules in the banner', async () => {
    const wrong = vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { field: 'currentPassword', detail: 'The current password is not right.' } })));
    await setup(wrong);
    await fill('bad', 'letters-and-1');
    await fireEvent.click(submit());
    expect(await screen.findByText('The current password is not right.')).toBeTruthy();
  });

  it('signs out', async () => {
    const { session } = await setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(session.signOut).toHaveBeenCalled();
  });
});
