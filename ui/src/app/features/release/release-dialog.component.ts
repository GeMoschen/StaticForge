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
  viewChild,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { forkJoin, of, catchError, map } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { problemOf } from '../../core/api/problem.util';
import { LocalesStore } from '../../core/project/locales.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ToastService } from '../../core/ui/toast.service';
import { BuildNowService } from '../generation/build-now.service';
import { SfAssetPickerDialogComponent, type AssetPicked } from '../../shared/components/sf-asset-picker-dialog.component';
import { SfDialogComponent, SfDialogFooterDirective } from '../../shared/components/dialog/sf-dialog.component';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfCheckboxComponent } from '../../shared/components/forms/sf-checkbox.component';
import { SfTextareaComponent } from '../../shared/components/forms/sf-textarea.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { formatDiffPath } from '../../shared/components/sf-diff.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { ReleaseEventsStore } from './release-events.store';
import { RedirectAfterService } from './redirect-after.service';
import { RedirectOptionComponent } from './redirect-option.component';
import { type RedirectIntent, type RedirectSource, NO_REDIRECT, intentReady } from './redirect-option.util';
import { type ReleaseChoice, type ReleaseMode, assetName, itemsOf } from './release-choice.util';
import { ReleasePlanComponent, type ReleasePlanState } from './release-plan.component';
import { localeTag } from './release-status.util';

type ReleaseResultView = components['schemas']['ReleaseResultView'];
type ReleaseTargetView = components['schemas']['ReleaseTargetView'];
type FieldChange = components['schemas']['FieldChange'];

/** How many items a discard confirmation loads diffs for; a larger selection lists the items only. */
const MAX_DIFFS = 10;

/** The button of each mode: its icon, and whether it is destructive. */
const MODES: Record<ReleaseMode, { icon: string; danger: boolean }> = {
  release: { icon: 'publish', danger: false },
  unpublish: { icon: 'cloud_off', danger: true },
  discard: { icon: 'undo', danger: true },
};

interface DiffSummary {
  label: string;
  paths: string[];
  error: boolean;
}

/**
 * Release, unpublish or discard a selection (M27.6.1, restyled in M35.23): from an editor's release actions (the
 * asset's languages) or from a list (the picked rows). One heading hierarchy: the dialog's `h2`, then an `h3` per part.
 * The choices come ticked by the caller (a release ticks every changed language); "All changed languages" is a plain
 * checkbox. Release shows the dependency plan, blocks on incomplete content (each with an *Open* link) and needs the
 * explicit confirmation of rule warnings (M33); discard shows what would be thrown away; each is one revision.
 * Afterwards the release events fire, so every status on screen re-reads from the server.
 */
@Component({
  selector: 'sf-release-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfAssetPickerDialogComponent,
    SfBadgeComponent,
    SfButtonComponent,
    SfCheckboxComponent,
    SfDialogComponent,
    SfDialogFooterDirective,
    SfFieldComponent,
    SfSpinnerComponent,
    SfTextareaComponent,
    ReleasePlanComponent,
    RedirectOptionComponent,
    TranslocoPipe,
  ],
  templateUrl: './release-dialog.component.html',
  styleUrl: './release-dialog.component.scss',
})
export class ReleaseDialogComponent {
  private readonly api = inject(ApiClient);
  private readonly toast = inject(ToastService);
  private readonly buildNow = inject(BuildNowService);
  private readonly events = inject(ReleaseEventsStore);
  private readonly locales = inject(LocalesStore);
  private readonly transloco = inject(TranslocoService);
  protected readonly defaultLocale = this.locales.defaultLocale;
  private readonly permissions = inject(ProjectPermissionsStore);
  private readonly redirectAfter = inject(RedirectAfterService);

  readonly projectKey = input.required<string>();
  readonly mode = input<ReleaseMode>('release');
  readonly choices = input.required<ReleaseChoice[]>();
  /** What the dialog acts on, for its title ("Release “Home”"); empty for a multi-selection. */
  readonly subjectName = input<string>('');

  readonly done = output<ReleaseResultView>();
  readonly closed = output<void>();

  private readonly plan = viewChild(ReleasePlanComponent);
  private readonly redirectOption = viewChild(RedirectOptionComponent);

