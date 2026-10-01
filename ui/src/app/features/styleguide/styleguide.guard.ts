import { InjectionToken, inject, isDevMode } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';

/** Whether the build is a development build (the style guide is open to everyone there). Overridable in specs. */
export const SF_DEV_BUILD = new InjectionToken<boolean>('SF_DEV_BUILD', {
  providedIn: 'root',
  factory: () => isDevMode(),
});

/**
 * `/styleguide` (M35.9): open in development builds; in production builds for signed-in instance admins only. Anyone
 * else signs in first, or lands on the dashboard.
 */
export const styleguideGuard: CanMatchFn = () => {
  if (inject(SF_DEV_BUILD)) {
    return true;
  }
  const store = inject(AuthStore);
  const router = inject(Router);
  if (!store.isAuthenticated()) {
    return router.createUrlTree(['/login'], { queryParams: { returnUrl: '/styleguide' } });
  }
  return store.isInstanceAdmin() ? true : router.createUrlTree(['/']);
};
