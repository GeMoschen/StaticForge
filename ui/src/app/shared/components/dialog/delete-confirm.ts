/** From this many items on, a delete asks for a typed confirmation (M35.13, gate decision 50). */
export const LARGE_DELETE_THRESHOLD = 25;

/** The word typed to confirm a large delete. */
export const LARGE_DELETE_WORD = 'delete';

/**
 * The `typeToConfirm` of a delete of `count` items: the word `delete` for a large one, nothing for a smaller one (which
 * confirms plainly and offers Undo). Pass it straight to `ConfirmService.confirm`.
 */
export function typeToConfirmFor(count: number): string | undefined {
  return count >= LARGE_DELETE_THRESHOLD ? LARGE_DELETE_WORD : undefined;
}
