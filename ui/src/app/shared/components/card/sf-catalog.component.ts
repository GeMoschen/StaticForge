import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Directive,
  ElementRef,
  TemplateRef,
  afterRender,
  booleanAttribute,
  computed,
  contentChild,
  inject,
  input,
  output,
  signal,
  viewChildren,
} from '@angular/core';
import { TranslocoPipe, TranslocoService, translateSignal } from '@jsverse/transloco';
import { sfUniqueId } from '../forms/sf-field-context';
import { SfHeadingLevel, headingLevelAttribute } from '../layout/heading-level';
import { SfMenuComponent } from '../menu/sf-menu.component';
import { SfMenuItem } from '../menu/sf-menu-item';
import { SfButtonComponent } from '../sf-button.component';
import { SfCardComponent, SfCardMove } from './sf-card.component';

/** A card type a catalog allows (a section template, for example). */
export interface SfCatalogType {
  id: string;
  label: string;
  icon?: string;
  description?: string;
}

/** One card of a catalog; `type` is an {@link SfCatalogType} id. Hosts extend it with their own data. */
export interface SfCatalogItem {
  id: string;
  type: string;
}

/** The context of the `sfCatalogCard` template: the item (`let-item`) and its position (`let-index="index"`). */
export interface SfCatalogCardContext<T extends SfCatalogItem = SfCatalogItem> {
  $implicit: T;
  index: number;
}

/**
 * The body of each card of an `sf-catalog`:
 * `<ng-template sfCatalogCard let-item let-index="index">…</ng-template>`. Bind `[sfCatalogCardItems]` to the catalog's
 * items to type `item` as the host's own item type (it is used for type checking only).
 */
@Directive({ selector: 'ng-template[sfCatalogCard]', standalone: true })
export class SfCatalogCardDirective<T extends SfCatalogItem = SfCatalogItem> {
  readonly template = inject<TemplateRef<SfCatalogCardContext<T>>>(TemplateRef);
  /** Types the template's `item`; not read. */
  readonly sfCatalogCardItems = input<readonly T[] | null>(null);

  static ngTemplateContextGuard<T extends SfCatalogItem>(
    _directive: SfCatalogCardDirective<T>,
    context: unknown,
  ): context is SfCatalogCardContext<T> {
    return true;
  }
}

/** Where a dragged card would land, relative to the card under the pointer. */
interface DropTarget {
  readonly index: number;
  readonly position: 'before' | 'after';
}

/** What to do once the host has re-rendered after an emitted change: focus a card and announce. */
type Pending =
  | { kind: 'move'; id: string; to: number; focus: HTMLElement | null; refocus: boolean }
  | { kind: 'add'; before: readonly SfCatalogItem[]; known: ReadonlySet<string>; refocus: boolean }
  | { kind: 'remove'; id: string; index: number; refocus: boolean };

/** The catalog a card is being dragged from (one drag at a time per document); drops from other catalogs are ignored. */
let activeDrag: { readonly catalog: object; readonly index: number } | null = null;

const STORAGE_PREFIX = 'sf-catalog:';

function readCollapsed(catalogId: string | null): ReadonlySet<string> {
  if (catalogId === null) {
    return new Set();
  }
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(STORAGE_PREFIX + catalogId) ?? '[]');
    return new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeCollapsed(catalogId: string | null, ids: ReadonlySet<string>): void {
  if (catalogId === null) {
    return;
  }
  try {
    if (ids.size === 0) {
      sessionStorage.removeItem(STORAGE_PREFIX + catalogId);
    } else {
      sessionStorage.setItem(STORAGE_PREFIX + catalogId, JSON.stringify([...ids]));
    }
  } catch {
    // Storage blocked or full: the state just isn't remembered.
  }
}

