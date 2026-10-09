import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { ApiClient } from '../../../../core/api/api.client';
import type { components } from '../../../../core/api/generated/schema.d.ts';
import { problemOf } from '../../../../core/api/problem.util';
import { FrameContextStore } from '../../../../core/frame/frame-context.store';
import { ProjectContextStore } from '../../../../core/project/project-context.store';
import { ProjectPermissionsStore } from '../../../../core/project/project-permissions.store';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../../shared/components/dialog/sf-dialog.component';
import { SfCheckboxComponent } from '../../../../shared/components/forms/sf-checkbox.component';
import { SfComboboxComponent, SfComboboxOption } from '../../../../shared/components/forms/sf-combobox.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../../../shared/components/forms/sf-segmented.component';
import { SfSelectComponent, SfSelectOption } from '../../../../shared/components/forms/sf-select.component';
import { SfTextareaComponent } from '../../../../shared/components/forms/sf-textarea.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { ChannelsService } from '../../../channels/channels.service';
import { BuildNowService } from '../../../generation/build-now.service';
import { parseDiagnostics } from '../../../generation/generation-diagnostics';
import { GenerationService, type StartGenerationRequest } from '../../../generation/generation.service';
import {
  assetLabel,
  fallbackWarning,
  planRequestKey,
  rootKindRows,
  type GenerationPlanView,
} from '../../../generation/insight/insight.util';
import { type GenerationRunView } from '../runs.util';

type GenerationTargetView = components['schemas']['GenerationTargetView'];
type FolderView = components['schemas']['FolderView'];
type AssetSummaryView = components['schemas']['AssetSummaryView'];
type BuildMode = 'FULL' | 'INCREMENTAL';

/** The scope picker's values: `folder:<path>` and `page:<uuid>`. */
const FOLDER = 'folder:';
const PAGE = 'page:';

/** The pages folders below the store's fixed "All Pages" root, depth first. */
function foldersOf(tree: readonly FolderView[]): { path: string; name: string }[] {
  const out: { path: string; name: string }[] = [];
  const walk = (nodes: readonly FolderView[]) => {
    for (const node of nodes) {
      if (node.path && node.type !== 'RECORD_SET') {
        out.push({ path: node.path, name: node.displayName ?? node.uid ?? node.path });
      }
      walk(node.children ?? []);
    }
  };
  walk(tree.flatMap((root) => root.children ?? []));
  return out;
}

/**
 * Build now (M35.24, gate decisions 196–198): channels (one checkbox per enabled channel, the last one stays on), an
 * optional comment, the target (the default preselected), Full / Incremental, a page scope picker and an **explicit**
 * plan preview — "Validate templates" and **Preview plan** (Alt+P) compute it; any later change to the form marks the
 * shown plan stale. A caller without full-build rights sees "Incremental, default target" instead of the choices.
 * Starting answers "a build is already running" inline; the new run opens in the run list.
 */