  protected readonly selection = signal<ReleaseChoice[]>([]);
  protected readonly comment = signal('');
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly planState = signal<ReleasePlanState | null>(null);
  /** After a discard that kept shared fields: the note, shown before the dialog closes. */
  protected readonly keptNote = signal<string[] | null>(null);
  protected readonly diffs = signal<DiffSummary[] | null>(null);
  protected readonly redirectIntent = signal<RedirectIntent>(NO_REDIRECT);
  protected readonly pickingRedirect = signal(false);

  /**
   * The pages whose URLs go offline with this action (M30.6.3): the ticked pages of an unpublish (every status it
   * offers has a released version), or of a release that publishes a page's deletion.
   */
  protected readonly redirectSources = computed<RedirectSource[]>(() => {
    const mode = this.mode();
    const sources = new Map<string, RedirectSource>();
    for (const choice of this.selection()) {
      const goesOffline = mode === 'unpublish' || (mode === 'release' && choice.status === 'DELETION_PENDING');
      if (choice.checked && goesOffline && choice.assetType === 'PAGE' && !sources.has(choice.assetUuid)) {
        sources.set(choice.assetUuid, {
          uuid: choice.assetUuid,
          name: choice.assetName ?? choice.label,
          folderPath: choice.folderPath,
        });
      }
    }
    return [...sources.values()];
  });
  /** "Redirect old URL to…" for whoever may unpublish, and developers (epic decision 17). */
  protected readonly offersRedirect = computed(
    () => this.permissions.canRedirectOldUrls() && this.redirectSources().length > 0,
  );

  protected readonly title = computed(() => {
    const name = this.subjectName();
    const mode = this.mode();
    return name
      ? this.transloco.translate(`release.dialog.titleNamed.${mode}`, { name })
      : this.transloco.translate(`release.dialog.title.${mode}`);
  });
  protected readonly actionLabel = computed(() => this.transloco.translate(`release.dialog.title.${this.mode()}`));
  protected readonly actionIcon = computed(() => MODES[this.mode()].icon);
  protected readonly danger = computed(() => MODES[this.mode()].danger);
  protected readonly items = computed(() => itemsOf(this.selection()));
  protected readonly checkedCount = computed(() => this.selection().filter((choice) => choice.checked).length);
  protected readonly multiple = computed(() => this.selection().length > 1);
  /** Several assets in the selection: its parts are items, not the languages of one asset. */
  protected readonly manyAssets = computed(() => new Set(this.selection().map((choice) => choice.assetUuid)).size > 1);
  /** "Language(s)" for one asset's locales, "Items" for a selection of several assets. */
  protected readonly legend = computed(() =>
    this.transloco.translate(`release.dialog.${this.manyAssets() ? 'items' : this.multiple() ? 'languages' : 'language'}`),
  );
  protected readonly allTicked = computed(() => this.selection().length > 0 && this.checkedCount() === this.selection().length);
  protected readonly someTicked = computed(() => this.checkedCount() > 0 && !this.allTicked());
  protected readonly canSubmit = computed(() => {
    if (this.submitting() || this.checkedCount() === 0) {
      return false;
    }
    if (this.offersRedirect() && !intentReady(this.redirectIntent())) {
      return false;
    }
    if (this.mode() !== 'release') {
      return true;
    }
    const state = this.planState();
    return !!state && state.ready && !state.blocked;
  });
  /** Why the button is disabled, or `null` when it may go (`submitting` is no reason: the button shows busy). */
  protected readonly blockedReason = computed<string | null>(() => {
    if (this.submitting()) {
      return null;
    }
    const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(`release.dialog.reason.${key}`, params);
    if (this.checkedCount() === 0) {
      return t(this.manyAssets() ? 'nothingItems' : 'nothing');
    }
    if (this.offersRedirect() && !intentReady(this.redirectIntent())) {
      return t('redirect');
    }
    if (this.mode() !== 'release') {
      return null;
    }
    const state = this.planState();
    if (!state?.ready) {
      return t('checking');
    }
    if (state.errors > 0) {
      return t('errors', { count: state.errors });
    }
    return state.warningsUnconfirmed ? t('warnings') : null;
  });

  constructor() {
    effect(
      () => {
        const choices = this.choices();
        untracked(() => this.selection.set(choices.map((choice) => ({ ...choice }))));
      },
      { allowSignalWrites: true },
    );
    effect(() => {
      const mode = this.mode();
      const checked = this.selection().filter((choice) => choice.checked);
      untracked(() => (mode === 'discard' ? this.loadDiffs(checked) : this.diffs.set(null)));
    });
  }

