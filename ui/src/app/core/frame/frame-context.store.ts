import { Injectable, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';
import { ProjectContextStore } from '../project/project-context.store';
import type { FrameItem } from './breadcrumb.util';
import { parseFrameLocation, type FrameLocation } from './frame-location';

/**
 * Where the user is, for the app frame (M35.10): the location read from the router URL, the open item a screen reports
 * for the breadcrumb and the title, and the route titles the title strategy collected. The frame, the developer-mode
 * service and the document title all read it, so none of them parses URLs on its own.
 */
@Injectable({ providedIn: 'root' })
export class FrameContextStore {
  private readonly router = inject(Router);
  private readonly project = inject(ProjectContextStore);

  /** The location of the last finished navigation. */
  readonly location = toSignal<FrameLocation, FrameLocation>(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => parseFrameLocation(event.urlAfterRedirects)),
    ),
    { initialValue: parseFrameLocation(this.router.url) },
  );

  readonly projectKey = computed(() => this.location().projectKey);
  /** The open project's display name, once its detail has loaded. */
  readonly projectName = computed(() => {
    const key = this.projectKey();
    const project = this.project.project();
    return key !== null && project?.key === key ? (project.name ?? key) : null;
  });

  /** The route titles of the current navigation, innermost first (set by `AppTitleStrategy`). */
  readonly routeTitles = signal<readonly string[]>([]);

  private readonly reported = signal<{ owner: string; item: FrameItem } | null>(null);

  /** The open item of the current area, `null` when the screen reports none. */
  readonly item = computed(() => {
    const reported = this.reported();
    return reported !== null && reported.owner === this.ownerKey() ? reported.item : null;
  });

  private readonly ownerKey = computed(() => {
    const { kind, projectKey, section } = this.location();
    return `${kind}:${projectKey ?? ''}:${section ?? ''}`;
  });

  /** A screen reports the open item (name and folder path). It only counts while the user stays in the same area. */
  setItem(item: FrameItem | null): void {
    this.reported.set(item === null ? null : { owner: this.ownerKey(), item });
  }
}
