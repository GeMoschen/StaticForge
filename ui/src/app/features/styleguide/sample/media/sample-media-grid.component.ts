import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, ElementRef, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfStatusComponent } from '../../../../shared/components/display/sf-status.component';
import { SfCheckboxComponent } from '../../../../shared/components/forms/sf-checkbox.component';
import { SfMenuComponent } from '../../../../shared/components/menu/sf-menu.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { SfFileSizePipe } from '../../../../shared/pipes/sf-file-size.pipe';
import { STATUS_ICONS, STATUS_TONES } from '../sample-state';
import { SampleMediaFile, SampleMediaFolder } from './sample-media-data';
import { SampleMediaItemActions } from './sample-media-item-actions';
import { SampleMediaState } from './sample-media-state';

/** The first lines of a text file, for its card. */
const SNIPPET_LINES = 7;
/** A press-and-drag shorter than this (px) on empty space is a plain click. */
const MARQUEE_THRESHOLD_PX = 4;

/** One card of the grid: folders come first, then the files, in the order shown. `key` is `d:<id>` or `f:<id>`. */
interface Entry {
  readonly key: string;
  readonly kind: 'folder' | 'file';
  readonly id: string;
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

const folderKey = (folder: SampleMediaFolder) => `d:${folder.id}`;
const fileKey = (file: SampleMediaFile) => `f:${file.id}`;

/**
 * The library grid (decision 22): one focusable card per folder and file (folders first, with the accent-coloured folder
 * icon) — the thumbnail on the sunken surface, the name (truncated at the end only), "JPG · 1.2 MB", a labelled checkbox top
 * left (shown on hover, focus or when selected) and a status icon when the file is not released.
 *
 * It behaves like the Explorer, folders and files being ONE ordered list. A click selects only that card (and makes it the
 * anchor); Ctrl/⌘+click toggles it, Shift+click selects the range from the anchor (Ctrl+Shift adds it); a double click opens
 * (a folder is entered, a file shows its detail). A click on empty space clears the selection, a press and drag on empty
 * space draws a rubber band that selects the cards it touches (Ctrl/⌘ keeps the selection). A right click selects an
 * unselected card first, then opens its menu; on empty space it opens the open folder's menu and keeps the selection.
 *
 * A `role=grid` with ONE roving tab stop: the arrow keys move the focus across the cards as laid out and select that card
 * (Shift extends the range, Ctrl/⌘ moves the focus only), Home/End jump, Space toggles, Enter opens, Ctrl/⌘+A selects all,
 * F2 renames, Delete deletes (the selection when there is one), Shift+F10 (or the menu key) opens the menu, Escape clears
 * the selection. Cards of files can be dragged onto a folder of the tree to move them (decision 94).
 */
@Component({
  selector: 'sf-sample-media-grid',
  standalone: true,
  imports: [SfCheckboxComponent, SfFileSizePipe, SfIconComponent, SfMenuComponent, SfStatusComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(contextmenu)': 'onEmptyContextMenu($event)', '(mousedown)': 'onMarqueeStart($event)' },
  templateUrl: './sample-media-grid.component.html',
  styleUrl: './sample-media-grid.component.scss',
})
export class SampleMediaGridComponent {
  protected readonly state = inject(SampleMediaState);
  protected readonly actions = inject(SampleMediaItemActions);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly changes = inject(ChangeDetectorRef);

  protected readonly tones = STATUS_TONES;
  protected readonly icons = STATUS_ICONS;
  /** The card in the tab order (its entry key, so it survives sorting and filtering). */
  private readonly activeKey = signal<string | null>(null);
  /** The anchor of Shift ranges (an entry key). */
  private anchor: string | null = null;
  private readonly fileSize = new SfFileSizePipe();
  /** A Shift+F10 press opened the menu already; the `contextmenu` event some browsers add must not open it twice. */
  private suppressContextMenu = false;
  /** The rubber band being dragged, if any. */
  private drag: MarqueeDrag | null = null;
  protected readonly marquee = signal<MarqueeRect | null>(null);

  /** Every card in the order shown: the folders, then the files. */
  private readonly entries = computed<Entry[]>(() => [
    ...this.state.subfolders().map((f) => ({ key: folderKey(f), kind: 'folder' as const, id: f.id })),
    ...this.state.visible().map((f) => ({ key: fileKey(f), kind: 'file' as const, id: f.id })),
  ]);

  protected readonly tabStop = computed(() => {
    const all = this.entries();
    const active = this.activeKey();
    return all.some((e) => e.key === active) ? active : (all[0]?.key ?? null);
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopDrag());
  }

  protected folderKey(folder: SampleMediaFolder): string {
    return folderKey(folder);
  }

  protected fileKey(file: SampleMediaFile): string {
    return fileKey(file);
  }

  /** The card's name: file name, type and size, and the status when not released. */
  protected cardLabel(file: SampleMediaFile): string {
    const meta = this.state.t('grid.meta', { type: file.format, size: this.fileSize.transform(file.sizeBytes) });
    const status = file.status === 'released' ? [] : [this.state.sample.statusLabel(file.status)];
    return [file.name, meta, ...status].join(', ');
  }

  protected snippet(file: SampleMediaFile): string {
    return (file.source ?? '').split('\n').slice(0, SNIPPET_LINES).join('\n');
  }

  // ── Selection ───────────────────────────────────────────────────────────

  private isSelectedKey(key: string): boolean {
    return key.startsWith('d:') ? this.state.isFolderSelected(key.slice(2)) : this.state.isSelected(key.slice(2));
  }

  /** Replaces the selection with the given entries (plus what is kept). */
  private select(entries: readonly Entry[], keepFiles: readonly string[] = [], keepFolders: readonly string[] = []): void {
    this.state.setSelection(
      [...new Set([...keepFiles, ...entries.filter((e) => e.kind === 'file').map((e) => e.id)])],
      [...new Set([...keepFolders, ...entries.filter((e) => e.kind === 'folder').map((e) => e.id)])],
    );
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
    this.select(all.slice(a, b + 1), additive ? this.state.selection() : [], additive ? this.state.folderSelection() : []);
    this.activeKey.set(key);
  }

  private toggleKey(key: string): void {
    if (key.startsWith('d:')) {
      this.state.toggleFolder(key.slice(2));
    } else {
      this.state.toggle(key.slice(2));
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
      this.actions.openEmptyMenu(event);
    }
  }

  private static ignored(event: Event): boolean {
    return event.target instanceof Element && !!event.target.closest('.card__check, .card__more');
  }

  /** A click selects only the card; Ctrl/⌘ toggles it, Shift selects the range from the anchor (the checkbox and ⋮ act on their own). */
  protected onCardClick(key: string, event: MouseEvent): void {
    if (SampleMediaGridComponent.ignored(event)) {
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
    if (!SampleMediaGridComponent.ignored(event)) {
      this.open(key);
    }
  }

  private open(key: string): void {
    if (key.startsWith('d:')) {
      void this.state.requestOpenFolder(key.slice(2));
    } else {
      void this.state.requestOpenAsset(key.slice(2));
    }
  }

  protected onCheck(key: string): void {
    this.toggleKey(key);
  }

  protected onFocus(key: string): void {
    this.activeKey.set(key);
  }

  protected onFolderContextMenu(event: MouseEvent, folder: SampleMediaFolder): void {
    event.preventDefault();
    if (this.suppressContextMenu) {
      this.suppressContextMenu = false;
      return;
    }
    this.ensureSelected(folderKey(folder));
    this.actions.openFolderMenu(event, folder);
  }

  protected onContextMenu(event: MouseEvent, file: SampleMediaFile): void {
    if (this.suppressContextMenu) {
      this.suppressContextMenu = false;
      event.preventDefault();
      return;
    }
    event.preventDefault();
    this.ensureSelected(fileKey(file));
    this.actions.openFileMenu(event, file);
  }

  protected onDragStart(event: DragEvent, file: SampleMediaFile): void {
    const ids = this.state.isSelected(file.id) ? this.state.selection() : [file.id];
    this.state.dragging.set(ids);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(
        'text/plain',
        this.state
          .files()
          .filter((f) => ids.includes(f.id))
          .map((f) => f.name)
          .join('\n'),
      );
    }
  }

  protected onDragEnd(): void {
    this.state.dragging.set([]);
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
      baseFiles: additive ? [...this.state.selection()] : [],
      baseFolders: additive ? [...this.state.folderSelection()] : [],
      dragging: false,
    };
    document.addEventListener('mousemove', this.onDragMove);
    document.addEventListener('mouseup', this.onDragUp);
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

  private readonly onDragUp = (): void => {
    const drag = this.drag;
    this.stopDrag();
    if (drag && !drag.dragging && !drag.additive) {
      this.state.clearSelection();
    }
  };

  private stopDrag(): void {
    this.drag = null;
    this.marquee.set(null);
    document.removeEventListener('mousemove', this.onDragMove);
    document.removeEventListener('mouseup', this.onDragUp);
  }

  /** The cards the rectangle touches. */
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
          result.push({ key: `d:${folder}`, kind: 'folder', id: folder });
        } else if (file) {
          result.push({ key: `f:${file}`, kind: 'file', id: file });
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
        if (this.state.selectionCount() > 0) {
          event.preventDefault();
          this.state.clearSelection();
        }
        return;
      case 'F2':
        if (!mod && this.state.canEdit()) {
          event.preventDefault();
          this.rename(all, entry);
        }
        return;
      case 'Delete':
        if (this.state.canEdit()) {
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
          this.state.selectAll();
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
    this.changes.detectChanges();
    this.card(target.key)?.focus();
  }

  private openMenu(entry: Entry): void {
    this.ensureSelected(entry.key);
    const card = this.card(entry.key);
    if (!card) {
      return;
    }
    if (entry.kind === 'folder') {
      const folder = this.state.subfolders().find((f) => f.id === entry.id);
      if (folder) {
        this.actions.openFolderMenu(card, folder);
      }
    } else {
      const file = this.state.visible().find((f) => f.id === entry.id);
      if (file) {
        this.actions.openFileMenu(card, file);
      }
    }
  }

  /** F2 renames the one selected item, else the focused one; nothing when several are selected. */
  private rename(all: readonly Entry[], focused: Entry): void {
    if (this.state.selectionCount() > 1) {
      return;
    }
    const entry = this.state.selectionCount() === 1 ? (all.find((e) => this.isSelectedKey(e.key)) ?? focused) : focused;
    if (entry.kind === 'folder') {
      const folder = this.state.subfolders().find((f) => f.id === entry.id);
      if (folder) {
        void this.state.renameFolder(folder);
      }
    } else {
      const file = this.state.visible().find((f) => f.id === entry.id);
      if (file) {
        void this.state.renameFile(file);
      }
    }
  }

  /** Delete deletes the selection; with nothing selected the focused item. */
  private async delete(focused: Entry): Promise<void> {
    if (this.state.selectionCount() > 0) {
      return this.actions.deleteSelection();
    }
    if (focused.kind === 'folder') {
      this.actions.deleteFolder();
      return;
    }
    const file = this.state.visible().find((f) => f.id === focused.id);
    return file ? this.actions.deleteFile(file) : undefined;
  }

  private card(key: string): HTMLElement | null {
    const kind = key.startsWith('d:') ? 'folder' : 'file';
    const id = key.slice(2);
    return Array.from(this.host.querySelectorAll<HTMLElement>('.card')).find((card) => card.dataset[kind] === id) ?? null;
  }

  /** How many cards share the first row (the grid reflows with the width); folders and files flow together. */
  private columns(): number {
    const cards = Array.from(this.host.querySelectorAll<HTMLElement>('.card'));
    const top = cards[0]?.offsetTop ?? 0;
    return Math.max(1, cards.filter((card) => card.offsetTop === top).length);
  }
}
