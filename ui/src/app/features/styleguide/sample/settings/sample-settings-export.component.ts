import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { SfStatusComponent } from '../../../../shared/components/display/sf-status.component';
import { SfSwitchComponent } from '../../../../shared/components/forms/sf-switch.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { SampleExportTreeComponent } from './sample-export-tree.component';
import {
  EXPORT_ARCHIVE_NAME,
  EXPORT_ARCHIVE_SIZE,
  EXPORT_RUN_PROGRESS,
  EXPORT_STEPS,
  EXPORT_TREE,
  ExportStep,
  INITIAL_EXPORT_SELECTION,
  exportCounts,
} from './settings-data';
import { SettingsState } from './settings-state';

/** How often and by how much a started export advances (a scripted `istep=run` stays where it is). */
export const EXPORT_TICK_MS = 300;
const EXPORT_TICK_STEP = 9;

/**
 * Import / export › Export, as steps (M35.25): **Select** (checkbox tree of the stores; the selection summary with
 * the Export button beside it), **Options** (schedules, release state), **Run** (progress) and **Result** (summary and
 * a fake download). The stepper header names the step, so the steps have no headings of their own.
 */
@Component({
  selector: 'sf-sample-settings-export',
  standalone: true,
  imports: [SampleExportTreeComponent, SfButtonComponent, SfFieldComponent, SfIconComponent, SfStatusComponent, SfSwitchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-settings-export.component.html',
  styleUrl: './sample-settings-export.component.scss',
})
export class SampleSettingsExportComponent {
  protected readonly state = inject(SettingsState);
  protected readonly t = this.state.t;
  protected readonly steps = EXPORT_STEPS;
  protected readonly tree = EXPORT_TREE;
  protected readonly archiveName = EXPORT_ARCHIVE_NAME;

  protected readonly selection = signal<readonly string[]>(INITIAL_EXPORT_SELECTION);
  protected readonly includeSchedules = signal(true);
  protected readonly includeReleaseState = signal(true);
  /** Run progress in percent; a scripted run (`istep=run`) shows the fixed value. */
  protected readonly progress = signal(this.state.exportStep() === 'run' ? EXPORT_RUN_PROGRESS : 0);
  private timer: ReturnType<typeof setInterval> | null = null;

  protected readonly counts = computed(() => exportCounts(new Set(this.selection())));
  protected readonly summary = computed(() => {
    const parts = [...this.counts()].map(([store, n]) => this.t('export.storeCount', { store: this.t(`stores.${store}`), n }));
    return parts.length ? this.t('export.summary', { parts: parts.join(' · ') }) : this.t('export.nothing');
  });
  protected readonly archiveSize = computed(() => this.t('export.size', { mb: (EXPORT_ARCHIVE_SIZE / 1_000_000).toFixed(1) }));
  /** The store being exported at the current progress (for the run's status line). */
  protected readonly runningStore = computed(() => {
    const stores = [...this.counts().keys()];
    if (!stores.length) {
      return '';
    }
    const index = Math.min(stores.length - 1, Math.floor((this.progress() / 100) * stores.length));
    return this.t(`stores.${stores[index]}`);
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  protected index(step: ExportStep): number {
    return this.state.stepIndex(step);
  }

  /** Select and Options can be revisited until the export runs. */
  protected reachable(step: ExportStep): boolean {
    const current = this.state.exportStep();
    return (step === 'select' || step === 'options') && (current === 'select' || current === 'options');
  }

  protected go(step: ExportStep): void {
    this.state.exportStep.set(step);
  }

  protected start(): void {
    this.stop();
    this.progress.set(0);
    this.state.exportStep.set('run');
    this.timer = setInterval(() => {
      const next = Math.min(100, this.progress() + EXPORT_TICK_STEP);
      this.progress.set(next);
      if (next >= 100) {
        this.stop();
        this.state.exportStep.set('result');
      }
    }, EXPORT_TICK_MS);
  }

  protected cancel(): void {
    this.stop();
    this.state.exportStep.set('options');
  }

  protected restart(): void {
    this.progress.set(0);
    this.state.exportStep.set('select');
  }

  protected download(): void {
    this.state.notice();
  }

  private stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
