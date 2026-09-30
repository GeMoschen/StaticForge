import { computed, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, Subject, type Subscription } from 'rxjs';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { refusesImport, rejectsAssetOnly } from './import-conflicts.util';
import {
  ConflictReportView,
  ImportConflictView,
  ImportExportService,
  ImportResultView,
  ReleaseMode,
  UrlRegistryImportMode,
  extractConflicts,
} from './import-export.service';

/**
 * Feature-scoped state of the import panel (provided by `ProjectSettingsImportComponent`): the picked archive, the
 * options that are re-analyzed live, the conflict report and the commit result. The options, report and result
 * sub-components read it directly; the host component owns the effects that react to it.
 */
@Injectable()
export class ImportSessionStore {
  private readonly api = inject(ImportExportService);
  private readonly toasts = inject(ToastService);
  private readonly context = inject(ProjectContextStore);

  /** Time travel or an archived project (M26). */
  readonly readOnly = inject(ProjectAccessStore).readOnly;

  readonly file = signal<File | null>(null);
  readonly analyzing = signal(false);
  readonly report = signal<ConflictReportView | null>(null);
  readonly pickError = signal<string | null>(null);

  /** "Skip ancestor folders that already exist" (M11.3.3) — re-analyzes live on toggle, debounced against rapid clicking, so the Blocking/Warnings split always reflects the current toggle state before commit. */
  readonly skipExistingImplicit = signal(false);
  private readonly skipExistingImplicit$ = new Subject<boolean>();

  /** Keep the archive's release state, or import everything as a draft (M27.5.2). */
  readonly releaseMode = signal<ReleaseMode>('KEEP');
  /**
   * Whether the loaded archive carries release state, from its last analysis; `null` until one answers. Kept apart
   * from `report` so the choice doesn't disappear while a changed option is re-analyzed.
   */
  readonly archiveHasReleaseState = signal<boolean | null>(null);

  /** Import the archive's schedules, or leave them out (M27.8.2). */
  readonly importSchedules = signal(true);
  /** How many schedules the loaded archive carries, from its last analysis; `null` until one answers. */
  readonly archiveScheduleCount = signal<number | null>(null);

  /** How the archive's URLs meet the project's existing ones (M32.6). */
  readonly urlRegistryMode = signal<UrlRegistryImportMode>('ARCHIVE_WINS');
  /** How many URL registry rows the loaded archive carries, from its last analysis; `null` until one answers. */
  readonly archiveUrlCount = signal<number | null>(null);

  /** The analysis in flight — dropped when the archive or the project changes before it answers. */
  private analysis: Subscription | null = null;

  readonly committing = signal(false);
  readonly commitError = signal<string | null>(null);
  readonly result = signal<ImportResultView | null>(null);

  /** Conflicts that refuse the whole import. */
  readonly blocking = computed(() => (this.report()?.conflicts ?? []).filter(refusesImport));
  /** Assets the import leaves out while the rest of the archive imports. */
  readonly rejected = computed(() => (this.report()?.conflicts ?? []).filter(rejectsAssetOnly));
  readonly warnings = computed(
    () => (this.report()?.conflicts ?? []).filter((c) => c.severity === 'WARNING'),
  );
  /** Whether the server would refuse this import — the only thing that disables "Import". */
  readonly blocksImport = computed(
    () => this.report()?.blocksImport === true || this.blocking().length > 0,
  );
  readonly noConflicts = computed(
    () => this.blocking().length === 0 && this.rejected().length === 0 && this.warnings().length === 0,
  );

  constructor() {
    this.skipExistingImplicit$
      .pipe(debounceTime(250), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((value) => {
        this.skipExistingImplicit.set(value);
      });
  }

  /** Requests a new value of the "skip existing ancestor folders" toggle (debounced, then re-analyzed by the host). */
  requestSkipExistingImplicit(value: boolean): void {
    this.skipExistingImplicit$.next(value);
  }

  pickFile(file: File | null): void {
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
    this.resetArchiveOptions();
    // Setting `file` here triggers the host's analyze-on-change effect — no direct `analyze()` call needed.
    this.file.set(file);
  }

  private resetArchiveOptions(): void {
    this.releaseMode.set('KEEP');
    this.archiveHasReleaseState.set(null);
    this.importSchedules.set(true);
    this.archiveScheduleCount.set(null);
    this.urlRegistryMode.set('ARCHIVE_WINS');
    this.archiveUrlCount.set(null);
  }

  analyze(
    projectKey: string,
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
      .analyzeImport(projectKey, file, skipExistingImplicit, releaseMode, importSchedules, urlRegistryMode)
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
    this.resetArchiveOptions();
  }

  commit(projectKey: string): void {
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
        projectKey,
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
        this.context.loadFor(projectKey, true).subscribe();
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