/**
 * A catalog (M35.9, review decisions 7–11): an ordered list of `sf-card`s of the allowed `types`. The host owns the
 * items and performs every change the catalog emits (`add`, `move`, `remove`, `duplicate`); the catalog never changes
 * them itself and never confirms (the host offers Undo).
 *
 * - **Naming:** a `role=group` named by the visible `label`, with the card count and Collapse all / Expand all.
 * - **Cards:** type label and icon from `types`, the summary from `summaryOf` (decision 9), a ⋮ menu with Move up / Move
 *   down (disabled with a reason at the ends), Duplicate and Remove. The body is the `sfCatalogCard` template.
 * - **Reorder:** drag a card header onto another card (drop indicator before / after), or `Alt+↑` / `Alt+↓` in a card
 *   header. After the host applied the move, focus returns to the moved card and the new position is announced; at the
 *   first / last card the key announces that it already is.
 * - **Add:** "Add card" at the end (a menu of the types; a plain button when only one type is allowed), and a "+"
 *   between two cards, shown on hover and keyboard focus, to insert there. The new card is focused once it appears.
 * - **Collapse:** cards open expanded; collapsed cards are remembered for the session under `catalogId`.
 * - **Read-only:** no handles, menus or add buttons; cards still collapse.
 * - **Nesting:** a card body can hold another catalog; cards never move between catalogs.
 */
