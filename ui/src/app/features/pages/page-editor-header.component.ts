import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import type { components } from '../../core/api/generated/schema.d.ts';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfUidRenameComponent } from '../../shared/components/sf-uid-rename.component';
import { PageNav, PageNavSettingsComponent } from './page-nav-settings.component';
import { PageEditorStore } from './page-editor.store';

type PageView = components['schemas']['PageView'];

/**
 * The page editor's header: the title with its metadata popover (display name, UID, navigation and search), the
 * language's translation count and the save status.
 */
@Component({
  selector: 'sf-page-editor-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent, SfUidRenameComponent, PageNavSettingsComponent],
  templateUrl: './page-editor-header.component.html',
  styleUrl: './page-editor-header.component.scss',
})
export class PageEditorHeaderComponent {
  private readonly api = inject(ApiClient);
  private readonly toast = inject(ToastService);
  protected readonly editor = inject(PageEditorStore);

  protected readonly metaOpen = signal(false);
  /** The page the meta popover was last shown for. */
  private metaUuid: string | null = null;
  protected readonly editingDisplayName = signal(false);
  protected readonly displayNameDraft = signal('');
  protected readonly savingDisplayName = signal(false);

  protected readonly statusLabel = computed(() => {
    const { timeTravel, autosave } = this.editor;
    if (timeTravel.isTimeTravel()) {
      return 'Viewing revision ' + (timeTravel.activeRevision() ?? '—');
    }
    if (this.editor.readOnly()) {
      return 'Archived — read-only';
    }
    switch (autosave.saveState()) {
      case 'dirty':
        return 'Unsaved';
      case 'saving':
        return 'Saving…';
      case 'saved':
        return 'Saved ' + (autosave.lastSavedAt() ?? '');
      case 'error':
        return 'Save failed';
      case 'rejected': {
        const errors = autosave.rejected().filter((f) => f.severity === 'ERROR').length;
        return `Not saved — fix ${errors} error${errors === 1 ? '' : 's'}`;
      }
      default:
        return '';
    }
  });

  constructor() {
    // The popover belongs to the page it was opened on; this editor is reused when another page is opened.
    effect(
      () => {
        const uuid = this.editor.uuid();
        if (uuid && uuid !== this.metaUuid) {
          this.metaUuid = uuid;
          untracked(() => this.closeMeta());
        }
      },
      { allowSignalWrites: true },
    );
  }

  protected toggleMeta(): void {
    this.metaOpen.update((v) => !v);
  }

  protected closeMeta(): void {
    this.metaOpen.set(false);
    this.editingDisplayName.set(false);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.metaOpen()) {
      this.closeMeta();
    }
  }

  /** A press anywhere outside the popover (and its title button) closes it — including on a button that opens a modal. */
  @HostListener('document:mousedown', ['$event'])
  protected onDocumentMouseDown(event: MouseEvent): void {
    if (this.metaOpen() && !(event.target as Element | null)?.closest?.('.page-editor__meta-anchor')) {
      this.closeMeta();
    }
  }

  protected startEditDisplayName(): void {
    this.displayNameDraft.set(this.editor.page()?.displayName ?? '');
    this.editingDisplayName.set(true);
  }

  protected cancelEditDisplayName(): void {
    this.editingDisplayName.set(false);
  }

  protected onDisplayNameInput(event: Event): void {
    this.displayNameDraft.set((event.target as HTMLInputElement).value);
  }

  protected saveDisplayName(): void {
    const name = this.displayNameDraft().trim();
    const key = this.editor.projectKey();
    const uuid = this.editor.uuid();
    if (!name || !key || !uuid || this.savingDisplayName()) {
      return;
    }
    this.savingDisplayName.set(true);
    this.api
      .renameAsset(key, uuid, { displayName: name }, this.editor.autosave.revision() ?? undefined)
      .subscribe({
        next: (detail) => {
          this.savingDisplayName.set(false);
          this.editingDisplayName.set(false);
          this.editor.page.update((cur) => (cur ? { ...cur, displayName: detail.displayName ?? name } : cur));
          if (detail.revision != null) {
            this.editor.autosave.setRevision(detail.revision);
          }
          this.toast.show('Page renamed', 'success');
          this.editor.notifyOwnChange();
        },
        error: () => {
          this.savingDisplayName.set(false);
          this.toast.show('Could not rename page — try again in a moment.', 'error');
        },
      });
  }

  /** The page's `nav` settings (a `JsonNode` in the API types). */
  protected navOf(page: PageView): PageNav | undefined {
    return page.nav as PageNav | undefined;
  }

  /** "Show in navigation" / "Hide from search engines" (M30.2.2): saved with the page right away. */
  protected onNavChange(nav: PageNav): void {
    if (this.editor.readOnly()) {
      return;
    }
    this.editor.page.update((cur) => (cur ? { ...cur, nav: nav as PageView['nav'] } : cur));
    this.editor.autosave.markDirty();
    this.editor.autosave.flush();
  }

  protected onUidChanged(newUid: string): void {
    this.editor.page.update((cur) => (cur ? { ...cur, uid: newUid } : cur));
    this.editor.notifyOwnChange();
  }
}
