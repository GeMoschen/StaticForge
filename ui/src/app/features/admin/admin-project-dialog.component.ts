import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { switchMap } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import { problemOf } from '../../core/api/problem.util';
import { SfDialogComponent, SfDialogFooterDirective } from '../../shared/components/dialog/sf-dialog.component';
import { SfInputComponent } from '../../shared/components/forms/sf-input.component';
import { SfTextareaComponent } from '../../shared/components/forms/sf-textarea.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { AdminProjectRow, projectKeyProblem } from './admin-projects.util';

/**
 * *New project* and *Edit project…* of Administration › Projects (M35.16). New: the key is checked as you type (an error
 * shows once something is typed and is wrong, or the key is taken) and a server refusal is shown under it; *Create
 * project* stays disabled until key and name are valid. Edit: the name and the description; the key is shown and cannot
 * change; *Save* stays disabled until something changed. Closes itself after a successful call.
 */
@Component({
  selector: 'sf-admin-project-dialog',
  standalone: true,
  imports: [SfButtonComponent, SfDialogComponent, SfDialogFooterDirective, SfFieldComponent, SfInputComponent, SfTextareaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-project-dialog.component.html',
  styleUrl: './admin-project-dialog.component.scss',
})
export class AdminProjectDialogComponent implements OnInit {
  /** The project to edit; without one the dialog creates a project. */
  readonly project = input<AdminProjectRow | null>(null);
  /** The keys that exist, so a new key can be refused before the server is asked. */
  readonly takenKeys = input<readonly string[]>([]);
  /** The project was created or saved: the list reloads. */
  readonly done = output<string>();
  readonly closed = output<void>();

  private readonly api = inject(ApiClient);
  private readonly transloco = inject(TranslocoService);

  protected readonly key = signal('');
  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly busy = signal(false);
  /** What the server said was wrong with the key (a key it already has, a format it refused). */
  protected readonly serverKeyError = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);

  protected readonly editing = computed(() => this.project() !== null);

  protected readonly keyError = computed(() => {
    if (this.editing()) {
      return null;
    }
    const problem = projectKeyProblem(this.key(), this.takenKeys());
    return problem ? this.t(problem) : this.serverKeyError();
  });
  private readonly changed = computed(() => {
    const p = this.project();
    return p !== null && (this.name().trim() !== (p.name ?? '') || this.description().trim() !== (p.description ?? ''));
  });
  protected readonly valid = computed(
    () => this.name().trim() !== '' && (this.editing() ? this.changed() : this.key() !== '' && this.keyError() === null),
  );

  ngOnInit(): void {
    const project = this.project();
    if (project) {
      this.key.set(project.key ?? '');
      this.name.set(project.name ?? '');
      this.description.set(project.description ?? '');
    }
  }

  protected setKey(value: string): void {
    this.key.set(value);
    this.serverKeyError.set(null);
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`admin.projects.dialog.${key}`, params);
  }

  protected submit(): void {
    if (!this.valid() || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.failure.set(null);
    const name = this.name().trim();
    const description = this.description().trim();
    const existing = this.project();
    const request = existing
      ? // The update replaces the project's MIME type override, so it is read first and sent back unchanged.
        this.api
          .getProject(existing.key!)
          .pipe(switchMap((detail) => this.api.updateProject(existing.key!, { name, description, allowedMimeTypes: detail.allowedMimeTypes })))
      : this.api.createProject({ key: this.key(), name, description });
    request.subscribe({
      next: () => {
        this.busy.set(false);
        this.done.emit(name);
        this.closed.emit();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        const problem = problemOf(err, this.t('failed'));
        if (!existing && (problem.status === 409 || problem.status === 422)) {
          this.serverKeyError.set(problem.detail);
        } else {
          this.failure.set(problem.detail);
        }
      },
    });
  }
}
