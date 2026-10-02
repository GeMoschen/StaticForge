/** The outline's entry for the page's own fields. */
export const FIELDS_SELECTION = 'fields';

/** The outline's entry for a body (a section's is its instance id). */
export function bodySelection(bodyName: string): string {
  return `body:${bodyName}`;
}

/** The DOM id of the card of an outline entry (the page fields, a body or a section), for scrolling to it. */
export function cardDomId(selection: string): string {
  return `page-editor-card-${selection.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

/**
 * Scrolls the card of an outline entry into view, as soon as the form has rendered it (the page may still be loading or a
 * new section still being added). Gives up after about a second.
 *
 * @param then runs with the card once it is found
 */
export function revealCard(selection: string, then?: (card: HTMLElement) => void, attempt = 0): void {
  const card = typeof document === 'undefined' ? null : document.getElementById(cardDomId(selection));
  if (!card) {
    if (attempt < 20) {
      setTimeout(() => revealCard(selection, then, attempt + 1), 50);
    }
    return;
  }
  card.scrollIntoView?.({ block: 'start' });
  then?.(card);
}
