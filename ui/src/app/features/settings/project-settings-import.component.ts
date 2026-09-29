import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, Subject, type Subscription } from 'rxjs';
import {
  ConflictReportView,
  ImportConflictView,
  ImportExportService,
  ImportResultView,
  ReleaseMode,
  UrlRegistryImportMode,
  extractConflicts,
} from './import-export.service';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfDropTargetDirective } from '../../shared/directives/sf-drop-target.directive';
import { ProjectAccessStore } from '../../core/project/project-access.store';

/**
 * Material Symbols icon per `ConflictType` — a reasonable visual cue, not meant to be pixel-perfect. Keyed by the
 * plain string the API sends (`ImportConflictView.type` is not an enum in the schema), so a type the server adds
 * later just falls back to `info`.
 */
const CONFLICT_ICONS: Record<string, string> = {
  PROTOCOL_VERSION_MISMATCH: 'warning',
  DUPLICATE_UUID: 'content_copy',
  DUPLICATE_UUID_TYPE_MISMATCH: 'report',
  MISSING_TEMPLATE_REFERENCE: 'link_off',
  RECORD_DATASET_MISSING: 'dataset_linked',
  RECORD_SET_DATASET_MISSING: 'dataset_linked',
  RECORD_SET_MISSING: 'table_rows',
  RECORD_SET_DATASET_MISMATCH: 'rule',
  RECORD_OUTSIDE_RECORD_SET: 'move_item',
  RECORD_SET_QUERY_INVALID: 'filter_alt_off',
  PARENT_TEMPLATE_MISSING: 'link_off',
  MISSING_PARENT_FOLDER: 'folder_off',
  SETTINGS_KEY_COLLISION: 'settings',
  TARGET_PATH_COLLISION: 'drive_file_move',
  LOCALE_CONFIG_MISMATCH: 'translate',
  LOCALIZATION_SHAPE_MISMATCH: 'translate',
  RELEASE_LOCALE_MISSING: 'translate',
  DUPLICATE_SCHEDULE: 'event_repeat',
  SCHEDULE_OVERDUE: 'event_busy',
  SCHEDULE_TARGET_MISSING: 'link_off',
  SCHEDULE_INVALID: 'event_busy',
  SCHEDULE_OWNER_REPLACED: 'person',
  REDIRECT_SOURCE_EXISTS: 'alt_route',
  REDIRECT_INVALID: 'link_off',
  URL_OVERRIDE_KEPT: 'edit_note',
  URL_TAKEN: 'link_off',
  URL_INVALID: 'link_off',
};

/**
 * Whether a conflict refuses the whole import. A `BLOCKING` conflict does unless the server says it only rejects
 * its own asset (`blocksImport: false` — M25: a record outside a record set, which is left out while the rest of
 * the archive imports). A conflict without the flag counts as refusing, the safe reading.
 */
export function refusesImport(conflict: ImportConflictView): boolean {
  return conflict.severity === 'BLOCKING' && conflict.blocksImport !== false;
}

/** Whether a conflict keeps only its own asset out of the import (`BLOCKING` with `blocksImport: false`). */
export function rejectsAssetOnly(conflict: ImportConflictView): boolean {
  return conflict.severity === 'BLOCKING' && conflict.blocksImport === false;
}

/**
 * Project settings tab: "Import" half of `M10`/`M11`'s selective export/import feature —
 * pick a `.zip` archive, analyze it for conflicts, then let the user cancel or commit.
 * Same standalone/OnPush/signals shape as `project-settings-url-registry.component`.
 *
 * <p>Import is gated on conflicts that refuse the whole import (`blocksImport`), not on every `BLOCKING`
 * one: assets whose conflict rejects only themselves are listed under "Not imported" and simply stay out
 * (M25: records from before record sets).
 *
 * <p>Release state (M27.5.2): once the analysis says whether the archive carries release state, the user chooses to
 * keep it (default) or import everything as a draft; the choice is re-analyzed (only a kept release state can miss
 * languages) and sent with the import. An archive without release state shows a note instead of the choice.
 *
 * <p>Schedules (M27.8.2): an archive that carries schedules offers to import them (default) or leave them out; the
 * choice is re-analyzed (the schedule warnings only apply when they are imported) and sent with the import. The result
 * lists what happened to them at commit time.
 *
 * <p>URLs (M32.6): an archive that carries URL registry rows asks how they meet the project's existing URLs — the
 * archive's replace computed ones but keep manual ones (default), existing URLs stay, or the archive's replace all.
 */
