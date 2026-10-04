import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import { ActiveEditorService } from '../../core/editor/active-editor.service';
import type { EditorError, EditorStateService } from '../../core/editor/editor-state';
import { useFrameItem } from '../../core/frame/use-frame-item';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ToastService } from '../../core/ui/toast.service';
import type { SaveResult } from '../../shared/components/dialog/unsaved-changes.service';
import { SfCopyableComponent } from '../../shared/components/display/sf-copyable.component';
import { SfStatusComponent } from '../../shared/components/display/sf-status.component';
import { SfInputComponent } from '../../shared/components/forms/sf-input.component';
import { SfSwitchComponent } from '../../shared/components/forms/sf-switch.component';
import { SfBannerComponent } from '../../shared/components/layout/sf-banner.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfSaveStatusComponent, type SfSaveState } from '../../shared/components/layout/sf-save-status.component';
import { SfSectionComponent } from '../../shared/components/layout/sf-section.component';
import type { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import { SfAssetFavoriteComponent } from '../../shared/components/sf-asset-favorite.component';
import { type AssetPicked, SfAssetPickerDialogComponent } from '../../shared/components/sf-asset-picker-dialog.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { ReleaseBarComponent } from '../release/release-bar.component';
import { type NavEntry, type NavUrls, entryUrl } from './navigation-tree.util';
import { NavigationService, etagFor } from './navigation.service';

/** What the server holds of the open menu item: its target, its label in the editing language and the revision to save against. */
interface ItemDetail {
  readonly uuid: string;
  readonly revision: number | null;
  readonly folderPath: string | null;
  readonly targetKind: 'PAGE' | 'FOLDER';
  readonly targetUuid: string | null;
  /** The label as stored (a string, or the per-language wrapper); read for the editing language by {@link storedLabel}. */
  readonly rawLabel: unknown;
  /** "Visible in menu" as stored (absent = visible). */
  readonly visible: boolean;
}

/** The label as stored for `locale`: a plain string, or the `L10N` wrapper's value for that language (`''` when untranslated). */
export function storedLabel(raw: unknown, locale: string | null): string {
  if (typeof raw === 'string') {
    return raw;
  }
  if (raw && typeof raw === 'object' && (raw as { type?: unknown }).type === 'L10N') {
    const values = (raw as { values?: Record<string, unknown> }).values ?? {};
    const value = locale ? values[locale] : undefined;
    return typeof value === 'string' ? value : '';
  }
  return '';
}

/**
 * A menu item's detail (M35.22, decisions 24 and 33): an `sf-page-header` with the item's name, its favorite star, the
 * save status, the release actions and a ⋮ menu (Move…, Delete…), above a form that spans the pane — the **label** (per
 * language; empty uses the target page's name) and the **target page** as a card (icon, name, public URL, *Open*,
 * *Change target…* — the asset picker restricted to pages), then the resolved **public URL** read-only. Developer mode
 * adds the UID and the target's UUID (decision 19).
 *
 * The item saves explicitly (Save, or Ctrl+S): it registers as an editor, so leaving it with unsaved changes asks
 * Save / Discard / Cancel (M35.13). Moving and deleting are the shell's business (`move`, `remove`) — it asks, runs
 * them and offers the one Undo.
 */
@Component({
  selector: 'sf-nav-item-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReleaseBarComponent,
    SfAssetFavoriteComponent,
    SfAssetPickerDialogComponent,
    SfBannerComponent,
    SfButtonComponent,
    SfCopyableComponent,
    SfFieldComponent,
    SfIconComponent,
    SfInputComponent,
    SfPageHeaderComponent,
    SfSaveStatusComponent,
    SfSectionComponent,
    SfStatusComponent,
    SfSwitchComponent,
    TranslocoPipe,
  ],
  templateUrl: './nav-item-detail.component.html',
  styleUrl: './nav-item-detail.component.scss',
})
export class NavItemDetailComponent {
  readonly projectKey = input.required<string>();
  readonly entry = input.required<NavEntry>();
  /** The public URLs per page (the URL registry). */
  readonly urls = input<NavUrls>(new Map());

  /** The item was saved: the menu reads again. */
  readonly changed = output<void>();
  readonly move = output<void>();
  readonly remove = output<void>();
  /** Open this page in the Pages area. */
  readonly openPage = output<string>();

