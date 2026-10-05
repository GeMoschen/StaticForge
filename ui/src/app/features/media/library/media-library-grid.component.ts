import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { SfStatusComponent } from '../../../shared/components/display/sf-status.component';
import { SfCheckboxComponent } from '../../../shared/components/forms/sf-checkbox.component';
import { SfMenuComponent } from '../../../shared/components/menu/sf-menu.component';
import { SfFileSizePipe } from '../../../shared/pipes/sf-file-size.pipe';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { MediaFolderActions } from './media-folder-actions';
import { MediaItemActions } from './media-item-actions';
import { MediaMover } from './media-mover';
import { MediaLibraryStore, type FolderView, type MediaSummaryView } from './media-library.store';
import { formatOf } from './media-library.util';
import { MediaPreviewComponent } from './media-preview.component';
import { MediaSelectionActions } from './media-selection.actions';

/** Start loading more cards this far (px) before the end of the grid is reached. */
const NEAR_END_PX = 200;
/** A press-and-drag shorter than this (px) on empty space is a plain click. */
const MARQUEE_THRESHOLD_PX = 4;

/** One card of the grid: folders come first, then the files, in the order shown. `key` is `d:<uuid>` or `f:<uuid>`. */
interface Entry {
  readonly key: string;
  readonly kind: 'folder' | 'file';
  readonly uuid: string;
}

/** A rubber-band rectangle in the grid's own (scroll-aware) coordinates. */
interface MarqueeRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface MarqueeDrag {
  readonly x: number;
  readonly y: number;
  readonly additive: boolean;
  readonly baseFiles: readonly string[];
  readonly baseFolders: readonly string[];
  dragging: boolean;
}

/**
 * The library grid (decision 22): one focusable card per folder and file (folders first) — the preview on the sunken
 * surface, the name (truncated at the end only), "JPG · 1.2 MB", a labelled checkbox top left (shown on hover, focus or
 * when selected) and a status icon when the file is not released.
 *
 * It behaves like the Explorer, folders and files being ONE ordered list. A click selects only that card (and makes it
 * the anchor); Ctrl/⌘+click toggles it, Shift+click selects the range from the anchor (Ctrl+Shift adds it); a double
 * click opens (a folder is entered, a file shows its detail). A click on empty space clears the selection, a press and
 * drag on empty space draws a rubber band that selects the cards it touches (Ctrl/⌘ keeps the selection). A right click
 * selects an unselected card first, then opens its menu.
 *
 * A `role=grid` with ONE roving tab stop: the arrow keys move the focus across the cards as laid out and select that
 * card (Shift extends the range, Ctrl/⌘ moves the focus only), Home/End jump, Space toggles, Enter opens, Ctrl/⌘+A selects
 * all, F2 renames, Delete deletes (the selection when there is one), Shift+F10 (or the menu key) opens the menu, Escape
 * clears the selection. The files are rendered in chunks as the end scrolls into view, so a big folder costs what is on
 * screen.
 */
