import { inject } from '@angular/core';
import { CanMatchFn, Route, Router, UrlSegment } from '@angular/router';
import { AuthStore } from './auth.store';

export const ROLE_RANK: Record<string, number> = {
  VIEWER: 0,
  EDITOR: 1,
  DEVELOPER: 2,
  PROJECT_ADMIN: 3,
};

export function roleRank(role: string | null | undefined): number {
  if (!role) {
    return -1;
  }
  return ROLE_RANK[role] ?? -1;
}

/** Resolves a `:param` value from the guard's own route path pattern. */
function paramFromRoute(route: Route, segments: UrlSegment[]): string | null {
  const path = route.path ?? '';
  const parts = path.split('/');
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith(':')) {
      const segment = segments[i];
      if (segment) {
        return segment.path;
      }
    }
  }
  return null;
}

export const authGuard: CanMatchFn = () => {
  const store = inject(AuthStore);
  const router = inject(Router);
  if (store.isAuthenticated()) {
    return true;
  }
  const returnUrl = router.url;
  return router.createUrlTree(['/login'], {
    queryParams: returnUrl && returnUrl !== '/' ? { returnUrl } : {},
  });
};

export function projectMemberGuard(minRole: string): CanMatchFn {
  const requiredRank = roleRank(minRole);
  return (route: Route, segments: UrlSegment[]) => {
    const store = inject(AuthStore);
    const projectKey = paramFromRoute(route, segments);
    if (!projectKey) {
      return false;
    }
    return roleRank(store.roleFor(projectKey)) >= requiredRank;
  };
}

/** The administration area (M26) is for instance admins only; anyone else lands on the dashboard. */
export const instanceAdminGuard: CanMatchFn = () => {
  const store = inject(AuthStore);
  return store.isInstanceAdmin() ? true : inject(Router).createUrlTree(['/']);
};

export const loginGuard: CanMatchFn = () => {
  const store = inject(AuthStore);
  const router = inject(Router);
  if (store.isAuthenticated()) {
    return router.createUrlTree(['/']);
  }
  return true;
};