  private readonly api = inject(ApiClient);
  private readonly nav = inject(NavigationService);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly editingLocale = inject(EditingLocaleStore);
  protected readonly canEdit = inject(ProjectPermissionsStore).canEditContent;
  protected readonly developerMode = inject(DeveloperModeService).enabled;

  protected readonly detail = signal<ItemDetail | null>(null);
  protected readonly loadFailed = signal(false);
  protected readonly labelDraft = signal('');
  /** The page chosen with *Change target…* and not saved yet. */
  protected readonly picked = signal<{ uuid: string; name: string } | null>(null);
  protected readonly pickerOpen = signal(false);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<EditorError | null>(null);
  protected readonly savedAt = signal<string | null>(null);

  /** The label as stored for the language being edited: what "has it changed?" compares against. */
  private readonly labelSeed = signal('');

  /** "Visible in menu" as being edited, and as the server holds it. */
  protected readonly visibleDraft = signal(true);
  protected readonly visibleSeed = signal(true);

  protected readonly dirty = computed(
    () => this.picked() !== null || this.labelDraft() !== this.labelSeed() || this.visibleDraft() !== this.visibleSeed(),
  );
  protected readonly saveState = computed<SfSaveState>(() =>
    this.saveError() ? 'error' : this.saving() ? 'saving' : this.dirty() ? 'dirty' : 'saved',
  );

  /** The page the card shows: the one just chosen, else the one the item leads to. */
  protected readonly target = computed(() => {
    const picked = this.picked();
    if (picked) {
      return { uuid: picked.uuid, name: picked.name };
    }
    const entry = this.entry();
    return entry.targetUuid ? { uuid: entry.targetUuid, name: entry.targetName ?? entry.targetUuid } : null;
  });
  /** The stored target is a folder of the Pages area (the item leads to its first page). */
  protected readonly folderTarget = computed(() => this.picked() === null && this.detail()?.targetKind === 'FOLDER');
  /** The item has a target that no longer resolves to a page (it was deleted). */
  protected readonly dangling = computed(() => this.picked() === null && this.detail() !== null && this.entry().targetUuid === null && this.detail()?.targetUuid != null);
  protected readonly publicUrl = computed(() => {
    const target = this.target();
    return target ? (this.urls().get(target.uuid) ?? null) : null;
  });
  protected readonly title = computed(() => this.entry().label);

  protected readonly moreActions = computed<SfMenuItem[]>(() => {
    const t = (key: string) => this.transloco.translate(`navigation.item.menu.${key}`);
    const locked = !this.canEdit();
    return [
      { id: 'save', label: t('save'), icon: 'save', shortcut: 'Ctrl+S', disabled: locked || !this.dirty() },
      { id: 'move', label: t('move'), icon: 'drive_file_move', disabled: locked },
      { id: 'delete', label: t('delete'), icon: 'delete', danger: true, separatorBefore: true, disabled: locked },
    ];
  });

  constructor() {
    // The open item is an editor for the frame (M35.13): Ctrl+S saves it, and leaving it with unsaved edits asks first.
    const unregister = inject(ActiveEditorService).register(this.editorState());
    inject(DestroyRef).onDestroy(unregister);

    // The breadcrumb ends with the open item.
    useFrameItem(() => ({ label: this.entry().label, asset: { uuid: this.entry().uuid } }));

    // Another item (or a new revision of this one after a save, a release discard or an undo): read what the server holds.
    effect(() => {
      const uuid = this.entry().uuid;
      const revision = this.entry().revision;
      untracked(() => {
        const current = this.detail();
        if (current?.uuid === uuid && (current.revision === revision || this.saving())) {
          return;
        }
        void this.load(uuid, current?.uuid === uuid);
      });
    });

    // The label belongs to the language being edited: switching re-seeds the draft with that language's words.
    effect(() => {
      this.editingLocale.locale();
      untracked(() => this.seedLabel());
    });
  }

  // ── Editing ────────────────────────────────────────────────────────────────

  protected openPicker(): void {
    if (this.canEdit()) {
      this.pickerOpen.set(true);
    }
  }

