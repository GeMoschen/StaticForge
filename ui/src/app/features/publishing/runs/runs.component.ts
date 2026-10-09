import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfEmptyStateComponent } from '../../../shared/components/sf-empty-state.component';
import { SfSpinnerComponent } from '../../../shared/components/sf-spinner.component';
import { RunDetailComponent } from './run-detail.component';
import { RunsListComponent } from './runs-list.component';
import { RunsStore } from './runs.store';

/**
 * Publishing › Runs (`/p/:key/publishing/runs`, M35.24): the run list or, with `?run=<id>`, that run's detail. Links
 * from the Schedules history, the Redirects and Quality screens and the build toast open a run this way
 * (`?run=7`, with `&rtab=log|findings|rebuilt|summary` for a tab).
 */
@Component({
  selector: 'sf-publishing-runs',
  standalone: true,
  imports: [RunDetailComponent, RunsListComponent, SfEmptyStateComponent, SfSpinnerComponent, TranslocoPipe],
  providers: [RunsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (runId() === null) {
      <sf-runs-list />
    } @else {
      @let run = openRun();
      @if (run) {
        <sf-run-detail [projectKey]="projectKey()" [run]="run" />
      } @else if (store.missing() === runId()) {
        <sf-empty-state
          icon="search_off"
          [title]="'publishing.runs.notFound' | transloco: { id: runId() }"
          [description]="'publishing.runs.notFoundHint' | transloco"
          [primaryLabel]="'publishing.run.back' | transloco"
          (primary)="closeRun()"
        />
      } @else {
        <sf-spinner [label]="'publishing.runs.table' | transloco" />
      }
    }
  `,
  styles: ':host { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; }',
})
export class PublishingRunsComponent {
  readonly projectKey = input.required<string>();
  /** `?run=` — the run to open. */
  readonly run = input<string | undefined>();

  protected readonly store = inject(RunsStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly runId = computed(() => {
    const id = Number(this.run());
    return this.run() && Number.isInteger(id) && id > 0 ? id : null;
  });
  protected readonly openRun = computed(() => {
    const id = this.runId();
    return id === null ? null : (this.store.runs().find((run) => run.id === id) ?? null);
  });

  constructor() {
    effect(() => {
      const key = this.projectKey();
      untracked(() => this.store.open(key));
    });
    effect(() => {
      const id = this.runId();
      this.store.runs();
      this.store.loaded();
      untracked(() => (id === null ? undefined : this.store.ensureRun(id)));
    });
  }

  protected closeRun(): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { run: null, rtab: null }, queryParamsHandling: 'merge' });
  }
}
