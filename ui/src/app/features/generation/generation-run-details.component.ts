import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable, map } from 'rxjs';
import { assetRoute } from '../../shared/asset-route.util';
import {
  DiagnosticGroup,
  HELD_BACK_CODE,
  parseDiagnostics,
  parseHeldBack,
  type DiagnosticPage,
  type HeldBackPage,
} from './generation-diagnostics';
import { findingCountsLabel } from './findings/findings.util';
import { SfRunFindingsComponent } from './findings/sf-run-findings.component';
import { type EntryPage, type PlanEntryQuery, planSummaryLine, redirectsLine, rootKindRows } from './insight/insight.util';
import { SfPlanEntriesTableComponent } from './insight/sf-plan-entries-table.component';
import { GenerationService } from './generation.service';
import { type GenerationRunView, GenerationStore } from './generation.store';

/** The expanded row of a run: the Summary, Rebuilt pages and Findings tabs with the run's diagnostics. */
@Component({
  selector: 'sf-generation-run-details',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, SfPlanEntriesTableComponent, SfRunFindingsComponent],
  templateUrl: './generation-run-details.component.html',
  styleUrl: './generation-run-details.component.scss',
})
export class GenerationRunDetailsComponent {
  protected readonly store = inject(GenerationStore);
  private readonly api = inject(GenerationService);

  readonly run = input.required<GenerationRunView>();

  protected readonly heldBackCode = HELD_BACK_CODE;

  protected readonly planLine = computed(() => planSummaryLine(this.run().planSummary));
  protected readonly rootKinds = computed(() => rootKindRows(this.run().planSummary).map((row) => row.key));
  protected readonly redirectsText = computed(() => redirectsLine(this.run().planSummary));
  /** The run list's findings summary: "3 errors · 41 warnings". */
  protected readonly findingsLine = computed(() => findingCountsLabel(this.run().findingCounts));
  protected readonly diagnostics = computed(() => parseDiagnostics(this.run().diagnostics));

  private readonly runId = computed(() => this.run().id ?? 0);
  /** One stable loader per run, so the entries table doesn't reload on every change detection. */
  protected readonly runPlanFetch = computed(() => {
    const id = this.runId();
    return (query: PlanEntryQuery): Observable<EntryPage | undefined> =>
      this.api.getRunPlan(this.store.projectKey(), id, query).pipe(map((plan) => plan.entries ?? undefined));
  });

  /**
   * The pages `run`'s `SF-GEN-0125` messages are about, by message index (the server lists `heldBack` in the order of
   * those messages). Empty — no links — for a run without findings or from before `heldBack`, or when the two
   * disagree.
   */
  protected heldBackOf(groups: DiagnosticGroup[]): HeldBackPage[] {
    const run = this.run();
    const pages = run.findingCounts ? parseHeldBack(run.diagnostics) : [];
    const messages = groups.find((group) => group.code === HELD_BACK_CODE)?.messages.length ?? 0;
    return pages.length === messages ? pages : [];
  }

  /** Opens the findings of a page the quality checks held back: that page, channel and language. */
  protected showHeldBack(page: HeldBackPage): void {
    this.store.showFindings(this.run(), { asset: page.asset, channel: page.channel, locale: page.locale });
  }

  /** The route of the page's editor. */
  protected pageRoute(page: DiagnosticPage): string[] {
    return assetRoute(this.store.projectKey(), { uuid: page.uuid, type: 'PAGE' }).commands;
  }

  /** How a diagnostic names a page: `Display name (/folder/uid)`; its uid, or its uuid when nothing else is known. */
  protected pageLabel(page: DiagnosticPage): string {
    const name = page.displayName ?? page.uid ?? page.uuid;
    return page.path && page.displayName ? `${name} (${page.path})` : name;
  }
}