@Component({
  selector: 'sf-media-library-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MediaPreviewComponent, SfCheckboxComponent, SfIconComponent, SfFileSizePipe, SfMenuComponent, SfStatusComponent, TranslocoPipe],
  host: { '(contextmenu)': 'onEmptyContextMenu($event)', '(mousedown)': 'onMarqueeStart($event)' },
  templateUrl: './media-library-grid.component.html',
  styleUrl: './media-library-grid.component.scss',
})
export class MediaLibraryGridComponent implements AfterViewInit {
  protected readonly library = inject(MediaLibraryStore);
  protected readonly items = inject(MediaItemActions);
  protected readonly folders = inject(MediaFolderActions);
  protected readonly mover = inject(MediaMover);
  private readonly selection = inject(MediaSelectionActions);
  private readonly transloco = inject(TranslocoService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly changes = inject(ChangeDetectorRef);
  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');
  private readonly fileSize = new SfFileSizePipe();
  private observer: IntersectionObserver | null = null;

  /** The card in the tab order (its entry key, so it survives sorting and filtering). */
  private readonly activeKey = signal<string | null>(null);
  /** The anchor of Shift ranges (an entry key). */
  private anchor: string | null = null;
  /** A Shift+F10 press opened the menu already; the `contextmenu` event some browsers add must not open it twice. */
  private suppressContextMenu = false;
  /** The rubber band being dragged, if any. */
  private drag: MarqueeDrag | null = null;
  protected readonly marquee = signal<MarqueeRect | null>(null);

  protected readonly folderName = computed(
    () => this.library.folderNode()?.displayName ?? this.transloco.translate('media.library.title'),
  );

  /** Every card of the open folder in the order shown: the folders, then all files (rendered or not). */
  private readonly entries = computed<Entry[]>(() => [
    ...this.library.subfolders().flatMap((f) => (f.uuid ? [{ key: folderKey(f), kind: 'folder' as const, uuid: f.uuid }] : [])),
    ...this.library.visible().flatMap((f) => (f.uuid ? [{ key: fileKey(f), kind: 'file' as const, uuid: f.uuid }] : [])),
  ]);
  protected readonly tabStop = computed(() => {
    const all = this.entries();
    const active = this.activeKey();
    const rendered = this.library.subfolders().filter((f) => f.uuid).length + this.library.shown().length;
    const index = all.findIndex((e) => e.key === active);
    return index >= 0 && index < rendered ? active : (all[0]?.key ?? null);
  });

  constructor() {
    // More files than fit: once the rendered cards have grown, look again whether the end is still in view.
    effect(() => {
      this.library.shown();
      untracked(() => setTimeout(() => this.loadWhileNearEnd()));
    });
    inject(DestroyRef).onDestroy(() => {
      this.observer?.disconnect();
      this.stopDrag();
    });
  }

  ngAfterViewInit(): void {
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }
    this.observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && this.library.showMore(), {
      root: this.host,
      rootMargin: `${NEAR_END_PX}px`,
    });
    const el = this.sentinel()?.nativeElement;
    if (el) {
      this.observer.observe(el);
    }
  }

  private loadWhileNearEnd(): void {
    const el = this.sentinel()?.nativeElement;
    if (!el || !this.library.hasMoreToShow()) {
      return;
    }
    if (el.getBoundingClientRect().top <= this.host.getBoundingClientRect().bottom + NEAR_END_PX) {
      this.library.showMore();
    }
  }

  protected format(file: MediaSummaryView): string {
    return formatOf(file);
  }

  protected folderKey(folder: FolderView): string {
    return folderKey(folder);
  }

  protected fileKey(file: MediaSummaryView): string {
    return fileKey(file);
  }

  /** The card's name: file name, type and size, and the status when not released. */
  protected cardLabel(file: MediaSummaryView): string {
    const meta = this.transloco.translate('media.grid.meta', { type: formatOf(file), size: this.fileSize.transform(file.sizeBytes) });
    const status = this.library.statusOf(file);
    return [file.displayName ?? file.uid ?? '', meta, ...(status ? [status.label] : [])].join(', ');
  }

  // ── Selection ───────────────────────────────────────────────────────────

  private isSelectedKey(key: string): boolean {
    return key.startsWith('d:') ? this.library.isFolderSelected(key.slice(2)) : this.library.isSelected(key.slice(2));
  }

  /** Replaces the selection with the given entries. */
  private select(entries: readonly Entry[], keepFiles: readonly string[] = [], keepFolders: readonly string[] = []): void {
    this.library.setSelection([...new Set([...keepFiles, ...entries.filter((e) => e.kind === 'file').map((e) => e.uuid)])]);
    this.library.setFolderSelection([...new Set([...keepFolders, ...entries.filter((e) => e.kind === 'folder').map((e) => e.uuid)])]);
  }

  private selectOnly(key: string): void {
    const entry = this.entries().find((e) => e.key === key);
    this.select(entry ? [entry] : []);
    this.anchor = key;
    this.activeKey.set(key);
  }

  /** Selects the entries from the anchor to `key` (the anchor itself when there is none yet). */
  private selectRange(key: string, additive: boolean): void {
    const all = this.entries();
    const from = all.findIndex((e) => e.key === (this.anchor ?? key));
    const to = all.findIndex((e) => e.key === key);
    if (to < 0) {
      return;
    }
    const [a, b] = from < 0 ? [to, to] : [Math.min(from, to), Math.max(from, to)];
    this.anchor ??= key;
    this.select(all.slice(a, b + 1), additive ? this.library.selected() : [], additive ? this.library.selectedFolderUuids() : []);
    this.activeKey.set(key);
  }

  private toggleKey(key: string): void {
    if (key.startsWith('d:')) {
      this.library.toggleFolder(key.slice(2));
    } else {
      this.library.toggle(key.slice(2));
    }
    this.anchor = key;
    this.activeKey.set(key);
  }

  /** A right click or the menu key on an unselected card selects it first (and only it), as the Explorer does. */
  private ensureSelected(key: string): void {
    if (!this.isSelectedKey(key)) {
      this.selectOnly(key);
    } else {
      this.activeKey.set(key);
    }
  }

  // ── Pointer ─────────────────────────────────────────────────────────────

  /** A right click on empty space (not on a card) opens the menu of the open folder; the selection stays. */
  protected onEmptyContextMenu(event: MouseEvent): void {
    if (!(event.target instanceof Element && event.target.closest('.card'))) {
      this.folders.openFolderContextMenu(event);
    }
  }

  private static ignored(event: Event): boolean {
    return event.target instanceof Element && !!event.target.closest('.card__check, .card__more');
  }

  /** A click selects only the card; Ctrl/⌘ toggles it, Shift selects the range from the anchor (the checkbox and ⋮ act on their own). */
  protected onCardClick(key: string, event: MouseEvent): void {
    if (MediaLibraryGridComponent.ignored(event)) {
      return;
    }
    if (event.shiftKey) {
      this.selectRange(key, event.ctrlKey || event.metaKey);
    } else if (event.ctrlKey || event.metaKey) {
      this.toggleKey(key);
    } else {
      this.selectOnly(key);
    }
  }

  /** A double click opens: a folder is entered, a file shows its detail. */
  protected onCardDblClick(key: string, event: MouseEvent): void {
    if (!MediaLibraryGridComponent.ignored(event)) {
      this.open(key);
    }
  }

  private open(key: string): void {
    if (key.startsWith('d:')) {
      void this.library.openFolder(key.slice(2));
    } else {
      void this.library.openAsset(key.slice(2));
    }
  }

  protected onCheck(key: string): void {
    this.toggleKey(key);
  }

  protected onFocus(key: string): void {
    this.activeKey.set(key);
  }

  protected onFolderContextMenu(event: MouseEvent, folder: FolderView): void {
    event.preventDefault();
    if (this.suppressContextMenu) {
      this.suppressContextMenu = false;
      return;
    }
    this.ensureSelected(folderKey(folder));
    this.folders.onFolderContextMenu(folder, event);
  }

  protected onContextMenu(event: MouseEvent, file: MediaSummaryView): void {
    if (this.suppressContextMenu) {
      this.suppressContextMenu = false;
      event.preventDefault();
      return;
    }
    this.ensureSelected(fileKey(file));
    this.items.onItemContextMenu(file, event);
  }

  // ── Rubber band ─────────────────────────────────────────────────────────

  /** Pressing on empty space starts a rubber band; without moving it is a click that clears the selection. */
  protected onMarqueeStart(event: MouseEvent): void {
    const hostRect = this.host.getBoundingClientRect();
    const onScrollbar = this.host.clientWidth > 0 && event.clientX - hostRect.left >= this.host.clientWidth;
    if (event.button !== 0 || onScrollbar || !(event.target instanceof Element) || event.target.closest('.card')) {
      return;
    }
    event.preventDefault(); // no text selection while dragging
    const additive = event.ctrlKey || event.metaKey;
    const { x, y } = this.contentPoint(event);
    this.drag = {
      x,
      y,
      additive,
      baseFiles: additive ? [...this.library.selected()] : [],
      baseFolders: additive ? [...this.library.selectedFolderUuids()] : [],
      dragging: false,
    };
    document.addEventListener('mousemove', this.onDragMove);
    document.addEventListener('mouseup', this.onDragEnd);
  }

  /** A client point in the grid's scroll-aware coordinates. */
  private contentPoint(event: MouseEvent): { x: number; y: number } {
    const rect = this.host.getBoundingClientRect();
    return { x: event.clientX - rect.left + this.host.scrollLeft, y: event.clientY - rect.top + this.host.scrollTop };
  }

  private readonly onDragMove = (event: MouseEvent): void => {
    const drag = this.drag;
    if (!drag) {
      return;
    }
    const { x, y } = this.contentPoint(event);
    if (!drag.dragging && Math.hypot(x - drag.x, y - drag.y) < MARQUEE_THRESHOLD_PX) {
      return;
    }
    drag.dragging = true;
    const rect: MarqueeRect = { left: Math.min(x, drag.x), top: Math.min(y, drag.y), width: Math.abs(x - drag.x), height: Math.abs(y - drag.y) };
    this.marquee.set(rect);
    this.select(this.touched(rect), drag.baseFiles, drag.baseFolders);
  };

  private readonly onDragEnd = (): void => {
    const drag = this.drag;
    this.stopDrag();
    if (drag && !drag.dragging && !drag.additive) {
      this.library.clearSelection();
    }
  };

  private stopDrag(): void {
    this.drag = null;
    this.marquee.set(null);
    document.removeEventListener('mousemove', this.onDragMove);
    document.removeEventListener('mouseup', this.onDragEnd);
  }

  /** The rendered cards the rectangle touches. */
  private touched(rect: MarqueeRect): Entry[] {
    const origin = this.host.getBoundingClientRect();
    const result: Entry[] = [];
    for (const card of Array.from(this.host.querySelectorAll<HTMLElement>('.card'))) {
      const box = card.getBoundingClientRect();
      const left = box.left - origin.left + this.host.scrollLeft;
      const top = box.top - origin.top + this.host.scrollTop;
      if (left < rect.left + rect.width && left + box.width > rect.left && top < rect.top + rect.height && top + box.height > rect.top) {
        const { folder, file } = card.dataset;
        if (folder) {
          result.push({ key: `d:${folder}`, kind: 'folder', uuid: folder });
        } else if (file) {
          result.push({ key: `f:${file}`, kind: 'file', uuid: file });
        }
      }
    }
    return result;
  }

  // ── Keyboard ────────────────────────────────────────────────────────────

  protected onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (event.altKey || target.closest('.card__more') || target.closest('.card') !== target) {
      return; // the ⋮ menu button and the checkbox handle their own keys
    }
    const all = this.entries();
    const key = target.dataset['folder'] ? `d:${target.dataset['folder']}` : `f:${target.dataset['file']}`;
    const current = all.findIndex((e) => e.key === key);
    if (current < 0) {
      return;
    }
    const entry = all[current];
    const columns = this.columns();
    const mod = event.ctrlKey || event.metaKey;
    let next = current;
    switch (event.key) {
      case 'ArrowRight':
        next = Math.min(all.length - 1, current + 1);
        break;
      case 'ArrowLeft':
        next = Math.max(0, current - 1);
        break;
      case 'ArrowDown':
        next = current + columns < all.length ? current + columns : current;
        break;
      case 'ArrowUp':
        next = current - columns >= 0 ? current - columns : current;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = all.length - 1;
        break;
      case ' ':
        event.preventDefault();
        this.toggleKey(entry.key);
        return;
      case 'Enter':
        event.preventDefault();
        this.open(entry.key);
        return;
      case 'Escape':
        if (this.library.selectionCount() > 0) {
          event.preventDefault();
          this.library.clearSelection();
        }
        return;
      case 'F2':
        if (!mod && this.library.canEdit()) {
          event.preventDefault();
          this.rename(all, entry);
        }
        return;
      case 'Delete':
        if (this.library.canEdit()) {
          event.preventDefault();
          void this.delete(entry);
        }
        return;
      case 'F10':
      case 'ContextMenu':
        if (event.key === 'ContextMenu' || event.shiftKey) {
          event.preventDefault();
          this.suppressContextMenu = true;
          setTimeout(() => (this.suppressContextMenu = false));
          this.openMenu(entry);
        }
        return;
      case 'a':
      case 'A':
        if (mod) {
          event.preventDefault();
          this.library.selectAll();
        }
        return;
      default:
        return;
    }
    event.preventDefault();
    this.moveTo(all, next, event);
  }

  /** Moves the focus to `index` of the entries (Ctrl/⌘: focus only; Shift: extends the range; else selects only it). */
  private moveTo(all: readonly Entry[], index: number, event: KeyboardEvent): void {
    const target = all[index];
    if (!target) {
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      this.activeKey.set(target.key);
    } else if (event.shiftKey) {
      this.selectRange(target.key, false);
    } else {
      this.selectOnly(target.key);
    }
    const fileIndex = index - this.library.subfolders().filter((f) => f.uuid).length;
    if (fileIndex >= this.library.renderLimit()) {
      this.library.renderLimit.set(fileIndex + 1);
      this.changes.detectChanges();
    }
    this.card(target.key)?.focus();
  }

  private openMenu(entry: Entry): void {
    this.ensureSelected(entry.key);
    const card = this.card(entry.key);
    if (!card) {
      return;
    }
    if (entry.kind === 'folder') {
      const folder = this.library.subfolders().find((f) => f.uuid === entry.uuid);
      if (folder) {
        this.folders.onFolderContextMenu(folder, card);
      }
    } else {
      const file = this.library.visible().find((f) => f.uuid === entry.uuid);
      if (file) {
        this.items.onItemContextMenu(file, card);
      }
    }
  }

  /** F2 renames the one selected item, else the focused one; nothing when several are selected. */
  private rename(all: readonly Entry[], focused: Entry): void {
    const count = this.library.selectionCount();
    if (count > 1) {
      return;
    }
    const entry = count === 1 ? (all.find((e) => this.isSelectedKey(e.key)) ?? focused) : focused;
    if (entry.kind === 'folder') {
      const folder = this.library.subfolders().find((f) => f.uuid === entry.uuid);
      if (folder) {
        void this.folders.rename(folder);
      }
    } else {
      const file = this.library.visible().find((f) => f.uuid === entry.uuid);
      if (file) {
        void this.items.rename(file);
      }
    }
  }

  /** Delete deletes the selection; with nothing selected the focused item. */
  private async delete(focused: Entry): Promise<void> {
    if (this.library.selectionCount() > 0) {
      return this.selection.delete();
    }
    if (focused.kind === 'folder') {
      const folder = this.library.subfolders().find((f) => f.uuid === focused.uuid);
      return folder ? this.folders.deleteFromTile(folder) : undefined;
    }
    const file = this.library.visible().find((f) => f.uuid === focused.uuid);
    return file ? this.items.deleteFile(file) : undefined;
  }

  private card(key: string): HTMLElement | null {
    const kind = key.startsWith('d:') ? 'folder' : 'file';
    const uuid = key.slice(2);
    return Array.from(this.host.querySelectorAll<HTMLElement>('.card')).find((card) => card.dataset[kind] === uuid) ?? null;
  }

  /** How many cards share the first row (the grid reflows with the width); folders and files flow together. */
  private columns(): number {
    const cards = Array.from(this.host.querySelectorAll<HTMLElement>('.card'));
    const top = cards[0]?.offsetTop ?? 0;
    return Math.max(1, cards.filter((card) => card.offsetTop === top).length);
  }
}

function folderKey(folder: FolderView): string {
  return `d:${folder.uuid}`;
}

function fileKey(file: MediaSummaryView): string {
  return `f:${file.uuid}`;
}
