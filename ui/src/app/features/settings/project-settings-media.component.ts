import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';

/**
 * Per-project override of which media MIME types are accepted on upload — one pattern per
 * line, e.g. `image/*`, `application/pdf`, or a lone `*` to allow everything. Left empty,
 * the project falls back to the instance-wide `sf.media.allowed-mime` default (which is
 * `*` — allow everything — unless an operator has configured it more narrowly).
 */
@Component({
  selector: 'sf-project-settings-media',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent, SfFieldComponent, SfSpinnerComponent],
  templateUrl: './project-settings-media.component.html',
  styleUrl: './project-settings-media.component.scss',
})
export class ProjectSettingsMediaComponent implements OnInit {
  readonly projectKey = input.required<string>();

  private readonly api = inject(ApiClient);
  private readonly store = inject(ProjectContextStore);
  private readonly toast = inject(ToastService);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly patterns = signal('');
  private name = '';
  private description: string | undefined;

  ngOnInit(): void {
    this.api.getProject(this.projectKey()).subscribe({
      next: (project) => {
        this.name = project.name ?? '';
        this.description = project.description ?? undefined;
        this.patterns.set((project.allowedMimeTypes ?? []).join('\n'));
        this.loading.set(false);
      },
      error: () => {
        this.toast.show('Could not load media settings — check your connection and try again.', 'error');
        this.loading.set(false);
      },
    });
  }

  protected onPatternsInput(event: Event): void {
    this.patterns.set((event.target as HTMLTextAreaElement).value);
  }

  protected save(): void {
    if (this.saving()) {
      return;
    }
    const key = this.projectKey();
    const allowedMimeTypes = this.patterns()
      .split('\n')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    this.saving.set(true);
    this.api
      .updateProject(key, { name: this.name, description: this.description, allowedMimeTypes })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.show('Media settings saved', 'success');
          this.store.loadFor(key, true).subscribe();
        },
        error: () => {
          this.saving.set(false);
          this.toast.show('Could not save media settings — try again in a moment.', 'error');
        },
      });
  }
}
