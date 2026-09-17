import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable, map } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import { ChannelsService } from '../channels/channels.service';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { parseDiagnostics } from './generation-diagnostics';
import {
  GenerationService,
  StartGenerationRequest,
} from './generation.service';
import {
  count,
  fallbackWarning,
  planRequestKey,
  rootKindRows,
  viaRows,
  type EntryPage,
  type GenerationPlanView,
  type PlanEntryQuery,
} from './insight/insight.util';
import {
  PLAN_ENTRIES_PAGE_SIZE,
  SfPlanEntriesTableComponent,
} from './insight/sf-plan-entries-table.component';

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
  imports: [ReactiveFormsModule, RouterLink, SfButtonComponent, SfFieldComponent, SfIconComponent, SfPlanEntriesTableComponent],
  templateUrl: './generation-dialog.component.html',
  styleUrl: './generation-dialog.component.scss',
  host: { '(keydown.alt.p)': 'onPreviewShortcut($event)' },
})
export class GenerationDialogComponent {
  readonly projectKey = input.required<string>();
  readonly targets = input<GenerationTargetView[]>([]);
  readonly started = output<GenerationRunView>();
  readonly cancelled = output<void>();

  private readonly api = inject(GenerationService);
  private readonly apiClient = inject(ApiClient);
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

  // ------------------------------------------------------------------
  // Plan preview (M22.3.1)
  // ------------------------------------------------------------------

  readonly validate = signal(false);
  readonly planning = signal(false);
  readonly planError = signal<string | null>(null);
  readonly plan = signal<GenerationPlanView | null>(null);
  readonly showChanged = signal(false);
  /** The request the shown preview was computed for. */
  private readonly planKey = signal<string | null>(null);
  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  private readonly requestKey = computed(() => {
    this.formValue();
    this.channelOptions();
    return planRequestKey(this.buildRequest());
  });
  /** The form changed since the preview: it no longer describes what Start would do. */
  readonly stale = computed(() => this.plan() !== null && this.planKey() !== this.requestKey());
  readonly fallback = computed(() => {
    const plan = this.plan();
    return plan?.summary?.fallbackCause ? fallbackWarning(plan.summary.fallbackCause, plan.target?.name) : null;
  });
  readonly rootKinds = computed(() => rootKindRows(this.plan()?.summary));
  readonly rootKindKeys = computed(() => this.rootKinds().map((row) => row.key));
  readonly via = computed(() => viaRows(this.plan()?.summary));
  readonly diagnostics = computed(() => parseDiagnostics(this.plan()?.diagnostics));
  readonly counts = computed(() => {
    const summary = this.plan()?.summary;
    return summary
      ? `${count(summary.entryCount, 'file')} to rebuild · ${count(summary.pageCount, 'page')} · ` +
          `${count(summary.changedAssetCount, 'changed asset')}`
      : '';
  });
  /** The request of the shown preview, for its entries table; a new preview reloads the table. */
  private readonly previewRequest = signal<StartGenerationRequest | null>(null);
  readonly fetchEntries = computed(() => {
    const request = this.previewRequest();
    const projectKey = this.projectKey();
    return (query: PlanEntryQuery): Observable<EntryPage | undefined> =>
      request === null
        ? new Observable<EntryPage | undefined>((subscriber) => subscriber.complete())
        : this.api.planGeneration(projectKey, request, query).pipe(map((plan) => plan.entries));
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

  private buildRequest(): StartGenerationRequest {
    const channels = this.channelOptions().filter(
      (_, index) => this.form.controls.channels.at(index)?.value ?? false,
    );
    return {
      mode: this.form.controls.mode.value ?? 'FULL',
      targetId: this.form.controls.targetId.value ?? undefined,
      comment: this.form.controls.comment.value.trim() || undefined,
      ...(channels.length > 0 ? { channels } : {}),
    };
  }

  onPreviewShortcut(event: Event): void {
    event.preventDefault();
    this.preview();
  }

  onValidateChange(event: Event): void {
    this.validate.set((event.target as HTMLInputElement).checked);
  }

  /** Dry-runs the current form values: the summary here, the entries in the table below. */
  preview(): void {
    if (this.planning()) {
      return;
    }
    const request = this.buildRequest();
    const key = planRequestKey(request);
    this.planning.set(true);
    this.planError.set(null);
    this.api.planGeneration(this.projectKey(), request, { page: 0, size: PLAN_ENTRIES_PAGE_SIZE }, this.validate()).subscribe({
      next: (plan) => {
        this.planning.set(false);
        this.plan.set(plan);
        this.planKey.set(key);
        this.showChanged.set(false);
        this.previewRequest.set(request);
      },
      error: (err: unknown) => {
        this.planning.set(false);
        this.planError.set(this.describeError(err, 'Could not preview the plan — check a target is configured.'));
      },
    });
  }

  submit(): void {
    if (this.submitting()) {
      return;
    }
    const req = this.buildRequest();
    const previewed = this.stale() ? null : this.plan();

    this.submitting.set(true);
    this.error.set(null);
    this.api.start(this.projectKey(), req).subscribe({
      next: (run) => {
        this.submitting.set(false);
        this.started.emit(run);
        if (previewed?.summary?.revision != null) {
          this.warnIfPreviewOutdated(previewed.summary.revision);
        }
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.error.set(this.describeError(err, 'Could not start generation — check a target is configured.'));
      },
    });
  }

  /** Content saved after the preview makes the run plan more than the preview showed; say so, never block. */
  private warnIfPreviewOutdated(previewRevision: number): void {
    this.apiClient.listRevisions(this.projectKey()).subscribe({
      next: (revisions) => {
        const head = Math.max(0, ...(revisions ?? []).map((revision) => revision.revisionId ?? 0));
        if (head > previewRevision) {
          this.toasts.show(
            `Plan preview is out of date: it showed revision ${previewRevision}, the run plans revision ${head}.`,
            'warning',
          );
        }
      },
      error: () => {
        /* the run started; the check is only a hint */
      },
    });
  }

  private describeError(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse && err.status === 409) {
      this.toasts.show('A generation is already running', 'warning');
      return 'Another generation is currently running.';
    }
    const e = err as {
      message?: string;
      error?: { detail?: string; message?: string };
    };
    return e?.error?.detail ?? e?.error?.message ?? e?.message ?? fallback;
  }
}
