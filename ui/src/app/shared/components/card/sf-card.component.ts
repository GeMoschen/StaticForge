import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  booleanAttribute,
  computed,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import { sfUniqueId } from '../forms/sf-field-context';
import { SfHeadingLevel, headingLevelAttribute } from '../layout/heading-level';
import { SfMenuComponent } from '../menu/sf-menu.component';
import { SfMenuItem } from '../menu/sf-menu-item';
import { SfButtonComponent } from '../sf-button.component';
import { SfIconComponent } from '../sf-icon.component';

/** A keyboard move request from a card header: `-1` up (`Alt+↑`), `1` down (`Alt+↓`). */
export type SfCardMove = -1 | 1;

/**
 * A card (M35.9, review decisions 7–9): a bordered panel with a header bar and a body — one instance of a section
 * template in a catalog, for example.
 *
 * - **Header:** drag handle (decorative; the header itself is the drag source when `draggable`), type icon, the title as
 *   a real `h2`–`h6` per `level` (default 3) reading "Type · Summary" — the summary truncates, the type never does;
 *   "Untitled" without a summary — the collapse toggle (`aria-expanded`, `aria-controls` → body) and the ⋮ menu.
 * - **Body:** the projected content. Collapsing hides it with `hidden` but keeps it rendered, so form state survives.
 * - `Alt+↑` / `Alt+↓` anywhere in the header emit `keyMove`; the host (`sf-catalog`) performs the move.
 * - `readonly`: no handle, no drag, no menu; the card still collapses.
 * - Host classes `is-dragging`, `is-drop-before` and `is-drop-after` (set by `sf-catalog`) dim the card and draw the
 *   drop indicator in the gap above / below it.
 */
@Component({
  selector: 'sf-card',
  standalone: true,
  imports: [NgTemplateOutlet, SfButtonComponent, SfIconComponent, SfMenuComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-card.component.html',
  styleUrl: './sf-card.component.scss',
})
export class SfCardComponent {
  /** The card type's name ("Product teaser"); also names the toggle and the menu. */
  readonly type = input.required<string>();
  /** Shown after the type ("Product teaser · Yirgacheffe 250 g"); "Untitled" when empty. */
  readonly summary = input<string | null>(null);
  /** The type's Material Symbols icon. */
  readonly icon = input<string | null | undefined>(null);
  readonly expanded = model(true);
  readonly collapsible = input(true, { transform: booleanAttribute });
  /** The ⋮ menu; none when empty. */
  readonly menuItems = input<readonly SfMenuItem[]>([]);
  /** Shows the drag handle and makes the header a drag source. */
  readonly draggable = input(false, { transform: booleanAttribute });
  /** The heading level of the title (2–6). */
  readonly level = input<SfHeadingLevel, unknown>(3, { transform: headingLevelAttribute });
  readonly readonly = input(false, { transform: booleanAttribute });

  readonly menuAction = output<SfMenuItem>();
  readonly dragStart = output<DragEvent>();
  readonly dragEnd = output<DragEvent>();
  readonly keyMove = output<SfCardMove>();

  protected readonly titleId = sfUniqueId('sf-card-title');
  protected readonly bodyId = sfUniqueId('sf-card-body');
  protected readonly canDrag = computed(() => this.draggable() && !this.readonly());
  protected readonly hasMenu = computed(() => !this.readonly() && this.menuItems().length > 0);
  protected readonly summaryText = computed(() => this.summary()?.trim() || null);

  private readonly header = viewChild.required<ElementRef<HTMLElement>>('header');

  /** Focuses the header's first control (the collapse toggle or the menu), else the header itself. */
  focusHeader(): void {
    const header = this.header().nativeElement;
    const control = header.querySelector<HTMLElement>('button:not([disabled]), a[href]');
    (control ?? header).focus();
  }

  protected toggle(): void {
    this.expanded.update((expanded) => !expanded);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || this.readonly()) {
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      this.keyMove.emit(event.key === 'ArrowUp' ? -1 : 1);
    }
  }

  protected onDragStart(event: DragEvent): void {
    if (!this.canDrag()) {
      return;
    }
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      // Some browsers start a drag only with data set.
      event.dataTransfer.setData('application/x-sf-card', this.type());
    }
    this.dragStart.emit(event);
  }

  protected onDragEnd(event: DragEvent): void {
    if (this.canDrag()) {
      this.dragEnd.emit(event);
    }
  }
}
