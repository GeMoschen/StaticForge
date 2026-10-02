import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { GenerationComponent } from '../generation/generation.component';

/** Publishing › Runs: the run list, a run's details and the *Build now* dialog (they belong to `sf-generation`). */
@Component({
  selector: 'sf-publishing-runs',
  standalone: true,
  imports: [GenerationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<sf-generation [projectKey]="projectKey()" [openRun]="runId()" [openTab]="tab() ?? null" />`,
  styles: ':host { display: block; }',
})
export class PublishingRunsComponent {
  readonly projectKey = input.required<string>();
  /** `?run=` opens that run's details (the Schedules history links a run it started, M27.6.5). */
  readonly run = input<string | undefined>();
  /** `?tab=findings` opens that run's findings (M30.6.2): a shared findings view. */
  readonly tab = input<string | undefined>();
  protected readonly runId = computed(() => (this.run() ? Number(this.run()) : null));
}
