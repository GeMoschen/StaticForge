import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfBadgeComponent } from '../../../shared/components/display/sf-badge.component';
import { SfTooltipDirective } from '../../../shared/directives/sf-tooltip.directive';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { CHANGES_COUNT } from './sample-data';
import { SAMPLE_AREAS, SampleAdminSection, SampleArea, SampleState } from './sample-state';

interface RailItem {
  readonly id: string;
  readonly icon: string;
  readonly badge?: number;
}

interface RailGroup {
  readonly id: string;
  /** Developer-only group (hidden in the editor view). */
  readonly develop?: boolean;
  readonly items: readonly RailItem[];
}

const GROUPS: readonly RailGroup[] = [
  { id: 'home', items: [{ id: 'home', icon: 'home' }] },
  {
    id: 'content',
    items: [
      { id: 'pages', icon: 'account_tree' },
      { id: 'media', icon: 'photo_library' },
      { id: 'records', icon: 'dataset' },
      { id: 'navigation', icon: 'menu_open' },
      { id: 'globals', icon: 'tune' },
    ],
  },
  {
    id: 'publish',
    items: [
      { id: 'changes', icon: 'difference', badge: CHANGES_COUNT },
      { id: 'publishing', icon: 'rocket_launch' },
      { id: 'schedules', icon: 'event_upcoming' },
    ],
  },
  { id: 'develop', develop: true, items: [{ id: 'templates', icon: 'code_blocks' }] },
];

/** The rail of Administration (M35.16): its sections replace the project's areas; there is no Settings footer. */
const ADMIN_GROUPS: readonly RailGroup[] = [
  {
    id: 'admin',
    items: [
      { id: 'users', icon: 'group' },
      { id: 'projects', icon: 'folder_managed' },
      { id: 'jobs', icon: 'work_history' },
      { id: 'audit', icon: 'fact_check' },
    ],
  },
];

/** The rail items that open an area of the sample (the others only say they are not part of it). */
const AREA_OF_ITEM: Readonly<Record<string, SampleArea>> = {
  pages: 'pages',
  records: 'content',
  templates: 'templates',
  media: 'media',
  navigation: 'navigation',
  globals: 'globals',
  changes: 'changes',
  schedules: 'schedules',
  publishing: 'publishing',
  settings: 'settings',
};

/**
 * The mocked M35.10 rail: labelled groups (Home; Content; Publish; Develop — developer mode only) and Settings in the
 * footer. Expanded it shows labels; collapsed only icons, each with its name as a tooltip. The open area's item is
 * the active one; Home and Settings only say they are not part of the sample.
 */
@Component({
  selector: 'sf-sample-rail',
  standalone: true,
  imports: [SfBadgeComponent, SfButtonComponent, SfIconComponent, SfTooltipDirective, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-rail.component.html',
  styleUrl: './sample-rail.component.scss',
  host: { '[class.is-collapsed]': 'collapsed()' },
})
export class SampleRailComponent {
  protected readonly state = inject(SampleState);
  protected readonly collapsed = computed(() => this.state.rail() === 'collapsed');
  protected readonly admin = computed(() => this.state.area() === 'admin');
  protected readonly groups = computed(() =>
    this.admin() ? ADMIN_GROUPS : GROUPS.filter((group) => !group.develop || this.state.devMode()),
  );

  protected label(id: string): string {
    return this.state.t(`rail.${id}`);
  }

  protected isActive(id: string): boolean {
    return this.admin() ? id === this.state.adminSection() : AREA_OF_ITEM[id] === this.state.area();
  }

  protected async select(id: string): Promise<void> {
    if (this.admin()) {
      if (await this.state.canLeave()) {
        this.state.adminSection.set(id as SampleAdminSection);
        this.state.adminDetail.set(null);
      }
      return;
    }
    const area = AREA_OF_ITEM[id];
    if (area && SAMPLE_AREAS.includes(area)) {
      if (await this.state.canLeave()) {
        this.state.openArea(area);
      }
    } else {
      this.state.notice('rail.notInSample', { name: this.label(id) });
    }
  }

  protected toggle(): void {
    this.state.rail.set(this.collapsed() ? 'expanded' : 'collapsed');
  }
}
