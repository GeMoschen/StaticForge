import { Injectable, inject, signal } from '@angular/core';
import { ConfirmService } from '../../../../shared/components/dialog/confirm.service';
import { injectSampleDevMode, injectSampleNotice, injectSampleText } from '../changes/sample-area.util';
import { EDITOR_NAME, SampleRun, isActiveRun, isPromotable, promoteTargetOf } from './publishing-data';

/** The Publishing area's sections (the side nav; query parameter `psec`). */
export type PublishingSection = 'runs' | 'targets' | 'policy' | 'quality' | 'redirects' | 'urls';
export const PUBLISHING_SECTIONS: readonly PublishingSection[] = ['runs', 'targets', 'policy', 'quality', 'redirects', 'urls'];

/**
 * State of the sample's Publishing area, provided by {@link SamplePublishingAreaComponent} and shared by its sections:
 * the open section, run and dialog (mirrored in the query parameters by the area), developer mode and the texts.
 */
@Injectable()
export class PublishingState {
  readonly section = signal<PublishingSection>('runs');
  /** The open run's id (run detail), or null for the run list. */
  readonly runId = signal<string | null>(null);
  readonly buildOpen = signal(false);
  /** The run detail's tab asked for by the opener (Live log opens on `log`; `rtab`), or null for the run's default. */
  readonly runTab = signal<'summary' | 'rebuilt' | 'findings' | 'log' | null>(null);
  /** The run detail read its URL parameters (`rtab`, `fsev` …) already: they belong to the run the page opened with. */
  runParamsRead = false;
  /** The project has no generation target (`notargets=1`): Build now cannot start, Targets shows its empty state. */
  readonly noTargets = signal(false);
  /** The viewer's project role (`role=editor`): editors have limited publishing and a read-only Targets and Policy. */
  readonly role = signal<'admin' | 'editor'>('admin');

  // Build now (`bplan`, `bfallback`, `bempty`, `berror`), Targets (`tdrawer`, `terror`) and Policy (`pdialog`) states.
  /** Build now opens with the plan preview already computed. */
  readonly buildPlan = signal(false);
  /** The previewed incremental plan fell back to a full build. */
  readonly buildFallback = signal(false);
  /** The previewed plan has nothing to rebuild. */
  readonly buildEmpty = signal(false);
  /** Start answers 409 "A build is already running." */
  readonly buildError = signal(false);
  /** The target drawer: `new`, a target id, or null (closed). */
  readonly targetDrawer = signal<string | null>(null);
  /** The target form shows the server's "name already used" error. */
  readonly targetError = signal(false);
  /** The Policy impact dialog is open (`pdialog=impact`). */
  readonly policyImpact = signal(false);

  readonly devMode = injectSampleDevMode();
  /** A `styleguide.sample.publishing.*` text. */
  readonly t = injectSampleText('styleguide.sample.publishing');
  private readonly toast = injectSampleNotice();
  private readonly confirms = inject(ConfirmService);

  /** Every action that would change something says so instead. */
  notice(key = 'notice', params?: Record<string, unknown>): void {
    this.toast(this.t(key, params));
  }

  openRun(id: string | null, tab: 'summary' | 'rebuilt' | 'findings' | 'log' | null = null): void {
    this.section.set('runs');
    this.runId.set(id);
    this.runTab.set(tab);
  }

  /** Cancel: a queued or running run; an editor may cancel only the runs they started. */
  canCancel(run: SampleRun): boolean {
    return isActiveRun(run) && (this.role() !== 'editor' || run.by === EDITOR_NAME);
  }

  /** Promote: a finished run with output, and only developers. */
  canPromote(run: SampleRun): boolean {
    return isPromotable(run) && this.role() !== 'editor';
  }

  async cancelRun(run: SampleRun): Promise<void> {
    const n = run.number;
    const confirmed = await this.confirms.confirm({
      title: this.t('runs.cancelTitle', { n }),
      message: this.t(run.status === 'queued' ? 'runs.cancelQueued' : 'runs.cancelRunning'),
      confirmLabel: this.t('runs.cancelConfirm', { n }),
      cancelLabel: this.t('runs.cancelKeep'),
      tone: 'danger',
    });
    if (confirmed) {
      this.notice();
    }
  }

  async promoteRun(run: SampleRun): Promise<void> {
    const confirmed = await this.confirms.confirm({
      title: this.t('runs.promoteTitle', { n: run.number, target: promoteTargetOf(run).name }),
      confirmLabel: this.t('runs.promoteConfirm'),
    });
    if (confirmed) {
      this.notice();
    }
  }
}
