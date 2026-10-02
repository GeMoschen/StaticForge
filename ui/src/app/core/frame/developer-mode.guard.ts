import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, createUrlTreeFromSnapshot } from '@angular/router';
import { DeveloperModeService } from './developer-mode.service';

/**
 * A page that is only there in developer mode (Settings › Channels, M35.10/M35.11): the side menu hides it, and this
 * keeps a deep link or a bookmark from opening it in the editor view — the user lands on `fallback`, a sibling route.
 * The project is read from the route, not from the frame's location, which follows the URL only once a navigation has
 * finished.
 */
export function developerModeGuard(fallback: string): CanActivateFn {
  return (route: ActivatedRouteSnapshot) => {
    const projectKey = route.pathFromRoot.map((r) => r.paramMap.get('projectKey')).find((key) => key !== null) ?? null;
    return inject(DeveloperModeService).enabledIn(projectKey) || createUrlTreeFromSnapshot(route, ['..', fallback]);
  };
}
