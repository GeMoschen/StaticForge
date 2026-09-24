import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthStore } from './auth.store';

/**
 * Login and refresh authenticate by password and refresh cookie. They never carry the access token: after an epoch
 * bump (membership change, own password change, M26) that token is revoked, and presenting it would get the very
 * request that is meant to replace it refused.
 */
const CREDENTIAL_ENDPOINTS = /\/api\/v1\/auth\/(login|refresh)$/;

export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  const store = inject(AuthStore);
  const token = store.accessToken();
  if (token && !CREDENTIAL_ENDPOINTS.test(req.url)) {
    req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
  return next(req);
};
