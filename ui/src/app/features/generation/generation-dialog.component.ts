import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import {
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ChannelsService } from '../channels/channels.service';
import type { components } from '../../core/api/generated/schema.d.ts';
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
  imports: [ReactiveFormsModule, RouterLink, SfButtonComponent, SfFieldComponent, SfIconComponent],
  templateUrl: './generation-dialog.component.html',
  styleUrl: './generation-dialog.component.scss',
})
export class GenerationDialogComponent {
  readonly projectKey = input.required<string>();
  readonly targets = input<GenerationTargetView[]>([]);
  readonly started = output<GenerationRunView>();
  readonly cancelled = output<void>();

  private readonly api = inject(GenerationService);
  private readonly channelsApi = inject(ChannelsService);
  private readonly toasts = inject(ToastService);

  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  /** The project's enabled channels — only those can be generated. */
  readonly channelOptions = signal<string[]>([]);

  readonly form = new FormGroup<GenerationForm>({
    mode: new FormControl<GenerationMode>('FULL', { nonNullable: true }),
    targetId: new FormControl<number | null>(null),
    comment: new FormControl('', { nonNullable: true }),
    channels: new FormArray<FormControl<boolean>>([]),
  });

  constructor() {
    effect(() => {
      const key = this.projectKey();
      untracked(() => this.loadChannels(key));
    });
  }

  private loadChannels(projectKey: string): void {
    this.channelsApi.list(projectKey).subscribe({
      next: (list) => {
        const keys = (list ?? []).filter((c) => c.enabled && c.key).map((c) => c.key as string);
        const controls = this.form.controls.channels;
        controls.clear();
        keys.forEach(() => controls.push(new FormControl<boolean>(true, { nonNullable: true })));
        this.channelOptions.set(keys);
      },
      // Leave the list empty: a request without channels generates every enabled channel.
      error: () => this.channelOptions.set([]),
    });
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
