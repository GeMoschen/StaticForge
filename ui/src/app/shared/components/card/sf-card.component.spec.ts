import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { SfMenuItem } from '../menu/sf-menu-item';
import { SfCardComponent } from './sf-card.component';

const menuItems: SfMenuItem[] = [
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'remove', label: 'Remove', danger: true },
];

async function setup(attrs = '', props: Record<string, unknown> = {}) {
  const handlers = { menuAction: vi.fn(), keyMove: vi.fn(), dragStart: vi.fn(), dragEnd: vi.fn() };
  const result = await render(
    `<sf-card type="Product teaser" [summary]="summary" [menuItems]="menuItems" ${attrs}
       (menuAction)="menuAction($event)" (keyMove)="keyMove($event)"
       (dragStart)="dragStart($event)" (dragEnd)="dragEnd($event)">
       <label>Title <input /></label>
     </sf-card>`,
    {
      imports: [SfCardComponent],
      componentProperties: { summary: 'Yirgacheffe 250 g', menuItems, ...props, ...handlers },
    },
  );
  return { ...result, ...handlers };
}

const header = () => document.querySelector<HTMLElement>('.sf-card__header')!;
const body = () => document.querySelector<HTMLElement>('.sf-card__body')!;

describe('SfCardComponent', () => {
  it('titles the card with a real h3 reading "Type · Summary"', async () => {
    await setup();

    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).toHaveTextContent('Product teaser · Yirgacheffe 250 g');
    expect(body()).toContainElement(screen.getByRole('textbox', { name: 'Title' }));
  });

  it('uses the heading level it is given', async () => {
    await setup('level="5"');
    expect(screen.getByRole('heading', { level: 5 }).tagName).toBe('H5');
  });

  it('shows "Untitled" without a summary', async () => {
    await setup('', { summary: '   ' });
    expect(screen.getByRole('heading')).toHaveTextContent('Product teaser · Untitled');
  });

  it('collapses with a toggle that controls the body, keeping the body rendered', async () => {
    const { fixture } = await setup();
    const toggle = screen.getByRole('button', { name: 'Collapse Product teaser' });

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', body().id);
    expect(body()).not.toHaveAttribute('hidden');

    screen.getByRole<HTMLInputElement>('textbox').value = 'kept';
    fireEvent.click(toggle);
    fixture.detectChanges();

    const expand = screen.getByRole('button', { name: 'Expand Product teaser', hidden: true });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    expect(body()).toHaveAttribute('hidden');
    expect(screen.getByRole<HTMLInputElement>('textbox', { hidden: true }).value).toBe('kept');

    fireEvent.click(expand);
    fixture.detectChanges();
    expect(body()).not.toHaveAttribute('hidden');
  });

  it('starts collapsed with [expanded]=false', async () => {
    await setup('[expanded]="false"');
    expect(body()).toHaveAttribute('hidden');
  });

  it('has no toggle when not collapsible', async () => {
    await setup('[collapsible]="false"');
    expect(screen.queryByRole('button', { name: /Collapse|Expand/ })).toBeNull();
  });

  it('emits the chosen menu item', async () => {
    const { menuAction } = await setup();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Product teaser' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));

    await waitFor(() => expect(menuAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'duplicate' })));
  });

  it('emits keyMove for Alt+↑ / Alt+↓ in the header, not for plain arrows or in the body', async () => {
    const { keyMove } = await setup();
    const toggle = screen.getByRole('button', { name: 'Collapse Product teaser' });

    fireEvent.keyDown(toggle, { key: 'ArrowUp', altKey: true });
    fireEvent.keyDown(toggle, { key: 'ArrowDown', altKey: true });
    fireEvent.keyDown(toggle, { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowDown', altKey: true });

    expect(keyMove.mock.calls).toEqual([[-1], [1]]);
  });

  it('moves the card on Alt+↓ from its ⋮ trigger without opening the menu', async () => {
    const { keyMove } = await setup();
    const trigger = screen.getByRole('button', { name: 'Actions for Product teaser' });

    fireEvent.keyDown(trigger, { key: 'ArrowDown', altKey: true });

    expect(keyMove.mock.calls).toEqual([[1]]);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('is a drag source with a decorative handle when draggable', async () => {
    const { dragStart, dragEnd } = await setup('draggable');
    const transfer = { setData: vi.fn(), effectAllowed: 'all' };

    expect(header()).toHaveAttribute('draggable', 'true');
    expect(header().querySelector('.sf-card__handle [aria-hidden="true"]')).not.toBeNull();
    fireEvent.dragStart(header(), { dataTransfer: transfer });
    fireEvent.dragEnd(header(), { dataTransfer: transfer });

    expect(transfer.effectAllowed).toBe('move');
    expect(dragStart).toHaveBeenCalledTimes(1);
    expect(dragEnd).toHaveBeenCalledTimes(1);
  });

  it('read-only: no handle, drag, menu or key moves; it still collapses', async () => {
    const { keyMove, dragStart } = await setup('draggable readonly');

    expect(header()).not.toHaveAttribute('draggable');
    expect(header().querySelector('.sf-card__handle')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions for Product teaser' })).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Collapse Product teaser' });
    fireEvent.keyDown(toggle, { key: 'ArrowUp', altKey: true });
    fireEvent.dragStart(header());
    expect(keyMove).not.toHaveBeenCalled();
    expect(dragStart).not.toHaveBeenCalled();
  });

  it('focusHeader focuses the collapse toggle', async () => {
    const { fixture } = await setup();
    const card = fixture.debugElement.children[0].componentInstance as SfCardComponent;

    card.focusHeader();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Collapse Product teaser' }));
  });
});
