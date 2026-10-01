import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SfCatalogCardDirective, SfCatalogComponent, SfCatalogItem, SfCatalogType } from './sf-catalog.component';

interface Card extends SfCatalogItem {
  title: string;
  children?: Card[];
}

const TYPES: SfCatalogType[] = [
  { id: 'teaser', label: 'Product teaser', icon: 'sell', description: 'A product with image and price' },
  { id: 'text', label: 'Text block', icon: 'notes' },
  { id: 'gallery', label: 'Gallery', icon: 'photo_library' },
];

const initial = (): Card[] => [
  { id: 'a', type: 'teaser', title: 'Yirgacheffe' },
  { id: 'b', type: 'text', title: '' },
  { id: 'c', type: 'gallery', title: 'Roastery' },
];

let nextId = 1;

/** A host that owns the items and applies every change, like a real one. */
@Component({
  selector: 'sf-test-host',
  standalone: true,
  imports: [SfCatalogComponent, SfCatalogCardDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sf-catalog
      class="outer"
      [label]="label()"
      [items]="items()"
      [types]="types()"
      [catalogId]="catalogId()"
      [readonly]="readonly()"
      [summaryOf]="summaryOf"
      (add)="onAdd($event)"
      (move)="onMove($event)"
      (remove)="onRemove($event)"
      (duplicate)="onDuplicate($event)"
    >
      <ng-template sfCatalogCard [sfCatalogCardItems]="items()" let-item let-index="index">
        <p class="body">Body {{ index }} {{ item.title }}</p>
        @if (item.children) {
          <sf-catalog
            label="Inner"
            [items]="item.children"
            [types]="types()"
            [summaryOf]="summaryOf"
            (move)="innerMove($event)"
          />
        }
      </ng-template>
    </sf-catalog>
  `,
})
class HostComponent {
  readonly label = input('Sections');
  readonly items = signal<Card[]>(initial());
  readonly types = signal<SfCatalogType[]>(TYPES);
  readonly catalogId = signal<string | null>(null);
  readonly readonly = signal(false);
  readonly summaryOf = (item: Card) => item.title || null;
  readonly events: unknown[] = [];
  readonly innerMove = vi.fn();

  onAdd(event: { type: string; index: number }): void {
    this.events.push(['add', event]);
    const card: Card = { id: `n${nextId++}`, type: event.type, title: '' };
    this.items.update((items) => [...items.slice(0, event.index), card, ...items.slice(event.index)]);
  }

  onMove(event: { from: number; to: number }): void {
    this.events.push(['move', event]);
    this.items.update((items) => {
      const next = [...items];
      const [moved] = next.splice(event.from, 1);
      next.splice(event.to, 0, moved);
      return next;
    });
  }

  onRemove(event: { item: Card; index: number }): void {
    this.events.push(['remove', event.item.id, event.index]);
    this.items.update((items) => items.filter((item) => item.id !== event.item.id));
  }

  onDuplicate(event: { item: Card; index: number }): void {
    this.events.push(['duplicate', event.item.id, event.index]);
    const copy = { ...event.item, id: `n${nextId++}` };
    this.items.update((items) => [...items.slice(0, event.index + 1), copy, ...items.slice(event.index + 1)]);
  }
}

async function setup(configure: (host: HostComponent) => void = () => undefined) {
  const result = await render(HostComponent);
  const host = result.fixture.componentInstance;
  configure(host);
  result.fixture.detectChanges();
  const group = screen.getAllByRole('group')[0];
  return { ...result, host, group };
}

/** The card titles (headings) of the outer catalog in order. */
const titles = () =>
  Array.from(document.querySelectorAll('sf-catalog.outer > .sf-catalog > ol > li > sf-card')).map(
    (card) => card.querySelector('.sf-card__title')!.textContent!.replace(/\s+/g, ' ').trim(),
  );
const outerCards = () =>
  Array.from(document.querySelectorAll<HTMLElement>('sf-catalog.outer > .sf-catalog > ol > li > sf-card'));
const outerItems = () => Array.from(document.querySelectorAll<HTMLElement>('sf-catalog.outer > .sf-catalog > ol > li'));

async function chooseFromMenu(trigger: HTMLElement, name: string) {
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}

afterEach(() => {
  sessionStorage.clear();
});

describe('SfCatalogComponent', () => {
  it('is a group named by its label, with the card count, and renders a card per item with type, icon and summary', async () => {
    const { group } = await setup();

    expect(screen.getByRole('group', { name: 'Sections' })).toBe(group);
    expect(group).toHaveAccessibleDescription('3 cards');
    expect(titles()).toEqual(['Product teaser · Yirgacheffe', 'Text block · Untitled', 'Gallery · Roastery']);
    expect(within(group).getAllByRole('heading', { level: 3 })).toHaveLength(3);
    expect(outerCards()[0].querySelector('.sf-card__icon')?.textContent).toContain('sell');
    expect(within(group).getByText('Body 1')).toBeInTheDocument();
  });

  it('adds a card of the chosen type at the end and focuses it', async () => {
    const { host, fixture } = await setup();

    const add = screen.getByRole('button', { name: 'Add card' });
    fireEvent.click(add);
    const option = await screen.findByRole('menuitem', { name: 'Product teaser' });
    expect(option).toHaveAccessibleDescription('A product with image and price');
    fireEvent.click(option);
    fixture.detectChanges();

    expect(host.events).toEqual([['add', { type: 'teaser', index: 3 }]]);
    expect(titles()[3]).toBe('Product teaser · Untitled');
    await waitFor(() => expect(outerCards()[3].contains(document.activeElement)).toBe(true));
  });

  it('adds directly, without a menu, when only one type is allowed', async () => {
    const { host, fixture } = await setup((h) => h.types.set([TYPES[1]]));

    const add = screen.getByRole('button', { name: 'Add card' });
    expect(add).not.toHaveAttribute('aria-haspopup');
    fireEvent.click(add);
    fixture.detectChanges();

    expect(host.events).toEqual([['add', { type: 'text', index: 3 }]]);
  });

  it('inserts between cards at the right index with the "+" buttons', async () => {
    const { host, fixture } = await setup();

    // One "+" between each pair of cards, named by the position it inserts at.
    const inserts = screen.getAllByRole('button', { name: /^Insert a card at position/ });
    expect(inserts.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Insert a card at position 2',
      'Insert a card at position 3',
    ]);
    await chooseFromMenu(inserts[1], 'Gallery');
    fixture.detectChanges();

    expect(host.events).toEqual([['add', { type: 'gallery', index: 2 }]]);
    expect(titles()[2]).toBe('Gallery · Untitled');
  });

  it('moves with the menu, disabling Move up / Move down at the ends with a reason', async () => {
    const { host, fixture } = await setup();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Product teaser' }));
    const up = await screen.findByRole('menuitem', { name: 'Move up' });
    expect(up).toHaveAttribute('aria-disabled', 'true');
    expect(up).toHaveAccessibleDescription('Unavailable: Already the first card');
    fireEvent.keyDown(up, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Gallery' }));
    expect(await screen.findByRole('menuitem', { name: 'Move down' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move up' }));
    fixture.detectChanges();

    expect(host.events).toEqual([['move', { from: 2, to: 1 }]]);
    expect(titles()).toEqual(['Product teaser · Yirgacheffe', 'Gallery · Roastery', 'Text block · Untitled']);
    // Focus stays with the moved card (its menu button) and the move is announced.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Actions for Gallery' })));
    await waitFor(() =>
      expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('Gallery moved to position 2 of 3'),
    );
  });

  it('moves with Alt+↑ / Alt+↓ from a card header; focus follows the moved card; nothing at the ends', async () => {
    const { host, fixture } = await setup();
    const toggleOf = (type: string) => screen.getByRole('button', { name: `Collapse ${type}` });

    toggleOf('Product teaser').focus();
    fireEvent.keyDown(toggleOf('Product teaser'), { key: 'ArrowUp', altKey: true });
    expect(host.events).toEqual([]);

    fireEvent.keyDown(toggleOf('Product teaser'), { key: 'ArrowDown', altKey: true });
    fixture.detectChanges();
    expect(host.events).toEqual([['move', { from: 0, to: 1 }]]);
    expect(titles()[1]).toBe('Product teaser · Yirgacheffe');
    await waitFor(() => expect(document.activeElement).toBe(toggleOf('Product teaser')));
    await waitFor(() =>
      expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('Product teaser moved to position 2 of 3'),
    );

    fireEvent.keyDown(toggleOf('Gallery'), { key: 'ArrowDown', altKey: true });
    expect(host.events).toHaveLength(1);
  });

  it('announces Alt+↑ on the first / Alt+↓ on the last card, again when repeated', async () => {
    const { host, fixture } = await setup();
    const live = document.querySelector('sf-catalog.outer > .sf-catalog > [aria-live="polite"]')!;
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((delivered) => records.push(...delivered));
    observer.observe(live, { characterData: true, characterDataOldValue: true, childList: true, subtree: true });

    fireEvent.keyDown(screen.getByRole('button', { name: 'Collapse Product teaser' }), { key: 'ArrowUp', altKey: true });
    await waitFor(() => expect(live).toHaveTextContent('Already the first card'));
    const gallery = screen.getByRole('button', { name: 'Collapse Gallery' });
    fireEvent.keyDown(gallery, { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(live).toHaveTextContent('Already the last card'));
    fireEvent.keyDown(gallery, { key: 'ArrowDown', altKey: true });
    await fixture.whenStable();

    // Every text the region showed: the same message twice is cleared in between, so it is read twice.
    const shown = [...[...records, ...observer.takeRecords()].map((record) => record.oldValue?.trim() ?? ''), live.textContent!.trim()];
    observer.disconnect();
    expect(shown.filter((text) => text === 'Already the last card')).toHaveLength(2);
    expect(host.events).toEqual([]);
  });

  it('focuses a duplicate wherever the host puts it', async () => {
    const { host, fixture } = await setup();
    host.onDuplicate = (event) => {
      host.events.push(['duplicate', event.item.id, event.index]);
      host.items.update((items) => [...items, { ...event.item, id: `n${nextId++}` }]);
    };

    await chooseFromMenu(screen.getByRole('button', { name: 'Actions for Product teaser' }), 'Duplicate');
    fixture.detectChanges();

    expect(titles()).toEqual([
      'Product teaser · Yirgacheffe',
      'Text block · Untitled',
      'Gallery · Roastery',
      'Product teaser · Yirgacheffe',
    ]);
    await waitFor(() => expect(outerCards()[3].contains(document.activeElement)).toBe(true));
  });

  it('duplicates and removes through the card menu, without confirming', async () => {
    const { host, fixture } = await setup();

    await chooseFromMenu(screen.getByRole('button', { name: 'Actions for Product teaser' }), 'Duplicate');
    fixture.detectChanges();
    expect(host.events).toEqual([['duplicate', 'a', 0]]);
    expect(titles()).toEqual([
      'Product teaser · Yirgacheffe',
      'Product teaser · Yirgacheffe',
      'Text block · Untitled',
      'Gallery · Roastery',
    ]);

    await chooseFromMenu(screen.getByRole('button', { name: 'Actions for Text block' }), 'Remove');
    fixture.detectChanges();
    expect(host.events[1]).toEqual(['remove', 'b', 2]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(titles()).toHaveLength(3);
    // Focus moves to the card now at the removed one's place.
    await waitFor(() => expect(outerCards()[2].contains(document.activeElement)).toBe(true));
  });

  describe('drag and drop', () => {
    const transfer = () => ({ setData: vi.fn(), getData: vi.fn(), effectAllowed: 'all', dropEffect: 'none' });
    const header = (index: number) => outerCards()[index].querySelector<HTMLElement>('.sf-card__header')!;
    /** Fires a dragover / drop at a pointer height (jsdom has no DragEvent, so `clientY` is set by hand). */
    const at = (type: 'dragOver' | 'drop', element: HTMLElement, data: object, clientY: number) => {
      const event = createEvent[type](element, { dataTransfer: data });
      Object.defineProperty(event, 'clientY', { value: clientY });
      return fireEvent(element, event);
    };
    /** Gives each list item a 100px tall box at `index * 100`. */
    const layOut = () =>
      outerItems().forEach((li, index) => {
        li.getBoundingClientRect = () => ({ top: index * 100, height: 100, bottom: index * 100 + 100 }) as DOMRect;
      });

    it('shows a before / after indicator and emits the move on drop', async () => {
      const { host, fixture } = await setup();
      layOut();
      const data = transfer();

      expect(header(0)).toHaveAttribute('draggable', 'true');
      fireEvent.dragStart(header(0), { dataTransfer: data });
      fixture.detectChanges();
      expect(outerCards()[0]).toHaveClass('is-dragging');

      // Lower half of the last card: after it.
      expect(at('dragOver', outerItems()[2], data, 280)).toBe(false);
      fixture.detectChanges();
      expect(data.dropEffect).toBe('move');
      expect(outerCards()[2]).toHaveClass('is-drop-after');

      // Upper half of the second card: before it.
      at('dragOver', outerItems()[1], data, 110);
      fixture.detectChanges();
      expect(outerCards()[2]).not.toHaveClass('is-drop-after');
      // Right after itself: not a move, no indicator.
      expect(outerCards()[1]).not.toHaveClass('is-drop-before');

      at('drop', outerItems()[2], data, 280);
      fixture.detectChanges();
      expect(host.events).toEqual([['move', { from: 0, to: 2 }]]);
      expect(titles()[2]).toBe('Product teaser · Yirgacheffe');
      expect(document.querySelector('.is-dragging, .is-drop-before, .is-drop-after')).toBeNull();
    });

    it('drops before a card above', async () => {
      const { host, fixture } = await setup();
      layOut();
      const data = transfer();

      fireEvent.dragStart(header(2), { dataTransfer: data });
      at('dragOver', outerItems()[0], data, 20);
      fixture.detectChanges();
      expect(outerCards()[0]).toHaveClass('is-drop-before');
      at('drop', outerItems()[0], data, 20);

      expect(host.events).toEqual([['move', { from: 2, to: 0 }]]);
    });

    it('ignores drags that did not start in this catalog: external data and cards of a nested catalog', async () => {
      const { host, fixture } = await setup((h) =>
        h.items.update((items) => [
          { ...items[0], children: [{ id: 'x', type: 'text', title: 'Inner one' }, { id: 'y', type: 'text', title: 'Inner two' }] },
          ...items.slice(1),
        ]),
      );
      layOut();
      const data = transfer();

      // External: nothing started a drag.
      expect(at('dragOver', outerItems()[1], data, 150)).toBe(true);

      // A card of the nested catalog dragged onto the outer catalog's cards.
      const inner = screen.getByRole('group', { name: 'Inner' });
      const innerHeader = inner.querySelector<HTMLElement>('.sf-card__header')!;
      fireEvent.dragStart(innerHeader, { dataTransfer: data });
      expect(at('dragOver', outerItems()[2], data, 280)).toBe(true);
      at('drop', outerItems()[2], data, 280);
      fixture.detectChanges();
      expect(host.events).toEqual([]);
      expect(host.innerMove).not.toHaveBeenCalled();

      // Within the nested catalog it moves there, not in the outer one.
      const innerItems = inner.querySelectorAll<HTMLElement>(':scope > ol > li');
      innerItems[1].getBoundingClientRect = () => ({ top: 0, height: 100, bottom: 100 }) as DOMRect;
      at('drop', innerItems[1], data, 90);
      expect(host.innerMove).toHaveBeenCalledWith({ from: 0, to: 1 });
      expect(host.events).toEqual([]);
    });
  });

  it('collapses and expands all, remembering collapsed cards for the session under catalogId', async () => {
    const { fixture } = await setup((h) => h.catalogId.set('page-1.content'));
    const bodies = () => outerCards().map((card) => card.querySelector('.sf-card__body')!.hasAttribute('hidden'));

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Text block' }));
    fixture.detectChanges();
    expect(bodies()).toEqual([false, true, false]);
    expect(JSON.parse(sessionStorage.getItem('sf-catalog:page-1.content')!)).toEqual(['b']);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    fixture.detectChanges();
    expect(bodies()).toEqual([true, true, true]);

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    fixture.detectChanges();
    expect(bodies()).toEqual([false, false, false]);
    expect(sessionStorage.getItem('sf-catalog:page-1.content')).toBeNull();
  });

  it('restores collapsed cards from the session', async () => {
    sessionStorage.setItem('sf-catalog:page-1.content', JSON.stringify(['a', 'c']));
    await setup((h) => h.catalogId.set('page-1.content'));

    const bodies = outerCards().map((card) => card.querySelector('.sf-card__body')!.hasAttribute('hidden'));
    expect(bodies).toEqual([true, false, true]);
    expect(screen.getByRole('button', { name: 'Expand Product teaser' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('survives storage that throws', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      const { fixture } = await setup((h) => h.catalogId.set('blocked'));
      fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
      fixture.detectChanges();
      expect(screen.getByRole('button', { name: 'Expand all' })).toBeInTheDocument();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it('shows a compact empty state with the add button', async () => {
    const { host, fixture } = await setup((h) => h.items.set([]));

    expect(screen.getByText('No cards yet')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Sections' })).toHaveAccessibleDescription('No cards');
    expect(screen.queryByRole('button', { name: 'Collapse all' })).toBeNull();
    await chooseFromMenu(screen.getByRole('button', { name: 'Add card' }), 'Text block');
    fixture.detectChanges();
    expect(host.events).toEqual([['add', { type: 'text', index: 0 }]]);
  });

  it('read-only: no handles, menus, add or insert buttons; cards still collapse', async () => {
    const { fixture } = await setup((h) => h.readonly.set(true));

    expect(document.querySelector('[draggable="true"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add card' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Insert a card/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Gallery' }));
    fixture.detectChanges();
    expect(screen.getByRole('button', { name: 'Expand Gallery' })).toBeInTheDocument();
  });

  it('read-only and empty: just the empty line', async () => {
    await setup((h) => {
      h.items.set([]);
      h.readonly.set(true);
    });

    expect(screen.getByText('No cards yet')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('nests: a card body holds another catalog with its own group, cards and menus', async () => {
    await setup((h) =>
      h.items.update((items) => [
        { ...items[0], children: [{ id: 'x', type: 'text', title: 'Inner one' }] },
        ...items.slice(1),
      ]),
    );

    const inner = screen.getByRole('group', { name: 'Inner' });
    expect(screen.getByRole('group', { name: 'Sections' })).toContainElement(inner);
    expect(inner).toHaveAccessibleDescription('1 card');
    expect(within(inner).getByRole('heading', { name: 'Text block · Inner one' })).toBeInTheDocument();
    expect(titles()).toHaveLength(3);
  });
});
