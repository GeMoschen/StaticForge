import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it } from 'vitest';
import { ToastService } from '../../../core/ui/toast.service';
import { SgCardsComponent } from './sg-cards.component';

const cardTitles = (group: HTMLElement) =>
  Array.from(group.querySelectorAll(':scope > ol > li > sf-card .sf-card__title'))
    .filter((title) => title.closest('[role="group"]') === group)
    .map((title) => title.textContent!.replace(/\s+/g, ' ').trim());

afterEach(() => sessionStorage.clear());

describe('SgCardsComponent', () => {
  async function setup() {
    const result = await render(SgCardsComponent);
    const toasts = result.fixture.debugElement.injector.get(ToastService);
    const catalog = screen.getByRole('group', { name: 'Page content' });
    return { ...result, toasts, catalog };
  }

  it('shows the single cards, a catalog of four cards with a nested catalog, an empty and a read-only catalog', async () => {
    const { catalog } = await setup();

    expect(cardTitles(catalog)).toEqual([
      'Product teaser · Yirgacheffe 250 g',
      'Text block · Our roasting process',
      'Gallery · The roastery',
      'Product teaser · Untitled',
    ]);
    expect(within(catalog).getByRole('group', { name: 'Slides' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Sidebar' })).toHaveTextContent('No cards yet');
    const readonly = screen.getByRole('group', { name: 'Footer (from the page template)' });
    expect(within(readonly).queryByRole('button', { name: /^Actions for/ })).toBeNull();
  });

  it('updates the summary from the card field', async () => {
    const { catalog, fixture } = await setup();

    const field = within(catalog).getAllByRole('textbox', { name: 'Product name' })[1];
    fireEvent.input(field, { target: { value: 'Sidamo 500 g' } });
    fixture.detectChanges();

    expect(cardTitles(catalog)[3]).toBe('Product teaser · Sidamo 500 g');
  });

  it('removes a card with an Undo toast that puts it back', async () => {
    const { catalog, fixture, toasts } = await setup();

    fireEvent.click(within(catalog).getByRole('button', { name: 'Actions for Text block' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    fixture.detectChanges();
    await waitFor(() => expect(cardTitles(catalog)).toHaveLength(3));

    const toast = toasts.toasts().at(-1)!;
    expect(toast.message).toBe('Removed: Our roasting process');
    toast.action!.run();
    fixture.detectChanges();
    expect(cardTitles(catalog)[1]).toBe('Text block · Our roasting process');
  });

  it('adds, duplicates and moves in the nested catalog without touching the outer one', async () => {
    const { catalog, fixture } = await setup();
    const slides = within(catalog).getByRole('group', { name: 'Slides' });

    // One slide type: the add button adds directly.
    fireEvent.click(within(slides).getByRole('button', { name: 'Add card' }));
    fixture.detectChanges();
    await waitFor(() => expect(cardTitles(slides)).toHaveLength(3));

    fireEvent.keyDown(within(slides).getAllByRole('button', { name: 'Collapse Slide' })[0], {
      key: 'ArrowDown',
      altKey: true,
    });
    fixture.detectChanges();
    expect(cardTitles(slides)).toEqual(['Slide · The drum roaster', 'Slide · Green beans arrive', 'Slide · Untitled']);

    fireEvent.click(within(slides).getAllByRole('button', { name: 'Actions for Slide' })[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));
    fixture.detectChanges();
    await waitFor(() => expect(cardTitles(slides).slice(0, 2)).toEqual(['Slide · The drum roaster', 'Slide · The drum roaster']));
    expect(cardTitles(catalog)).toHaveLength(4);
  });
});
