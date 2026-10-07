import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { autosaveStatus } from '../../core/editor/autosave-editor-state';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { ToastService } from '../../core/ui/toast.service';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfSaveStatusComponent } from '../../shared/components/layout/sf-save-status.component';
import type { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import { SfAssetFavoriteComponent } from '../../shared/components/sf-asset-favorite.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { ReleaseActionsComponent } from '../release/release-actions.component';
import { PageDeleteDialogComponent } from './page-delete-dialog.component';
import { PageEditorStore } from './page-editor.store';
import { PagesTreeRefresh } from './pages-tree-refresh.service';


/**
 * The page editor's header (M35.18): the page's name as the `h1`, its favorite star and the language's translation count;
 * the save status, **Issues** (with the count of what is wrong), **Page settings** and the **Preview** toggle; the release
 * actions as one group (status per language, Release…, Schedule…, ⋮) and, last, the page's own ⋮ menu — Save now,
 * Duplicate, Rename…, Copy link, Page settings…, Delete…. Issues and settings are drawers the page editor renders; the
 * buttons only flip the store's flags.
 */
@Component({
  selector: 'sf-page-editor-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageDeleteDialogComponent,
    ReleaseActionsComponent,
    SfAssetFavoriteComponent,
    SfBadgeComponent,
    SfButtonComponent,
    SfPageHeaderComponent,
    SfSaveStatusComponent,
    TranslocoPipe,
  ],
  templateUrl: './page-editor-header.component.html',
  styleUrl: './page-editor-header.component.scss',
})
export class PageEditorHeaderComponent {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly treeRefresh = inject(PagesTreeRefresh);
  protected readonly editor = inject(PageEditorStore);
  protected readonly developerMode = inject(DeveloperModeService).enabled;

  protected readonly deleting = signal(false);

  protected readonly title = computed(() => {
    const page = this.editor.page();
    return page?.displayName || page?.uid || this.transloco.translate('pages.editor.title');
  });

  /** Why the page cannot be edited (time travel, archived); the save status is for a page that can. */
  protected readonly readOnlyLabel = computed(() => {
    const { timeTravel } = this.editor;
    if (timeTravel.isTimeTravel()) {
      return this.transloco.translate('pages.editor.status.revision', { revision: timeTravel.activeRevision() ?? '—' });
    }
    return this.editor.readOnly() ? this.transloco.translate('pages.editor.status.archived') : '';
  });

  /** The save status (M35.13): the same words and look in every editor. */
  protected readonly status = computed(() => autosaveStatus(this.editor.autosave));
  protected readonly savedAt = computed(() => this.editor.autosave.lastSavedAt());

  /** The page as the delete dialog wants it. */
  protected readonly summary = computed<components['schemas']['AssetSummaryView'] | null>(() => {
    const page = this.editor.page();
    return page
      ? { uuid: page.uuid, uid: page.uid, displayName: page.displayName, folderPath: page.folderPath, release: page.release }
      : null;
  });

  protected readonly moreActions = computed<SfMenuItem[]>(() => {
    const t = (key: string) => this.transloco.translate(`pages.editor.menu.${key}`);
    const readOnly = this.editor.readOnly();
    return [
      { id: 'saveNow', label: t('saveNow'), icon: 'save', disabled: readOnly },
      { id: 'duplicate', label: t('duplicate'), icon: 'content_copy', disabled: readOnly },
      { id: 'rename', label: t('rename'), icon: 'edit', disabled: readOnly },
      { id: 'copyLink', label: t('copyLink'), icon: 'link', separatorBefore: true },
      { id: 'settings', label: t('settings'), icon: 'tune' },
      { id: 'delete', label: t('delete'), icon: 'delete', danger: true, disabled: readOnly, separatorBefore: true },
    ];
  });


  protected onMore(item: SfMenuItem): void {
    switch (item.id) {
      case 'saveNow':
        void this.editor.autosave.flush();
        break;
      case 'duplicate':
        this.duplicate();
        break;
      case 'rename':
        this.editor.toggleSettings(true, true);
        break;
      case 'copyLink':
        void this.copyLink();
        break;
      case 'settings':
        this.editor.toggleSettings(true);
        break;
      case 'delete':
        this.deleting.set(true);
        break;
    }
  }

  /** The page was deleted: the editor has nothing left to show, so it returns to the pages area. */
  protected onDeleted(): void {
    this.deleting.set(false);
    void this.router.navigate(['/p', this.editor.projectKey(), 'pages']);
  }

  private duplicate(): void {
    this.api.duplicateAsset(this.editor.projectKey(), this.editor.uuid()).subscribe({
      next: (copy) => {
        this.treeRefresh.notify();
        this.toast.show(this.transloco.translate('pages.editor.toast.duplicated', { name: copy.displayName ?? copy.uid }), 'success');
        if (copy.uuid) {
          void this.router.navigate(['/p', this.editor.projectKey(), 'pages', copy.uuid]);
        }
      },
      error: () => this.toast.show(this.transloco.translate('pages.editor.toast.duplicateFailed'), 'error'),
    });
  }

  private async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(location.href);
      this.toast.show(this.transloco.translate('pages.editor.toast.linkCopied'), 'success');
    } catch {
      this.toast.show(this.transloco.translate('pages.editor.toast.linkFailed'), 'error');
    }
  }
}
