/**
 * Catalog cards of the sample screen (M35.9, review round 1, decisions 8–12): the card types (section templates — schema
 * data, not UI text), the page's "Product teasers" and a record's "Tasting notes", and the pure list operations the
 * hosts apply when `sf-catalog` asks for a change. Nothing is saved.
 */

export type SampleCardTypeId = 'product' | 'quote' | 'badge' | 'note';

/** How a card field is edited. */
export type SampleCardFieldKind = 'text' | 'longtext' | 'select';

export interface SampleCardField {
  readonly id: string;
  readonly label: string;
  readonly kind: SampleCardFieldKind;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
}

/** A card type: its section template's name, icon, purpose and fields. */
export interface SampleCardType {
  readonly id: SampleCardTypeId;
  readonly label: string;
  readonly icon: string;
  readonly description: string;
  readonly fields: readonly SampleCardField[];
  /** The label of the nested catalog (product teasers hold badges). */
  readonly nested?: string;
}

/** One card: an instance of a card type. Product teasers hold a nested catalog of badges. */
export interface SampleCard {
  readonly id: string;
  readonly type: SampleCardTypeId;
  readonly fields: Readonly<Record<string, string>>;
  readonly badges?: readonly SampleCard[];
}

export const BADGE_TONES = [
  { value: 'accent', label: 'Highlight' },
  { value: 'success', label: 'Green' },
  { value: 'warning', label: 'Amber' },
] as const;

export const CARD_TYPES: Readonly<Record<SampleCardTypeId, SampleCardType>> = {
  product: {
    id: 'product',
    label: 'Product teaser',
    icon: 'sell',
    description: 'A product with its picture, short text and price',
    fields: [
      { id: 'name', label: 'Product name', kind: 'text' },
      { id: 'text', label: 'Teaser text', kind: 'longtext' },
      { id: 'price', label: 'Price', kind: 'text' },
      { id: 'link', label: 'Link', kind: 'text' },
    ],
    nested: 'Badges',
  },
  quote: {
    id: 'quote',
    label: 'Quote',
    icon: 'format_quote',
    description: 'A customer or press quote',
    fields: [
      { id: 'quote', label: 'Quote', kind: 'longtext' },
      { id: 'author', label: 'Source', kind: 'text' },
    ],
  },
  badge: {
    id: 'badge',
    label: 'Badge',
    icon: 'new_releases',
    description: 'A short label such as “New harvest”',
    fields: [
      { id: 'label', label: 'Label', kind: 'text' },
      { id: 'tone', label: 'Colour', kind: 'select', options: BADGE_TONES },
    ],
  },
  note: {
    id: 'note',
    label: 'Tasting note',
    icon: 'local_cafe',
    description: 'One flavour you taste in the cup',
    fields: [
      { id: 'note', label: 'Flavour', kind: 'text' },
      {
        id: 'intensity',
        label: 'Intensity',
        kind: 'select',
        options: [
          { value: 'subtle', label: 'Subtle' },
          { value: 'clear', label: 'Clear' },
          { value: 'intense', label: 'Intense' },
        ],
      },
    ],
  },
};

/** The page's catalog field and the card types it allows. */
export const TEASERS_FIELD = { label: 'Product teasers', types: ['product', 'quote', 'badge'] as const };
/** The Products dataset's catalog field. */
export const NOTES_FIELD = { label: 'Tasting notes', types: ['note', 'badge'] as const };

let nextCard = 0;
const cardId = () => `card-${++nextCard}`;

function card(type: SampleCardTypeId, fields: Record<string, string>, badges?: readonly SampleCard[]): SampleCard {
  return badges ? { id: cardId(), type, fields, badges } : { id: cardId(), type, fields };
}

/** The "Product teasers" of the sample article (a fresh copy each time a page opens). */
export function initialTeasers(): SampleCard[] {
  return [
    card(
      'product',
      {
        name: 'Yirgacheffe Konga 250 g',
        text: 'Washed, light roast — jasmine, bergamot and lemon zest.',
        price: '€ 14.90',
        link: '/shop/single-origins/konga',
      },
      [card('badge', { label: 'New harvest', tone: 'accent' }), card('badge', { label: 'Organic', tone: 'success' })],
    ),
    card('quote', { quote: 'Bright, clean and sweet — the best Konga we have tasted.', author: 'Kaffee-Journal 3/2026' }),
    card(
      'product',
      {
        name: 'Guji Hambela 250 g',
        text: 'Natural process, medium roast — blueberry, cocoa nib and honey.',
        price: '€ 15.50',
        link: '/shop/single-origins/hambela',
      },
      [],
    ),
    card('badge', { label: 'Limited: 120 bags', tone: 'warning' }),
  ];
}

/** Tasting notes of a product record. */
export function notesOf(...notes: readonly (readonly [string, string])[]): SampleCard[] {
  return notes.map(([note, intensity]) => card('note', { note, intensity }));
}

/** An empty card of a type (a product teaser starts with no badges). */
export function newCard(type: SampleCardTypeId): SampleCard {
  const fields = Object.fromEntries(CARD_TYPES[type].fields.map((field) => [field.id, field.options?.[0]?.value ?? '']));
  return card(type, fields, type === 'product' ? [] : undefined);
}

/** A copy with new ids (nested cards too). */
export function copyCard(source: SampleCard): SampleCard {
  return card(source.type, { ...source.fields }, source.badges?.map(copyCard));
}

/** Decision 9: the value of the card's first text-like field, `null` when that is empty. */
export function cardSummary(source: SampleCard): string | null {
  const first = CARD_TYPES[source.type].fields.find((field) => field.kind !== 'select');
  const value = first ? source.fields[first.id]?.trim() : '';
  return value ? value : null;
}

export function insertAt<T>(list: readonly T[], index: number, item: T): T[] {
  const next = [...list];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
  return next;
}

export function removeAt<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) {
    return [...list];
  }
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

export function replaceCard(list: readonly SampleCard[], next: SampleCard): SampleCard[] {
  return list.map((item) => (item.id === next.id ? next : item));
}
