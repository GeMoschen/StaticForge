import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import {
  ConflictReportView,
  ImportConflictView,
  ImportExportService,
  ImportResultView,
  extractConflicts,
} from './import-export.service';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfDropTargetDirective } from '../../shared/directives/sf-drop-target.directive';

/** Material Symbols icon per `ConflictType` — a reasonable visual cue, not meant to be pixel-perfect. */
const CONFLICT_ICONS: Record<string, string> = {
  PROTOCOL_VERSION_MISMATCH: 'warning',
  DUPLICATE_UUID: 'content_copy',
  MISSING_TEMPLATE_REFERENCE: 'link_off',
  MISSING_PARENT_FOLDER: 'folder_off',
  SETTINGS_KEY_COLLISION: 'settings',
};

/**
 * Project settings tab: "Import" half of `M10`'s selective export/import feature —
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

  protected readonly dragCounter = signal(0);
  protected readonly dragActive = computed(() => this.dragCounter() > 0);

  protected readonly file = signal<File | null>(null);
  protected readonly analyzing = signal(false);
  protected readonly report = signal<ConflictReportView | null>(null);
  protected readonly pickError = signal<string | null>(null);

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

  private pickFile(file: File | null): void {
    if (!file) {
      return;
    }
    if (!file.name.toLowerCase().endsWith('.zip')) {
      this.pickError.set(`"${file.name}" is not a .zip archive — pick a .zip export file.`);
      return;
    }
    this.pickError.set(null);
    this.result.set(null);
    this.commitError.set(null);
    this.file.set(file);
    this.analyze(file);
  }

  private analyze(file: File): void {
    this.analyzing.set(true);
    this.report.set(null);
    this.api.analyzeImport(this.projectKey(), file).subscribe({
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
    if (!file || this.hasBlocking() || this.committing()) {
      return;
    }
    this.committing.set(true);
    this.commitError.set(null);
    this.api.commitImport(this.projectKey(), file).subscribe({
      next: (result) => {
        this.committing.set(false);
        this.result.set(result);
        this.file.set(null);
        this.report.set(null);
        this.toasts.show(
          `Imported ${result.importedAssetCount ?? 0} asset(s), ${result.importedBlobCount ?? 0} blob(s)`,
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
