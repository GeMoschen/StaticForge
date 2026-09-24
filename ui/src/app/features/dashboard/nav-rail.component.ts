import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ProjectContextStore } from '../../core/project/project-context.store';
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
  protected readonly theme = inject(ThemeService);

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
      { label: 'Templates', icon: 'dashboard_customize', route: `${base}/templates` },
      { label: 'Settings', icon: 'settings', route: `${base}/settings` },
    ];
  });

  constructor() {
    effect(() => {
      localStorage.setItem(STORAGE_KEY, this.expanded() ? '1' : '0');
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
