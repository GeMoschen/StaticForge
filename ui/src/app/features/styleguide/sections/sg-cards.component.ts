import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ToastService } from '../../../core/ui/toast.service';
import { SfCardComponent } from '../../../shared/components/card/sf-card.component';
import { SfCatalogCardDirective, SfCatalogComponent } from '../../../shared/components/card/sf-catalog.component';
import { SfInputComponent } from '../../../shared/components/forms/sf-input.component';
import { SfMenuItem } from '../../../shared/components/menu/sf-menu-item';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { CARDS, DemoCard, demoCards, demoReadonlyCards } from '../styleguide.demo';
import { sectionOf } from '../styleguide.sections';

/** A list of demo cards: the top level (`null`) or the nested catalog of the card with this id. */
type ListId = string | null;

let nextId = 1;

/** A deep copy of a card under new ids. */
function copyOf(card: DemoCard): DemoCard {
  return { ...card, id: `copy-${nextId++}`, children: card.children?.map(copyOf) };
}

/** Applies `change` to the list `list` inside `cards` (recursively), returning new arrays along the way. */
function updateList(cards: readonly DemoCard[], list: ListId, change: (items: DemoCard[]) => DemoCard[]): DemoCard[] {
  if (list === null) {
    return change([...cards]);
  }
  return cards.map((card) => {
    if (card.id === list) {
      return { ...card, children: change([...(card.children ?? [])]) };
    }
    return card.children ? { ...card, children: updateList(card.children, list, change) } : card;
  });
}

/** Replaces the card with this id anywhere in `cards`. */
function updateCard(cards: readonly DemoCard[], id: string, change: (card: DemoCard) => DemoCard): DemoCard[] {
  return cards.map((card) => {
    if (card.id === id) {
      return change(card);
    }
    return card.children ? { ...card, children: updateCard(card.children, id, change) } : card;
  });
}

/**
 * The cards and catalogs section of the style guide (M35.9, review decisions 7–11): single cards in their states, a
 * catalog of three card types with a nested catalog, an empty and a read-only catalog. Adding, inserting, moving,
 * duplicating and removing (with Undo) really happen, in memory; the card summary follows the card's text field.
 */
@Component({
  selector: 'sf-sg-cards',
  standalone: true,
  imports: [SfCardComponent, SfCatalogCardDirective, SfCatalogComponent, SfFieldComponent, SfInputComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sg-cards.component.html',
  styleUrl: './sg-cards.component.scss',
})
export class SgCardsComponent {
  private readonly toasts = inject(ToastService);

  protected readonly s = sectionOf('cards');
  protected readonly c = CARDS;

  protected readonly cards = signal<DemoCard[]>(demoCards());
  protected readonly empty = signal<DemoCard[]>([]);
  protected readonly readonlyCards: readonly DemoCard[] = demoReadonlyCards();
  protected readonly summaryOf = (card: DemoCard) => card.title || null;
  protected readonly fieldLabel = (card: DemoCard) => CARDS.fields[card.type] ?? '';

  protected chosen(item: SfMenuItem): void {
    this.toasts.show(CARDS.chosen + item.label, 'info');
  }

  protected setTitle(target: 'cards' | 'empty', id: string, title: string): void {
    this.store(target).update((cards) => updateCard(cards, id, (card) => ({ ...card, title })));
  }

  // ── Catalog changes, on `cards` (the main catalog and its nested ones) or `empty` ──

  protected add(target: 'cards' | 'empty', list: ListId, type: string, index: number): void {
    const card: DemoCard = { id: `new-${nextId++}`, type, title: '', children: type === 'gallery' ? [] : undefined };
    this.store(target).update((cards) =>
      updateList(cards, list, (items) => [...items.slice(0, index), card, ...items.slice(index)]),
    );
  }

  protected move(target: 'cards' | 'empty', list: ListId, from: number, to: number): void {
    this.store(target).update((cards) =>
      updateList(cards, list, (items) => {
        const [moved] = items.splice(from, 1);
        items.splice(to, 0, moved);
        return items;
      }),
    );
  }

  protected duplicate(target: 'cards' | 'empty', list: ListId, card: DemoCard, index: number): void {
    this.store(target).update((cards) =>
      updateList(cards, list, (items) => [...items.slice(0, index + 1), copyOf(card), ...items.slice(index + 1)]),
    );
  }

  protected remove(target: 'cards' | 'empty', list: ListId, card: DemoCard, index: number): void {
    const store = this.store(target);
    store.update((cards) => updateList(cards, list, (items) => items.filter((item) => item.id !== card.id)));
    this.toasts.undo(CARDS.removed + (card.title || CARDS.untitled), () =>
      store.update((cards) => updateList(cards, list, (items) => [...items.slice(0, index), card, ...items.slice(index)])),
    );
  }

  private store(target: 'cards' | 'empty') {
    return target === 'cards' ? this.cards : this.empty;
  }
}
