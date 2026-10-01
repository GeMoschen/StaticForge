import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { ToastService } from '../../../core/ui/toast.service';
import { SfCatalogCardDirective, SfCatalogComponent, SfCatalogType } from '../../../shared/components/card/sf-catalog.component';
import { SfInputComponent } from '../../../shared/components/forms/sf-input.component';
import { SfSelectComponent } from '../../../shared/components/forms/sf-select.component';
import { SfTextareaComponent } from '../../../shared/components/forms/sf-textarea.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import {
  CARD_TYPES,
  SampleCard,
  SampleCardField,
  SampleCardTypeId,
  cardSummary,
  copyCard,
  insertAt,
  moveItem,
  newCard,
  removeAt,
} from './sample-catalog';
import { SampleState } from './sample-state';

const BADGE_TYPES: readonly SampleCardTypeId[] = ['badge'];

function catalogTypes(ids: readonly SampleCardTypeId[]): SfCatalogType[] {
  return ids.map((id) => {
    const { label, icon, description } = CARD_TYPES[id];
    return { id, label, icon, description };
  });
}

/** Applies `change` to the card with `id`, at any depth (product teasers hold badges). */
function mapCard(list: readonly SampleCard[], id: string, change: (card: SampleCard) => SampleCard): SampleCard[] {
  return list.map((card) => {
    if (card.id === id) {
      return change(card);
    }
    return card.badges ? { ...card, badges: mapCard(card.badges, id, change) } : card;
  });
}

/**
 * A catalog field of the sample (M35.9, decision 12): an `sf-catalog` of cards whose bodies are the card type's fields
 * in `sf-field`s; product teasers hold a nested "Badges" catalog. The field owns the list (`cards`, two-way) and
 * applies every change the catalogs ask for — add, insert, move, duplicate, remove (with Undo) — in memory only.
 */
@Component({
  selector: 'sf-sample-catalog-field',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    SfCatalogCardDirective,
    SfCatalogComponent,
    SfFieldComponent,
    SfInputComponent,
    SfSelectComponent,
    SfTextareaComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-catalog-field.component.html',
  styleUrl: './sample-catalog-field.component.scss',
})
export class SampleCatalogFieldComponent {
  private readonly state = inject(SampleState);
  private readonly toasts = inject(ToastService);

  readonly cards = model.required<readonly SampleCard[]>();
  readonly types = input.required<readonly SampleCardTypeId[]>();
  readonly label = input.required<string>();
  /** Remembers collapsed cards for the session (nested catalogs add their card's id). */
  readonly catalogId = input.required<string>();
  /** The heading level of the card titles. */
  readonly level = input<3 | 4 | 5>(3);

  protected readonly catalogTypes = computed(() => catalogTypes(this.types()));
  protected readonly badgeTypes = catalogTypes(BADGE_TYPES);
  protected readonly summaryOf = cardSummary;

  protected fieldsOf(card: SampleCard): readonly SampleCardField[] {
    return CARD_TYPES[card.type].fields;
  }

  protected nestedLabel(card: SampleCard): string {
    return CARD_TYPES[card.type].nested ?? '';
  }

  protected setField(card: SampleCard, field: string, value: string): void {
    this.cards.update((list) => mapCard(list, card.id, (c) => ({ ...c, fields: { ...c.fields, [field]: value } })));
  }

  // ── Changes of the top-level catalog (`parent` null) or of a teaser's badges ────────────────────────────────────

  protected add(parent: SampleCard | null, event: { type: string; index: number }): void {
    this.change(parent, (list) => insertAt(list, event.index, newCard(event.type as SampleCardTypeId)));
  }

  protected move(parent: SampleCard | null, event: { from: number; to: number }): void {
    this.change(parent, (list) => moveItem(list, event.from, event.to));
  }

  protected duplicate(parent: SampleCard | null, event: { item: SampleCard; index: number }): void {
    this.change(parent, (list) => insertAt(list, event.index + 1, copyCard(event.item)));
  }

  protected remove(parent: SampleCard | null, event: { item: SampleCard; index: number }): void {
    const { item, index } = event;
    this.change(parent, (list) => removeAt(list, index));
    const type = CARD_TYPES[item.type].label;
    const summary = cardSummary(item) ?? this.state.t('catalog.untitled');
    this.toasts.undo(this.state.t('catalog.removed', { type, summary }), () =>
      this.change(parent, (list) => (list.some((c) => c.id === item.id) ? [...list] : insertAt(list, index, item))),
    );
  }

  private change(parent: SampleCard | null, change: (list: readonly SampleCard[]) => SampleCard[]): void {
    if (parent === null) {
      this.cards.update(change);
    } else {
      this.cards.update((list) => mapCard(list, parent.id, (card) => ({ ...card, badges: change(card.badges ?? []) })));
    }
  }
}
