import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthStore } from './auth.store';

export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  const store = inject(AuthStore);
  const token = store.accessToken();
  if (token) {
    req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
  return next(req);
};
