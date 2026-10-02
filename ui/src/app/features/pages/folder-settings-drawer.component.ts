import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { tap } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ToastService } from '../../core/ui/toast.service';
import { UndoService } from '../../core/ui/undo.service';
import { SfDrawerComponent } from '../../shared/components/dialog/sf-drawer.component';
import { SfInputComponent } from '../../shared/components/forms/sf-input.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfUidRenameComponent } from '../../shared/components/sf-uid-rename.component';
import { SfAssetUrlsComponent } from '../settings/asset-urls.component';
import { PagesTreeRefresh } from './pages-tree-refresh.service';

type FolderView = components['schemas']['FolderView'];

/**
 * Folder settings (M35.18, gate decision 83): a non-modal drawer below the top bar, opened by *Folder settings…* in the
 * folder's ⋮ menu. It replaces the metadata panel that used to sit beside the tree. A rename and a UID change apply at once
 * (their own server calls) and offer Undo in a toast; the address section lists the folder's URLs (and lets a developer
 * rewrite them); the facts say where the folder lives and what it contains.
 */
@Component({
  selector: 'sf-folder-settings-drawer',
  standalone: true,
  imports: [SfAssetUrlsComponent, SfButtonComponent, SfDrawerComponent, SfFieldComponent, SfInputComponent, SfUidRenameComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './folder-settings-drawer.component.scss',
  template: `
    <sf-drawer [title]="'pages.folder.settings.title' | transloco" [width]="440" (closed)="closed.emit()">
      <section class="settings__section" aria-labelledby="folder-settings-name">
        <h3 class="settings__heading" id="folder-settings-name">{{ 'pages.folder.settings.name' | transloco }}</h3>
        @if (renaming()) {
          <sf-field [label]="'pages.folder.settings.nameLabel' | transloco" [findings]="nameFindings()">
            <sf-input
              data-sf-autofocus
              [value]="draft()"
              (valueChange)="draft.set($event)"
              (keydown.enter)="saveName()"
              (keydown.escape)="cancelRename()"
            />
          </sf-field>
          <div class="settings__row">
            <sf-button variant="ghost" size="sm" (click)="cancelRename()">{{ 'common.cancel' | transloco }}</sf-button>
            <sf-button size="sm" [disabled]="!canSave()" (click)="saveName()">{{ 'pages.folder.settings.save' | transloco }}</sf-button>
          </div>
        } @else {
          <div class="settings__row is-spread">
            <span class="settings__value">{{ folder().displayName ?? folder().uid }}</span>
            <sf-button variant="secondary" size="sm" icon="edit" [disabled]="readOnly()" (click)="startRename()">{{
              'pages.folder.settings.rename' | transloco
            }}</sf-button>
          </div>
        }
      </section>

      @if (developerMode.enabled() && folder().uuid) {
        <section class="settings__section" aria-labelledby="folder-settings-uid">
          <h3 class="settings__heading" id="folder-settings-uid">{{ 'pages.folder.settings.uid' | transloco }}</h3>
          <sf-uid-rename [projectKey]="projectKey()" [uuid]="folder().uuid!" [uid]="folder().uid ?? ''" [undoable]="true" (uidChanged)="changed.emit()" />
        </section>
      }

      @if (folder().uuid; as folderUuid) {
        <section class="settings__section" aria-labelledby="folder-settings-urls">
          <h3 class="settings__heading" id="folder-settings-urls">{{ 'pages.folder.settings.addresses' | transloco }}</h3>
          <sf-asset-urls [projectKey]="projectKey()" [assetUuid]="folderUuid" [refreshKey]="folder().revision" />
        </section>
      }

      <section class="settings__section" aria-labelledby="folder-settings-facts">
        <h3 class="settings__heading" id="folder-settings-facts">{{ 'pages.folder.settings.facts' | transloco }}</h3>
        <dl class="settings__facts">
          <dt>{{ 'pages.folder.settings.path' | transloco }}</dt>
          <dd class="settings__mono">{{ folder().path ?? '/' }}</dd>
          <dt>{{ 'pages.folder.settings.contains' | transloco }}</dt>
          <dd>{{ 'pages.folder.settings.containsValue' | transloco: { pages: pageCount(), folders: folderCount() } }}</dd>
        </dl>
      </section>
    </sf-drawer>
  `,
})
export class FolderSettingsDrawerComponent {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  private readonly undo = inject(UndoService);
  private readonly treeRefresh = inject(PagesTreeRefresh);
  private readonly transloco = inject(TranslocoService);
  protected readonly developerMode = inject(DeveloperModeService);
  /** Time travel or an archived project (M26). */
  protected readonly readOnly = inject(ProjectAccessStore).readOnly;

  readonly projectKey = input.required<string>();
  readonly folder = input.required<FolderView>();
  readonly pageCount = input(0);
  readonly folderCount = input(0);
  /** Opens with the name already in edit mode (the ⋮ menu's *Rename*). */
  readonly startRenaming = input(false);

  readonly closed = output<void>();
  /** The folder's name or UID changed: the tree and the table re-read. */
  readonly changed = output<void>();

  protected readonly renaming = signal(false);
  protected readonly draft = signal('');
  protected readonly saving = signal(false);

  protected readonly nameFindings = computed(() =>
    this.draft().trim() === '' ? [{ level: 'error' as const, message: this.transloco.translate('pages.folder.settings.nameRequired') }] : [],
  );
  protected readonly canSave = computed(
    () => this.nameFindings().length === 0 && this.draft().trim() !== (this.folder().displayName ?? '') && !this.saving() && !this.readOnly(),
  );

  constructor() {
    effect(() => {
      if (this.startRenaming()) {
        untracked(() => this.startRename());
      }
    });
  }

  protected startRename(): void {
    if (this.readOnly()) {
      return;
    }
    this.draft.set(this.folder().displayName ?? '');
    this.renaming.set(true);
  }

  protected cancelRename(): void {
    this.renaming.set(false);
  }

  protected saveName(): void {
    const folder = this.folder();
    const uuid = folder.uuid;
    const name = this.draft().trim();
    if (!uuid || !this.canSave()) {
      return;
    }
    const key = this.projectKey();
    const oldName = folder.displayName ?? folder.uid ?? '';
    this.saving.set(true);
    this.api.renameFolder(key, uuid, { displayName: name }, folder.revision).subscribe({
      next: (renamed) => {
        this.saving.set(false);
        this.renaming.set(false);
        // Undo renames back; the etag is the revision the rename produced.
        this.undo.offer(this.transloco.translate('pages.folder.settings.renamed', { from: oldName, to: name }), () =>
          this.api.renameFolder(key, uuid, { displayName: oldName }, renamed.revision).pipe(tap(() => this.treeRefresh.notify())),
        );
        this.changed.emit();
      },
      error: () => {
        this.saving.set(false);
        this.toasts.show(this.transloco.translate('pages.folder.settings.renameFailed'), 'error');
      },
    });
  }
}
