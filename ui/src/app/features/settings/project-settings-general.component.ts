import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiClient } from '../../core/api/api.client';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectSettingsCodeHighlightingComponent } from './project-settings-code-highlighting.component';
import type { components } from '../../core/api/generated/schema.d.ts';

/** General project settings: display name and description, and the code highlighting overrides (M33 follow-up). */
@Component({
  selector: 'sf-project-settings-general',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    SfButtonComponent,
    SfFieldComponent,
    SfSpinnerComponent,
    ProjectSettingsCodeHighlightingComponent,
  ],
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
  /** The code highlighting overrides the server holds. */
  protected readonly codeHighlighting = signal<components['schemas']['CodeHighlightingView'] | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    description: [''],
  });

  /** The values the server holds, as last loaded or saved. */
  private readonly saved = signal({ name: '', description: '' });
  private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  /** Save is offered only for a real change (lessons: gate on dirty as well as valid). */
  protected readonly changed = computed(() => {
    const value = this.value();
    const saved = this.saved();
    return (value.name ?? '').trim() !== saved.name || (value.description ?? '').trim() !== saved.description;
  });

  ngOnInit(): void {
    this.api.getProject(this.projectKey()).subscribe({
      next: (project) => {
        const loaded = { name: project.name ?? '', description: project.description ?? '' };
        this.saved.set({ name: loaded.name.trim(), description: loaded.description.trim() });
        this.form.reset(loaded);
        this.codeHighlighting.set(project.codeHighlighting ?? null);
        this.loading.set(false);
      },
      error: () => {
        this.toast.show('Could not load project settings — check your connection and try again.', 'error');
        this.loading.set(false);
      },
    });
  }

  /** Code highlighting saved: the editors read the overrides from the project context. */
  protected onCodeHighlightingSaved(): void {
    this.store.loadFor(this.projectKey(), true).subscribe();
  }

  protected save(): void {
    if (this.form.invalid || !this.changed() || this.saving() || this.readOnly()) {
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
          this.saved.set({ name: value.name.trim(), description: value.description.trim() });
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