@Component({
  selector: 'sf-project-settings-import',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfButtonComponent,
    SfEmptyStateComponent,
    SfIconComponent,
    SfSpinnerComponent,
    SfDropTargetDirective,
  ],
  templateUrl: './project-settings-import.component.html',
  styleUrl: './project-settings-import.component.scss',
})
export class ProjectSettingsImportComponent {
  readonly projectKey = input.required<string>();

  private readonly api = inject(ImportExportService);
  private readonly toasts = inject(ToastService);
  private readonly store = inject(ProjectContextStore);

  /** Time travel or an archived project (M26). */
  protected readonly readOnly = inject(ProjectAccessStore).readOnly;

  protected readonly dragCounter = signal(0);
  protected readonly dragActive = computed(() => this.dragCounter() > 0);

  protected readonly file = signal<File | null>(null);
  protected readonly analyzing = signal(false);
  protected readonly report = signal<ConflictReportView | null>(null);
  protected readonly pickError = signal<string | null>(null);

  /** "Skip ancestor folders that already exist" (M11.3.3) — re-analyzes live on toggle, debounced against rapid clicking, so the Blocking/Warnings split always reflects the current toggle state before commit. */
  protected readonly skipExistingImplicit = signal(false);
  private readonly skipExistingImplicit$ = new Subject<boolean>();

  /** Keep the archive's release state, or import everything as a draft (M27.5.2). */
  protected readonly releaseMode = signal<ReleaseMode>('KEEP');
  /**
   * Whether the loaded archive carries release state, from its last analysis; `null` until one answers. Kept apart
   * from `report` so the choice doesn't disappear while a changed option is re-analyzed.
   */
  protected readonly archiveHasReleaseState = signal<boolean | null>(null);

  /** Import the archive's schedules, or leave them out (M27.8.2). */
  protected readonly importSchedules = signal(true);
  /** How many schedules the loaded archive carries, from its last analysis; `null` until one answers. */
  protected readonly archiveScheduleCount = signal<number | null>(null);

  /** How the archive's URLs meet the project's existing ones (M32.6). */
  protected readonly urlRegistryMode = signal<UrlRegistryImportMode>('ARCHIVE_WINS');
  /** How many URL registry rows the loaded archive carries, from its last analysis; `null` until one answers. */
  protected readonly archiveUrlCount = signal<number | null>(null);

  /** The analysis in flight — dropped when the archive or the project changes before it answers. */
  private analysis: Subscription | null = null;

  protected readonly committing = signal(false);
  protected readonly commitError = signal<string | null>(null);
  protected readonly result = signal<ImportResultView | null>(null);

  /** Conflicts that refuse the whole import. */
  protected readonly blocking = computed(() => (this.report()?.conflicts ?? []).filter(refusesImport));
  /** Assets the import leaves out while the rest of the archive imports. */
  protected readonly rejected = computed(() => (this.report()?.conflicts ?? []).filter(rejectsAssetOnly));
  protected readonly warnings = computed(
    () => (this.report()?.conflicts ?? []).filter((c) => c.severity === 'WARNING'),
  );
  /** Whether the server would refuse this import — the only thing that disables "Import". */
  protected readonly blocksImport = computed(
    () => this.report()?.blocksImport === true || this.blocking().length > 0,
  );
  protected readonly noConflicts = computed(
    () => this.blocking().length === 0 && this.rejected().length === 0 && this.warnings().length === 0,
  );

