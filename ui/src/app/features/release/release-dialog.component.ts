import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { forkJoin, of, catchError, map } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { problemOf } from '../../core/api/problem.util';
import { LocalesStore } from '../../core/project/locales.store';
import { ToastService } from '../../core/ui/toast.service';
import { BuildNowService } from '../generation/build-now.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { formatDiffPath } from '../../shared/components/sf-diff.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { ReleaseEventsStore } from './release-events.store';
import { type ReleaseChoice, type ReleaseMode, assetName, itemsOf } from './release-choice.util';
import { ReleasePlanComponent, type ReleasePlanState } from './release-plan.component';
import { localeTag, statusLabel } from './release-status.util';

type ReleaseResultView = components['schemas']['ReleaseResultView'];
type ReleaseTargetView = components['schemas']['ReleaseTargetView'];
type FieldChange = components['schemas']['FieldChange'];

/** How many items a discard confirmation loads diffs for; a larger selection lists the items only. */
const MAX_DIFFS = 10;

const TITLES: Record<ReleaseMode, string> = {
  release: 'Release',
  unpublish: 'Unpublish',
  discard: 'Discard changes',
};

interface DiffSummary {
  label: string;
  paths: string[];
  error: boolean;
}

/**
 * Release, unpublish or discard a selection (M27.6.1): from an editor's release bar (the asset's locales, the
 * editing locale ticked) or from the Changes view (the picked rows). Release shows the dependency plan and blocks on
 * incomplete content; discard shows what would be thrown away; each is one revision. Afterwards the release events
 * fire, so every status on screen re-reads from the server.
 */
@Component({
  selector: 'sf-release-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent, SfSpinnerComponent, ReleasePlanComponent],
  templateUrl: './release-dialog.component.html',
  styleUrl: './release-dialog.component.scss',
})
export class ReleaseDialogComponent {
  private readonly api = inject(ApiClient);
  private readonly toast = inject(ToastService);
  private readonly buildNow = inject(BuildNowService);
  private readonly events = inject(ReleaseEventsStore);
  private readonly locales = inject(LocalesStore);

  readonly projectKey = input.required<string>();
  readonly mode = input<ReleaseMode>('release');
  readonly choices = input.required<ReleaseChoice[]>();
  /** What the dialog acts on, for its title ("Release “Home”"); empty for a multi-selection. */
  readonly subjectName = input<string>('');

  readonly done = output<ReleaseResultView>();
  readonly closed = output<void>();

  private readonly plan = viewChild(ReleasePlanComponent);

  protected readonly selection = signal<ReleaseChoice[]>([]);
  protected readonly comment = signal('');
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly planState = signal<ReleasePlanState | null>(null);
  /** After a discard that kept shared fields: the note, shown before the dialog closes. */
  protected readonly keptNote = signal<string[] | null>(null);
  protected readonly diffs = signal<DiffSummary[] | null>(null);

  protected readonly title = computed(() => {
    const name = this.subjectName();
    return name ? `${TITLES[this.mode()]} “${name}”` : TITLES[this.mode()];
  });
  protected readonly actionLabel = computed(() => TITLES[this.mode()]);
  protected readonly items = computed(() => itemsOf(this.selection()));
  protected readonly checkedCount = computed(() => this.selection().filter((choice) => choice.checked).length);
  protected readonly multiple = computed(() => this.selection().length > 1);
  /** "Language(s)" for one asset's locales, "Items" for a selection of several assets. */
  protected readonly legend = computed(() => {
    const assets = new Set(this.selection().map((choice) => choice.assetUuid));
    return assets.size > 1 ? 'Items' : this.multiple() ? 'Languages' : 'Language';
  });
  protected readonly canSubmit = computed(() => {
    if (this.submitting() || this.checkedCount() === 0) {
      return false;
    }
    if (this.mode() !== 'release') {
      return true;
    }
    const state = this.planState();
    return !!state && state.ready && !state.blocked;
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

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.close();
  }

  protected toggle(index: number, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selection.update((list) => list.map((choice, i) => (i === index ? { ...choice, checked } : choice)));
  }

  /** "All changed languages": every offered choice. */
  protected selectAll(): void {
    this.selection.update((list) => list.map((choice) => ({ ...choice, checked: true })));
  }

  protected onComment(event: Event): void {
    this.comment.set((event.target as HTMLTextAreaElement).value);
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
    };
    const request =
      mode === 'release'
        ? this.api.release(this.projectKey(), body)
        : mode === 'unpublish'
          ? this.api.unpublish(this.projectKey(), body)
          : this.api.discard(this.projectKey(), body);
    this.submitting.set(true);
    this.error.set(null);
    request.subscribe({
      next: (result) => {
        this.submitting.set(false);
        this.events.changed();
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
        const problem = problemOf(err, `Could not ${TITLES[mode].toLowerCase()} — try again.`);
        this.error.set(problem.detail);
        if (problem.code === 'SF-DOM-0150') {
          this.plan()?.refresh();
        }
      },
    });
  }

  private successMessage(mode: ReleaseMode, result: ReleaseResultView): string {
    const skipped = result.skipped?.length ?? 0;
    const skippedNote = skipped > 0 ? ` ${skipped} skipped: nothing to do.` : '';
    if (result.revision == null) {
      return mode === 'release' ? 'Nothing to release — already published.' : 'Nothing changed.';
    }
    switch (mode) {
      case 'release':
        return `Released in r${result.revision} — goes online with the next build.${skippedNote}`;
      case 'unpublish':
        return `Unpublished in r${result.revision} — goes offline with the next build.${skippedNote}`;
      case 'discard':
        return `Changes discarded in r${result.revision}.${skippedNote}`;
    }
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

  protected readonly statusLabel = statusLabel;
}

function paths(changes: FieldChange[], labels: Record<string, string>): string[] {
  return changes.map((change) => formatDiffPath(change.path, labels)).filter((path) => path.length > 0);
}
