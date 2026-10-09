import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ToastService } from '../../core/ui/toast.service';
import { GenerationService } from './generation.service';
import type { GenerationRunView } from '../publishing/runs/runs.util';

/**
 * "Build now" after a release (M28.3.3, epic decision 14). A release only changes what the next build renders; this
 * offers that build — incremental, to the default target, unscoped — as a separate explicit action, to whoever may
 * start one. Starting it links to the run's progress on the generation screen.
 */
@Injectable({ providedIn: 'root' })
export class BuildNowService {
  private readonly generation = inject(GenerationService);
  private readonly permissions = inject(ProjectPermissionsStore);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  /** Emits each run this service started, so the top bar's build status can show it at once. */
  readonly started = new Subject<GenerationRunView>();

  /** Shows `message` as a success toast, with "Build now" when the caller may start an incremental build. */
  announceRelease(projectKey: string, message: string): void {
    if (!this.permissions.canIncrementalBuild()) {
      this.toasts.show(message, 'success');
      return;
    }
    this.toasts.show(`${message} Build now to put it online.`, 'success', {
      label: 'Build now',
      run: () => this.start(projectKey, undefined, 'RELEASE'),
    });
  }

  /** Starts the incremental build to the default target and offers its progress. */
  start(projectKey: string, comment = 'Build after release', trigger: 'MANUAL' | 'RELEASE' = 'MANUAL'): void {
    this.generation.start(projectKey, { mode: 'INCREMENTAL', comment, trigger }).subscribe({
      next: (run) => {
        this.started.next(run);
        this.toasts.show(`Build #${run.id} started.`, 'success', {
          label: 'Show progress',
          run: () => void this.router.navigate(['/p', projectKey, 'publishing', 'runs'], { queryParams: { run: run.id } }),
        });
      },
      error: () => {
        /* the error interceptor toasts why: a build already running (409) or a permission lost meanwhile (403) */
      },
    });
  }
}