@Component({
  selector: 'sf-build-dialog',
  standalone: true,
  imports: [
    RouterLink,
    SfButtonComponent,
    SfCheckboxComponent,
    SfComboboxComponent,
    SfDialogComponent,
    SfDialogFooterDirective,
    SfFieldComponent,
    SfIconComponent,
    SfSegmentedComponent,
    SfSelectComponent,
    SfTextareaComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './build-dialog.component.html',
  styleUrl: './build-dialog.component.scss',
})
export class BuildDialogComponent {
  /** The project to build; the open project of the frame when left out. */
  readonly projectKeyInput = input<string | null>(null, { alias: 'projectKey' });
  readonly closed = output<void>();
  readonly started = output<GenerationRunView>();

  private readonly frame = inject(FrameContextStore);
  private readonly generation = inject(GenerationService);
  private readonly channelsApi = inject(ChannelsService);
  private readonly pagesApi = inject(ApiClient);
  private readonly context = inject(ProjectContextStore);
  private readonly permissions = inject(ProjectPermissionsStore);
  private readonly buildNow = inject(BuildNowService);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);

  protected readonly projectKey = computed(() => this.projectKeyInput() ?? this.frame.projectKey() ?? '');

  // Data
  private readonly targets = signal<readonly GenerationTargetView[]>([]);
  private readonly targetsLoaded = signal(false);
  protected readonly channelKeys = signal<readonly string[]>([]);
  private readonly pages = signal<readonly AssetSummaryView[]>([]);

  // Form
  protected readonly channels = signal<readonly string[]>([]);
  protected readonly comment = signal('');
  private readonly pickedTarget = signal<number | null>(null);
  protected readonly mode = signal<BuildMode>('INCREMENTAL');
  protected readonly scope = signal<string[]>([]);
  protected readonly validate = signal(false);

  // Plan
  protected readonly planState = signal<'none' | 'loading' | 'ready'>('none');
  private readonly shown = signal<{ plan: GenerationPlanView; key: string } | null>(null);
  protected readonly showAssets = signal(false);
  protected readonly showRedirects = signal(false);
  protected readonly planError = signal<string | null>(null);

  // Start
  protected readonly submitting = signal(false);
  protected readonly startError = signal<string | null>(null);

  protected readonly defaultTarget = computed(() => this.targets().find((t) => t.isDefault) ?? this.targets()[0] ?? null);
  /** Without full-build rights: incremental, to the default target. */
  protected readonly limited = computed(() => !this.permissions.canFullBuild());
  protected readonly noTargets = computed(() => this.targetsLoaded() && this.targets().length === 0);
  protected readonly target = computed(() => this.pickedTarget() ?? this.defaultTarget()?.id ?? null);
  protected readonly effectiveMode = computed<BuildMode>(() => (this.limited() ? 'INCREMENTAL' : this.mode()));

  protected readonly targetOptions = computed<SfSelectOption<number>[]>(() =>
    this.targets().map((target) => ({
      value: target.id as number,
      label: target.isDefault ? this.t('defaultTarget', { name: target.name }) : (target.name ?? ''),
    })),
  );
  protected readonly modeOptions = computed<SfSegmentedOption<BuildMode>[]>(() => [
    { value: 'INCREMENTAL', label: this.transloco.translate('publishing.runs.mode.incremental'), icon: 'bolt' },
    { value: 'FULL', label: this.transloco.translate('publishing.runs.mode.full'), icon: 'all_inclusive' },
  ]);
  protected readonly modeHint = computed(() => this.t(this.mode() === 'FULL' ? 'fullHint' : 'incrementalHint'));
  protected readonly scopeOptions = computed<SfComboboxOption<string>[]>(() => [
    ...foldersOf(this.context.pageFolderTree()).map((folder) => ({
      value: FOLDER + folder.path,
      label: folder.name,
      description: folder.path,
      group: this.t('folders'),
    })),
    ...this.pages().map((page) => ({
      value: PAGE + page.uuid,
      label: page.displayName ?? page.uid ?? '',
      description: page.folderPath,
      group: this.t('pages'),
    })),
  ]);

  protected readonly request = computed<StartGenerationRequest>(() => {
    const folder = this.scope().find((value) => value.startsWith(FOLDER));
    const assetUuids = this.scope()
      .filter((value) => value.startsWith(PAGE))
      .map((value) => value.slice(PAGE.length));
    const comment = this.comment().trim();
    const channels = this.channels();
    const targetId = this.limited() ? this.defaultTarget()?.id : (this.target() ?? undefined);
    return {
      mode: this.effectiveMode(),
      ...(targetId != null ? { targetId } : {}),
      ...(comment ? { comment } : {}),
      ...(channels.length > 0 ? { channels: [...channels] } : {}),
      ...(folder ? { folderPath: folder.slice(FOLDER.length) } : {}),
      ...(assetUuids.length > 0 ? { assetUuids } : {}),
    };
  });
  private readonly formKey = computed(() => `${planRequestKey(this.request())}|${this.validate()}`);

  protected readonly plan = computed(() => this.shown()?.plan ?? null);
  protected readonly planShown = computed(() => this.planState() !== 'none');
  protected readonly stale = computed(() => {
    const shown = this.shown();
    return this.planState() === 'ready' && !!shown && shown.key !== this.formKey();
  });
  protected readonly fallback = computed(() => {
    const plan = this.plan();
    return plan?.summary?.fallbackCause ? fallbackWarning(plan.summary.fallbackCause, plan.target?.name) : null;
  });
  protected readonly empty = computed(() => (this.plan()?.summary?.entryCount ?? 0) === 0);
  protected readonly counts = computed(() => {
    const plan = this.plan();
    const summary = plan?.summary;
    return {
      pages: summary?.pageCount ?? 0,
      media: summary?.processedMediaCount ?? 0,
      removed: (plan?.changedAssets ?? []).filter((asset) => asset.deleted).length,
      redirects: summary?.redirectsAdded ?? plan?.redirectCandidates?.length ?? 0,
    };
  });
  protected readonly roots = computed(() => rootKindRows(this.plan()?.summary));
  protected readonly via = computed(() =>
    (this.plan()?.summary?.via ?? []).map((via) => ({ name: assetLabel(via.assetType, via.uid), count: via.count ?? 0 })),
  );
  protected readonly diagnostics = computed(() => parseDiagnostics(this.plan()?.diagnostics));
  /** The templates were validated and the plan carries the answer. */
  protected readonly validated = computed(() => this.validate() && !!this.plan()?.diagnostics);
  protected readonly previewLabel = computed(() =>
    this.planState() === 'loading' ? this.t('planning') : this.planState() === 'ready' ? this.t('refresh') : this.t('previewPlan'),
  );
  protected readonly canStart = computed(() => !this.noTargets() && this.target() !== null && !this.submitting());

  constructor() {
    effect(() => {
      const key = this.projectKey();
      if (key) {
        untracked(() => this.load(key));
      }
    });
  }

  private load(key: string): void {
    this.generation.listTargets(key).subscribe({
      next: (targets) => {
        this.targets.set(targets ?? []);
        this.targetsLoaded.set(true);
      },
      error: () => this.targetsLoaded.set(true),
    });
    this.channelsApi.list(key).subscribe({
      // Every enabled channel starts on.
      next: (list) => {
        const keys = (list ?? []).filter((c) => c.enabled && c.key).map((c) => c.key as string);
        this.channelKeys.set(keys);
        this.channels.set(keys);
      },
      error: () => this.channelKeys.set([]),
    });
    this.pagesApi.listPages(key).subscribe({
      next: (pages) => this.pages.set(pages ?? []),
      error: () => this.pages.set([]),
    });
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`publishing.build.${key}`, params);
  }

  protected channelOn(channel: string): boolean {
    return this.channels().includes(channel);
  }

  /** The only channel left stays checked and disabled, so a build always has an output. */
  protected channelLocked(channel: string): boolean {
    return this.channels().length === 1 && this.channelOn(channel);
  }

  protected setChannel(channel: string, on: boolean): void {
    this.channels.set(this.channelKeys().filter((c) => (c === channel ? on : this.channelOn(c))));
  }

  protected setTarget(id: number | null): void {
    this.pickedTarget.set(id);
  }

  /** A run limits to one folder (`folderPath`): choosing another folder replaces the first. */
  protected setScope(value: unknown): void {
    const next = Array.isArray(value) ? (value as string[]) : [];
    const previous = this.scope();
    const newFolder = next.find((v) => v.startsWith(FOLDER) && !previous.includes(v));
    this.scope.set(newFolder ? next.filter((v) => !v.startsWith(FOLDER) || v === newFolder) : next);
  }

  /** Alt+P previews the plan from anywhere in the dialog (the shortcut registry is off while a modal is open). */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.code === 'KeyP') {
      event.preventDefault();
      this.previewPlan();
    }
  }

  protected previewPlan(): void {
    if (this.planState() === 'loading' || this.noTargets()) {
      return;
    }
    const key = this.formKey();
    this.planState.set('loading');
    this.planError.set(null);
    this.generation.planGeneration(this.projectKey(), this.request(), { page: 0, size: 1 }, this.validate()).subscribe({
      next: (plan) => {
        this.shown.set({ plan, key });
        this.showAssets.set(false);
        this.showRedirects.set(false);
        this.planState.set('ready');
      },
      error: (err: unknown) => {
        this.planState.set(this.shown() ? 'ready' : 'none');
        this.planError.set(problemOf(err, this.t('planFailed')).detail);
      },
    });
  }

  protected start(): void {
    if (!this.canStart()) {
      return;
    }
    this.startError.set(null);
    this.submitting.set(true);
    const key = this.projectKey();
    this.generation.start(key, this.request(), true).subscribe({
      next: (run) => {
        this.submitting.set(false);
        this.buildNow.started.next(run);
        this.started.emit(run);
        this.closed.emit();
        void this.router.navigate(['/p', key, 'publishing', 'runs'], { queryParams: { run: run.id } });
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        const problem = problemOf(err, this.t('startFailed'));
        this.startError.set(problem.status === 409 || problem.code === 'SF-GEN-0500' ? this.t('alreadyRunning') : problem.detail);
      },
    });
  }
}
