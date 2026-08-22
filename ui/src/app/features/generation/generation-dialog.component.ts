import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import {
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
} from '@angular/forms';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import {
  GenerationService,
  StartGenerationRequest,
} from './generation.service';

type GenerationRunView = components['schemas']['GenerationRunView'];
type GenerationTargetView = components['schemas']['GenerationTargetView'];
type GenerationMode = 'FULL' | 'INCREMENTAL';

const DEFAULT_CHANNELS = ['html', 'markdown'];

interface GenerationForm {
  mode: FormControl<GenerationMode>;
  targetId: FormControl<number | null>;
  comment: FormControl<string>;
  channels: FormArray<FormControl<boolean>>;
}

@Component({
  selector: 'sf-generation-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfButtonComponent, SfFieldComponent, SfIconComponent],
  templateUrl: './generation-dialog.component.html',
  styleUrl: './generation-dialog.component.scss',
})
export class GenerationDialogComponent {
  readonly projectKey = input.required<string>();
  readonly targets = input<GenerationTargetView[]>([]);
  readonly started = output<GenerationRunView>();
  readonly cancelled = output<void>();

  private readonly api = inject(GenerationService);
  private readonly store = inject(ProjectContextStore);
  private readonly toasts = inject(ToastService);

  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  readonly channelOptions = computed<string[]>(() => {
    const set = new Set<string>([...DEFAULT_CHANNELS, ...this.store.channels()]);
    return Array.from(set);
  });

  readonly form = new FormGroup<GenerationForm>({
    mode: new FormControl<GenerationMode>('FULL', { nonNullable: true }),
    targetId: new FormControl<number | null>(null),
    comment: new FormControl('', { nonNullable: true }),
    channels: new FormArray<FormControl<boolean>>([]),
  });

  constructor() {
    for (const channel of this.channelOptions()) {
      this.form.controls.channels.push(
        new FormControl<boolean>(DEFAULT_CHANNELS.includes(channel), {
          nonNullable: true,
        }),
      );
    }
  }

  onBackdrop(): void {
    this.cancelled.emit();
  }

  submit(): void {
    if (this.submitting()) {
      return;
    }
    const channels = this.channelOptions().filter(
      (_, index) => this.form.controls.channels.at(index)?.value ?? false,
    );
    const req: StartGenerationRequest = {
      mode: this.form.controls.mode.value ?? 'FULL',
      targetId: this.form.controls.targetId.value ?? undefined,
      comment: this.form.controls.comment.value.trim() || undefined,
      ...(channels.length > 0 ? { channels } : {}),
    };

    this.submitting.set(true);
    this.error.set(null);
    this.api.start(this.projectKey(), req).subscribe({
      next: (run) => {
        this.submitting.set(false);
        this.started.emit(run);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.error.set(this.describeError(err));
      },
    });
  }

  private describeError(err: unknown): string {
    if (err instanceof HttpErrorResponse && err.status === 409) {
      this.toasts.show('A generation is already running', 'warning');
      return 'Another generation is currently running.';
    }
    const e = err as {
      message?: string;
      error?: { detail?: string; message?: string };
    };
    return (
      e?.error?.detail ?? e?.error?.message ?? e?.message ?? 'Could not start generation — check a target is configured.'
    );
  }
}
