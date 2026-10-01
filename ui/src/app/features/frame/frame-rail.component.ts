import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { filter, map } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { SETTINGS_ITEM, activeRailItem, hasSettings, railGroups, type RailItem } from '../../core/frame/rail-model';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { SfTooltipDirective } from '../../shared/directives/sf-tooltip.directive';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { pendingCount } from '../changes/changes-query.util';
import { ReleaseEventsStore } from '../release/release-events.store';

/**
 * The left rail of the app frame (M35.10): labelled groups — Home; Content; Publish (Changes with its count); Develop
 * (developer mode only) — and Settings in the footer; in administration its sections. Collapsible (the state is a user
 * preference); collapsed it shows icons only, each with its name as a tooltip. What is shown follows `railGroups`.
 */
@Component({
  selector: 'sf-frame-rail',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, SfBadgeComponent, SfButtonComponent, SfIconComponent, SfTooltipDirective, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './frame-rail.component.html',
  styleUrl: './frame-rail.component.scss',
  host: { '[class.is-collapsed]': 'collapsed()' },
})
export class FrameRailComponent {
  private readonly api = inject(ApiClient);
  private readonly frame = inject(FrameContextStore);
  private readonly preferences = inject(PreferencesService);
  private readonly releaseEvents = inject(ReleaseEventsStore);
  private readonly transloco = inject(TranslocoService);
  private readonly developerMode = inject(DeveloperModeService);

  protected readonly collapsed = this.preferences.railCollapsed;
  protected readonly location = this.frame.location;

  protected readonly groups = computed(() =>
    railGroups({ location: this.location(), developerMode: this.developerMode.enabled() }),
  );
  protected readonly settings = computed(() => (hasSettings(this.location()) ? SETTINGS_ITEM : null));
  protected readonly active = computed(() => activeRailItem(this.location()));
  protected readonly isAdmin = computed(() => this.location().kind === 'admin');

  /** New, changed and deletion-pending (asset, language) pairs — re-read on navigation and after release actions, never polled. */
  private readonly changesCount = signal(0);
  private readonly navigations = toSignal(
    inject(Router).events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => (event as NavigationEnd).id),
    ),
    { initialValue: 0 },
  );

  constructor() {
    effect(() => {
      const key = this.frame.projectKey();
      this.navigations();
      this.releaseEvents.version();
      untracked(() => this.loadCount(key));
    });
  }

  protected name(item: RailItem): string {
    return this.transloco.translate(`frame.rail.item.${item.id}`);
  }

  protected count(item: RailItem): number {
    return item.badge === 'changes' ? this.changesCount() : 0;
  }

  /** The name a screen reader (and the collapsed tooltip) gets: with the count, when there is one. */
  protected fullName(item: RailItem): string {
    const name = this.name(item);
    const count = this.count(item);
    return count > 0 ? this.transloco.translate('frame.rail.withCount', { name, count }) : name;
  }

  protected link(item: RailItem): unknown[] {
    const route = [...item.route];
    return route[0]?.startsWith('/') ? route : ['/p', this.frame.projectKey() ?? '', ...route];
  }

  protected toggle(): void {
    this.preferences.setRailCollapsed(!this.collapsed());
  }

  private loadCount(key: string | null): void {
    if (key === null) {
      this.changesCount.set(0);
      return;
    }
    this.api.changesCount(key).subscribe({
      next: (counts) => this.changesCount.set(pendingCount(counts)),
      // The count is a hint: a failed read keeps the last one.
      error: () => undefined,
    });
  }
}
