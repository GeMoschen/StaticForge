import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfDropTargetDirective } from '../../shared/directives/sf-drop-target.directive';
import { ImportConflictReportComponent } from './import-conflict-report.component';
import { ImportOptionsComponent } from './import-options.component';
import { ImportResultComponent } from './import-result.component';
import { ImportSessionStore } from './import-session.store';

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
    SfIconComponent,
    SfSpinnerComponent,
    SfDropTargetDirective,
    ImportConflictReportComponent,
    ImportOptionsComponent,
    ImportResultComponent,
  ],
  providers: [ImportSessionStore],
  templateUrl: './project-settings-import.component.html',
  styleUrl: './project-settings-import.component.scss',
})
export class ProjectSettingsImportComponent {
  readonly projectKey = input.required<string>();

  protected readonly sess = inject(ImportSessionStore);

  protected readonly dragCounter = signal(0);
  protected readonly dragActive = computed(() => this.dragCounter() > 0);

  constructor() {
    // Re-run analysis whenever the toggle settles on a new value, as long as a file is loaded —
    // keeps the displayed Blocking/Warnings split in sync with the option that will actually be
    // sent to `commitImport()`.
    effect(() => {
      const skip = this.sess.skipExistingImplicit();
      const releaseMode = this.sess.releaseMode();
      const importSchedules = this.sess.importSchedules();
      const urlRegistryMode = this.sess.urlRegistryMode();
      const file = this.sess.file();
      if (!file) {
        return;
      }
      untracked(() => this.sess.analyze(this.projectKey(), file, skip, releaseMode, importSchedules, urlRegistryMode));
    });

    // The router reuses this screen when only the project changes (`/p/a/settings/…` → `/p/b/settings/…`): an
    // archive loaded and analyzed for the previous project must not stay armed for this one — its report was
    // checked against the other project, and "Import" would commit into this one.
    let shownFor: string | null = null;
    effect(() => {
      const key = this.projectKey();
      if (shownFor !== null && shownFor !== key) {
        untracked(() => this.sess.cancel());
      }
      shownFor = key;
    });
  }

  // ── File selection ──────────────────────────────────────────────────────

  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.sess.pickFile(input.files?.[0] ?? null);
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
    this.sess.pickFile(event.dataTransfer.files?.[0] ?? null);
  }

  cancel(): void {
    this.sess.cancel();
  }

  commit(): void {
    this.sess.commit(this.projectKey());
  }
}