  constructor() {
    this.skipExistingImplicit$
      .pipe(debounceTime(250), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((value) => {
        this.skipExistingImplicit.set(value);
      });

    // Re-run analysis whenever the toggle settles on a new value, as long as a file is loaded —
    // keeps the displayed Blocking/Warnings split in sync with the option that will actually be
    // sent to `commitImport()`.
    effect(() => {
      const skip = this.skipExistingImplicit();
      const releaseMode = this.releaseMode();
      const importSchedules = this.importSchedules();
      const urlRegistryMode = this.urlRegistryMode();
      const file = this.file();
      if (!file) {
        return;
      }
      untracked(() => this.analyze(file, skip, releaseMode, importSchedules, urlRegistryMode));
    });

    // The router reuses this screen when only the project changes (`/p/a/settings/…` → `/p/b/settings/…`): an
    // archive loaded and analyzed for the previous project must not stay armed for this one — its report was
    // checked against the other project, and "Import" would commit into this one.
    let shownFor: string | null = null;
    effect(() => {
      const key = this.projectKey();
      if (shownFor !== null && shownFor !== key) {
        untracked(() => this.cancel());
      }
      shownFor = key;
    });
  }

  /**
   * Whether a conflict is about an archived asset, whose explicit/implicit pick the badge shows (a schedule's or a
   * redirect's isn't).
   */
  protected hasProvenance(conflict: ImportConflictView): boolean {
    const type = conflict.type ?? '';
    return !type.includes('SCHEDULE') && !type.startsWith('REDIRECT_') && !type.startsWith('URL_');
  }

  protected iconFor(type: string | undefined): string {
    return CONFLICT_ICONS[type ?? ''] ?? 'info';
  }

  /** "Imported 2 schedule(s), replaced 1." — empty when the import brought none. */
  protected schedulesSummary(result: ImportResultView): string {
    const created = result.importedScheduleCount ?? 0;
    const replaced = result.updatedScheduleCount ?? 0;
    if (created + replaced === 0) {
      return '';
    }
    return `Imported ${created} schedule(s)` + (replaced > 0 ? `, replaced ${replaced}` : '') + '.';
  }

  /** "Imported 3 redirect(s)." — empty when the import brought none (M30.4.1). */
  protected redirectsSummary(result: ImportResultView): string {
    const imported = result.importedRedirectCount ?? 0;
    return imported > 0 ? `Imported ${imported} redirect(s).` : '';
  }

  /** "Imported 12 URL(s)." — empty when the import brought none (M32.6). */
  protected urlsSummary(result: ImportResultView): string {
    const imported = result.importedUrlCount ?? 0;
    return imported > 0 ? `Imported ${imported} URL(s).` : '';
  }

  /** The badge of an asset left out of the import: a record outside a record set says what it is. */
  protected notImportedLabel(type: string | undefined): string {
    return type === 'RECORD_OUTSIDE_RECORD_SET' ? 'Record will not be imported' : 'Will not be imported';
  }

  // ── File selection ──────────────────────────────────────────────────────

  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.pickFile(input.files?.[0] ?? null);
    input.value = '';
  }

