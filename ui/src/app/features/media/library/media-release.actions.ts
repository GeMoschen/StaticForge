import { Injectable, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { EditingLocaleStore } from '../../../core/project/editing-locale.store';
import { LocalesStore } from '../../../core/project/locales.store';
import { ProjectPermissionsStore } from '../../../core/project/project-permissions.store';
import { ToastService } from '../../../core/ui/toast.service';
import { type ReleaseChoice, type ReleaseSubject, choicesFor } from '../../release/release-choice.util';
import { type FolderView, type MediaSummaryView, MediaLibraryStore } from './media-library.store';

/** Every folder of a forest, depth first. */
function withDescendants(folder: FolderView): FolderView[] {
  return [folder, ...(folder.children ?? []).flatMap(withDescendants)];
}

/**
 * *Release…* for the media library, in one place for the folder tree, the grid and the list: files release as themselves, a
 * folder releases with everything inside it (its sub-folders and every file below it, from the project-wide file list), all
 * choices ticked. The choices go to {@link choices}; the screen shows the shared release dialog while it is set.
 */
@Injectable()
export class MediaReleaseActions {
  private readonly library = inject(MediaLibraryStore);
  private readonly permissions = inject(ProjectPermissionsStore);
  private readonly editingLocale = inject(EditingLocaleStore);
  private readonly locales = inject(LocalesStore);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  /** The choices of the open release dialog; `null` while it is closed. */
  readonly choices = signal<ReleaseChoice[] | null>(null);

  /** Whether the person may release (an editor of a project that can be changed). */
  canRelease(): boolean {
    return this.permissions.canRelease() && this.library.canEdit();
  }

  /** Every file at or below a folder: the project-wide list, plus the open folder's own (it may be fresher). */
  private filesBelow(folder: FolderView): MediaSummaryView[] {
    const path = folder.path;
    if (!path) {
      return [];
    }
    const seen = new Set<string>();
    return [...this.library.items(), ...this.library.allMedia()].filter((file) => {
      const inside = !!file.uuid && !!file.folderPath?.startsWith(path) && !seen.has(file.uuid);
      if (inside) {
        seen.add(file.uuid as string);
      }
      return inside;
    });
  }

  /** The folders (each with what is below them) and files to release, as release subjects, without duplicates. */
  private subjects(files: readonly MediaSummaryView[], folders: readonly FolderView[]): ReleaseSubject[] {
    const subjects = new Map<string, ReleaseSubject>();
    const addFile = (file: MediaSummaryView) => {
      if (file.uuid && !subjects.has(file.uuid)) {
        subjects.set(file.uuid, {
          uuid: file.uuid,
          type: 'MEDIA',
          uid: file.uid,
          displayName: file.displayName,
          folderPath: file.folderPath,
          release: file.release,
        });
      }
    };
    for (const root of folders) {
      for (const folder of withDescendants(root)) {
        if (folder.uuid && !subjects.has(folder.uuid)) {
          subjects.set(folder.uuid, {
            uuid: folder.uuid,
            type: 'FOLDER',
            uid: folder.uid,
            displayName: folder.displayName,
            folderPath: folder.path,
            release: folder.release as ReleaseSubject['release'],
          });
        }
        this.filesBelow(folder).forEach(addFile);
      }
    }
    files.forEach(addFile);
    return [...subjects.values()];
  }

  /**
   * Opens the release dialog for the files and folders (a folder with everything inside it). With nothing waiting to be
   * released it only says so.
   */
  release(files: readonly MediaSummaryView[], folders: readonly FolderView[] = []): void {
    if (!this.canRelease()) {
      return;
    }
    const labelOf = (code: string) => this.locales.labelOf(code);
    const locale = this.editingLocale.locale();
    const choices = this.subjects(files, folders).flatMap((subject) =>
      choicesFor(subject, 'release', locale, labelOf).map((choice) => ({
        ...choice,
        label: `${choice.assetName} · ${choice.label}`,
        checked: true,
      })),
    );
    if (choices.length === 0) {
      this.toasts.show(this.transloco.translate('media.release.nothing'), 'info');
      return;
    }
    this.choices.set(choices);
  }

  /** The dialog is closed (released or cancelled). */
  close(): void {
    this.choices.set(null);
  }
}
