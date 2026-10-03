import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ActiveEditorService } from '../../core/editor/active-editor.service';
import { type EditorError, type EditorStateService, saveStateOf } from '../../core/editor/editor-state';
import { mediaDrawerShortcuts } from '../../core/ui/documented-shortcuts';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { ToastService } from '../../core/ui/toast.service';
import { SfDrawerComponent, SfDrawerFooterDirective } from '../../shared/components/dialog/sf-drawer.component';
import type { SaveResult } from '../../shared/components/dialog/unsaved-changes.service';
import { SfSaveStatusComponent } from '../../shared/components/layout/sf-save-status.component';
import { SfSkeletonComponent } from '../../shared/components/layout/sf-skeleton.component';
import { SfBannerComponent } from '../../shared/components/layout/sf-banner.component';
import { SfMenuComponent } from '../../shared/components/menu/sf-menu.component';
import type { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import { SfAssetFavoriteComponent } from '../../shared/components/sf-asset-favorite.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfTab, SfTabsComponent } from '../../shared/components/sf-tabs.component';
import { SfFileSizePipe } from '../../shared/pipes/sf-file-size.pipe';
import { ConflictDrawerComponent } from '../pages/conflict-drawer.component';
import { ReleaseBarComponent } from '../release/release-bar.component';
import type { ReleaseMode } from '../release/release-choice.util';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { formatOf } from './library/media-library.util';
import { MediaDrawerDetailsComponent } from './drawer/media-drawer-details.component';
import { MediaDrawerFilesStore } from './drawer/media-drawer-files.store';
import { MediaDrawerLayout } from './drawer/media-drawer-layout';
import { MediaDrawerLocalizationComponent } from './drawer/media-drawer-localization.component';
import { MediaDrawerMetadataStore } from './drawer/media-drawer-metadata.store';
import { MediaDrawerNamesStore } from './drawer/media-drawer-names.store';
import { MediaDrawerPreviewStore } from './drawer/media-drawer-preview.store';
import { MediaDrawerProcessComponent } from './drawer/media-drawer-process.component';
import { MediaDrawerRenderedComponent } from './drawer/media-drawer-rendered.component';
import { MediaDrawerSourceComponent } from './drawer/media-drawer-source.component';
import { MediaDrawerTextStore } from './drawer/media-drawer-text.store';
import { MediaDrawerUsagesComponent } from './drawer/media-drawer-usages.component';
import { MediaDrawerUsagesStore } from './drawer/media-drawer-usages.store';
import { MediaDrawerVariantsComponent } from './drawer/media-drawer-variants.component';
import { MediaDrawerVersionsComponent } from './drawer/media-drawer-versions.component';
import { MediaDrawerVersionsStore } from './drawer/media-drawer-versions.store';
import { MediaDrawerStore, type MediaDrawerTab, type MediaView } from './drawer/media-drawer.store';

export type { MediaDrawerTab } from './drawer/media-drawer.store';

/** What the ⋮ menu asks the library to do with the open file; the library owns these actions and their dialogs. */
export type MediaFileAction = 'rename' | 'move' | 'download' | 'copyLink';

/** The open file's place in the library's visible list (for ←/→ and "3 of 12"). */
export interface MediaDrawerPosition {
  readonly index: number;
  readonly count: number;
}

/**
 * The detail drawer of one media file (decisions 20, 21, 97): a resizable, non-modal `sf-drawer` below the top bar. The
 * header names the file and holds its unreleased status, the favorite star, previous/next (←/→ while focus is in the
 * header) and a ⋮ menu; below, `sf-tabs` with every tab that applies to the file and, on Details and Source, a footer
 * with the save status, Revert and Save. The drawer is an editor of its own: it registers with the
 * {@link ActiveEditorService}, so Ctrl+S saves it and leaving it with unsaved edits (another file, closing it, another
 * folder, the browser's back button) asks Save / Discard / Cancel. The parts and the drawer's logic share the
 * feature-scoped stores provided here; the effects that react to the inputs stay in this constructor, in one place, so
 * their order under zoneless change detection is explicit.
 */
@Component({
  selector: 'sf-media-detail-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ConflictDrawerComponent,
    MediaDrawerDetailsComponent,
    MediaDrawerLocalizationComponent,
    MediaDrawerProcessComponent,
    MediaDrawerRenderedComponent,
    MediaDrawerSourceComponent,
    MediaDrawerUsagesComponent,
    MediaDrawerVariantsComponent,
    MediaDrawerVersionsComponent,
    ReleaseBarComponent,
    SfAssetFavoriteComponent,
    SfBannerComponent,
    SfButtonComponent,
    SfDrawerComponent,
    SfDrawerFooterDirective,
    SfFileSizePipe,
    SfMenuComponent,
    SfSaveStatusComponent,
    SfSkeletonComponent,
    SfTabsComponent,
    TranslocoPipe,
  ],
  providers: [
    MediaDrawerStore,
    MediaDrawerPreviewStore,
    MediaDrawerMetadataStore,
    MediaDrawerTextStore,
    MediaDrawerFilesStore,
    MediaDrawerUsagesStore,
    MediaDrawerVersionsStore,
    MediaDrawerNamesStore,
  ],
  templateUrl: './media-detail-drawer.component.html',
  styleUrl: './media-detail-drawer.component.scss',
})
export class MediaDetailDrawerComponent {
  readonly projectKey = input.required<string>();
  /** The open file: a list row, or the full view after a save. The drawer reads the full view itself. */
  readonly media = input.required<MediaView>();
  /** The tab the URL names (`?mtab=`); `null` is Details. */
  readonly tab = input<string | null>(null);
  readonly position = input<MediaDrawerPosition>({ index: -1, count: 0 });
  /** The folder the file lives in, for the developer view's path. */
  readonly folderPath = input<string | null>(null);
  /** The UIDs of the project's media, for the Source tab's name completion. */
  readonly mediaUids = input<readonly string[]>([]);

