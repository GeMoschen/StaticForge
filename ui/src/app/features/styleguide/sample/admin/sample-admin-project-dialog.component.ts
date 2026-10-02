import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../../shared/components/dialog/sf-dialog.component';
import { SfInputComponent } from '../../../../shared/components/forms/sf-input.component';
import { SfTextareaComponent } from '../../../../shared/components/forms/sf-textarea.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { AdminProject } from './admin-data';
import { AdminState } from './admin-state';

/** A project key: starts with a lower case letter, then lower case letters, digits and dashes (2–32 characters). */
export const PROJECT_KEY_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

/**
 * The *New project* dialog of Administration › Projects (M35.16): the project key (lower case, checked as you type — an
 * error shows once something is typed and is wrong, or the key is taken), the name and an optional description. **Create
 * project** stays disabled until the key and the name are valid. Nothing is saved; the project is added in memory.
 */
@Component({
  selector: 'sf-sample-admin-project-dialog',
  standalone: true,
  imports: [SfButtonComponent, SfDialogComponent, SfDialogFooterDirective, SfFieldComponent, SfInputComponent, SfTextareaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-admin-project-dialog.component.html',
  styleUrl: './sample-admin-project-dialog.component.scss',
})
export class SampleAdminProjectDialogComponent implements OnInit {
  /** The project to edit; without one the dialog creates a project. */
  readonly project = input<AdminProject | null>(null);
  readonly created = output<AdminProject>();
  readonly edited = output<AdminProject>();
  readonly closed = output<void>();

  protected readonly admin = inject(AdminState);
  protected readonly t = this.admin.t;

  protected readonly key = signal('');
  protected readonly name = signal('');
  protected readonly description = signal('');

  protected readonly editing = computed(() => this.project() !== null);

  ngOnInit(): void {
    const project = this.project();
    if (project) {
      this.key.set(project.key);
      this.name.set(project.name);
      this.description.set(project.description);
    }
  }

  /** Why the key is wrong; `null` while it is empty (nothing to say yet) or fine. */
  protected readonly keyError = computed(() => {
    const key = this.key();
    if (key === '' || this.editing()) {
      return null;
    }
    if (!PROJECT_KEY_PATTERN.test(key)) {
      return this.t(key !== key.toLowerCase() ? 'newProject.keyLower' : 'newProject.keyFormat');
    }
    return this.admin.projectByKey(key) ? this.t('newProject.keyTaken') : null;
  });
  /** Editing: the name or description changed. */
  protected readonly changed = computed(() => {
    const p = this.project();
    return p !== null && (this.name().trim() !== p.name || this.description().trim() !== p.description);
  });
  protected readonly valid = computed(() =>
    this.editing() ? this.changed() && this.name().trim() !== '' : this.key() !== '' && this.keyError() === null && this.name().trim() !== '',
  );

  protected submit(): void {
    if (!this.valid()) {
      return;
    }
    const existing = this.project();
    if (existing) {
      const next = { ...existing, name: this.name().trim(), description: this.description().trim() };
      this.edited.emit(next);
      this.admin.notice(this.t('editProject.saved', { name: next.name }));
      this.closed.emit();
      return;
    }
    const project: AdminProject = {
      key: this.key(),
      name: this.name().trim(),
      description: this.description().trim(),
      lastChangeMinutes: null,
      revision: null,
      archived: false,
    };
    this.created.emit(project);
    this.admin.notice(this.t('newProject.created', { name: project.name }));
    this.closed.emit();
  }
}
