import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ToastService } from '../../core/ui/toast.service';
import { GenerationService } from './generation.service';

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

  /** Shows `message` as a success toast, with "Build now" when the caller may start an incremental build. */
  announceRelease(projectKey: string, message: string): void {
    if (!this.permissions.canIncrementalBuild()) {
      this.toasts.show(message, 'success');
      return;
    }
    this.toasts.show(`${message} Build now to put it online.`, 'success', {
      label: 'Build now',
      run: () => this.start(projectKey),
    });
  }

  /** Starts the incremental build to the default target and offers its progress. */
  start(projectKey: string): void {
    this.generation.start(projectKey, { mode: 'INCREMENTAL', comment: 'Build after release' }).subscribe({
      next: (run) =>
        this.toasts.show(`Build #${run.id} started.`, 'success', {
          label: 'Show progress',
          run: () => void this.router.navigate(['/p', projectKey, 'settings', 'generation'], { queryParams: { run: run.id } }),
        }),
      error: () => {
        /* the error interceptor toasts why: a build already running (409) or a permission lost meanwhile (403) */
      },
    });
  }
}