  readonly closed = output<void>();
  readonly updated = output<MediaView>();
  readonly deleted = output<string>();
  /** Discard changes rewrote the draft (M27.6.1): the library reloads the file and reopens the drawer. */
  readonly discarded = output<string>();
  readonly tabChange = output<MediaDrawerTab>();
  /** Previous (-1) or next (+1) file. */
  readonly step = output<-1 | 1>();
  readonly fileAction = output<MediaFileAction>();

  protected readonly store = inject(MediaDrawerStore);
  protected readonly text = inject(MediaDrawerTextStore);
  protected readonly metadata = inject(MediaDrawerMetadataStore);
  private readonly preview = inject(MediaDrawerPreviewStore);
  private readonly files = inject(MediaDrawerFilesStore);
  protected readonly usages = inject(MediaDrawerUsagesStore);
  protected readonly versions = inject(MediaDrawerVersionsStore);
  private readonly timeTravel = inject(TimeTravelStore);
  private readonly toasts = inject(ToastService);
  protected readonly layout = inject(MediaDrawerLayout);

  protected readonly readOnly = this.store.readOnly;
  protected readonly tabsId = 'media-drawer-tab';
  /** "Replace" was chosen in the ⋮ menu (or the large-file banner): the Details tab brings its Replace field into view. */
  protected readonly replaceRequested = signal(false);

  // ── The drawer as an editor ───────────────────────────────────────────────

  private readonly savedAt = signal<string | null>(null);
  private readonly saveError = signal<EditorError | null>(null);
  readonly dirty = computed(() => this.metadata.dirty() || this.text.dirty());
  private readonly saving = computed(() => this.metadata.saving() || this.text.sourceSaving());
  /** Why Save does nothing right now; `null` when it can save. */
  protected readonly saveBlockedReason = computed<string | null>(() => {
    if (this.readOnly()) {
      return this.store.readOnlyLabel();
    }
    if (!this.dirty()) {
      return this.store.t('footer.nothingToSave');
    }
    return this.text.dirty() && this.text.sourceHasErrors() ? this.store.t('source.fixErrors') : null;
  });
  protected readonly saveState = computed(() => saveStateOf({ dirty: this.dirty, saving: this.saving, error: this.saveError }));
  protected readonly lastSaved = this.savedAt.asReadonly();

  /** What the footer and the leave dialog share: this drawer as one editor (the Save button, Ctrl+S, the leave guard). */
  private readonly editor: EditorStateService = {
    name: computed(() => this.store.media()?.displayName ?? this.store.media()?.uid ?? ''),
    dirty: this.dirty,
    saving: this.saving,
    lastSaved: this.savedAt,
    error: this.saveError,
    autosave: false,
    save: () => this.save(),
    discard: async () => this.revert(),
  };

  // ── The header and the tabs ───────────────────────────────────────────────

  protected readonly title = computed(() => this.store.media()?.displayName ?? this.store.media()?.fileName ?? this.store.media()?.uid ?? '');

  /** "JPG · 4000 × 2667 · 1.2 MB". */
  protected readonly meta = computed(() => {
    const media = this.store.media();
    const size = new SfFileSizePipe().transform(media.sizeBytes ?? 0);
    const image = media.image;
    const dimensions = image?.width && image.height ? `${image.width} × ${image.height}` : null;
    return [formatOf({ mimeType: media.mimeType, displayName: media.fileName, uid: media.uid }), dimensions, size].filter(Boolean).join(' · ');
  });

