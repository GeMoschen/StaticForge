import { DestroyRef, Injectable, Injector, computed, inject, signal } from '@angular/core';
import { HashMap } from '@jsverse/transloco';
import { ToastService } from '../../../../core/ui/toast.service';
import { CodeFormat, ResolvedCodeFormat, extensionOf, resolveCodeFormat } from '../../../../shared/code-editor/code-format';
import { ConfirmService } from '../../../../shared/components/dialog/confirm.service';
import { typeToConfirmFor } from '../../../../shared/components/dialog/delete-confirm';
import { DialogService } from '../../../../shared/components/dialog/dialog.service';
import { UnsavedChangesService } from '../../../../shared/components/dialog/unsaved-changes.service';
import { LANGUAGE_NAMES, SampleLang } from '../sample-data';
import { SampleState } from '../sample-state';
import {
  DEFAULT_MEDIA_FOLDER,
  MEDIA_FILES,
  SampleFocal,
  SampleMediaFile,
  SampleMediaFolder,
  SampleMediaTypeFilter,
  SampleSourceBanner,
  UPLOADED_FILE,
  UPLOAD_EXTENSIONS,
  UPLOAD_MAX_BYTES,
  copyName,
  fileExtension,
  matchesType,
  mediaFile,
  mediaFolder,
  mediaFolderChildren,
  mediaFolderDescendants,
  mediaFolderParent,
  mediaFolderPath,
  languageVariant,
  mediaTypeOf,
  withUnreadableCharacters,
} from './sample-media-data';
import { MEDIA_ROOT, SampleMediaMoveDialogComponent, SampleMoveDialogData } from './sample-media-move-dialog.component';
import { SampleMediaRenameDialogComponent, SampleRenameDialogData } from './sample-media-rename-dialog.component';

/** The default language of the sample project: its text media have their own file (the other language's is derived). */
const DEFAULT_TEXT_LANG: SampleLang = 'de';

export type SampleMediaView = 'grid' | 'list';
export const MEDIA_VIEWS: readonly SampleMediaView[] = ['grid', 'list'];

/** The detail drawer's tabs (decision 21); {@link tabsFor} picks those that apply to a file. */
export type SampleMediaTab = 'details' | 'variants' | 'languages' | 'processing' | 'rendered' | 'source' | 'usedby' | 'versions';
export const MEDIA_TABS: readonly SampleMediaTab[] = [
  'details',
  'variants',
  'languages',
  'processing',
  'rendered',
  'source',
  'usedby',
  'versions',
];

export type SampleMediaSort = 'name' | 'date' | 'size' | 'type';
export const MEDIA_SORTS: readonly SampleMediaSort[] = ['name', 'date', 'size', 'type'];
export type SampleSortDirection = 'asc' | 'desc';

/** The review states of the library and the folder tree (`state`): live data, the skeleton, the error with Retry, no files at all. */
export type SampleMediaReview = 'live' | 'loading' | 'error' | 'empty';
export const MEDIA_REVIEW_STATES: readonly SampleMediaReview[] = ['live', 'loading', 'error', 'empty'];

/** Dialogs a link can open (`dialog`): rename and move a file, move the open folder, a delete of the selection. */
export type SampleMediaDialog = 'rename' | 'rename-folder' | 'move' | 'folder-move' | 'delete';
export const MEDIA_DIALOGS: readonly SampleMediaDialog[] = ['rename', 'rename-folder', 'move', 'folder-move', 'delete'];

/** Why an upload was refused (decision 98): not an accepted type, over the limit, the name is taken, the connection dropped. */
export type SampleUploadError = 'type' | 'size' | 'duplicate' | 'network';

export interface SampleUpload {
  readonly id: string;
  readonly name: string;
  readonly sizeBytes: number;
  /** 0–100. */
  readonly progress: number;
  readonly state: 'uploading' | 'done' | 'error';
  /** The folder the file goes to (named in the panel's header). */
  readonly folderId: string;
  /** The library file a finished upload became ("Add alt text" opens it). */
  readonly fileId?: string;
  readonly error?: SampleUploadError;
  /** A refused duplicate: the library file that has the name. */
  readonly existingId?: string;
  /** How a duplicate went on (Replace / Keep both), shown once it is uploaded. */
  readonly outcome?: 'replaced' | 'copy';
  /** The alt text saved from the panel. */
  readonly alt?: string;
}

/** Whether a file of this name can have alt text (pictures). */
export function acceptsAlt(name: string): boolean {
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(fileExtension(name));
}

/** Review of a link: `upload=1` mid-upload, `upload=errors` every kind of refusal. */
export type SampleUploadSeed = '1' | 'errors';
export const UPLOAD_SEEDS: readonly SampleUploadSeed[] = ['1', 'errors'];

