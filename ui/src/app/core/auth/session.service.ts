import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, switchMap, tap } from 'rxjs';
import { ApiClient } from '../api/api.client';
import type { components } from '../api/generated/schema.d.ts';
import { AuthStore } from './auth.store';

type MeResponse = components['schemas']['MeResponse'];

/** Where the app goes when a password change is pending (M26). */
export const SET_PASSWORD_URL = '/account/set-password';

/**
 * The session's lifecycle beyond login (M26): signing out here or everywhere, and changing the own password — which
 * revokes every session server-side, so the change signs straight back in with the new password.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly api = inject(ApiClient);
  private readonly http = inject(HttpClient);
  private readonly store = inject(AuthStore);
  private readonly router = inject(Router);

  /** Ends this session and goes to the login page, whether or not the server could be told. */
  signOut(): void {
    const done = () => this.leave();
    this.api.logout().subscribe({ next: done, error: done });
  }

  /** Ends every session of the account, this one included, then goes to the login page. */
  signOutEverywhere(): Observable<void> {
    return this.api.revokeAllSessions().pipe(tap(() => this.leave()));
  }

  /**
   * Changes the own password and signs in again with it: the server revokes every session on a password change,
   * this one included. Emits the reloaded profile (with `mustChangePassword` cleared).
   */
  changeOwnPassword(currentPassword: string, newPassword: string): Observable<MeResponse> {
    const username = this.store.username();
    return this.api.changePassword(currentPassword, newPassword).pipe(
      switchMap(() => {
        if (!username) {
          throw new Error('No signed-in user to sign in again.');
        }
        return this.api.login(username, newPassword);
      }),
      tap((res) => this.store.setSession(res)),
      switchMap(() => this.reloadUser()),
    );
  }

  /** Reads `/auth/me` into the store (after a profile edit, or when the server asks for a password change). */
  reloadUser(): Observable<MeResponse> {
    return this.store.loadUser(this.http);
  }

  private leave(): void {
    this.store.clear();
    void this.router.navigate(['/login']);
  }
}