  protected readonly tabs = computed<SfTab[]>(() => {
    const dirty: Partial<Record<MediaDrawerTab, boolean>> = { details: this.metadata.dirty(), source: this.text.dirty() };
    return this.store.tabs().map((id) => ({
      id,
      label: this.store.t(`tabs.${id}`),
      dirty: dirty[id] ?? false,
      note: id === 'usedby' && !this.usages.usagesLoading() && !this.usages.usagesFailed() ? String(this.usages.count()) : undefined,
    }));
  });

  protected readonly fileActions = computed<SfMenuItem[]>(() => {
    const writable = !this.readOnly();
    const items: SfMenuItem[] = [];
    if (writable) {
      items.push(
        { id: 'replace', label: this.store.t('menu.replace'), icon: 'swap_horiz', action: () => this.requestReplace() },
        { id: 'rename', label: this.store.t('menu.rename'), icon: 'edit', shortcut: 'F2', action: () => this.fileAction.emit('rename') },
        { id: 'move', label: this.store.t('menu.move'), icon: 'drive_file_move', action: () => this.fileAction.emit('move') },
      );
    }
    items.push(
      { id: 'download', label: this.store.t('menu.download'), icon: 'download', action: () => this.fileAction.emit('download') },
      { id: 'copyLink', label: this.store.t('menu.copyLink'), icon: 'link', action: () => this.fileAction.emit('copyLink') },
    );
    if (writable) {
      items.push({
        id: 'delete',
        label: this.store.t('menu.delete'),
        icon: 'delete',
        danger: true,
        separatorBefore: true,
        action: () => void this.confirmDelete(),
      });
    }
    return items;
  });

  protected readonly singleFile = computed(() => this.position().count < 2 || this.position().index < 0);

