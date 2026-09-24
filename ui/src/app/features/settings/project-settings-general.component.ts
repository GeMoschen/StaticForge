import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiClient } from '../../core/api/api.client';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { ProjectAccessStore } from '../../core/project/project-access.store';

/** General project settings: display name and description. */
@Component({
  selector: 'sf-project-settings-general',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfButtonComponent, SfFieldComponent, SfSpinnerComponent],
  templateUrl: './project-settings-general.component.html',
  styleUrl: './project-settings-general.component.scss',
})
export class ProjectSettingsGeneralComponent implements OnInit {
  readonly projectKey = input.required<string>();

  private readonly api = inject(ApiClient);
  private readonly store = inject(ProjectContextStore);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  /** Time travel or an archived project (M26). */
  protected readonly readOnly = inject(ProjectAccessStore).readOnly;

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    description: [''],
  });

  ngOnInit(): void {
    this.api.getProject(this.projectKey()).subscribe({
      next: (project) => {
        this.form.reset({ name: project.name ?? '', description: project.description ?? '' });
        this.loading.set(false);
      },
      error: () => {
        this.toast.show('Could not load project settings — check your connection and try again.', 'error');
        this.loading.set(false);
      },
    });
  }

  protected save(): void {
    if (this.form.invalid || this.saving() || this.readOnly()) {
      return;
    }
    const key = this.projectKey();
    const value = this.form.getRawValue();
    const current = this.store.project();
    this.saving.set(true);
    this.api
      .updateProject(key, {
        name: value.name.trim(),
        description: value.description.trim() || undefined,
        allowedMimeTypes: current?.allowedMimeTypes,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.show('Project settings saved', 'success');
          this.store.loadFor(key, true).subscribe();
        },
        error: () => {
          this.saving.set(false);
          this.toast.show('Could not save project settings — try again in a moment.', 'error');
        },
      });
  }
}
