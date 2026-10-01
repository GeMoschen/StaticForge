import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';

/**
 * The `title` of a route: the translated text for `key` (`frame.section.pages`). `AppTitleStrategy` collects the titles
 * of the matched routes and the document title shows them as "Item · Section · Project — StaticForge".
 */
export function routeTitle(key: string): ResolveFn<string> {
  return () => inject(TranslocoService).translate(key);
}
