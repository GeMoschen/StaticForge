import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { SfStatusComponent } from '../../../../shared/components/display/sf-status.component';
import { SfPageHeaderComponent } from '../../../../shared/components/layout/sf-page-header.component';
import { SfSideNavComponent, SfSideNavItem } from '../../../../shared/components/layout/sf-side-nav.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { injectSampleQuery, oneOf } from '../changes/sample-area.util';
import { LAST_FINISHED_RUN, QUALITY_RULES, RUNNING_RUN, findingCounts, runById } from './publishing-data';
import { PUBLISHING_SECTIONS, PublishingSection, PublishingState } from './publishing-state';
import { RUN_STATUS_ICONS, RUN_STATUS_TONES } from './publishing-status';
import { SampleBuildDialogComponent } from './sample-build-dialog.component';
import { SamplePolicyComponent } from './sample-policy.component';
import { SampleQualityComponent } from './sample-quality.component';
import { SampleRedirectsComponent } from './sample-redirects.component';
import { SampleRunsComponent } from './sample-runs.component';
import { SampleTargetsComponent } from './sample-targets.component';
import { SampleUrlsComponent } from './sample-urls.component';

const SECTION_ICONS: Readonly<Record<PublishingSection, string>> = {
  runs: 'history',
  targets: 'dns',
  policy: 'admin_panel_settings',
  quality: 'rule',
  redirects: 'alt_route',
  urls: 'link',
};

/**
 * The sample's Publishing area (M35.24 preview, M35.9 decisions 27–28): a page header with the last build's status
 * and **Build now**, a secondary side menu (`sf-side-nav`) with Runs, Targets, Policy, Quality, Redirects and URLs,
 * and the chosen section beside it (above it when the nav collapses into a select at narrow widths).
 *
 * Query parameters (read on load, written back as the user clicks; other parameters stay): `psec` — the section,
 * `run=<id>` — the run detail, `build=1` — the Build now dialog. Developer mode: `SampleState` when inside the sample
 * screen, else `dev`. Nothing is saved.
 */
@Component({
  selector: 'sf-sample-publishing-area',
  standalone: true,
  imports: [
    SampleBuildDialogComponent,
    SamplePolicyComponent,
    SampleQualityComponent,
    SampleRedirectsComponent,
    SampleRunsComponent,
    SampleTargetsComponent,
    SampleUrlsComponent,
    SfButtonComponent,
    SfPageHeaderComponent,
    SfSideNavComponent,
    SfStatusComponent,
  ],
  providers: [PublishingState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-publishing-area.component.html',
  styleUrl: './sample-publishing-area.component.scss',
})
export class SamplePublishingAreaComponent {
  protected readonly state = inject(PublishingState);
  protected readonly t = this.state.t;
  private readonly query = injectSampleQuery();

  protected readonly running = RUNNING_RUN;
  protected readonly last = LAST_FINISHED_RUN;
  protected readonly tones = RUN_STATUS_TONES;
  protected readonly icons = RUN_STATUS_ICONS;

  protected readonly navItems = computed<SfSideNavItem[]>(() => {
    const t = this.t;
    const warnings = QUALITY_RULES.filter((r) => r.lastFindings > 0).length;
    const lastCounts = findingCounts(this.last);
    return PUBLISHING_SECTIONS.map((id) => ({
      id,
      label: t(`sections.${id}`),
      icon: SECTION_ICONS[id],
      group: id === 'quality' || id === 'redirects' || id === 'urls' ? t('nav.checks') : undefined,
      badge: id === 'runs' ? t('nav.running') : id === 'quality' ? lastCounts.errors + lastCounts.warnings || warnings : null,
      badgeTone: id === 'runs' ? ('info' as const) : ('warning' as const),
    }));
  });

  constructor() {
    const section = oneOf<PublishingSection>(this.query.get('psec'), PUBLISHING_SECTIONS);
    if (section) {
      this.state.section.set(section);
    }
    const run = runById(this.query.get('run'));
    if (run) {
      this.state.openRun(run.id);
    }
    this.state.buildOpen.set(this.query.get('build') === '1');

    effect(() => {
      const sectionNow = this.state.section();
      this.query.set({
        psec: sectionNow,
        run: sectionNow === 'runs' ? this.state.runId() : null,
        build: this.state.buildOpen() ? '1' : null,
      });
    });
  }

  protected selectSection(id: string): void {
    this.state.section.set(id as PublishingSection);
    this.state.runId.set(null);
  }
}
