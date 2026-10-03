import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfDrawerComponent } from '../../../shared/components/dialog/sf-drawer.component';
import { SfBadgeComponent } from '../../../shared/components/display/sf-badge.component';
import { SfEmptyStateComponent } from '../../../shared/components/sf-empty-state.component';
import { SfTab, SfTabsComponent } from '../../../shared/components/sf-tabs.component';
import { SampleUsage } from './sample-content-data';
import { SampleState } from './sample-state';

/** The drawer's tabs; `null` is closed. */
export type SampleContentPanelTab = 'issues' | 'usages';

/** One finding of the record's Checks tab. */
export interface SampleIssue {
  readonly level: 'error' | 'warning' | 'info';
  readonly message: string;
  /** The field it is about. */
  readonly path: string;
}

/**
 * The right-hand drawer of the Content area (M35.20, gate round 11). The **record editor** opens it with two tabs,
 * **Checks** (errors, warnings and notes about the record's values, most severe first; an error is outlined) and
 * **Used by** (the pages, templates and records that read the record); the **record set view** opens it with
 * **Used by** only (`tabs="usages"`). Each tab has an empty state. It is non-modal, so the form stays usable beside it.
 */
@Component({
  selector: 'sf-sample-content-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfBadgeComponent, SfDrawerComponent, SfEmptyStateComponent, SfTabsComponent, TranslocoPipe],
  templateUrl: './sample-content-panel.component.html',
  styleUrl: './sample-content-panel.component.scss',
})
export class SampleContentPanelComponent {
  private readonly state = inject(SampleState);

  readonly title = input.required<string>();
  /** `both`: Checks and Used by; `usages`: Used by only (a record set has no checks). */
  readonly tabs = input<'both' | 'usages'>('both');
  readonly issues = input<readonly SampleIssue[]>([]);
  readonly usages = input<readonly SampleUsage[]>([]);
  /** The open tab; `null` while the drawer is closed. */
  readonly tab = model<SampleContentPanelTab | null>(null);

  protected readonly tabList = computed<SfTab[]>(() => {
    const list: SfTab[] = [];
    if (this.tabs() === 'both') {
      list.push({ id: 'issues', label: this.state.t('contentPanel.checks'), errors: this.issues().length });
    }
    list.push({ id: 'usages', label: this.state.t('contentPanel.usedBy'), note: this.usages().length ? String(this.usages().length) : undefined });
    return list;
  });

  protected select(id: string): void {
    this.tab.set(id as SampleContentPanelTab);
  }

  protected levelLabel(issue: SampleIssue): string {
    return this.state.t(`contentPanel.level.${issue.level}`);
  }

  protected typeLabel(usage: SampleUsage): string {
    return this.state.t(`contentPanel.type.${usage.type}`);
  }
}
