import { Injectable, Injector, computed, effect, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { APP_TITLE, composeTitle } from './document-title';
import { FrameContextStore } from './frame-context.store';

/**
 * Hands the titles of the matched routes (`title` on each route, innermost first) to {@link FrameContextStore}; the
 * {@link DocumentTitleService} puts them together with the open item and the project.
 */
@Injectable({ providedIn: 'root' })
export class AppTitleStrategy extends TitleStrategy {
  // Looked up on use: the router creates its title strategy, and the frame context reads the router.
  private readonly injector = inject(Injector);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const titles: string[] = [];
    let route = snapshot.root;
    while (route) {
      const title = this.getResolvedTitleForRoute(route);
      // A child route inherits its parent's resolved title (`paramsInheritanceStrategy: 'always'`): count it once.
      if (typeof title === 'string' && title !== '' && titles[0] !== title) {
        titles.unshift(title);
      }
      route = route.firstChild as typeof route;
    }
    this.injector.get(FrameContextStore).routeTitles.set(titles);
  }
}

/** Keeps `<title>` on "Item · Section · Project — StaticForge" (created at start-up by the root component). */
@Injectable({ providedIn: 'root' })
export class DocumentTitleService {
  private readonly frame = inject(FrameContextStore);
  private readonly title = inject(Title);

  readonly text = computed(() =>
    composeTitle({
      item: this.frame.item()?.label,
      sections: this.frame.routeTitles(),
      project: this.frame.projectName() ?? this.frame.projectKey(),
    }),
  );

  constructor() {
    this.title.setTitle(APP_TITLE);
    effect(() => this.title.setTitle(this.text()), { injector: inject(Injector) });
  }
}