/** The editable details of the open file (decision 21, Details). */
export interface SampleMediaDetails {
  readonly alt: string;
  readonly caption: string;
  /** The rights line under the caption (gate round 12: the app keeps it as a field; the signed-off sample had none). */
  readonly copyright: string;
  readonly focal: SampleFocal | null;
}

/** Fake upload speed: a step every this many ms (slower and without bar animation under reduced motion). */
const TICK_MS = 450;
const TICK_MS_REDUCED = 1500;
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** The tabs that apply to a file: Variants for images; Processing, Rendered (when processed) and Source for text. */
export function tabsFor(file: SampleMediaFile, processCms: boolean): SampleMediaTab[] {
  const tabs: SampleMediaTab[] = ['details'];
  if (file.kind === 'image') {
    tabs.push('variants');
  }
  tabs.push('languages');
  if (file.kind === 'text') {
    tabs.push('processing');
    if (processCms) {
      tabs.push('rendered');
    }
    tabs.push('source');
  }
  tabs.push('usedby', 'versions');
  return tabs;
}

function compareBy(sort: SampleMediaSort): (a: SampleMediaFile, b: SampleMediaFile) => number {
  const byName = (a: SampleMediaFile, b: SampleMediaFile) => a.name.localeCompare(b.name, undefined, { numeric: true });
  switch (sort) {
    case 'date':
      // Newest first is "ascending" for dates: the smaller age.
      return (a, b) => a.modifiedMinutes - b.modifiedMinutes || byName(a, b);
    case 'size':
      return (a, b) => a.sizeBytes - b.sizeBytes || byName(a, b);
    case 'type':
      return (a, b) => a.format.localeCompare(b.format) || byName(a, b);
    default:
      return byName;
  }
}

/**
 * The media area's state (M35.9, decisions 19–22), provided by {@link SampleMediaAreaComponent}: the open folder, the
 * library's view, search, type filter and sort, the selection, the detail drawer (file, tab, width, unsaved edits),
 * per-file switches, and the fake uploads. Files live in memory: deletes can be undone, nothing is saved.
 */
