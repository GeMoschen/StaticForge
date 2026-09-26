import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { pendingCount } from '../changes/changes-query.util';
import { ReleaseEventsStore } from '../release/release-events.store';
import { ThemeService } from '../../core/ui/theme.service';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { UserMenuComponent } from '../account/user-menu.component';

const STORAGE_KEY = 'sf-nav-rail-expanded';

interface NavItem {
  label: string;
  icon: string;
  route: string;
  /** Tooltip, when it says more than the label (e.g. a keyboard shortcut). */
  hint?: string;
  /** A count shown on the entry (the Changes entry's unreleased changes, M27.6.2); hidden when 0. */
  count?: number;
  /** What the count means, for its accessible name. */
  countLabel?: string;
}

@Component({
  selector: 'sf-nav-rail',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, SfIconComponent, UserMenuComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './nav-rail.component.html',
  styleUrl: './nav-rail.component.scss',
})
export class NavRailComponent {
  private readonly store = inject(ProjectContextStore);
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly releaseEvents = inject(ReleaseEventsStore);
  protected readonly theme = inject(ThemeService);

  /** New, changed and deletion-pending (asset, locale) pairs — re-read on navigation and after release actions, never polled. */
  protected readonly changesCount = signal(0);
  private readonly navigations = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => (event as NavigationEnd).id),
    ),
    { initialValue: 0 },
  );

  readonly activeKey = this.store.activeProjectKey;
  readonly expanded = signal(this.readInitial());

  readonly switcherGlyph = computed(() => {
    const key = this.activeKey();
    return key ? key.charAt(0).toUpperCase() : 'S';
  });

  readonly navItems = computed<NavItem[]>(() => {
    const key = this.activeKey();
    if (!key) {
      return [];
    }
    const base = `/p/${key}`;
    return [
      { label: 'Search', icon: 'search', route: `${base}/search`, hint: 'Search (Ctrl K)' },
      { label: 'Pages', icon: 'description', route: `${base}/pages` },
      { label: 'Content', icon: 'dataset', route: `${base}/content` },
      { label: 'Media', icon: 'perm_media', route: `${base}/media` },
      { label: 'Navigation', icon: 'account_tree', route: `${base}/navigation` },
      { label: 'Globals', icon: 'tune', route: `${base}/globals` },
      {
        label: 'Changes',
        icon: 'published_with_changes',
        route: `${base}/changes`,
        count: this.changesCount(),
        countLabel: this.changesCount() === 1 ? 'unreleased change' : 'unreleased changes',
      },
      { label: 'Schedules', icon: 'schedule', route: `${base}/schedules` },
      { label: 'Templates', icon: 'dashboard_customize', route: `${base}/templates` },
      { label: 'Settings', icon: 'settings', route: `${base}/settings` },
    ];
  });

  constructor() {
    effect(() => {
      localStorage.setItem(STORAGE_KEY, this.expanded() ? '1' : '0');
    });
    effect(() => {
      const key = this.activeKey();
      this.navigations();
      this.releaseEvents.version();
      untracked(() => this.loadCount(key));
    });
  }

  private loadCount(key: string | null): void {
    if (!key) {
      this.changesCount.set(0);
      return;
    }
    this.api.changesCount(key).subscribe({
      next: (counts) => this.changesCount.set(pendingCount(counts)),
      // The count is a hint: a failed read keeps the last one.
      error: () => undefined,
    });
  }

  toggle(): void {
    this.expanded.update((v) => !v);
  }

  toggleTheme(): void {
    this.theme.toggle();
  }

  private readInitial(): boolean {
    return localStorage.getItem(STORAGE_KEY) === '1';
  }
}
