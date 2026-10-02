import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { AuthStore } from '../../core/auth/auth.store';
import { LoginComponent } from './login.component';

async function setup(login = vi.fn().mockReturnValue(of({ accessToken: 't' }))) {
  const store = { setSession: vi.fn(), loadUser: vi.fn().mockReturnValue(of({})) };
  await render(LoginComponent, {
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ApiClient, useValue: { login } },
      { provide: AuthStore, useValue: store },
    ],
  });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  return { login, store, navigate };
}

const username = () => screen.getByLabelText('Username');
const password = () => screen.getByLabelText('Password');
const submit = () => screen.getByRole('button', { name: /^Sign in|Signing in/ }) as HTMLButtonElement;

describe('LoginComponent', () => {
  it('has one h1, no implementation text, and a Sign in button that stays disabled until both fields are filled', async () => {
    await setup();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryByText(/memory/i)).toBeNull();
    expect(submit().getAttribute('aria-disabled') ?? String(submit().disabled)).toBe('true');
    await fireEvent.input(username(), { target: { value: 'ada' } });
    expect(submit().getAttribute('aria-disabled') ?? String(submit().disabled)).toBe('true');
    await fireEvent.input(password(), { target: { value: 'secret' } });
    await waitFor(() => expect(submit().getAttribute('aria-disabled')).not.toBe('true'));
    expect(submit().disabled).toBe(false);
  });

  it('signs in with the trimmed username and goes on to the app', async () => {
    const { login, store, navigate } = await setup();
    await fireEvent.input(username(), { target: { value: ' ada ' } });
    await fireEvent.input(password(), { target: { value: 'secret' } });
    await fireEvent.click(submit());
    expect(login).toHaveBeenCalledWith('ada', 'secret');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
    expect(store.setSession).toHaveBeenCalled();
  });

  it('shows a refused sign-in inline and clears it on the next edit', async () => {
    await setup(vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({ status: 401 }))));
    await fireEvent.input(username(), { target: { value: 'ada' } });
    await fireEvent.input(password(), { target: { value: 'wrong' } });
    await fireEvent.click(submit());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The username or password is not right');
    await fireEvent.input(password(), { target: { value: 'wrong2' } });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('says what the server said for an account it will not let in', async () => {
    await setup(vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({ status: 423, error: { detail: 'Account locked.' } }))));
    await fireEvent.input(username(), { target: { value: 'ada' } });
    await fireEvent.input(password(), { target: { value: 'x' } });
    await fireEvent.click(submit());
    expect((await screen.findByRole('alert')).textContent).toContain('Account locked.');
  });

  it('is busy while signing in and ignores a second submit', async () => {
    const pending = new Subject<unknown>();
    const { login } = await setup(vi.fn().mockReturnValue(pending));
    await fireEvent.input(username(), { target: { value: 'ada' } });
    await fireEvent.input(password(), { target: { value: 'secret' } });
    await fireEvent.click(submit());
    await waitFor(() => expect(screen.getByRole('button', { name: /Signing in/ })).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: /Signing in/ }));
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('toggles the password visibility', async () => {
    await setup();
    expect((password() as HTMLInputElement).type).toBe('password');
    await fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect((password() as HTMLInputElement).type).toBe('text');
  });
});