@Injectable()
export class SampleMediaState {
  readonly sample = inject(SampleState);
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);
  private readonly dialogs = inject(DialogService);
  private readonly unsaved = inject(UnsavedChangesService);
  private readonly injector = inject(Injector);

  /** Live data, or one of the review states of the library and the tree (`state=loading|error|empty`). */
  readonly review = signal<SampleMediaReview>('live');
  /** The folder tree's filter (`tfilter`). */
  readonly treeFilter = signal('');
  /** The page header's folder menu asked for an inline rename / new folder in the tree; the area performs it. */
  readonly folderRequest = signal<'rename' | 'create' | null>(null);
  /** The files being dragged from the library toward a folder of the tree. */
  readonly dragging = signal<readonly string[]>([]);
  readonly view = signal<SampleMediaView>('grid');
  readonly folderId = signal<string>(DEFAULT_MEDIA_FOLDER);
  readonly files = signal<readonly SampleMediaFile[]>(MEDIA_FILES);
  readonly search = signal('');
  readonly typeFilter = signal<SampleMediaTypeFilter>('all');
  readonly sort = signal<SampleMediaSort>('name');
  readonly direction = signal<SampleSortDirection>('asc');
  /** Selected file ids (the grid's and the list's). */
  readonly selection = signal<readonly string[]>([]);
  /** Selected folder ids (the folders of the open folder, shown inline before the files). */
  readonly folderSelection = signal<readonly string[]>([]);
  /** A read-only project (`readonly=1`): menus keep what only reads; nothing is renamed, moved, uploaded, released or deleted. */
  readonly readOnly = signal(false);
  readonly canEdit = computed(() => !this.readOnly());
  /** The parent of the folder the tree is asked to create inline (`undefined`: the open folder). */
  readonly folderRequestParent = signal<string | null | undefined>(undefined);
  /** The library's file picker (registered by the library); `Upload` entries of the menus open it for a folder. */
  private picker: ((folderId: string) => void) | null = null;

  readonly assetId = signal<string | null>(null);
  readonly tab = signal<SampleMediaTab>('details');
  /** The drawer's width, kept while the area lives (narrower below the large breakpoint). */
  readonly drawerWidth = signal(typeof innerWidth === 'number' && innerWidth < 1280 ? 420 : 520);
  /** Unsaved edits of the open file's details, and of a text file's source. */
  readonly edits = signal<Partial<SampleMediaDetails>>({});
  readonly sourceDraft = signal<string | null>(null);
  /**
   * The project's highlighting overrides (decision 104), by file extension: a text file type the project highlights
   * as another format (`css` → JavaScript). Absent = Auto (detected from the media type and the extension).
   */
  readonly highlightOverrides = signal<Readonly<Record<string, CodeFormat>>>({});
  /** What the Source tab warns about (`banner=`, decision 105); in the app it follows from the file. */
  readonly sourceBanner = signal<SampleSourceBanner | null>(null);
  /** The language the Source tab shows for a text file with one file per language (decision 105). */
  readonly textLang = signal<SampleLang>('de');
  /** The URL registry of the Used by tab could not be read (`urls=error`): a quiet note with Retry instead of an error toast. */
  readonly urlsFailed = signal(false);
  /** "Replace" was chosen in the drawer's ⋮ menu: the Details tab brings its Replace field into view. */
  readonly replaceRequest = signal(false);
  /** Per-file switches the user flipped: "Different file per language", "Process CMS syntax". */
  readonly localized = signal<ReadonlyMap<string, boolean>>(new Map());
  readonly processed = signal<ReadonlyMap<string, boolean>>(new Map());

  /** When the details were last saved ("12:04"), for the save status. */
  readonly savedAt = signal<string | null>(null);

  readonly uploads = signal<readonly SampleUpload[]>([]);
  readonly reducedMotion = typeof matchMedia === 'function' && matchMedia(REDUCED_MOTION).matches;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextUpload = 0;

  readonly devMode = this.sample.devMode;
  readonly folder = computed(() => mediaFolder(this.folderId()));
  readonly folderName = computed(() => this.folder()?.name ?? '');
  readonly folderPath = computed(() => mediaFolderPath(this.folderId()));

  /** The open folder's files after search and type filter, sorted. */
  readonly visible = computed<readonly SampleMediaFile[]>(() => {
    if (this.review() !== 'live') {
      return [];
    }
    const query = this.search().trim().toLowerCase();
    const type = this.typeFilter();
    const compare = compareBy(this.sort());
    const sign = this.direction() === 'asc' ? 1 : -1;
    return this.files()
      .filter((f) => f.folderId === this.folderId() && matchesType(f, type) && (!query || f.name.toLowerCase().includes(query)))
      .sort((a, b) => sign * compare(a, b));
  });
  /** The open folder's folders (shown before the files), by name; the search filters them as it does the files. */
  readonly subfolders = computed<readonly SampleMediaFolder[]>(() => {
    if (this.review() !== 'live') {
      return [];
    }
    const query = this.search().trim().toLowerCase();
    return mediaFolderChildren(this.folderId())
      .filter((f) => !query || f.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  });
  readonly folderCount = computed(() => (this.review() === 'empty' ? 0 : this.files().filter((f) => f.folderId === this.folderId()).length));
  readonly selectedFiles = computed(() => this.visible().filter((f) => this.selection().includes(f.id)));
  readonly selectedFolders = computed(() => this.subfolders().filter((f) => this.folderSelection().includes(f.id)));
  /** Files and folders in the selection. */
  readonly selectionCount = computed(() => this.selectedFiles().length + this.selectedFolders().length);

  readonly asset = computed(() => mediaFile(this.files(), this.assetId()));
  readonly assetProcessed = computed(() => {
    const file = this.asset();
    return file ? this.isProcessed(file) : false;
  });
  readonly tabs = computed<SampleMediaTab[]>(() => {
    const file = this.asset();
    return file ? tabsFor(file, this.assetProcessed()) : [];
  });
  /** The shown tab: the chosen one when it applies to the file, else Details. */
  readonly currentTab = computed<SampleMediaTab>(() => (this.tabs().includes(this.tab()) ? this.tab() : 'details'));

  readonly details = computed<SampleMediaDetails | null>(() => {
    const file = this.asset();
    if (!file) {
      return null;
    }
    const edits = this.edits();
    return {
      alt: edits.alt ?? file.alt,
      caption: edits.caption ?? file.caption,
      copyright: edits.copyright ?? file.copyright ?? '',
      focal: edits.focal ?? file.focal,
    };
  });
  readonly detailsDirty = computed(() => {
    const file = this.asset();
    const now = this.details();
    if (!file || !now) {
      return false;
    }
    return now.alt !== file.alt || now.caption !== file.caption || now.copyright !== (file.copyright ?? '') || now.focal?.x !== file.focal?.x || now.focal?.y !== file.focal?.y;
  });
  /** Source texts saved in the sample, by file and language (the file keeps one text only, the default language's). */
  private readonly savedSources = signal<ReadonlyMap<string, string>>(new Map());
  /** The text the Source tab starts from: what was saved, else the file's text in the shown language, damaged when `banner=utf8`. */
  readonly sourceBase = computed(() => {
    const file = this.asset();
    if (!file) {
      return '';
    }
    const lang = this.sourceLang();
    const saved = this.savedSources().get(`${file.id}:${lang}`);
    if (saved !== undefined) {
      return saved;
    }
    const extension = extensionOf(file.name) ?? '';
    let text = file.source ?? '';
    if (lang !== DEFAULT_TEXT_LANG) {
      text = languageVariant(text, LANGUAGE_NAMES[lang], extension);
    }
    return this.sourceBanner() === 'utf8' ? withUnreadableCharacters(text, extension) : text;
  });
  /** The language of the Source tab's file: the chosen one when the file has one file per language, else the default. */
  readonly sourceLang = computed<SampleLang>(() => {
    const file = this.asset();
    return file && this.isLocalized(file) ? this.textLang() : DEFAULT_TEXT_LANG;
  });
  readonly sourceDirty = computed(() => {
    const draft = this.sourceDraft();
    return draft !== null && draft !== this.sourceBase();
  });
  /** The open file has edits that are not saved (the drawer's save status, the leave guard). */
  readonly dirty = computed(() => this.detailsDirty() || this.sourceDirty());

  /** The open file's place in the library (for ←/→). */
  readonly position = computed(() => {
    const list = this.visible();
    const index = list.findIndex((f) => f.id === this.assetId());
    return { index, count: list.length };
  });

  constructor() {
    // Leaving the area (the rail, the breadcrumb) with unsaved edits asks first (decision 97).
    const unregister = this.sample.registerGuard(() => this.leave());
    inject(DestroyRef).onDestroy(() => {
      unregister();
      this.stopTimer();
    });
  }

  t(key: string, params?: HashMap): string {
    return this.sample.t(`media.${key}`, params);
  }

  notice(key = 'prototypeNotice', params?: HashMap): void {
    this.sample.notice(key, params);
  }

  /** How a text file is highlighted: the project's override for its extension, else detected (the code editor's own rule). */
  highlightOf(file: SampleMediaFile): ResolvedCodeFormat {
    return resolveCodeFormat({
      extension: extensionOf(file.name),
      mimeType: mediaTypeOf(file),
      overrides: { extensions: this.highlightOverrides() },
    });
  }

  /** Overrides the format of the file's type for the whole project (`null`: back to Auto). */
  setHighlight(file: SampleMediaFile, format: CodeFormat | null): void {
    const extension = extensionOf(file.name);
    if (!extension) {
      return;
    }
    this.highlightOverrides.update((map) => {
      const next = { ...map };
      if (format) {
        next[extension] = format;
      } else {
        delete next[extension];
      }
      return next;
    });
  }

  /** Switches the Source tab's language; unsaved source edits ask first (decision 97). */
  async requestTextLang(lang: SampleLang): Promise<void> {
    if (lang !== this.textLang() && (!this.sourceDirty() || (await this.leave()))) {
      this.sourceDraft.set(null);
      this.textLang.set(lang);
    }
  }

  isLocalized(file: SampleMediaFile): boolean {
    return this.localized().get(file.id) ?? !!file.localized;
  }

  isProcessed(file: SampleMediaFile): boolean {
    return this.processed().get(file.id) ?? !!file.processCms;
  }

  setLocalized(file: SampleMediaFile, on: boolean): void {
    this.localized.update((m) => new Map(m).set(file.id, on));
  }

  setProcessed(file: SampleMediaFile, on: boolean): void {
    this.processed.update((m) => new Map(m).set(file.id, on));
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  openFolder(id: string): void {
    if (id !== this.folderId()) {
      this.selection.set([]);
      this.folderSelection.set([]);
      // A file of another folder can't be stepped to from here: the drawer closes with the folder.
      this.openAsset(null);
    }
    this.folderId.set(id);
  }

  /** Whether the drawer may be left: nothing unsaved, or the person saved or discarded it (decision 97). */
  async leave(): Promise<boolean> {
    if (!this.dirty()) {
      return true;
    }
    return this.unsaved.confirmLeave({
      name: this.asset()?.name ?? '',
      save: async () => {
        this.save();
        return { ok: true };
      },
      discard: () => this.discard(),
      injector: this.injector,
    });
  }

  /** {@link openFolder} after the leave guard. */
  async requestOpenFolder(id: string): Promise<void> {
    if (id !== this.folderId() && (await this.leave())) {
      this.openFolder(id);
    }
  }

  /** {@link openAsset} after the leave guard (another file, or closing with `null`). */
  async requestOpenAsset(id: string | null, tab?: SampleMediaTab): Promise<void> {
    if (id !== this.assetId() && !(await this.leave())) {
      return;
    }
    this.openAsset(id, tab);
  }

  /** {@link step} after the leave guard. */
  async requestStep(delta: -1 | 1): Promise<void> {
    const list = this.visible();
    const { index } = this.position();
    if (list.length < 2 || index < 0) {
      return;
    }
    await this.requestOpenAsset(list[(index + delta + list.length) % list.length].id);
  }

  /** Opens a file in the drawer (unsaved edits of the previous one are dropped: nothing is saved anyway). */
  openAsset(id: string | null, tab?: SampleMediaTab): void {
    if (id !== this.assetId()) {
      this.edits.set({});
      this.sourceDraft.set(null);
      this.textLang.set(DEFAULT_TEXT_LANG);
    }
    this.assetId.set(id);
    if (tab) {
      this.tab.set(tab);
    }
  }

  /** The previous (-1) or next (+1) file of the library, wrapping. */
  step(delta: -1 | 1): void {
    const list = this.visible();
    const { index } = this.position();
    if (list.length === 0 || index < 0) {
      return;
    }
    this.openAsset(list[(index + delta + list.length) % list.length].id);
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  isSelected(id: string): boolean {
    return this.selection().includes(id);
  }

  toggle(id: string): void {
    this.selection.update((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  /** Selects the files between `from` and `to` (inclusive) of the visible list, keeping the rest. */
  selectRange(fromId: string, toId: string): void {
    const ids = this.visible().map((f) => f.id);
    const [a, b] = [ids.indexOf(fromId), ids.indexOf(toId)].sort((x, y) => x - y);
    if (a < 0) {
      return;
    }
    const range = ids.slice(a, b + 1);
    this.selection.update((s) => [...new Set([...s, ...range])]);
  }

  isFolderSelected(id: string): boolean {
    return this.folderSelection().includes(id);
  }

  toggleFolder(id: string): void {
    this.folderSelection.update((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  /** Replaces the selection (files and folders). */
  setSelection(files: readonly string[], folders: readonly string[] = []): void {
    this.selection.set([...files]);
    this.folderSelection.set([...folders]);
  }

  clearSelection(): void {
    this.setSelection([]);
  }

  /** Ctrl/⌘+A: every folder and file shown. */
  selectAll(): void {
    this.setSelection(
      this.visible().map((f) => f.id),
      this.subfolders().map((f) => f.id),
    );
  }

  // ── Edits ──────────────────────────────────────────────────────────────────

  edit(patch: Partial<SampleMediaDetails>): void {
    this.edits.update((e) => ({ ...e, ...patch }));
  }

  /** Gives the edits up. */
  discard(): void {
    this.edits.set({});
    this.sourceDraft.set(null);
  }

  /** Keeps the details and source edits in memory (the prototype's "save"). */
  save(): void {
    const id = this.assetId();
    const details = this.details();
    const source = this.sourceDraft();
    if (!id || !details) {
      return;
    }
    const lang = this.sourceLang();
    if (source !== null) {
      this.savedSources.update((map) => new Map(map).set(`${id}:${lang}`, source));
    }
    this.files.update((list) =>
      list.map((f) =>
        f.id === id
          ? { ...f, ...details, ...(source !== null && lang === DEFAULT_TEXT_LANG ? { source } : {}), status: 'changed' as const }
          : f,
      ),
    );
    this.edits.set({});
    this.sourceDraft.set(null);
    this.savedAt.set(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    this.toasts.show(this.t('detail.saved', { name: this.files().find((f) => f.id === id)?.name ?? '' }), 'success');
  }

  /** Delete with a danger confirm, then an Undo toast (decision 10). Resolves whether the files were removed. */
  async confirmDelete(files: readonly SampleMediaFile[]): Promise<boolean> {
    if (files.length === 0) {
      return false;
    }
    const count = files.length;
    const name = files[0].name;
    const used = files.reduce((sum, f) => sum + f.usages.length, 0);
    const confirmed = await this.confirms.confirm({
      title: this.t('delete.title', { count, name }),
      message: used > 0 ? this.t('delete.messageUsed', { count: used }) : this.t('delete.message'),
      confirmLabel: this.t('delete.confirm', { count }),
      tone: 'danger',
      // 25 or more files: the word "delete" must be typed (decision 99).
      typeToConfirm: typeToConfirmFor(count),
      // One used file: the confirmation names where it is used (the drawer reads the usages afresh); several: the files.
      details: count > 1 ? files.map((f) => f.name) : used > 0 ? files[0].usages.map((u) => `${u.title} · ${u.field}`) : undefined,
    });
    if (!confirmed) {
      return false;
    }
    const restore = this.remove(files.map((f) => f.id));
    this.toasts.undo(this.t('delete.done', { count, name }), () => {
      restore();
      this.toasts.show(this.t('delete.restored', { count }), 'info');
    });
    return true;
  }

  /**
   * One file downloads as itself, several as one ZIP named after the folder (decision 95). The sample only says so:
   * a toast (which screen readers announce) — nothing is downloaded.
   */
  download(files: readonly SampleMediaFile[]): void {
    if (files.length === 0) {
      return;
    }
    if (files.length === 1) {
      this.notice('media.download.single', { name: files[0].name });
      return;
    }
    const slug = this.folderName()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    this.notice('media.download.zip', { count: files.length, zip: `${slug}.zip` });
  }

  copyLink(file: SampleMediaFile): void {
    const url = `https://lumen-coffee.example/media/${file.name}`;
    void navigator.clipboard?.writeText(url).catch(() => undefined);
    this.toasts.show(this.t('detail.linkCopied'), 'success');
  }

  // ── Per-file actions (decision 92) ─────────────────────────────────────────

  /** The Rename dialog (name field, validation, Apply), then an Undo toast. */
  async renameFile(file: SampleMediaFile): Promise<void> {
    const taken = this.files()
      .filter((f) => f.folderId === file.folderId && f.id !== file.id)
      .map((f) => f.name.toLowerCase());
    const data: SampleRenameDialogData = { name: file.name, folder: mediaFolder(file.folderId)?.name ?? '', taken, uid: file.uid };
    const name = await this.dialogs.open<string, SampleRenameDialogData>(SampleMediaRenameDialogComponent, data, { injector: this.injector })
      .result;
    if (!name || name === file.name) {
      return;
    }
    const previous = file.name;
    this.files.update((list) => list.map((f) => (f.id === file.id ? { ...f, name } : f)));
    this.toasts.undo(this.t('rename.done', { from: previous, to: name }), () => {
      this.files.update((list) => list.map((f) => (f.id === file.id ? { ...f, name: previous } : f)));
      this.toasts.show(this.t('rename.undone', { name: previous }), 'info');
    });
  }

  /**
   * The Rename dialog of a folder (tree menu *Rename…*, page header *Rename folder…*): the name is required and free among the
   * sibling folders; in developer mode the UID can be changed there too. The sample's folder tree keeps its names: the
   * rename is announced and offers Undo.
   */
  async renameFolder(folder: SampleMediaFolder | null = this.folder()): Promise<void> {
    if (!folder) {
      return;
    }
    const taken = mediaFolderChildren(mediaFolderParent(folder.id))
      .filter((f) => f.id !== folder.id)
      .map((f) => f.name.toLowerCase());
    const data: SampleRenameDialogData = { kind: 'folder', name: folder.name, folder: '', taken, uid: folder.uid };
    const name = await this.dialogs.open<string, SampleRenameDialogData>(SampleMediaRenameDialogComponent, data, { injector: this.injector })
      .result;
    if (name && name !== folder.name) {
      this.toasts.undo(this.t('rename.folderDone', { from: folder.name, to: name }), () =>
        this.toasts.show(this.t('rename.undone', { name: folder.name }), 'info'),
      );
    }
  }

  /** The Move dialog with a folder tree (the current folder is disabled), then {@link applyMove}. */
  async moveFiles(files: readonly SampleMediaFile[]): Promise<void> {
    if (files.length === 0) {
      return;
    }
    const data: SampleMoveDialogData = {
      title: this.t('move.title', { count: files.length, name: files[0].name }),
      current: files[0].folderId,
      blocked: [],
      // Files can live at the library root, so the top level is offered for files too.
      root: true,
    };
    const target = await this.dialogs.open<string, SampleMoveDialogData>(SampleMediaMoveDialogComponent, data, { injector: this.injector })
      .result;
    if (target === MEDIA_ROOT) {
      // The sample has no files at the top level: the move is announced and can be undone, the files stay where they are.
      this.toasts.undo(this.t('move.rootDone', { count: files.length, name: files[0].name }), () => this.toasts.show(this.t('move.undone'), 'info'));
    } else if (target) {
      this.applyMove(
        files.map((f) => f.id),
        target,
      );
    }
  }

  /** The Move dialog for a folder (the open one from the page header menu, else a tile's or the tree's); the folder and what lies inside it can't be the target. */
  async moveFolder(folder: SampleMediaFolder | null = this.folder()): Promise<void> {
    if (!folder) {
      return;
    }
    const data: SampleMoveDialogData = {
      title: this.t('move.folderTitle', { name: folder.name }),
      current: mediaFolderParent(folder.id) ?? MEDIA_ROOT,
      blocked: [folder.id, ...mediaFolderDescendants(folder.id)],
      root: true,
    };
    const target = await this.dialogs.open<string, SampleMoveDialogData>(SampleMediaMoveDialogComponent, data, { injector: this.injector })
      .result;
    if (!target) {
      return;
    }
    const into = target === MEDIA_ROOT ? this.t('move.topLevel') : (mediaFolder(target)?.name ?? '');
    // The sample's folder structure is fixed: the move is announced and can be undone, the tree stays as it is.
    this.toasts.undo(this.t('move.folderDone', { name: folder.name, folder: into }), () => this.toasts.show(this.t('move.undone'), 'info'));
  }

  /** Moves files into a folder (a dialog, a bulk move or a drop on the tree) and offers Undo for the whole group. */
  applyMove(ids: readonly string[], target: string): void {
    const moving = this.files().filter((f) => ids.includes(f.id) && f.folderId !== target);
    if (moving.length === 0) {
      return;
    }
    const before = new Map(moving.map((f) => [f.id, f.folderId]));
    this.files.update((list) => list.map((f) => (before.has(f.id) ? { ...f, folderId: target } : f)));
    this.selection.update((s) => s.filter((id) => !before.has(id)));
    const open = this.assetId();
    if (open !== null && before.has(open) && this.folderId() !== target) {
      this.openAsset(null);
    }
    const folder = mediaFolder(target)?.name ?? '';
    this.toasts.undo(this.t('move.done', { count: moving.length, name: moving[0].name, folder }), () => {
      this.files.update((list) => list.map((f) => (before.has(f.id) ? { ...f, folderId: before.get(f.id)! } : f)));
      this.toasts.show(this.t('move.undone'), 'info');
    });
  }

  /** The dialog a link names (`dialog=…`), on the open file, the selection or the first file of the folder. */
  openDialog(kind: SampleMediaDialog): void {
    const fallback = this.asset() ?? this.visible()[0];
    const targets = this.selectedFiles().length > 0 ? this.selectedFiles() : fallback ? [fallback] : [];
    if (kind === 'folder-move') {
      void this.moveFolder();
    } else if (kind === 'rename-folder') {
      void this.renameFolder();
    } else if (kind === 'rename' && targets[0]) {
      void this.renameFile(targets[0]);
    } else if (kind === 'move') {
      void this.moveFiles(targets);
    } else if (kind === 'delete') {
      void this.confirmDelete(targets);
    }
  }

  /** Removes files; the returned function puts them back where they were. */
  remove(ids: readonly string[]): () => void {
    const before = this.files();
    const removed = before.map((f, i) => [i, f] as const).filter(([, f]) => ids.includes(f.id));
    this.files.set(before.filter((f) => !ids.includes(f.id)));
    this.selection.update((s) => s.filter((id) => !ids.includes(id)));
    if (this.assetId() !== null && ids.includes(this.assetId()!)) {
      this.openAsset(null);
    }
    return () => {
      const list = [...this.files()];
      for (const [i, f] of removed) {
        list.splice(Math.min(i, list.length), 0, f);
      }
      this.files.set(list);
    };
  }

  // ── Uploads (fake) ─────────────────────────────────────────────────────────

  /**
   * Starts fake uploads of chosen or dropped files into the open folder. A file that is refused — not an accepted type,
   * over the size limit, a name that is taken — shows up as a failed row with the reason (decision 98).
   */
  upload(files: readonly { readonly name: string; readonly size: number }[], folderId: string = this.folderId()): void {
    const rows = files.map<SampleUpload>((f) => {
      const base: SampleUpload = { id: `up-${this.nextUpload++}`, name: f.name, sizeBytes: f.size, progress: 0, state: 'uploading', folderId };
      const refused = this.refusal(f.name, f.size, folderId);
      return refused ? { ...base, state: 'error', ...refused } : base;
    });
    this.uploads.update((list) => [...list, ...rows]);
    this.startTimer();
  }

  /** The library registers its file picker; the returned function unregisters it. */
  registerPicker(picker: (folderId: string) => void): () => void {
    this.picker = picker;
    return () => {
      if (this.picker === picker) {
        this.picker = null;
      }
    };
  }

  /** Opens the file picker for uploads into `folderId` (the menus' *Upload* entries; the open folder without one). */
  pickFiles(folderId: string = this.folderId()): void {
    this.picker?.(folderId);
  }

  /** Why a file can't go into a folder, if it can't. */
  private refusal(name: string, size: number, folderId: string): { error: SampleUploadError; existingId?: string } | null {
    if (!UPLOAD_EXTENSIONS.includes(fileExtension(name))) {
      return { error: 'type' };
    }
    if (size > UPLOAD_MAX_BYTES) {
      return { error: 'size' };
    }
    const existing = this.files().find((f) => f.folderId === folderId && f.name.toLowerCase() === name.toLowerCase());
    return existing ? { error: 'duplicate', existingId: existing.id } : null;
  }

  /**
   * The scripted `upload=` states. `1`: two files mid-upload, one finished (alt text to enter), one lost its
   * connection. `errors`: every kind of refusal — type, size, duplicate, connection — and a finished picture.
   */
  seedUploads(kind: SampleUploadSeed = '1'): void {
    const mb = 1024 * 1024;
    const folderId = this.folderId();
    const done: SampleUpload = { id: 'up-c', name: 'cold-brew-bottle.jpg', sizeBytes: 0.72 * mb, progress: 100, state: 'done', folderId, fileId: UPLOADED_FILE };
    const lost: SampleUpload = { id: 'up-d', name: 'menu-board-summer.jpg', sizeBytes: 3.1 * mb, progress: 54, state: 'error', folderId, error: 'network' };
    this.uploads.set(
      kind === 'errors'
        ? [
            done,
            lost,
            { id: 'up-e', name: 'setup-wizard.exe', sizeBytes: 4.8 * mb, progress: 0, state: 'error', folderId, error: 'type' },
            { id: 'up-f', name: 'harvest-panorama.jpg', sizeBytes: 24.6 * mb, progress: 0, state: 'error', folderId, error: 'size' },
            { id: 'up-g', name: 'espresso-blend-bag.jpg', sizeBytes: 0.9 * mb, progress: 0, state: 'error', folderId, error: 'duplicate', existingId: 'a-espresso-bag' },
          ]
        : [
            { id: 'up-a', name: 'iced-latte-terrace.jpg', sizeBytes: 2.4 * mb, progress: 38, state: 'uploading', folderId },
            { id: 'up-b', name: 'iced-latte-close-up.jpg', sizeBytes: 1.8 * mb, progress: 71, state: 'uploading', folderId },
            done,
            lost,
          ],
    );
    this.startTimer();
  }

  /** Cancels a running upload, or removes a finished or failed row from the panel. */
  cancelUpload(id: string): void {
    this.uploads.update((list) => list.filter((u) => u.id !== id));
  }

  /** Retry: only for a lost connection (the other refusals would fail again). */
  retryUpload(id: string): void {
    this.uploads.update((list) => list.map((u) => (u.id === id ? { ...u, state: 'uploading' as const, progress: 0, error: undefined } : u)));
    this.startTimer();
  }

  /** A duplicate: *Replace* uploads over the existing file (links and usages stay), *Keep both* under the next free name. */
  resolveDuplicate(id: string, outcome: 'replaced' | 'copy'): void {
    const taken = new Set(this.files().map((f) => f.name.toLowerCase()));
    this.uploads.update((list) =>
      list.map((u) =>
        u.id === id
          ? {
              ...u,
              name: outcome === 'copy' ? copyName(u.name, taken) : u.name,
              state: 'uploading' as const,
              progress: 0,
              error: undefined,
              existingId: undefined,
              outcome,
            }
          : u,
      ),
    );
    this.startTimer();
  }

  /** The alt text entered in the panel for a finished picture: saved on the library file, and the row says so. */
  saveUploadAlt(id: string, alt: string): void {
    const upload = this.uploads().find((u) => u.id === id);
    if (!upload) {
      return;
    }
    this.uploads.update((list) => list.map((u) => (u.id === id ? { ...u, alt } : u)));
    if (upload.fileId) {
      this.files.update((list) => list.map((f) => (f.id === upload.fileId ? { ...f, alt } : f)));
    }
    this.toasts.show(this.t('uploads.altSaved', { name: upload.name }), 'success');
  }

  /** Closes the panel: finished and failed rows go, running uploads would continue in the background. */
  clearUploads(): void {
    this.uploads.update((list) => list.filter((u) => u.state === 'uploading'));
  }

  /** The folder name the upload panel's header names: the one folder the files go to, else how many. */
  readonly uploadTarget = computed(() => {
    const folders = [...new Set(this.uploads().map((u) => u.folderId))];
    return folders.length === 1 ? { folder: mediaFolder(folders[0])?.name ?? '', count: 1 } : { folder: '', count: folders.length };
  });

  private startTimer(): void {
    if (this.timer !== null || !this.uploads().some((u) => u.state === 'uploading')) {
      return;
    }
    const step = this.reducedMotion ? 25 : 7;
    this.timer = setInterval(() => {
      this.uploads.update((list) =>
        list.map((u) => {
          if (u.state !== 'uploading') {
            return u;
          }
          const progress = Math.min(100, u.progress + step + (u.name.length % 4));
          return progress >= 100 ? { ...u, progress: 100, state: 'done' as const } : { ...u, progress };
        }),
      );
      if (!this.uploads().some((u) => u.state === 'uploading')) {
        this.stopTimer();
      }
    }, this.reducedMotion ? TICK_MS_REDUCED : TICK_MS);
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
