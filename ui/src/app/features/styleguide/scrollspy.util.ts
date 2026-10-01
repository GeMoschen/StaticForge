/**
 * Which section of the style guide is current (M35.9), from the sections an IntersectionObserver reports inside its
 * band (below the sticky header, the top part of the viewport): the first of them in document order. When none is in
 * the band (scrolling through a gap, or a short last section) the previous one stays current; before anything has been
 * reported, the first section.
 */
export function currentSection(
  order: readonly string[],
  visible: ReadonlySet<string>,
  previous: string | null,
): string | null {
  return order.find((id) => visible.has(id)) ?? previous ?? order[0] ?? null;
}

/** Applies IntersectionObserver entries (by element id) to the set of sections in the band; returns a new set. */
export function applyIntersections(
  visible: ReadonlySet<string>,
  entries: readonly { readonly id: string; readonly isIntersecting: boolean }[],
): Set<string> {
  const next = new Set(visible);
  for (const entry of entries) {
    if (entry.isIntersecting) {
      next.add(entry.id);
    } else {
      next.delete(entry.id);
    }
  }
  return next;
}

/**
 * The observer's root margin: the band starts `gap` px under the sticky header and ends at 40 % of the viewport. The
 * gap covers the sections' `scroll-margin-top`, so after jumping to a section the tail of the one before it, still
 * showing just under the header, is not in the band.
 */
export function spyRootMargin(headerHeight: number, gap = 24): string {
  return `-${Math.max(0, Math.round(headerHeight + gap))}px 0px -60% 0px`;
}
