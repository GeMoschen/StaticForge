import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { tap } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ToastService } from '../../core/ui/toast.service';
import { UndoService } from '../../core/ui/undo.service';
import { SfAssetPickerDialogComponent, type AssetPicked } from '../../shared/components/sf-asset-picker-dialog.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { assetName } from '../release/release-choice.util';
import { RedirectAfterService } from '../release/redirect-after.service';
import { RedirectOptionComponent } from '../release/redirect-option.component';
import { type RedirectIntent, type RedirectSource, NO_REDIRECT, intentReady } from '../release/redirect-option.util';
import { deleteQuestion, isOnline } from '../release/release-status.util';
import { restoreDeletedAsset } from '../../shared/restore-deleted-asset';
import { PagesTreeRefresh } from './pages-tree-refresh.service';

type AssetSummaryView = components['schemas']['AssetSummaryView'];

/**
 * Deleting a page from the page tree (M27 epic decision 8, M30.6.3). A published page stays online until the deletion
 * is released; for such a page the dialog offers "Redirect old URL to…" to whoever may unpublish — the redirect is
 * written after the delete succeeded and takes effect once a build no longer contains the page.
 */
@Component({
  selector: 'sf-page-delete-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfAssetPickerDialogComponent, SfButtonComponent, SfSpinnerComponent, RedirectOptionComponent],
  templateUrl: './page-delete-dialog.component.html',
  styleUrl: './page-delete-dialog.component.scss',
})
export class PageDeleteDialogComponent {
  private readonly api = inject(ApiClient);
  private readonly toast = inject(ToastService);
  private readonly undo = inject(UndoService);
  private readonly treeRefresh = inject(PagesTreeRefresh);
  private readonly permissions = inject(ProjectPermissionsStore);
  private readonly redirectAfter = inject(RedirectAfterService);

  readonly projectKey = input.required<string>();
  readonly page = input.required<AssetSummaryView>();

  readonly deleted = output<void>();
  readonly closed = output<void>();

  private readonly redirectOption = viewChild(RedirectOptionComponent);

  protected readonly submitting = signal(false);
  protected readonly pickingRedirect = signal(false);
  protected readonly redirectIntent = signal<RedirectIntent>(NO_REDIRECT);

  protected readonly name = computed(() => assetName(this.page()));
  protected readonly online = computed(() => isOnline(this.page().release));
  protected readonly question = computed(() =>
    deleteQuestion(`Delete "${this.name()}"?`, this.page().release),
  );
  protected readonly redirectSources = computed<RedirectSource[]>(() => {
    const page = this.page();
    return page.uuid ? [{ uuid: page.uuid, name: this.name(), folderPath: page.folderPath }] : [];
  });
  /** Only a page with a released version has URLs to redirect. */
  protected readonly offersRedirect = computed(
    () => this.online() && this.permissions.canRedirectOldUrls() && this.redirectSources().length > 0,
  );
  protected readonly canSubmit = computed(
    () => !this.submitting() && (!this.offersRedirect() || intentReady(this.redirectIntent())),
  );

  /** Escape goes through the shortcut registry, which orders it among the open layers (M35.14). */
  private readonly escapeShortcut = inject(ShortcutService).useEscape(() => this.onEscape());

  protected onEscape(): void {
    if (this.pickingRedirect()) {
      this.pickingRedirect.set(false);
      return;
    }
    this.close();
  }

  protected close(): void {
    if (!this.submitting()) {
      this.closed.emit();
    }
  }

  protected onRedirectPicked(picked: AssetPicked): void {
    this.pickingRedirect.set(false);
    this.redirectOption()?.choose(picked);
  }

  protected submit(): void {
    const uuid = this.page().uuid;
    if (!uuid || !this.canSubmit()) {
      return;
    }
    const online = this.online();
    const redirect = this.offersRedirect() ? this.redirectIntent() : NO_REDIRECT;
    const sources = this.redirectSources();
    const key = this.projectKey();
    this.submitting.set(true);
    this.api.deleteAsset(this.projectKey(), uuid).subscribe({
      next: () => {
        this.submitting.set(false);
        const name = this.name();
        const message = online ? `Deleted “${name}”. It stays online until you release the deletion.` : `Deleted “${name}”.`;
        // Undo restores the page from its last live revision.
        this.undo.offer(message, () => restoreDeletedAsset(this.api, key, uuid).pipe(tap(() => this.treeRefresh.notify())));
        if (redirect.wanted && redirect.page) {
          this.redirectAfter.redirect(this.projectKey(), sources, redirect.page);
        }
        this.deleted.emit();
        this.closed.emit();
      },
      error: () => {
        this.submitting.set(false);
        this.toast.show('Could not delete page — try again in a moment.', 'error');
      },
    });
  }
}
