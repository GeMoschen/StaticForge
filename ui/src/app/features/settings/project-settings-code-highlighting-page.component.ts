import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { ProjectSettingsCodeHighlightingComponent } from './project-settings-code-highlighting.component';

/** Settings › Code highlighting: loads the project's overrides for {@link ProjectSettingsCodeHighlightingComponent}. */
@Component({
  selector: 'sf-project-settings-code-highlighting-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProjectSettingsCodeHighlightingComponent, SfSpinnerComponent],
  template: `
    @if (loading()) {
      <sf-spinner />
    } @else {
      <sf-project-settings-code-highlighting
        [projectKey]="projectKey()"
        [overrides]="overrides()"
        (saved)="onSaved()"
      />
    }
  `,
  styles: ':host { display: block; padding: var(--sf-4); max-width: 40rem; }',
})
export class ProjectSettingsCodeHighlightingPageComponent implements OnInit {
  readonly projectKey = input.required<string>();

  private readonly api = inject(ApiClient);
  private readonly store = inject(ProjectContextStore);
  private readonly toast = inject(ToastService);

  protected readonly loading = signal(true);
  protected readonly overrides = signal<components['schemas']['CodeHighlightingView'] | null>(null);

  ngOnInit(): void {
    this.api.getProject(this.projectKey()).subscribe({
      next: (project) => {
        this.overrides.set(project.codeHighlighting ?? null);
        this.loading.set(false);
      },
      error: () => {
        this.toast.show('Could not load code highlighting — check your connection and try again.', 'error');
        this.loading.set(false);
      },
    });
  }

  /** The editors read the overrides from the project context. */
  protected onSaved(): void {
    this.store.loadFor(this.projectKey(), true).subscribe();
  }
}