  protected onPicked(page: AssetPicked): void {
    this.pickerOpen.set(false);
    const current = this.entry();
    const unchanged = this.detail()?.targetKind === 'PAGE' && this.detail()?.targetUuid === page.uuid && current.targetUuid === page.uuid;
    this.picked.set(unchanged ? null : { uuid: page.uuid, name: page.label });
  }

  protected onMore(item: SfMenuItem): void {
    if (item.id === 'save') {
      void this.save();
    } else if (item.id === 'move') {
      this.move.emit();
    } else if (item.id === 'delete') {
      this.remove.emit();
    }
  }

  protected onSaveClick(): void {
    void this.save();
  }

  // ── Saving ─────────────────────────────────────────────────────────────────

  /** Saves the label and target; the result says whether it was written (Ctrl+S and the unsaved-changes dialog read it). */
  protected async save(): Promise<SaveResult> {
    const detail = this.detail();
    const target = this.target();
    if (!detail || !this.canEdit() || this.saving()) {
      return { ok: true };
    }
    if (!this.dirty()) {
      return { ok: true };
    }
    const targetUuid = this.picked()?.uuid ?? detail.targetUuid;
    if (!targetUuid || (!target && !detail.targetUuid)) {
      const message = this.transloco.translate('navigation.item.needsTarget');
      this.saveError.set({ message });
      return { ok: false, message };
    }
    this.saving.set(true);
    this.saveError.set(null);
    try {
      await firstValueFrom(
        this.nav.updateReference(
          this.projectKey(),
          detail.uuid,
          {
            targetKind: this.picked() ? 'PAGE' : detail.targetKind,
            targetAssetUuid: targetUuid,
            label: this.labelDraft().trim() || undefined,
            visibleInMenu: this.visibleDraft(),
          },
          detail.revision == null ? undefined : etagFor(detail.revision),
          // The label belongs to the language being edited (M24.4.1).
          this.editingLocale.locale() ?? undefined,
        ),
      );
      this.saving.set(false);
      this.picked.set(null);
      this.savedAt.set(clockTime());
      this.toasts.show(this.transloco.translate('navigation.item.saved'), 'success');
      await this.load(detail.uuid, false);
      this.changed.emit();
      return { ok: true };
    } catch {
      this.saving.set(false);
      const message = this.transloco.translate('navigation.item.saveFailed');
      this.saveError.set({ message });
      return { ok: false, message };
    }
  }

  /** Gives the unsaved changes up: the server's label and target show again. */
  private discard(): void {
    this.picked.set(null);
    this.saveError.set(null);
    this.seedLabel();
    this.seedVisible();
  }

  private editorState(): EditorStateService {
    return {
      name: computed(() => this.entry().label),
      dirty: this.dirty,
      saving: this.saving,
      lastSaved: this.savedAt,
      error: this.saveError,
      autosave: false,
      save: () => this.save(),
      discard: async () => this.discard(),
    };
  }

  // ── Reading ────────────────────────────────────────────────────────────────

  /** `keepDrafts`: a re-read of the item that is open keeps what is being typed. */
  private async load(uuid: string, keepDrafts: boolean): Promise<void> {
    try {
      const view = await firstValueFrom(this.api.assetDetail(this.projectKey(), uuid));
      if (this.entry().uuid !== uuid) {
        return;
      }
      const payload = (view.payload ?? {}) as { target?: { kind?: string; assetUuid?: string }; label?: unknown; visibleInMenu?: unknown };
      this.detail.set({
        uuid,
        revision: view.revision ?? null,
        folderPath: view.folderPath ?? null,
        targetKind: payload.target?.kind === 'FOLDER' ? 'FOLDER' : 'PAGE',
        targetUuid: payload.target?.assetUuid ?? null,
        rawLabel: payload.label,
        visible: payload.visibleInMenu !== false,
      });
      this.loadFailed.set(false);
      if (!keepDrafts || !this.dirty()) {
        this.picked.set(null);
        this.seedLabel();
        this.seedVisible();
      }
    } catch {
      this.loadFailed.set(true);
    }
  }

  private seedVisible(): void {
    const visible = this.detail()?.visible ?? true;
    this.visibleSeed.set(visible);
    this.visibleDraft.set(visible);
  }

  private seedLabel(): void {
    const stored = storedLabel(this.detail()?.rawLabel, this.editingLocale.locale());
    this.labelSeed.set(stored);
    this.labelDraft.set(stored);
  }
}

function clockTime(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
