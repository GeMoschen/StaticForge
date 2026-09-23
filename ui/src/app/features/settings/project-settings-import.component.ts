import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import {
  ConflictReportView,
  ImportConflictView,
  ImportExportService,
  ImportResultView,
  extractConflicts,
} from './import-export.service';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfDropTargetDirective } from '../../shared/directives/sf-drop-target.directive';

/**
 * Material Symbols icon per `ConflictType` — a reasonable visual cue, not meant to be pixel-perfect. Keyed by the
 * plain string the API sends (`ImportConflictView.type` is not an enum in the schema), so a type the server adds
 * later just falls back to `info`; the four record-set conflicts (M25) are mapped ahead of the backend.
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
  PARENT_TEMPLATE_MISSING: 'link_off',
  MISSING_PARENT_FOLDER: 'folder_off',
  SETTINGS_KEY_COLLISION: 'settings',
  TARGET_PATH_COLLISION: 'drive_file_move',
  LOCALE_CONFIG_MISMATCH: 'translate',
  LOCALIZATION_SHAPE_MISMATCH: 'translate',
};

/**
 * Project settings tab: "Import" half of `M10`/`M11`'s selective export/import feature —
 * pick a `.zip` archive, analyze it for conflicts, then let the user cancel or commit.
 * Same standalone/OnPush/signals shape as `project-settings-url-registry.component`.
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
  private readonly timeTravel = inject(TimeTravelStore);

  protected readonly readOnly = this.timeTravel.isTimeTravel;

  protected readonly dragCounter = signal(0);
  protected readonly dragActive = computed(() => this.dragCounter() > 0);

  protected readonly file = signal<File | null>(null);
  protected readonly analyzing = signal(false);
  protected readonly report = signal<ConflictReportView | null>(null);
  protected readonly pickError = signal<string | null>(null);

  /** "Skip ancestor folders that already exist" (M11.3.3) — re-analyzes live on toggle, debounced against rapid clicking, so the Blocking/Warnings split always reflects the current toggle state before commit. */
  protected readonly skipExistingImplicit = signal(false);
  private readonly skipExistingImplicit$ = new Subject<boolean>();

  protected readonly committing = signal(false);
  protected readonly commitError = signal<string | null>(null);
  protected readonly result = signal<ImportResultView | null>(null);

  protected readonly blocking = computed(
    () => (this.report()?.conflicts ?? []).filter((c) => c.severity === 'BLOCKING'),
  );
  protected readonly warnings = computed(
    () => (this.report()?.conflicts ?? []).filter((c) => c.severity === 'WARNING'),
  );
  protected readonly hasBlocking = computed(
    () => this.report()?.hasBlocking === true || this.blocking().length > 0,
  );
  protected readonly noConflicts = computed(
    () => this.blocking().length === 0 && this.warnings().length === 0,
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
      const file = this.file();
      if (!file) {
        return;
      }
      untracked(() => this.analyze(file, skip));
    });
  }

  protected iconFor(type: string | undefined): string {
    return CONFLICT_ICONS[type ?? ''] ?? 'info';
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
    // Setting `file` here triggers the constructor's analyze-on-change effect below — no
    // direct `analyze()` call needed.
    this.file.set(file);
  }

  private analyze(file: File, skipExistingImplicit: boolean): void {
    this.analyzing.set(true);
    this.report.set(null);
    this.api.analyzeImport(this.projectKey(), file, skipExistingImplicit).subscribe({
      next: (report) => {
        this.analyzing.set(false);
        this.report.set(report);
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
    this.file.set(null);
    this.report.set(null);
    this.pickError.set(null);
    this.commitError.set(null);
    this.result.set(null);
  }

  commit(): void {
    const file = this.file();
    if (!file || this.hasBlocking() || this.committing() || this.readOnly()) {
      return;
    }
    this.committing.set(true);
    this.commitError.set(null);
    this.api.commitImport(this.projectKey(), file, this.skipExistingImplicit()).subscribe({
      next: (result) => {
        this.committing.set(false);
        this.result.set(result);
        this.file.set(null);
        this.report.set(null);
        // A committed import can create folders (and move/rename existing ones) that
        // `ProjectContextStore`'s folder trees — loaded once per project and otherwise only
        // refreshed by each store screen's own CRUD actions — have no other way to learn about,
        // so without this every Pages/Media/Navigation/Templates tree keeps showing pre-import
        // folder structure until a full page reload re-fetches the store from scratch.
        this.store.loadFor(this.projectKey(), true).subscribe();
        const updated = result.updatedAssetCount ?? 0;
        this.toasts.show(
          `Imported ${result.importedAssetCount ?? 0} asset(s)`
            + (updated > 0 ? `, overwrote ${updated}` : '')
            + `, ${result.importedBlobCount ?? 0} blob(s)`,
          'success',
        );
      },
      error: (err) => {
        this.committing.set(false);
        const freshConflicts: ImportConflictView[] | null = extractConflicts(err);
        if (freshConflicts) {
          this.report.set({ conflicts: freshConflicts, hasBlocking: freshConflicts.some((c) => c.severity === 'BLOCKING') });
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
