import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { AuthStore } from '../../core/auth/auth.store';
import { SessionService } from '../../core/auth/session.service';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { parseFrameLocation } from '../../core/frame/frame-location';
import { ToastService } from '../../core/ui/toast.service';
import { AccountDraftStore } from './account-draft.store';
import { PasswordPolicyStore } from './password-policy.store';

function setup() {
  const auth = { displayName: signal('Ada'), username: signal('ada'), email: signal('ada@example.com'), setUser: vi.fn() };
  const api = { updateMe: vi.fn().mockReturnValue(of({ id: 1, username: 'ada' })) };
  const session = { reloadUser: vi.fn().mockReturnValue(of({})), changeOwnPassword: vi.fn().mockReturnValue(of({})) };
  const url = signal('/account/profile');
  TestBed.configureTestingModule({
    providers: [
      AccountDraftStore,
      { provide: AuthStore, useValue: auth },
      { provide: ApiClient, useValue: api },
      { provide: SessionService, useValue: session },
      { provide: FrameContextStore, useValue: { location: computed(() => parseFrameLocation(url())) } },
      { provide: PasswordPolicyStore, useValue: { policy: signal({ minLength: 12, requireMixed: false, maxBytes: 72 }), load: vi.fn() } },
    ],
  });
  return { store: TestBed.inject(AccountDraftStore), auth, api, session, url, toasts: TestBed.inject(ToastService) };
}

describe('AccountDraftStore › profile', () => {
  it('starts clean, is dirty once a field differs and clean again after discard', () => {
    const { store } = setup();
    expect(store.profileDirty()).toBe(false);
    store.displayName.set('Ada L.');
    expect(store.profileDirty()).toBe(true);
    expect(store.dirtyOf('profile')).toBe(true);
    store.discardSection('profile');
    expect(store.displayName()).toBe('Ada');
    expect(store.profileDirty()).toBe(false);
  });

  it('asks for the current password only when the username or email changes', () => {
    const { store } = setup();
    store.displayName.set('Ada L.');
    expect(store.needsCurrentPassword()).toBe(false);
    store.email.set('ada@new.example.com');
    expect(store.needsCurrentPassword()).toBe(true);
  });

  it('refuses a save with the fields named, without calling the server', async () => {
    const { store, api } = setup();
    store.displayName.set('');
    store.email.set('nope');
    const result = await store.saveSection('profile');
    expect(result).toMatchObject({ ok: false });
    expect(store.profileErrors()).toMatchObject({ displayName: expect.any(String), email: expect.any(String), currentPassword: expect.any(String) });
    expect(store.errorCountOf('profile')).toBe(3);
    expect(api.updateMe).not.toHaveBeenCalled();
  });

  it('saves a display name change alone, and sends the current password only with a username or email change', async () => {
    const { store, api, auth, toasts } = setup();
    store.displayName.set('Ada L.');
    expect(await store.saveSection('profile')).toEqual({ ok: true });
    expect(api.updateMe).toHaveBeenLastCalledWith({ displayName: 'Ada L.', username: 'ada', email: 'ada@example.com' });
    expect(auth.setUser).toHaveBeenCalled();
    expect(toasts.toasts().at(-1)?.message).toBe('Profile saved.');

    store.email.set('ada@new.example.com');
    store.currentPassword.set('secret');
    await store.saveSection('profile');
    expect(api.updateMe).toHaveBeenLastCalledWith({ displayName: 'Ada', username: 'ada', email: 'ada@new.example.com', currentPassword: 'secret' });
  });

  it('puts a server refusal on its field', async () => {
    const { store, api } = setup();
    api.updateMe.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { field: 'username', detail: 'That username is taken.' } })));
    store.username.set('grace');
    store.currentPassword.set('secret');
    const result = await store.saveSection('profile');
    expect(result).toEqual({ ok: false, message: 'That username is taken.' });
    expect(store.profileErrors().username).toBe('That username is taken.');
  });
});

describe('AccountDraftStore › password', () => {
  it('is dirty as soon as anything is typed', () => {
    const { store } = setup();
    expect(store.passwordDirty()).toBe(false);
    store.next.set('x');
    expect(store.dirtyOf('password')).toBe(true);
  });

  it('refuses a save that does not meet the rules, and a missing current password', async () => {
    const { store, session } = setup();
    store.next.set('short');
    store.confirm.set('short');
    const result = await store.saveSection('password');
    expect(result).toMatchObject({ ok: false });
    expect(store.currentError()).toBeTruthy();
    expect(store.errorCountOf('password')).toBe(2);
    expect(session.changeOwnPassword).not.toHaveBeenCalled();
  });

  it('changes the password and clears the draft', async () => {
    const { store, session, toasts } = setup();
    store.current.set('old-password');
    store.next.set('a-much-longer-one');
    store.confirm.set('a-much-longer-one');
    expect(await store.saveSection('password')).toEqual({ ok: true });
    expect(session.changeOwnPassword).toHaveBeenCalledWith('old-password', 'a-much-longer-one');
    expect(store.passwordDirty()).toBe(false);
    expect(toasts.toasts().at(-1)?.message).toContain('Password changed');
  });

  it('puts a wrong current password on that field and keeps the draft', async () => {
    const { store, session } = setup();
    session.changeOwnPassword.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { field: 'currentPassword', detail: 'Not right.' } })));
    store.current.set('bad');
    store.next.set('a-much-longer-one');
    store.confirm.set('a-much-longer-one');
    expect(await store.saveSection('password')).toMatchObject({ ok: false });
    expect(store.currentError()).toBe('Not right.');
    expect(store.passwordDirty()).toBe(true);
  });
});

describe('AccountDraftStore › sections', () => {
  it('follows the URL, falling back to Profile', () => {
    const { store, url } = setup();
    url.set('/account/preferences');
    expect(store.section()).toBe('preferences');
    url.set('/account');
    expect(store.section()).toBe('profile');
  });

  it('has nothing to save on the other pages', async () => {
    const { store } = setup();
    expect(store.dirtyOf('preferences')).toBe(false);
    expect(await store.saveSection('sessions')).toEqual({ ok: true });
  });
});
