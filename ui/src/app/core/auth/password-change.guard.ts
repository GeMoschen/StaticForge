import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { AuthStore } from './auth.store';
import { SET_PASSWORD_URL } from './session.service';

/**
 * While a password change is pending (M26), every route but the "Set a new password" screen leads there, keeping the
 * URL the user was heading for as `returnUrl`. The server refuses those calls anyway (`428`); this keeps the user
 * from landing on screens that can only fail.
 */
export const passwordChangeGuard: CanMatchFn = () => {
  const store = inject(AuthStore);
  const router = inject(Router);
  if (!store.mustChangePassword()) {
    return true;
  }
  const target = router.getCurrentNavigation()?.extractedUrl.toString() ?? router.url;
  return router.createUrlTree([SET_PASSWORD_URL], { queryParams: returnUrlParams(target) });
};

/** The "Set a new password" screen is only for a pending change; otherwise it leads home. */
export const setPasswordGuard: CanMatchFn = () => {
  const store = inject(AuthStore);
  return store.mustChangePassword() ? true : inject(Router).createUrlTree(['/']);
};

/** `{ returnUrl }` for a URL worth coming back to (not the root, not the password screen itself). */
export function returnUrlParams(url: string | null | undefined): Record<string, string> {
  if (!url || url === '/' || !url.startsWith('/') || url.startsWith(SET_PASSWORD_URL)) {
    return {};
  }
  return { returnUrl: url };
}
