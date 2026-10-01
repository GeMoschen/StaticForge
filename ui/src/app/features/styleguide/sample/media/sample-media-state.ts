import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { HashMap } from '@jsverse/transloco';
import { ToastService } from '../../../../core/ui/toast.service';
import { ConfirmService } from '../../../../shared/components/dialog/confirm.service';
import { SampleState } from '../sample-state';
import {
  DEFAULT_MEDIA_FOLDER,
  MEDIA_FILES,
  SampleFocal,
  SampleMediaFile,
  SampleMediaTypeFilter,
  UPLOADED_FILE,
  matchesType,
  mediaFile,
  mediaFolder,
  mediaFolderPath,
} from './sample-media-data';

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

export interface SampleUpload {
  readonly id: string;
  readonly name: string;
  readonly sizeBytes: number;
  /** 0–100. */
  readonly progress: number;
  readonly state: 'uploading' | 'done' | 'error';
  /** The library file a finished upload became ("Add alt text" opens it). */
  readonly fileId?: string;
}

/** The editable details of the open file (decision 21, Details). */
export interface SampleMediaDetails {
  readonly alt: string;
  readonly caption: string;
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

  readonly view = signal<SampleMediaView>('grid');
  readonly folderId = signal<string>(DEFAULT_MEDIA_FOLDER);
  readonly files = signal<readonly SampleMediaFile[]>(MEDIA_FILES);
  readonly search = signal('');
  readonly typeFilter = signal<SampleMediaTypeFilter>('all');
  readonly sort = signal<SampleMediaSort>('name');
  readonly direction = signal<SampleSortDirection>('asc');
  /** Selected file ids (the grid's and the list's). */
  readonly selection = signal<readonly string[]>([]);

  readonly assetId = signal<string | null>(null);
  readonly tab = signal<SampleMediaTab>('details');
  /** The drawer's width, kept while the area lives (narrower below the large breakpoint). */
  readonly drawerWidth = signal(typeof innerWidth === 'number' && innerWidth < 1280 ? 420 : 520);
  /** Unsaved edits of the open file's details, and of a text file's source. */
  readonly edits = signal<Partial<SampleMediaDetails>>({});
  readonly sourceDraft = signal<string | null>(null);
  /** "Replace" was chosen in the drawer's ⋮ menu: the Details tab brings its Replace field into view. */
  readonly replaceRequest = signal(false);
  /** Per-file switches the user flipped: "Different file per language", "Process CMS syntax". */
  readonly localized = signal<ReadonlyMap<string, boolean>>(new Map());
  readonly processed = signal<ReadonlyMap<string, boolean>>(new Map());

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
    const query = this.search().trim().toLowerCase();
    const type = this.typeFilter();
    const compare = compareBy(this.sort());
    const sign = this.direction() === 'asc' ? 1 : -1;
    return this.files()
      .filter((f) => f.folderId === this.folderId() && matchesType(f, type) && (!query || f.name.toLowerCase().includes(query)))
      .sort((a, b) => sign * compare(a, b));
  });
  readonly folderCount = computed(() => this.files().filter((f) => f.folderId === this.folderId()).length);
  readonly selectedFiles = computed(() => this.visible().filter((f) => this.selection().includes(f.id)));

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
      focal: edits.focal ?? file.focal,
    };
  });
  readonly detailsDirty = computed(() => {
    const file = this.asset();
    const now = this.details();
    if (!file || !now) {
      return false;
    }
    return now.alt !== file.alt || now.caption !== file.caption || now.focal?.x !== file.focal?.x || now.focal?.y !== file.focal?.y;
  });
  readonly sourceDirty = computed(() => {
    const draft = this.sourceDraft();
    return draft !== null && draft !== this.asset()?.source;
  });

  /** The open file's place in the library (for ←/→). */
  readonly position = computed(() => {
    const list = this.visible();
    const index = list.findIndex((f) => f.id === this.assetId());
    return { index, count: list.length };
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopTimer());
  }

  t(key: string, params?: HashMap): string {
    return this.sample.t(`media.${key}`, params);
  }

  notice(key = 'prototypeNotice', params?: HashMap): void {
    this.sample.notice(key, params);
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
    }
    this.folderId.set(id);
  }

  /** Opens a file in the drawer (unsaved edits of the previous one are dropped: nothing is saved anyway). */
  openAsset(id: string | null, tab?: SampleMediaTab): void {
    if (id !== this.assetId()) {
      this.edits.set({});
      this.sourceDraft.set(null);
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

  // ── Edits ──────────────────────────────────────────────────────────────────

  edit(patch: Partial<SampleMediaDetails>): void {
    this.edits.update((e) => ({ ...e, ...patch }));
  }

  /** Keeps the details and source edits in memory (the prototype's "save"). */
  save(): void {
    const id = this.assetId();
    const details = this.details();
    const source = this.sourceDraft();
    if (!id || !details) {
      return;
    }
    this.files.update((list) =>
      list.map((f) => (f.id === id ? { ...f, ...details, ...(source !== null ? { source } : {}), status: 'changed' as const } : f)),
    );
    this.edits.set({});
    this.sourceDraft.set(null);
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
      details: count > 1 ? files.map((f) => f.name) : undefined,
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

  download(files: readonly SampleMediaFile[]): void {
    this.notice('media.downloadNotice', { count: files.length, name: files[0]?.name ?? '' });
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

  /** Starts fake uploads of chosen or dropped files into the open folder. */
  upload(files: readonly { readonly name: string; readonly size: number }[]): void {
    const rows = files.map<SampleUpload>((f) => ({ id: `up-${this.nextUpload++}`, name: f.name, sizeBytes: f.size, progress: 0, state: 'uploading' }));
    this.uploads.update((list) => [...list, ...rows]);
    this.startTimer();
  }

  /** The scripted `upload=1` state: two files mid-upload, one finished (needs alt text), one failed. */
  seedUploads(): void {
    const mb = 1024 * 1024;
    this.uploads.set([
      { id: 'up-a', name: 'iced-latte-terrace.jpg', sizeBytes: 2.4 * mb, progress: 38, state: 'uploading' },
      { id: 'up-b', name: 'iced-latte-close-up.jpg', sizeBytes: 1.8 * mb, progress: 71, state: 'uploading' },
      { id: 'up-c', name: 'cold-brew-bottle.jpg', sizeBytes: 0.72 * mb, progress: 100, state: 'done', fileId: UPLOADED_FILE },
      { id: 'up-d', name: 'menu-board-summer.jpg', sizeBytes: 3.1 * mb, progress: 54, state: 'error' },
    ]);
    this.startTimer();
  }

  cancelUpload(id: string): void {
    this.uploads.update((list) => list.filter((u) => u.id !== id));
  }

  retryUpload(id: string): void {
    this.uploads.update((list) => list.map((u) => (u.id === id ? { ...u, state: 'uploading' as const, progress: 0 } : u)));
    this.startTimer();
  }

  /** Closes the panel: finished and failed rows go, running uploads would continue in the background. */
  clearUploads(): void {
    this.uploads.update((list) => list.filter((u) => u.state === 'uploading'));
  }

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
