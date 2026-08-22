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

const STORAGE_KEY = 'sf-nav-rail-expanded';

interface NavItem {
  label: string;
  icon: string;
  route: string;
}

@Component({
  selector: 'sf-nav-rail',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './nav-rail.component.html',
  styleUrl: './nav-rail.component.scss',
})
export class NavRailComponent {
  private readonly store = inject(ProjectContextStore);

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
      { label: 'Pages', icon: '▤', route: `${base}/pages` },
      { label: 'Media', icon: '◫', route: `${base}/media` },
      { label: 'Generate', icon: '⇢', route: `${base}/generation` },
      { label: 'Structures', icon: '⌗', route: `${base}/structures` },
      { label: 'Templates', icon: '▦', route: `${base}/templates` },
      { label: 'Channels', icon: '▣', route: `${base}/channels` },
      { label: 'Revisions', icon: '⇄', route: `${base}/revisions` },
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

  private readInitial(): boolean {
    return localStorage.getItem(STORAGE_KEY) === '1';
  }
}
