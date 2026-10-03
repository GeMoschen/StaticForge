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
import { MediaItemActions } from './media-item-actions';
import { MediaMover } from './media-mover';
import { MediaLibraryStore, type MediaSummaryView } from './media-library.store';
import { formatOf } from './media-library.util';
import { MediaPreviewComponent } from './media-preview.component';

/** Start loading more cards this far (px) before the end of the grid is reached. */
const NEAR_END_PX = 200;

/**
 * The library grid (decision 22): one focusable card per file — the preview on the sunken surface, the name (truncated at
 * the end only), "JPG · 1.2 MB", a labelled checkbox top left (shown on hover, focus or when selected) and a status icon
 * when the file is not released.
 *
 * A `role=grid` with a roving tabindex: ←/→/↑/↓ move across the cards as laid out, Home/End go to the first/last,
 * Space toggles the selection, Enter opens the detail, Ctrl/⌘+A selects all, F2 renames, Delete deletes (the selection
 * when the card is in it), Shift+F10 (or the menu key) opens the card's menu. A click opens the file; Ctrl/⌘+click
 * toggles it, Shift+click selects a range. The cards are rendered in chunks as the end scrolls into view, so a big
 * folder costs what is on screen.
 */
@Component({
  selector: 'sf-media-library-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MediaPreviewComponent, SfCheckboxComponent, SfFileSizePipe, SfMenuComponent, SfStatusComponent, TranslocoPipe],
  templateUrl: './media-library-grid.component.html',
  styleUrl: './media-library-grid.component.scss',
})
export class MediaLibraryGridComponent implements AfterViewInit {
  protected readonly library = inject(MediaLibraryStore);
  protected readonly items = inject(MediaItemActions);
  protected readonly mover = inject(MediaMover);
  private readonly transloco = inject(TranslocoService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly changes = inject(ChangeDetectorRef);
  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');
  private readonly fileSize = new SfFileSizePipe();
  private observer: IntersectionObserver | null = null;

  /** The card in the tab order (by uuid, so it survives sorting and filtering). */
  private readonly activeUuid = signal<string | null>(null);
  /** The anchor of Shift+click ranges. */
  private anchor: string | null = null;
  /** A Shift+F10 press opened the menu already; the `contextmenu` event some browsers add must not open it twice. */
  private suppressContextMenu = false;

  protected readonly folderName = computed(
    () => this.library.folderNode()?.displayName ?? this.transloco.translate('media.library.title'),
  );
  protected readonly tabStop = computed(() => {
    const files = this.library.shown();
    const active = this.activeUuid();
    return files.some((f) => f.uuid === active) ? active : (files[0]?.uuid ?? null);
  });

  constructor() {
    // More files than fit: once the rendered cards have grown, look again whether the end is still in view.
    effect(() => {
      this.library.shown();
      untracked(() => setTimeout(() => this.loadWhileNearEnd()));
    });
    inject(DestroyRef).onDestroy(() => this.observer?.disconnect());
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

  /** The card's name: file name, type and size, and the status when not released. */
  protected cardLabel(file: MediaSummaryView): string {
    const meta = this.transloco.translate('media.grid.meta', { type: formatOf(file), size: this.fileSize.transform(file.sizeBytes) });
    const status = this.library.statusOf(file);
    return [file.displayName ?? file.uid ?? '', meta, ...(status ? [status.label] : [])].join(', ');
  }

  protected onFocus(file: MediaSummaryView): void {
    this.activeUuid.set(file.uuid ?? null);
  }

  protected onContextMenu(event: MouseEvent, file: MediaSummaryView): void {
    if (this.suppressContextMenu) {
      this.suppressContextMenu = false;
      event.preventDefault();
      return;
    }
    this.items.onItemContextMenu(file, event);
  }

  protected onClick(file: MediaSummaryView, event: MouseEvent): void {
    const uuid = file.uuid;
    if (!uuid || (event.target as HTMLElement).closest('.card__check, .card__more')) {
      return; // the checkbox and the ⋮ menu act on their own
    }
    this.activeUuid.set(uuid);
    if (event.shiftKey && this.anchor) {
      this.library.selectRange(this.anchor, uuid);
    } else if (event.ctrlKey || event.metaKey) {
      this.library.toggle(uuid);
      this.anchor = uuid;
    } else {
      this.anchor = uuid;
      this.library.openAsset(uuid);
    }
  }

  protected onCheck(file: MediaSummaryView): void {
    this.library.toggle(file.uuid);
    this.anchor = file.uuid ?? null;
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.altKey || (event.target as HTMLElement).closest('.card__more')) {
      return; // the ⋮ menu button handles its own keys
    }
    const files = this.library.visible();
    const current = files.findIndex((f) => f.uuid === this.tabStop());
    if (current < 0) {
      return;
    }
    const file = files[current];
    const columns = this.columns();
    let next = current;
    switch (event.key) {
      case 'ArrowRight':
        next = Math.min(files.length - 1, current + 1);
        break;
      case 'ArrowLeft':
        next = Math.max(0, current - 1);
        break;
      case 'ArrowDown':
        next = current + columns < files.length ? current + columns : current;
        break;
      case 'ArrowUp':
        next = current - columns >= 0 ? current - columns : current;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = files.length - 1;
        break;
      case ' ':
        event.preventDefault();
        this.onCheck(file);
        return;
      case 'Enter':
        event.preventDefault();
        this.library.openAsset(file.uuid ?? null);
        return;
      case 'F2':
        if (!event.ctrlKey && !event.metaKey && this.library.canEdit()) {
          event.preventDefault();
          void this.items.rename(file);
        }
        return;
      case 'Delete':
        event.preventDefault();
        void this.items.deleteFile(file);
        return;
      case 'F10':
      case 'ContextMenu':
        if (event.key === 'ContextMenu' || event.shiftKey) {
          event.preventDefault();
          this.suppressContextMenu = true;
          setTimeout(() => (this.suppressContextMenu = false));
          const card = this.card(file.uuid);
          if (card) {
            this.items.onItemContextMenu(file, card);
          }
        }
        return;
      case 'a':
      case 'A':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          this.library.selectAll();
        }
        return;
      default:
        return;
    }
    event.preventDefault();
    this.focusIndex(files, next);
  }

  /** Moves the focus to the card at `index` of the visible list, rendering it first when it is past the chunk. */
  private focusIndex(files: readonly MediaSummaryView[], index: number): void {
    const target = files[index];
    if (!target?.uuid) {
      return;
    }
    this.activeUuid.set(target.uuid);
    if (index >= this.library.renderLimit()) {
      this.library.renderLimit.set(index + 1);
      this.changes.detectChanges();
    }
    this.card(target.uuid)?.focus();
  }

  private card(uuid: string | undefined): HTMLElement | null {
    return uuid ? (Array.from(this.host.querySelectorAll<HTMLElement>('.card')).find((card) => card.dataset['file'] === uuid) ?? null) : null;
  }

  /** How many cards share the first row (the grid reflows with the width). */
  private columns(): number {
    const cards = Array.from(this.host.querySelectorAll<HTMLElement>('.card'));
    const top = cards[0]?.offsetTop ?? 0;
    return Math.max(1, cards.filter((card) => card.offsetTop === top).length);
  }
}
