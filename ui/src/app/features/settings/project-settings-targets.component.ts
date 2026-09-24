import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfTableComponent } from '../../shared/components/sf-table.component';
import { GenerationService } from '../generation/generation.service';
import { ProjectAccessStore } from '../../core/project/project-access.store';

type GenerationTargetView = components['schemas']['GenerationTargetView'];
type GenerationTargetRequest = components['schemas']['GenerationTargetRequest'];
type JsonNode = components['schemas']['JsonNode'];

/** Plain view of a target's free-form `config`; keys this form doesn't edit are carried through untouched. */
type TargetConfig = Record<string, unknown>;

const TARGET_TYPES = ['FILESYSTEM', 'ZIP', 'S3'] as const;

const configOf = (target: GenerationTargetView | null): TargetConfig =>
  (target?.config as TargetConfig | undefined) ?? {};

const textOf = (config: TargetConfig, key: string): string =>
  typeof config[key] === 'string' ? (config[key] as string) : '';

/**
 * Project settings tab: "Targets" — the output destinations generation runs publish to
 * (spec §18.4). Each target writes into its own directory under the server's output root,
 * `{projectKey}/{path}` (or `{projectKey}/target-{id}` when no path is set).
 */
@Component({
  selector: 'sf-project-settings-targets',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    SfButtonComponent,
    SfEmptyStateComponent,
    SfFieldComponent,
    SfSpinnerComponent,
    SfTableComponent,
  ],
  templateUrl: './project-settings-targets.component.html',
  styleUrl: './project-settings-targets.component.scss',
})
export class ProjectSettingsTargetsComponent {
  readonly projectKey = input.required<string>();

  private readonly api = inject(GenerationService);
  private readonly toasts = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  /** Time travel or an archived project (M26). */
  protected readonly readOnly = inject(ProjectAccessStore).readOnly;
  protected readonly types = TARGET_TYPES;

  readonly targets = signal<GenerationTargetView[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  readonly formOpen = signal(false);
  readonly editing = signal<GenerationTargetView | null>(null);
  readonly confirmDelete = signal<GenerationTargetView | null>(null);

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    type: ['FILESYSTEM'],
    path: [''],
    baseUrl: [''],
    isDefault: [false],
  });

  constructor() {
    effect(() => {
      this.projectKey();
      untracked(() => this.reload());
    });
  }

  reload(): void {
    this.loading.set(true);
    this.api.listTargets(this.projectKey()).subscribe({
      next: (list) => {
        this.targets.set(list ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toasts.show('Could not load generation targets — check your connection and try again.', 'error');
      },
    });
  }

  baseUrlOf(target: GenerationTargetView): string {
    return textOf(configOf(target), 'baseUrl');
  }

  pathHint(): string {
    const hint = `Relative to ${this.projectKey()}/ in the server output root. Leave empty for ${this.pathPlaceholder()}.`;
    return this.editing()
      ? `${hint} Changing it or the type starts a fresh folder; earlier runs can then no longer be promoted.`
      : hint;
  }

  /** Placeholder for the path input: what an empty path resolves to. */
  pathPlaceholder(): string {
    const id = this.editing()?.id;
    return id != null ? `target-${id}` : 'target-<id>';
  }

  openCreate(): void {
    if (this.readOnly()) {
      return;
    }
    this.editing.set(null);
    this.error.set(null);
    this.form.reset({
      name: '',
      type: 'FILESYSTEM',
      path: '',
      baseUrl: '',
      // The first target becomes the default so generation works without a second step.
      isDefault: this.targets().length === 0,
    });
    this.formOpen.set(true);
  }

  openEdit(target: GenerationTargetView): void {
    if (this.readOnly()) {
      return;
    }
    const config = configOf(target);
    this.editing.set(target);
    this.error.set(null);
    this.form.reset({
      name: target.name ?? '',
      type: target.type ?? 'FILESYSTEM',
      path: textOf(config, 'path'),
      baseUrl: textOf(config, 'baseUrl'),
      isDefault: target.isDefault ?? false,
    });
    this.formOpen.set(true);
  }

  closeForm(): void {
    this.formOpen.set(false);
    this.editing.set(null);
    this.error.set(null);
  }

  submit(): void {
    if (this.form.invalid || this.submitting() || this.readOnly()) {
      return;
    }
    const editing = this.editing();
    const value = this.form.getRawValue();
    const config: TargetConfig = { ...configOf(editing) };
    setOrDelete(config, 'path', value.path.trim());
    setOrDelete(config, 'baseUrl', value.baseUrl.trim());
    const req: GenerationTargetRequest = {
      name: value.name.trim(),
      type: value.type,
      config: config as JsonNode,
      isDefault: value.isDefault,
    };

    this.submitting.set(true);
    this.error.set(null);
    const call =
      editing?.id != null
        ? this.api.updateTarget(this.projectKey(), editing.id, req)
        : this.api.createTarget(this.projectKey(), req);
    call.subscribe({
      next: () => {
        this.submitting.set(false);
        this.closeForm();
        this.toasts.show(editing ? 'Target updated' : 'Target created', 'success');
        // Reload rather than patching locally: saving a default clears the flag on the others server-side.
        this.reload();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(describeError(err) ?? 'Could not save target — try again in a moment.');
      },
    });
  }

  requestDelete(target: GenerationTargetView): void {
    if (this.readOnly()) {
      return;
    }
    this.confirmDelete.set(target);
  }

  confirmDeleteAction(): void {
    const target = this.confirmDelete();
    if (target?.id == null || this.submitting() || this.readOnly()) {
      return;
    }
    const id = target.id;
    this.submitting.set(true);
    this.api.deleteTarget(this.projectKey(), id).subscribe({
      next: () => {
        this.targets.update((list) => list.filter((t) => t.id !== id));
        this.submitting.set(false);
        this.confirmDelete.set(null);
        this.toasts.show('Target deleted', 'success');
      },
      error: (err) => {
        this.submitting.set(false);
        this.confirmDelete.set(null);
        this.toasts.show(describeError(err) ?? 'Could not delete target — try again in a moment.', 'error');
      },
    });
  }
}

function setOrDelete(config: TargetConfig, key: string, value: string): void {
  if (value) {
    config[key] = value;
  } else {
    delete config[key];
  }
}

function describeError(err: unknown): string | null {
  const e = err as { status?: number; error?: { detail?: string } };
  if (e?.status === 403) {
    return 'You do not have permission to change generation targets in this project.';
  }
  return e?.error?.detail ?? null;
}
