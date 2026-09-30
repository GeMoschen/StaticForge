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
import { ProjectContextStore } from '../../core/project/project-context.store';
import { SfAssetPickerDialogComponent, type AssetPicked } from '../../shared/components/sf-asset-picker-dialog.component';
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
type FolderView = components['schemas']['FolderView'];
type GenerationMode = 'FULL' | 'INCREMENTAL';

/** A pages folder the scope can be limited to, indented by depth. */
interface FolderOption {
  path: string;
  label: string;
}

/** The pages folders below the store's fixed root, depth first. */
function folderOptions(tree: FolderView[]): FolderOption[] {
  const out: FolderOption[] = [];
  const walk = (nodes: FolderView[], depth: number) => {
    for (const node of nodes) {
      if (node.path && node.type !== 'RECORD_SET') {
        out.push({ path: node.path, label: `${'\u00a0\u00a0'.repeat(depth)}${node.displayName ?? node.uid ?? node.path}` });
      }
      walk(node.children ?? [], depth + 1);
    }
  };
  // The tree's single entry is the protected "All Pages" wrapper: its folders are the choices.
  walk(tree.flatMap((root) => root.children ?? []), 0);
  return out;
}

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
  imports: [
    ReactiveFormsModule,
    RouterLink,
    SfAssetPickerDialogComponent,
    SfButtonComponent,
    SfFieldComponent,
    SfIconComponent,
    SfPlanEntriesTableComponent,
  ],
  templateUrl: './generation-dialog.component.html',
  styleUrl: './generation-dialog.component.scss',
  host: { '(keydown.alt.p)': 'onPreviewShortcut($event)' },
})
export class GenerationDialogComponent {
  readonly projectKey = input.required<string>();
  readonly targets = input<GenerationTargetView[]>([]);
  /**
   * Whether the caller may start full builds and builds to any target (M28.3.3). Without it the run is incremental to
   * the default target: both are shown, not chosen — the server refuses anything else with `403 FULL_BUILD`.
   */
  readonly fullBuild = input(true);
  /** Where a run without a target goes (shown when the target is fixed). */
  readonly defaultTargetId = input<number | null>(null);
  readonly started = output<GenerationRunView>();
  readonly cancelled = output<void>();

  private readonly api = inject(GenerationService);
  private readonly apiClient = inject(ApiClient);
  private readonly channelsApi = inject(ChannelsService);
  private readonly toasts = inject(ToastService);
  private readonly context = inject(ProjectContextStore);

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
  // Scope (M28.3.3): a pages folder and/or single pages; empty builds everything that changed.
  // ------------------------------------------------------------------

  readonly folderOptions = computed(() => folderOptions(this.context.pageFolderTree()));
  readonly scopeFolder = signal('');
  readonly scopePages = signal<AssetPicked[]>([]);
  readonly pickingPage = signal(false);
  readonly defaultTargetName = computed(() => {
    const id = this.defaultTargetId();
    return this.targets().find((t) => t.id === id)?.name ?? 'Default target';
  });

  addPage(page: AssetPicked): void {
    this.pickingPage.set(false);
    this.scopePages.update((pages) => (pages.some((p) => p.uuid === page.uuid) ? pages : [...pages, page]));
  }

  removePage(uuid: string): void {
    this.scopePages.update((pages) => pages.filter((p) => p.uuid !== uuid));
  }

  onScopeFolder(event: Event): void {
    this.scopeFolder.set((event.target as HTMLSelectElement).value);
  }

  // ------------------------------------------------------------------
  // Plan preview (M22.3.1)
  // ------------------------------------------------------------------

  readonly validate = signal(false);
  readonly planning = signal(false);
  readonly planError = signal<string | null>(null);
  readonly plan = signal<GenerationPlanView | null>(null);
  readonly showChanged = signal(false);
  readonly showRedirects = signal(false);
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
  /** The automatic redirects the run would add (M30.4.2): planned pages whose path moved since the target's build. */
  readonly redirectCandidates = computed(() => this.plan()?.redirectCandidates ?? []);
  readonly redirectsToAdd = computed(
    () => `${count(this.plan()?.summary?.redirectsAdded ?? this.redirectCandidates().length, 'redirect')} to add`,
  );
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
    // Without FULL_BUILD the mode and target are fixed: incremental, to the default target. With it the Target select
    // starts on the default target — a `<select>` shows its first option for a value it doesn't hold, so the choice
    // has to be the model's, not just what the select happens to display.
    effect(() => {
      const restricted = !this.fullBuild();
      const target = this.defaultTargetId();
      untracked(() => {
        if (restricted) {
          this.form.controls.mode.setValue('INCREMENTAL');
          this.form.controls.targetId.setValue(target);
        } else if (this.form.controls.targetId.value === null && target !== null) {
          this.form.controls.targetId.setValue(target);
        }
      });
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
    const folderPath = this.scopeFolder();
    const assetUuids = this.scopePages().map((page) => page.uuid);
    return {
      mode: this.form.controls.mode.value ?? 'FULL',
      targetId: this.form.controls.targetId.value ?? undefined,
      comment: this.form.controls.comment.value.trim() || undefined,
      ...(channels.length > 0 ? { channels } : {}),
      ...(folderPath ? { folderPath } : {}),
      ...(assetUuids.length > 0 ? { assetUuids } : {}),
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
        this.showRedirects.set(false);
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
