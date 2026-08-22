import { HttpClient } from '@angular/common/http';
import { Injectable, computed, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs';
import type { components } from '../api/generated/schema.d.ts';

type LoginResponse = components['schemas']['LoginResponse'];
type MeResponse = components['schemas']['MeResponse'];

/**
 * Base64url-decodes a JWT segment to a raw string.
 */
function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  return atob(padded);
}

/**
 * Decodes the JWT payload (middle segment) without touching storage. Returns
 * null if the token is malformed or the environment lacks a base64 decoder.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3 || typeof atob !== 'function') {
    return null;
  }
  try {
    return JSON.parse(base64UrlDecode(parts[1])) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Returns the JWT `exp` claim (seconds since epoch), or null when absent.
 */
export function jwtExpiresAt(token: string): number | null {
  const claims = decodeJwtPayload(token);
  const exp = claims?.['exp'];
  if (typeof exp === 'number') {
    return exp;
  }
  if (typeof exp === 'string' && exp !== '') {
    const parsed = Number(exp);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

@Injectable({ providedIn: 'root' })
export class AuthStore {
  readonly accessToken = signal<string | null>(null);
  readonly userId = signal<number | null>(null);
  readonly username = signal<string | null>(null);
  readonly displayName = signal<string | null>(null);
  readonly systemRole = signal<string | null>(null);
  readonly projectRoles = signal<Record<string, string>>({});

  readonly isAuthenticated = computed(() => this.accessToken() !== null);

  /**
   * Stores the access token in memory only (never localStorage/sessionStorage)
   * and derives best-effort claims (user id, roles) from the JWT payload.
   */
  setSession(res: LoginResponse): void {
    const token = res.accessToken ?? null;
    this.accessToken.set(token);
    if (!token) {
      this.userId.set(null);
      return;
    }
    const claims = decodeJwtPayload(token);
    if (!claims) {
      return;
    }
    this.userId.set(toNumber(claims['uid'] ?? claims['id'] ?? claims['userId']));

    const systemRole = claims['sysRole'] ?? claims['systemRole'];
    if (typeof systemRole === 'string') {
      this.systemRole.set(systemRole);
    }

    const roles = claims['roles'];
    if (roles && typeof roles === 'object' && !Array.isArray(roles)) {
      this.projectRoles.set(roles as Record<string, string>);
    }
  }

  setUser(user: MeResponse): void {
    this.userId.set(user.id ?? null);
    this.username.set(user.username ?? null);
    this.displayName.set(user.displayName ?? null);
    this.systemRole.set(user.systemRole ?? null);
    this.projectRoles.set(user.projectRoles ?? {});
  }

  roleFor(projectKey: string): string | null {
    return this.projectRoles()[projectKey] ?? null;
  }

  clear(): void {
    this.accessToken.set(null);
    this.userId.set(null);
    this.username.set(null);
    this.displayName.set(null);
    this.systemRole.set(null);
    this.projectRoles.set({});
  }

  loadUser(http: HttpClient): Observable<MeResponse> {
    return http
      .get<MeResponse>('/api/v1/auth/me', { withCredentials: true })
      .pipe(tap((user) => this.setUser(user)));
  }
}