  onDragEnter(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) {
      return;
    }
    this.dragCounter.update((n) => n + 1);
  }

  onDragLeave(): void {
    this.dragCounter.update((n) => Math.max(0, n - 1));
  }

  onDrop(event: DragEvent): void {
    this.dragCounter.set(0);
    if (!event.dataTransfer?.types.includes('Files')) {
      return;
    }
    this.pickFile(event.dataTransfer.files?.[0] ?? null);
  }

  protected onToggleSkipExistingImplicit(event: Event): void {
    this.skipExistingImplicit$.next((event.target as HTMLInputElement).checked);
  }

  protected onReleaseModeChange(mode: ReleaseMode): void {
    this.releaseMode.set(mode);
  }

  protected onImportSchedulesChange(importSchedules: boolean): void {
    this.importSchedules.set(importSchedules);
  }

  protected onUrlRegistryModeChange(mode: UrlRegistryImportMode): void {
    this.urlRegistryMode.set(mode);
  }

  private pickFile(file: File | null): void {
    if (!file || this.readOnly()) {
      return;
    }
    if (!file.name.toLowerCase().endsWith('.zip')) {
      this.pickError.set(`"${file.name}" is not a .zip archive — pick a .zip export file.`);
      return;
    }
    this.pickError.set(null);
    this.result.set(null);
    this.commitError.set(null);
    this.releaseMode.set('KEEP');
    this.archiveHasReleaseState.set(null);
    this.importSchedules.set(true);
    this.archiveScheduleCount.set(null);
    this.urlRegistryMode.set('ARCHIVE_WINS');
    this.archiveUrlCount.set(null);
    // Setting `file` here triggers the constructor's analyze-on-change effect below — no
    // direct `analyze()` call needed.
    this.file.set(file);
  }

  private analyze(
    file: File,
    skipExistingImplicit: boolean,
    releaseMode: ReleaseMode,
    importSchedules: boolean,
    urlRegistryMode: UrlRegistryImportMode,
  ): void {
    this.analyzing.set(true);
    this.report.set(null);
    this.analysis?.unsubscribe();
    this.analysis = this.api
      .analyzeImport(this.projectKey(), file, skipExistingImplicit, releaseMode, importSchedules, urlRegistryMode)
      .subscribe({
        next: (report) => {
          this.analyzing.set(false);
          this.report.set(report);
          this.archiveHasReleaseState.set(report.releaseState !== false);
          this.archiveScheduleCount.set(report.scheduleCount ?? 0);
          this.archiveUrlCount.set(report.urlCount ?? 0);
        },
        error: () => {
          this.analyzing.set(false);
          this.pickError.set('Could not analyze that archive — check your connection and try again.');
          this.file.set(null);
        },
      });
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  cancel(): void {
    this.analysis?.unsubscribe();
    this.analysis = null;
    this.analyzing.set(false);
    this.file.set(null);
    this.report.set(null);
    this.pickError.set(null);
    this.commitError.set(null);
    this.result.set(null);
    this.releaseMode.set('KEEP');
    this.archiveHasReleaseState.set(null);
    this.importSchedules.set(true);
    this.archiveScheduleCount.set(null);
    this.urlRegistryMode.set('ARCHIVE_WINS');
    this.archiveUrlCount.set(null);
  }

  commit(): void {
    const file = this.file();
    if (!file || this.blocksImport() || this.committing() || this.readOnly()) {
      return;
    }
    this.committing.set(true);
    this.commitError.set(null);
    // Without release state the server imports drafts whatever is sent; send what the analysis applied.
    const releaseMode: ReleaseMode = this.archiveHasReleaseState() === false ? 'DRAFT' : this.releaseMode();
    const importSchedules = this.importSchedules();
    this.api
      .commitImport(
        this.projectKey(),
        file,
        this.skipExistingImplicit(),
        releaseMode,
        importSchedules,
        this.urlRegistryMode(),
      )
      .subscribe({
      next: (result) => {
        this.committing.set(false);
        this.result.set(result);
        this.file.set(null);
        this.report.set(null);
        this.archiveHasReleaseState.set(null);
        this.archiveScheduleCount.set(null);
        this.archiveUrlCount.set(null);
        // A committed import can create folders (and move/rename existing ones) that
        // `ProjectContextStore`'s folder trees — loaded once per project and otherwise only
        // refreshed by each store screen's own CRUD actions — have no other way to learn about,
        // so without this every Pages/Media/Navigation/Templates tree keeps showing pre-import
        // folder structure until a full page reload re-fetches the store from scratch.
        this.store.loadFor(this.projectKey(), true).subscribe();
        const updated = result.updatedAssetCount ?? 0;
        const released = result.releasedCount ?? 0;
        const schedules = (result.importedScheduleCount ?? 0) + (result.updatedScheduleCount ?? 0);
        const redirects = result.importedRedirectCount ?? 0;
        const urls = result.importedUrlCount ?? 0;
        this.toasts.show(
          `Imported ${result.importedAssetCount ?? 0} asset(s)`
            + (updated > 0 ? `, overwrote ${updated}` : '')
            + `, ${result.importedBlobCount ?? 0} blob(s)`
            + (released > 0 ? `, ${released} release(s) kept` : '')
            + (schedules > 0 ? `, ${schedules} schedule(s)` : '')
            + (redirects > 0 ? `, ${redirects} redirect(s)` : '')
            + (urls > 0 ? `, ${urls} URL(s)` : ''),
          'success',
        );
      },
      error: (err) => {
        this.committing.set(false);
        const freshConflicts: ImportConflictView[] | null = extractConflicts(err);
        if (freshConflicts) {
          this.report.set({
            conflicts: freshConflicts,
            hasBlocking: freshConflicts.some((c) => c.severity === 'BLOCKING'),
            blocksImport: freshConflicts.some(refusesImport),
            releaseState: this.archiveHasReleaseState() !== false,
            releaseMode,
            scheduleCount: this.archiveScheduleCount() ?? 0,
            urlCount: this.archiveUrlCount() ?? 0,
          });
          this.commitError.set(
            'Conflicts changed since you last checked this archive — please re-check it.',
          );
          return;
        }
        this.commitError.set('Could not complete the import — try again in a moment.');
        this.toasts.show('Could not complete the import — try again in a moment.', 'error');
      },
    });
  }
}