  protected onRedirectPicked(picked: AssetPicked): void {
    this.pickingRedirect.set(false);
    this.redirectOption()?.choose(picked);
  }

  protected toggle(index: number, checked: boolean): void {
    this.selection.update((list) => list.map((choice, i) => (i === index ? { ...choice, checked } : choice)));
  }

  /** "All changed languages" (or "Select all"): ticks every offered choice, or unticks them. */
  protected tickAll(checked: boolean): void {
    this.selection.update((list) => list.map((choice) => ({ ...choice, checked })));
  }

  protected close(): void {
    if (!this.submitting()) {
      this.closed.emit();
    }
  }

  protected submit(): void {
    if (!this.canSubmit()) {
      return;
    }
    const mode = this.mode();
    const body = {
      items: this.items(),
      includeDependencies: mode === 'release' ? (this.planState()?.includeDependencies ?? []) : undefined,
      comment: this.comment().trim() || undefined,
      acceptWarnings: mode === 'release' && this.planState()?.acceptWarnings ? true : undefined,
    };
    const request =
      mode === 'release'
        ? this.api.release(this.projectKey(), body)
        : mode === 'unpublish'
          ? this.api.unpublish(this.projectKey(), body)
          : this.api.discard(this.projectKey(), body);
    // What goes offline is fixed at submit time: the redirect follows the action that actually ran.
    const redirect = this.offersRedirect() ? this.redirectIntent() : NO_REDIRECT;
    const redirectSources = this.redirectSources();
    this.submitting.set(true);
    this.error.set(null);
    request.subscribe({
      next: (result) => {
        this.submitting.set(false);
        this.events.changed();
        if (redirect.wanted && redirect.page && result.revision != null) {
          this.redirectAfter.redirect(this.projectKey(), redirectSources, redirect.page);
        }
        if (mode === 'release' && result.revision != null) {
          this.buildNow.announceRelease(this.projectKey(), this.successMessage(mode, result));
        } else {
          this.toast.show(this.successMessage(mode, result), result.revision != null ? 'success' : 'info');
        }
        const kept = result.sharedFieldsKept ?? [];
        if (mode === 'discard' && kept.length > 0) {
          this.keptNote.set(kept.map((target) => this.targetLabel(target)));
          this.done.emit(result);
          return;
        }
        this.done.emit(result);
        this.closed.emit();
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        const problem = problemOf(err, this.transloco.translate('release.dialog.failed', { action: this.actionLabel().toLowerCase() }));
        this.error.set(problem.detail);
        if (problem.code === 'SF-DOM-0150') {
          this.plan()?.refresh();
        }
      },
    });
  }

  private successMessage(mode: ReleaseMode, result: ReleaseResultView): string {
    if (result.revision == null) {
      return this.transloco.translate(mode === 'release' ? 'release.dialog.toast.nothingToRelease' : 'release.dialog.toast.nothingChanged');
    }
    return this.transloco.translate(`release.dialog.toast.${mode}`, { revision: result.revision, skipped: result.skipped?.length ?? 0 });
  }

  private targetLabel(target: ReleaseTargetView): string {
    return target.locale ? `${assetName(target)} (${localeTag(target.locale)})` : assetName(target);
  }

  private loadDiffs(checked: ReleaseChoice[]): void {
    if (checked.length === 0 || checked.length > MAX_DIFFS) {
      this.diffs.set(checked.length === 0 ? null : []);
      return;
    }
    const labels = Object.fromEntries(this.locales.locales().map((locale) => [locale.code ?? '', locale.label ?? '']));
    this.diffs.set(null);
    forkJoin(
      checked.map((choice) =>
        this.api.changeDiff(this.projectKey(), choice.assetUuid, choice.locale || null).pipe(
          map((diff) => ({ label: choice.label, paths: paths(diff.changes ?? [], labels), error: false })),
          catchError(() => of({ label: choice.label, paths: [], error: true })),
        ),
      ),
    ).subscribe((summaries) => this.diffs.set(summaries));
  }

}

function paths(changes: FieldChange[], labels: Record<string, string>): string[] {
  return changes.map((change) => formatDiffPath(change.path, labels)).filter((path) => path.length > 0);
}