  constructor() {
    // ←/→ in the header and Esc are handled by the drawer itself; the `?` sheet lists them (decision 100).
    inject(ShortcutService).use(mediaDrawerShortcuts({ steps: () => !this.singleFile() }));
    this.store.connect({
      projectKey: this.projectKey,
      media: this.media,
      tab: this.tab,
      tabChange: (tab) => this.tabChange.emit(tab),
      mediaUids: this.mediaUids,
      updated: (media) => this.updated.emit(media),
      deleted: (uuid) => {
        // The file is gone: its unsaved edits go with it, so closing the drawer is not held up by the leave guard.
        this.revert();
        this.deleted.emit(uuid);
      },
    });
    const unregister = inject(ActiveEditorService).register(this.editor);
    inject(DestroyRef).onDestroy(unregister);

    // Another file (or another revision in time travel): forget what was read of the last one and read this one.
    let loadedKey: string | null = null;
    let seededUuid: string | null = null;
    effect(() => {
      const uuid = this.media()?.uuid;
      const viewed = this.timeTravel.activeRevision();
      untracked(() => {
        const key = `${uuid}|${viewed ?? ''}`;
        if (!uuid || key === loadedKey) {
          return;
        }
        const another = !loadedKey?.startsWith(`${uuid}|`);
        loadedKey = key;
        this.text.resetText();
        this.text.resetLocaleChoice();
        this.store.processDiagnostics.set([]);
        this.store.revision.set(this.media().revision ?? null);
        if (another) {
          seededUuid = null;
          this.savedAt.set(null);
          this.saveError.set(null);
        }
        this.store.loadDetail();
        this.usages.loadUsages();
        this.versions.load();
      });
    });

    // The same file changed under the drawer (another user, a release): read it again.
    effect(() => {
      const revision = this.media()?.revision;
      const ready = this.store.ready();
      untracked(() => {
        if (ready && revision != null && revision !== this.store.revision()) {
          this.store.loadDetail();
        }
      });
    });

    // What the server says about the file feeds the edits: seeded for a new file, followed (keeping edits) after that.
    effect(() => {
      const media = this.store.media();
      const ready = this.store.ready();
      untracked(() => {
        if (!ready) {
          return;
        }
        if (seededUuid !== media.uuid) {
          seededUuid = media.uuid ?? null;
          this.metadata.seed(media);
        } else {
          this.metadata.sync(media);
        }
      });
    });

    // Alt text and caption are stored per language, so the two fields have to be re-seeded when the editing language
    // changes (M24.4.1) — otherwise they keep showing (and would save) the previous language's words under the new one.
    let lastLocale = this.store.editingLocale.locale();
    effect(() => {
      const locale = this.store.editingLocale.locale();
      untracked(() => {
        if (locale !== lastLocale) {
          lastLocale = locale;
          this.metadata.reseedLanguageFields(this.store.media());
        }
      });
    });

    // Localized media previews the editing language's file (M27.6.4); a new file of it previews again.
    let lastPreviewKey: string | null = null;
    effect(() => {
      const media = this.store.media();
      const key = this.projectKey();
      const locale = media?.localized ? this.store.editingLocale.locale() : null;
      const previewKey = `${media?.uuid}|${locale ?? ''}|${media?.revision ?? ''}`;
      if (!media?.uuid || !key || previewKey === lastPreviewKey) {
        return;
      }
      lastPreviewKey = previewKey;
      untracked(() => this.preview.loadPreview(key, media.uuid!, locale));
    });

    // Thumbnails of the languages that have their own image file, re-fetched only when that file changes.
    effect(() => {
      const rows = this.files.fileRows();
      const key = this.projectKey();
      const uuid = this.store.media()?.uuid;
      untracked(() => {
        if (uuid) {
          this.files.loadLocaleThumbs(key, uuid, rows);
        }
      });
    });

    // What a tab shows is read when the tab is: the text for Details and Source of a text file, the rendered output, the
    // check of the Processing tab. Rendered output dropped by a save or a switch is read again.
    effect(() => {
      const tab = this.store.tab();
      const ready = this.store.ready();
      const text = this.store.textEditable();
      const rendered = this.text.renderedText();
      const failed = this.text.renderedDiagnostics().length > 0;
      const loading = this.text.renderedLoading();
      untracked(() => {
        if (!ready) {
          return;
        }
        if ((tab === 'details' || tab === 'source') && text) {
          this.text.ensureLoaded();
        } else if (tab === 'rendered' && rendered === null && !failed && !loading) {
          this.text.loadRendered();
        } else if (tab === 'processing' && text) {
          this.text.checkProcessing();
        }
      });
    });

    // The history behind Details (who uploaded, when it changed) and the Versions tab follows the file's revision.
    effect(() => {
      void this.store.media()?.revision;
      untracked(() => {
        this.usages.loadUsages();
        this.versions.load();
      });
    });
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  /** Saves what is unsaved: the details, then the source. A refusal keeps the edits and says why. */
  async save(): Promise<SaveResult> {
    if (this.store.readOnly()) {
      return { ok: false, message: this.store.readOnlyLabel() };
    }
    if (this.metadata.dirty()) {
      const result = await this.metadata.save();
      if (!result.ok) {
        this.saveError.set({ message: result.message });
        return result;
      }
    }
    if (this.text.dirty()) {
      const result = await this.text.saveSource();
      if (!result.ok) {
        this.saveError.set({ message: result.message });
        return result;
      }
    }
    this.saveError.set(null);
    this.savedAt.set(new Date().toTimeString().slice(0, 5));
    return { ok: true };
  }

  /** The Save button: a refusal is said in a toast as well. */
  protected async saveClicked(): Promise<void> {
    const result = await this.save();
    if (!result.ok && result.message) {
      this.toasts.show(result.message, 'error');
    }
  }

  /** Revert / Discard: the edits of both tabs go back to what the server has. */
  revert(): void {
    this.metadata.revert();
    this.text.revert();
    this.saveError.set(null);
  }

  // ── The header ────────────────────────────────────────────────────────────

  /** ←/→ while focus is in the drawer's header step to the previous/next file; F2 renames (outside text fields). */
  protected onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    if (event.key === 'F2' && !target?.closest('input, textarea, [contenteditable="true"], .cm-editor') && !this.readOnly()) {
      event.preventDefault();
      this.fileAction.emit('rename');
      return;
    }
    if ((event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || event.shiftKey || this.singleFile()) {
      return;
    }
    if (!target?.closest('.sf-drawer__header')) {
      return;
    }
    event.preventDefault();
    this.step.emit(event.key === 'ArrowLeft' ? -1 : 1);
  }

  protected selectTab(id: string): void {
    this.store.selectTab(id as MediaDrawerTab);
  }

  /** Replace, from the ⋮ menu or the large-file banner: Details, with its Replace field in view. */
  protected requestReplace(): void {
    if (this.store.tab() !== 'details') {
      this.store.selectTab('details');
    }
    this.replaceRequested.set(true);
  }

  protected async confirmDelete(): Promise<void> {
    await this.usages.confirmDelete();
  }

  protected onReleaseChanged(mode: ReleaseMode): void {
    const uuid = this.media()?.uuid;
    if (mode === 'discard' && uuid) {
      this.discarded.emit(uuid);
    }
  }
}
