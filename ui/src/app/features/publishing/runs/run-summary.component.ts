import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { ApiClient } from '../../../core/api/api.client';
import { DeveloperModeService } from '../../../core/frame/developer-mode.service';
import { SfRelativeTimeComponent } from '../../../shared/components/display/sf-relative-time.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { assetRoute } from '../../../shared/asset-route.util';
import { HELD_BACK_CODE, parseDiagnostics, type DiagnosticPage } from '../../generation/generation-diagnostics';
import { RunsStore } from './runs.store';
import { GenerationRunView, findingTotals, formatBytes, isActiveRun, runModeOf, runTriggerOf } from './runs.util';

/**
 * A run's Summary tab (gate decisions 192): the facts (finished, channels, redirects added, a findings line that links
 * to the Findings tab), the pages the run held back because of Error findings, and what the build itself reported
 * (template and file problems, with the pages they are about).
 */
@Component({
  selector: 'sf-run-summary',
  standalone: true,
  imports: [RouterLink, SfButtonComponent, SfIconComponent, SfRelativeTimeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './run-summary.component.html',
  styleUrl: './run-summary.component.scss',
})
export class RunSummaryComponent {
  readonly projectKey = input.required<string>();
  readonly run = input.required<GenerationRunView>();
  /** "Show findings": the Findings tab, only the errors when `true`. */
  readonly showFindings = output<boolean>();

  private readonly store = inject(RunsStore);
  private readonly pagesApi = inject(ApiClient);
  private readonly transloco = inject(TranslocoService);
  protected readonly developerMode = inject(DeveloperModeService).enabled;

  protected readonly mode = computed(() => runModeOf(this.run()));
  protected readonly trigger = computed(() => runTriggerOf(this.run()));
  protected readonly target = computed(() => {
    const id = this.run().targetId;
    return id == null ? this.store.defaultTarget() : (this.store.targets().find((t) => t.id === id) ?? null);
  });
  protected readonly channels = computed(() => this.run().channels?.join(', ') || this.t('run.channelsAll'));
  protected readonly bytes = computed(() => formatBytes(this.run().bytesWritten ?? 0));
  /** Redirects the run added; shown when there are some. */
  protected readonly redirectsAdded = computed(() => this.run().planSummary?.redirectsAdded ?? 0);
  protected readonly totals = computed(() => (isActiveRun(this.run()) ? null : findingTotals(this.run())));
  protected readonly revision = computed(() => (this.run().revisionId == null ? null : this.t('run.revisionValue', { revision: this.run().revisionId })));

  protected readonly heldBack = computed(() => this.run().heldBack ?? []);
  /** The channel of a held-back page is only worth naming when the run built several. */
  protected readonly severalChannels = computed(() => new Set(this.heldBack().map((page) => page.channel)).size > 1);

  /** What the build reported: its template and file problems. The held-back pages have their own block above. */
  protected readonly problems = computed(() => {
    const hasHeldBack = this.heldBack().length > 0;
    return parseDiagnostics(this.run().diagnostics).filter((group) => !(hasHeldBack && group.code === HELD_BACK_CODE));
  });

  /** The uuids of the project's pages, read only when a problem names pages: a deleted page is listed as text. */
  private readonly existing = signal<ReadonlySet<string> | null>(null);

  constructor() {
    effect(() => {
      const names = this.problems().some((group) => (group.pages?.length ?? 0) > 0);
      const key = this.projectKey();
      if (names) {
        untracked(() =>
          this.pagesApi.listPages(key).subscribe({
            next: (pages) => this.existing.set(new Set((pages ?? []).map((page) => page.uuid ?? ''))),
            // Without the list the pages stay plain text.
            error: () => undefined,
          }),
        );
      }
    });
  }

  protected pageExists(page: DiagnosticPage): boolean {
    return this.existing()?.has(page.uuid) ?? false;
  }

  protected pageRoute(page: DiagnosticPage): string[] {
    return assetRoute(this.projectKey(), { uuid: page.uuid, type: 'PAGE' }).commands;
  }

  /** How a problem names a page: `Display name (/folder/uid)`; its uid, or its uuid when nothing else is known. */
  protected pageLabel(page: DiagnosticPage): string {
    const name = page.displayName ?? page.uid ?? page.uuid;
    return page.path && page.displayName ? `${name} (${page.path})` : name;
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`publishing.${key}`, params);
  }
}