@Component({
  selector: 'sf-catalog',
  standalone: true,
  imports: [NgTemplateOutlet, SfButtonComponent, SfCardComponent, SfMenuComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-catalog.component.html',
  styleUrl: './sf-catalog.component.scss',
})
export class SfCatalogComponent<T extends SfCatalogItem = SfCatalogItem> {
  readonly items = input.required<readonly T[]>();
  /** The card types that may be added. */
  readonly types = input.required<readonly SfCatalogType[]>();
  /** The catalog's accessible name (and visible label). */
  readonly label = input.required<string>();
  /** Remembers collapsed cards for the session under this id; without it the state lives as long as the component. */
  readonly catalogId = input<string | null>(null);
  /** The card summary: usually the value of the card's first text-like field. */
  readonly summaryOf = input<(item: T) => string | null>(() => null);
  readonly readonly = input(false, { transform: booleanAttribute });
  /** The heading level of the card titles. */
  readonly level = input<SfHeadingLevel, unknown>(3, { transform: headingLevelAttribute });

  /**
   * Insert a card of `type` at `index` (`items.length`: at the end). The new item needs an id not in `items` yet; the
   * first such item in the next `items` gets focus, wherever the host put it.
   */
  readonly add = output<{ type: string; index: number }>();
  /** Move the card at `from` to `to` (its index after the move). */
  readonly move = output<{ from: number; to: number }>();
  readonly remove = output<{ item: T; index: number }>();
  /**
   * Add a copy of `item` (at `index`), usually right after it at `index + 1` — but anywhere goes: the copy needs an id
   * not in `items` yet, and the first such item in the next `items` gets focus.
   */
  readonly duplicate = output<{ item: T; index: number }>();

  protected readonly cardTemplate = contentChild<SfCatalogCardDirective<T>>(SfCatalogCardDirective);

  protected readonly labelId = sfUniqueId('sf-catalog-label');
  protected readonly countId = sfUniqueId('sf-catalog-count');
  protected readonly announcement = signal('');
  /** The index of the card being dragged from this catalog. */
  protected readonly dragFrom = signal<number | null>(null);
  protected readonly dropTarget = signal<DropTarget | null>(null);

  private readonly transloco = inject(TranslocoService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly host: HTMLElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly cards = viewChildren(SfCardComponent);
  private readonly addTrigger = viewChildren<ElementRef<HTMLElement>>('addTrigger');

  private readonly text = {
    moveUp: translateSignal('shared.catalog.moveUp'),
    moveDown: translateSignal('shared.catalog.moveDown'),
    duplicate: translateSignal('shared.catalog.duplicate'),
    remove: translateSignal('shared.catalog.remove'),
    atStart: translateSignal('shared.catalog.atStart'),
    atEnd: translateSignal('shared.catalog.atEnd'),
  };

  private readonly typeById = computed(() => new Map(this.types().map((type) => [type.id, type])));
  /** The single allowed type, which the add buttons add directly; null with several (they open a menu). */
  protected readonly singleType = computed(() => (this.types().length === 1 ? this.types()[0] : null));
  protected readonly typeMenu = computed<SfMenuItem[]>(() =>
    this.types().map((type) => ({ id: type.id, label: type.label, icon: type.icon, description: type.description })),
  );
  protected readonly cardMenus = computed<SfMenuItem[][]>(() => {
    const count = this.items().length;
    return this.items().map((_, index) => [
      {
        id: 'moveUp',
        label: this.text.moveUp(),
        icon: 'arrow_upward',
        shortcut: 'Alt+Up',
        disabledReason: index === 0 ? this.text.atStart() : undefined,
      },
      {
        id: 'moveDown',
        label: this.text.moveDown(),
        icon: 'arrow_downward',
        shortcut: 'Alt+Down',
        disabledReason: index === count - 1 ? this.text.atEnd() : undefined,
      },
      { id: 'duplicate', label: this.text.duplicate(), icon: 'content_copy' },
      { id: 'remove', label: this.text.remove(), icon: 'delete', danger: true, separatorBefore: true },
    ]);
  });

  /** Collapsed card ids as set in this component, for the `catalogId` they were set under. */
  private readonly collapsedState = signal<{ readonly catalogId: string | null; readonly ids: ReadonlySet<string> } | null>(
    null,
  );
  protected readonly collapsed = computed(() => {
    const catalogId = this.catalogId();
    const state = this.collapsedState();
    return state && state.catalogId === catalogId ? state.ids : readCollapsed(catalogId);
  });
  /** Whether every card is collapsed: the header button then expands all. */
  protected readonly allCollapsed = computed(
    () => this.items().length > 0 && this.items().every((item) => this.collapsed().has(item.id)),
  );

  private pending: Pending | null = null;

  constructor() {
    afterRender({ write: () => this.settle() });
  }

  protected typeLabel(item: T): string {
    return this.typeById().get(item.type)?.label ?? item.type;
  }

  protected typeIcon(item: T): string | null {
    return this.typeById().get(item.type)?.icon ?? null;
  }

  // ── Collapse ───────────────────────────────────────────────────────────────

  protected setExpanded(item: T, expanded: boolean): void {
    const ids = new Set(this.collapsed());
    if (expanded) {
      ids.delete(item.id);
    } else {
      ids.add(item.id);
    }
    this.storeCollapsed(ids);
  }

  protected toggleAll(): void {
    const ids = new Set(this.collapsed());
    const collapse = !this.allCollapsed();
    for (const item of this.items()) {
      if (collapse) {
        ids.add(item.id);
      } else {
        ids.delete(item.id);
      }
    }
    this.storeCollapsed(ids);
  }

  private storeCollapsed(ids: ReadonlySet<string>): void {
    const catalogId = this.catalogId();
    this.collapsedState.set({ catalogId, ids });
    writeCollapsed(catalogId, ids);
  }

  // ── Changes ────────────────────────────────────────────────────────────────

  protected addAt(type: string, index: number): void {
    if (this.readonly()) {
      return;
    }
    this.pending = this.addPending(true);
    this.add.emit({ type, index });
  }

  protected onCardMenu(action: SfMenuItem, index: number): void {
    const item = this.items()[index];
    switch (action.id) {
      case 'moveUp':
        this.requestMove(index, index - 1, true);
        break;
      case 'moveDown':
        this.requestMove(index, index + 1, true);
        break;
      case 'duplicate':
        this.pending = this.addPending(this.focusIsInCard(index));
        this.duplicate.emit({ item, index });
        break;
      case 'remove':
        this.pending = { kind: 'remove', id: item.id, index, refocus: this.focusIsInCard(index) };
        this.remove.emit({ item, index });
        break;
    }
  }

  protected onKeyMove(index: number, delta: SfCardMove): void {
    const to = index + delta;
    if (to < 0 || to >= this.items().length) {
      this.announce(to < 0 ? this.text.atStart() : this.text.atEnd());
      return;
    }
    this.requestMove(index, to, true);
  }

  /** Waits for the item the host adds: the first one whose id isn't in the current items. */
  private addPending(refocus: boolean): Pending {
    const before = this.items();
    return { kind: 'add', before, known: new Set(before.map((item) => item.id)), refocus };
  }

  private requestMove(from: number, to: number, refocus: boolean): void {
    const items = this.items();
    if (this.readonly() || from === to || to < 0 || to >= items.length || from < 0 || from >= items.length) {
      return;
    }
    const active = this.host.ownerDocument.activeElement;
    const cardElement = this.cardElement(from);
    this.pending = {
      kind: 'move',
      id: items[from].id,
      to,
      focus: active instanceof HTMLElement && cardElement?.contains(active) ? active : null,
      refocus,
    };
    this.move.emit({ from, to });
  }

  /** After a render: once the host applied the change, focus the card it concerns and announce a move. */
  private settle(): void {
    const pending = this.pending;
    if (!pending) {
      return;
    }
    const items = this.items();
    switch (pending.kind) {
      case 'move': {
        if (items[pending.to]?.id !== pending.id || this.cardElement(pending.to)?.dataset['sfCatalogItem'] !== pending.id) {
          return;
        }
        this.pending = null;
        if (pending.refocus) {
          if (pending.focus?.isConnected) {
            pending.focus.focus();
          } else {
            this.cards()[pending.to]?.focusHeader();
          }
        }
        this.announce(
          this.transloco.translate('shared.catalog.moved', {
            type: this.typeLabel(items[pending.to]),
            position: pending.to + 1,
            count: items.length,
          }),
        );
        return;
      }
      case 'add': {
        const index = items.findIndex((item) => !pending.known.has(item.id));
        if (index < 0) {
          if (items !== pending.before) {
            // The host changed the items without adding one: nothing to wait for any more.
            this.pending = null;
          }
          return;
        }
        if (this.cardElement(index)?.dataset['sfCatalogItem'] !== items[index].id) {
          return;
        }
        this.pending = null;
        if (pending.refocus) {
          this.cards()[index]?.focusHeader();
        }
        return;
      }
      case 'remove': {
        if (items.some((item) => item.id === pending.id)) {
          return;
        }
        this.pending = null;
        if (pending.refocus) {
          const next = Math.min(pending.index, items.length - 1);
          if (next >= 0) {
            this.cards()[next]?.focusHeader();
          } else {
            this.addTrigger()[0]?.nativeElement.querySelector<HTMLElement>('button')?.focus();
          }
        }
        return;
      }
    }
  }

  private announce(message: string): void {
    // Cleared first, so the same message twice in a row is announced twice.
    this.announcement.set('');
    this.changeDetector.detectChanges();
    this.announcement.set(message);
  }

  private cardElement(index: number): HTMLElement | null {
    const list = this.host.querySelector(':scope > .sf-catalog > .sf-catalog__list');
    return (list?.children[index]?.querySelector(':scope > sf-card') as HTMLElement | null) ?? null;
  }

  private focusIsInCard(index: number): boolean {
    const active = this.host.ownerDocument.activeElement;
    return !!active && !!this.cardElement(index)?.contains(active);
  }

  // ── Drag and drop ──────────────────────────────────────────────────────────

  protected onDragStart(event: DragEvent, index: number): void {
    if (this.readonly()) {
      return;
    }
    // A nested catalog's card: its own catalog handles it.
    event.stopPropagation();
    activeDrag = { catalog: this, index };
    this.dragFrom.set(index);
  }

  protected onDragOver(event: DragEvent, index: number): void {
    const from = this.ownDrag();
    if (from === null) {
      return; // not ours: a file, text, or a card of another catalog
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const position: DropTarget['position'] = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    const insertion = position === 'before' ? index : index + 1;
    // Next to itself: no move, no indicator.
    const target: DropTarget | null = insertion === from || insertion === from + 1 ? null : { index, position };
    const current = this.dropTarget();
    if (current?.index !== target?.index || current?.position !== target?.position) {
      this.dropTarget.set(target);
    }
  }

  protected onDragLeave(event: DragEvent, index: number): void {
    const related = event.relatedTarget;
    if (related instanceof Node && (event.currentTarget as HTMLElement).contains(related)) {
      return;
    }
    if (this.dropTarget()?.index === index) {
      this.dropTarget.set(null);
    }
  }

  protected onDrop(event: DragEvent, index: number): void {
    const from = this.ownDrag();
    if (from === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const insertion = event.clientY < rect.top + rect.height / 2 ? index : index + 1;
    this.endDrag();
    const to = insertion > from ? insertion - 1 : insertion;
    this.requestMove(from, to, false);
  }

  protected endDrag(): void {
    if (activeDrag?.catalog === this) {
      activeDrag = null;
    }
    this.dragFrom.set(null);
    this.dropTarget.set(null);
  }

  /** The index of the card being dragged when the drag started in this catalog, else null. */
  private ownDrag(): number | null {
    return !this.readonly() && activeDrag?.catalog === this ? activeDrag.index : null;
  }
}
