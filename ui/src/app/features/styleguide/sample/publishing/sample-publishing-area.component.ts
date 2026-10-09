import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { SfStatusComponent } from '../../../../shared/components/display/sf-status.component';
import { SfPageHeaderComponent } from '../../../../shared/components/layout/sf-page-header.component';
import { SfSideNavComponent, SfSideNavItem } from '../../../../shared/components/layout/sf-side-nav.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { injectSampleQuery, oneOf } from '../changes/sample-area.util';
import { SampleState } from '../sample-state';
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
 * `run=<id>` — the run detail, `build=1` — the Build now dialog (also Alt+Shift+B in the sample screen), with
 * `bplan=1` (plan already previewed), `bfallback=1` (incremental fell back to full), `bempty=1` (nothing to rebuild),
 * `berror=1` (Start answers 409); `notargets=1` — no target; `role=editor` — limited permission (read-only Targets and
 * Policy); `tdrawer=new|<targetId>` — the target drawer, `terror=1` (name already used); `pdialog=impact` — the
 * Policy "These schedules would fail" dialog. Run detail (`run=<id>`; r-49 queued, r-48 running, r-47 partial with
 * held-back pages, carried findings and the findings limit, r-44 failed at the upload but with plan and findings, r-41 no plan stored, r-43 rebuilt nothing, r-42 plan
 * removed by retention): `rtab=summary|rebuilt|findings|log`, `fsev=error|warning`, `fcat=links|seo|accessibility`,
 * `frule=<code>[,<code>]`, `flang=DE|EN`, `fpath=<output path prefix>`. With `notargets=1` Build now is disabled with
 * a reason and a link to Targets; with `role=editor` it is hidden (a note says why), Promote is hidden and Cancel
 * stays only on the runs the editor started (r-49). Developer mode: `SampleState` when inside the sample
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
  private readonly sample = inject(SampleState, { optional: true });

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
    // Build now / Targets / Policy variants (`bplan`, `bfallback`, `bempty`, `berror`, `notargets`, `role`, `tdrawer`, `terror`, `pdialog`).
    this.state.buildPlan.set(this.query.get('bplan') === '1');
    this.state.buildFallback.set(this.query.get('bfallback') === '1');
    this.state.buildEmpty.set(this.query.get('bempty') === '1');
    this.state.buildError.set(this.query.get('berror') === '1');
    this.state.noTargets.set(this.query.get('notargets') === '1');
    this.state.role.set(this.query.get('role') === 'editor' ? 'editor' : 'admin');
    this.state.targetDrawer.set(this.query.get('tdrawer') || null);
    this.state.targetError.set(this.query.get('terror') === '1');
    this.state.policyImpact.set(this.query.get('pdialog') === 'impact');
    effect(() => {
      // Alt+Shift+B (the palette's Build now) opens the dialog from anywhere in the sample screen.
      if (this.sample?.buildRequested()) {
        this.sample.buildRequested.set(false);
        this.state.buildOpen.set(true);
      }
    });

    effect(() => {
      const sectionNow = this.state.section();
      this.query.set({
        psec: sectionNow,
        run: sectionNow === 'runs' ? this.state.runId() : null,
        build: this.state.buildOpen() ? '1' : null,
        tdrawer: sectionNow === 'targets' ? this.state.targetDrawer() : null,
        pdialog: sectionNow === 'policy' && this.state.policyImpact() ? 'impact' : null,
      });
    });
  }

  protected selectSection(id: string): void {
    this.state.section.set(id as PublishingSection);
    this.state.runId.set(null);
  }
}
