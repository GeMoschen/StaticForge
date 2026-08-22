import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  inject,
  input,
  signal,
} from '@angular/core';
import { Subscription } from 'rxjs';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AuthStore } from '../../core/auth/auth.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfRelativeTimePipe } from '../../shared/pipes/sf-relative-time.pipe';
import { GenerationService } from './generation.service';
import { GenerationDialogComponent } from './generation-dialog.component';
import { GenerationRunEvent } from './generation-sse';

type GenerationRunView = components['schemas']['GenerationRunView'];
type GenerationTargetView = components['schemas']['GenerationTargetView'];

interface LogLine {
  id: number;
  stage: string;
  message: string;
}

interface LiveSummary {
  filesWritten: number;
  errors: number;
  warnings: number;
}

@Component({
  selector: 'sf-generation',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfButtonComponent,
    SfEmptyStateComponent,
    SfSpinnerComponent,
    SfRelativeTimePipe,
    GenerationDialogComponent,
  ],
  templateUrl: './generation.component.html',
  styleUrl: './generation.component.scss',
})
export class GenerationComponent implements OnDestroy {
  readonly projectKey = input.required<string>();

  private readonly api = inject(GenerationService);
  private readonly auth = inject(AuthStore);
  private readonly toasts = inject(ToastService);

  readonly runs = signal<GenerationRunView[]>([]);
  readonly loading = signal(false);
  readonly dialogOpen = signal(false);
  readonly targets = signal<GenerationTargetView[]>([]);

  readonly liveRunId = signal<number | null>(null);
  readonly liveActive = signal(false);
  readonly liveLines = signal<LogLine[]>([]);
  readonly liveSummary = signal<LiveSummary>({
    filesWritten: 0,
    errors: 0,
    warnings: 0,
  });

  private liveSub: Subscription | null = null;

  trackRun(index: number, run: GenerationRunView): number {
    return run.id ?? index;
  }

  load(): void {
    this.loading.set(true);
    this.api.history(this.projectKey()).subscribe({
      next: (runs) => {
        this.runs.set(runs ?? []);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  openDialog(): void {
    this.dialogOpen.set(true);
    this.api.listTargets(this.projectKey()).subscribe({
      next: (targets) => this.targets.set(targets ?? []),
      error: () => this.targets.set([]),
    });
  }

  onStarted(run: GenerationRunView): void {
    this.dialogOpen.set(false);
    this.runs.update((list) => {
      const rest = list.filter((r) => r.id !== run.id);
      return [run, ...rest];
    });
    this.toasts.show('Generation started', 'success');
    this.watchLive(run);
  }

  onDialogCancelled(): void {
    this.dialogOpen.set(false);
  }

  statusColor(status?: string): string {
    switch (status) {
      case 'SUCCESS':
        return 'var(--sf-jade)';
      case 'PARTIAL':
        return 'var(--sf-amber)';
      case 'FAILED':
        return 'var(--sf-rust)';
      case 'RUNNING':
      case 'QUEUED':
        return 'var(--sf-signal)';
      case 'CANCELLED':
        return 'var(--sf-slate)';
      default:
        return 'var(--sf-slate)';
    }
  }

  promote(run: GenerationRunView): void {
    const id = run.id ?? 0;
    this.api.promote(this.projectKey(), id).subscribe({
      next: () => this.toasts.show('Generation promoted', 'success'),
      error: () => this.toasts.show('Could not promote generation — try again in a moment.', 'error'),
    });
  }

  rollback(run: GenerationRunView): void {
    const id = run.id ?? 0;
    this.api.promote(this.projectKey(), id).subscribe({
      next: () => this.toasts.show('Rolled back to previous generation', 'success'),
      error: () => this.toasts.show('Could not roll back — try again in a moment.', 'error'),
    });
  }

  cancel(run: GenerationRunView): void {
    const id = run.id ?? 0;
    this.api.cancel(this.projectKey(), id).subscribe({
      next: () => {
        this.toasts.show('Generation cancelled', 'info');
        this.refreshRun(id);
      },
      error: () => this.toasts.show('Could not cancel generation — it may have already finished.', 'error'),
    });
  }

  watchLive(run: GenerationRunView): void {
    const token = this.auth.accessToken();
    if (!token) {
      this.toasts.show('Not authenticated', 'error');
      return;
    }
    const id = run.id ?? 0;
    this.closeLive();
    this.liveRunId.set(id);
    this.liveLines.set([]);
    this.liveSummary.set({ filesWritten: 0, errors: 0, warnings: 0 });
    this.liveActive.set(true);
    this.liveSub = this.api.connectEvents(this.projectKey(), id, token).subscribe({
      next: (event) => this.onLiveEvent(event),
      error: () => this.liveDone(),
      complete: () => this.liveDone(),
    });
  }

  closeLive(): void {
    if (this.liveSub) {
      this.liveSub.unsubscribe();
      this.liveSub = null;
    }
    this.liveActive.set(false);
    this.liveRunId.set(null);
  }

  private onLiveEvent(event: GenerationRunEvent): void {
    this.liveLines.update((list) => [
      ...list,
      { id: list.length, stage: event.stage, message: event.message },
    ]);
    this.liveSummary.set({
      filesWritten: event.filesWritten,
      errors: event.errors,
      warnings: event.warnings,
    });
  }

  private liveDone(): void {
    this.liveSub = null;
    this.liveActive.set(false);
    const id = this.liveRunId();
    if (id !== null) {
      this.refreshRun(id);
    }
    this.liveRunId.set(null);
  }

  private refreshRun(id: number): void {
    this.api.status(this.projectKey(), id).subscribe({
      next: (fresh) => {
        this.runs.update((list) =>
          list.map((r) => (r.id === id ? fresh : r)),
        );
      },
      error: () => {
        /* leave existing row as-is */
      },
    });
  }

  ngOnDestroy(): void {
    this.closeLive();
  }
}
