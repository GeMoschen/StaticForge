/**
 * Anchored popups (M35.6): tooltips, menus and combobox lists are `position: fixed` panels placed next to an anchor
 * element, flipped to the other side when they don't fit the viewport and clamped inside it. M35.7's overlay layer
 * builds on this.
 */
export type AnchorSide = 'bottom' | 'top';
export type AnchorAlign = 'start' | 'end' | 'center';

export interface AnchorOptions {
  /** The preferred side; the other one is used when the panel fits only there. */
  side?: AnchorSide;
  align?: AnchorAlign;
  /** Gap between anchor and panel, in px. */
  offset?: number;
  /** Makes the panel at least as wide as the anchor (lists under inputs). */
  matchWidth?: boolean;
  /** Space kept free at the viewport edges, in px. */
  margin?: number;
}

export interface AnchorPlacement {
  top: number;
  left: number;
  side: AnchorSide;
  minWidth: number | null;
  maxHeight: number;
}

interface Size {
  width: number;
  height: number;
}

/** Where a panel of `panel` size goes next to `anchor` in a `viewport`-sized window. Pure, for tests. */
export function computeAnchorPlacement(
  anchor: DOMRect,
  panel: Size,
  viewport: Size,
  options: AnchorOptions = {},
): AnchorPlacement {
  const { side = 'bottom', align = 'start', offset = 4, matchWidth = false, margin = 8 } = options;
  const width = matchWidth ? Math.max(panel.width, anchor.width) : panel.width;

  const spaceBelow = viewport.height - anchor.bottom - offset - margin;
  const spaceAbove = anchor.top - offset - margin;
  let chosen: AnchorSide = side;
  if (side === 'bottom' && panel.height > spaceBelow && spaceAbove > spaceBelow) {
    chosen = 'top';
  } else if (side === 'top' && panel.height > spaceAbove && spaceBelow > spaceAbove) {
    chosen = 'bottom';
  }
  const maxHeight = Math.max(0, chosen === 'bottom' ? spaceBelow : spaceAbove);
  const height = Math.min(panel.height, maxHeight);
  const top = chosen === 'bottom' ? anchor.bottom + offset : anchor.top - offset - height;

  let left: number;
  switch (align) {
    case 'end':
      left = anchor.right - width;
      break;
    case 'center':
      left = anchor.left + anchor.width / 2 - width / 2;
      break;
    default:
      left = anchor.left;
  }
  left = Math.min(Math.max(left, margin), Math.max(margin, viewport.width - margin - width));

  return { top, left, side: chosen, minWidth: matchWidth ? anchor.width : null, maxHeight };
}

/**
 * Places `panel` (already `position: fixed` and rendered) next to `anchor` and keeps it there while the page scrolls
 * or resizes. Returns the function that stops following.
 *
 * The panel moves into `<body>` first: inside an ancestor with a `transform` (the dialog shell has one) or with
 * `overflow` clipping, a fixed panel would be offset or cut off. It keeps its Angular bindings and component styles.
 * Stopping removes it from `<body>` — Angular removes only the top nodes of a destroyed view, so a panel inside a
 * destroyed subtree would otherwise stay on screen.
 */
export function anchorPanel(anchor: HTMLElement, panel: HTMLElement, options: AnchorOptions = {}): () => void {
  const body = panel.ownerDocument.body;
  if (panel.parentElement !== body) {
    body.appendChild(panel);
  }
  // The panel's own CSS max-height (a scrolling list's cap), read before the inline one below replaces it.
  const cssMaxHeight = parseFloat(panel.ownerDocument.defaultView?.getComputedStyle(panel).maxHeight ?? '') || Infinity;
  const place = (event?: Event) => {
    const view = panel.ownerDocument.defaultView;
    if (!view || (event?.target instanceof Node && panel.contains(event.target))) {
      return; // scrolling inside the panel doesn't move it
    }
    // The height it wants: content plus borders, up to its CSS cap (a previous inline maxHeight doesn't count).
    const naturalHeight = Math.min(panel.scrollHeight + (panel.offsetHeight - panel.clientHeight), cssMaxHeight);
    const placement = computeAnchorPlacement(
      anchor.getBoundingClientRect(),
      { width: panel.offsetWidth, height: naturalHeight },
      { width: view.innerWidth, height: view.innerHeight },
      options,
    );
    panel.style.top = `${placement.top}px`;
    panel.style.left = `${placement.left}px`;
    panel.style.maxHeight = `${Math.min(placement.maxHeight, cssMaxHeight)}px`;
    if (placement.minWidth !== null) {
      panel.style.minWidth = `${placement.minWidth}px`;
    }
    panel.dataset['side'] = placement.side;
  };
  place();
  const view = panel.ownerDocument.defaultView;
  view?.addEventListener('scroll', place, true);
  view?.addEventListener('resize', place);
  return () => {
    view?.removeEventListener('scroll', place, true);
    view?.removeEventListener('resize', place);
    panel.remove();
  };
}
