import { ActivatedRoute, Router } from '@angular/router';

/**
 * Removes a deep-link query parameter (`?asset=`, `?folder=`) once its screen has applied it (M23.4.1), without a
 * history entry. The link opened what it named; clearing it lets the same link select the asset again later, after
 * the user has selected something else.
 */
export function consumeQueryParam(router: Router, route: ActivatedRoute, name: string): void {
  void router.navigate([], {
    relativeTo: route,
    queryParams: { [name]: null },
    queryParamsHandling: 'merge',
    replaceUrl: true,
  });
}
