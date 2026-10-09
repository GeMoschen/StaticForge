import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { ExportOptionsComponent } from './export-options.component';
import { ExportSelectionStore } from './export-selection.store';
import { ExportTreeData } from './export-tree-data.service';
import { ExportTreeSectionComponent } from './export-tree-section.component';
import { ExportSelectionRequest, ImportExportService } from './import-export.service';

/**
 * Project settings tab: "Export" half of `M10`/`M11`'s selective export/import — lets the user
 * pick a subset of the project's pages/media/navigation (via the three folder trees loaded by
 * `ProjectContextStore`), page/section templates (flat searchable lists), whole-store picks, and
 * channels/generation-targets toggles, then downloads the resulting ZIP. Standalone/OnPush, signals for
 * state, services via `inject()`, reload-on-`projectKey`-change effect.
 *
 * All five selection sources (three trees + two template lists) write into the single `selected`
 * uuid set — uuids are globally unique server-side, so no merge step is needed; `exportNow()`'s
 * `assetUuids` is simply `Array.from(selected())`.
 */
@Component({
  selector: 'sf-project-settings-export',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent, SfSpinnerComponent, ExportOptionsComponent, ExportTreeSectionComponent],
  providers: [ExportTreeData, ExportSelectionStore],
  templateUrl: './project-settings-export.component.html',
  styleUrl: './project-settings-export.component.scss',
})
export class ProjectSettingsExportComponent {
  readonly projectKey = input.required<string>();

  protected readonly store = inject(ProjectContextStore);
  protected readonly sel = inject(ExportSelectionStore);
  private readonly data = inject(ExportTreeData);
  private readonly importExport = inject(ImportExportService);
  private readonly toasts = inject(ToastService);

  protected readonly exporting = signal(false);
  protected readonly exportError = signal<string | null>(null);

  constructor() {
    effect(() => {
      const key = this.projectKey();
      if (!key) {
        return;
      }
      untracked(() => this.data.load(key));
    });
  }

  // ── Export ───────────────────────────────────────────────────────────────

  protected exportNow(): void {
    if (this.sel.exportDisabled() || this.exporting()) {
      return;
    }
    const request: ExportSelectionRequest = {
      assetUuids: Array.from(this.sel.selected()),
      includeChannels: this.sel.includeChannels(),
      includeGenerationTargets: this.sel.includeGenerationTargets(),
      fullStores: Array.from(this.sel.fullStores()),
      includeSchedules: this.sel.includeSchedules(),
    };
    this.exporting.set(true);
    this.exportError.set(null);
    this.importExport.exportSelection(this.projectKey(), request).subscribe({
      next: (blob) => {
        this.exporting.set(false);
        this.triggerDownload(blob, `${this.projectKey()}-export.zip`);
        this.toasts.show('Export ready — download started.', 'success');
      },
      error: () => {
        this.exporting.set(false);
        this.exportError.set('Could not export — try again in a moment.');
        this.toasts.show('Could not export — try again in a moment.', 'error');
      },
    });
  }

  private triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}
