/**
 * Shared display ordering for every tree view in the app (Pages/Media/Navigation/Templates
 * stores and the export panel's selection trees): folders before leaf items, and alphabetical
 * by display name within each group. Every one of those trees is built from a different fetch
 * shape (a flat `FolderView[]` forest plus a separate per-folder leaf-asset map for
 * Pages/Media/Templates/export; a single mixed-children `NavTreeView` for the Navigation
 * screen's own tree), so there's no one data structure to sort once upstream — these helpers
 * are applied at each of those shapes' own construction site instead.
 */

function displayKey(item: { displayName?: string; uid?: string }): string {
  return (item.displayName ?? item.uid ?? '').toLocaleLowerCase();
}

/** Sorts a flat list of leaf items (pages, media, references, templates, …) alphabetically by
 * display name (falling back to `uid`). Does not mutate the input. */
export function sortByDisplayName<T extends { displayName?: string; uid?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => displayKey(a).localeCompare(displayKey(b)));
}

/** Recursively sorts a `FolderView` forest alphabetically by display name (folders only — these
 * trees never mix in leaf items). Does not mutate the input. */
export function sortFolderTree<T extends { displayName?: string; uid?: string; children?: T[] }>(
  nodes: T[],
): T[] {
  return sortByDisplayName(nodes).map((node) =>
    node.children && node.children.length > 0 ? { ...node, children: sortFolderTree(node.children) } : node,
  );
}

/** Recursively sorts a `NavTreeView` forest, which — unlike the other trees — mixes `FOLDER`
 * nodes and leaf `PAGE_REFERENCE` nodes in one flat list (at the top level, and again in each
 * node's own `children`): folders first, then alphabetical by display name within each group.
 * Does not mutate the input. */
export function sortNavTree<T extends { displayName?: string; uid?: string; type?: string; children?: T[] }>(
  nodes: T[],
): T[] {
  const sorted = [...nodes].sort((a, b) => {
    const aFolder = a.type === 'FOLDER' ? 0 : 1;
    const bFolder = b.type === 'FOLDER' ? 0 : 1;
    return aFolder !== bFolder ? aFolder - bFolder : displayKey(a).localeCompare(displayKey(b));
  });
  return sorted.map((node) =>
    node.children && node.children.length > 0 ? { ...node, children: sortNavTree(node.children) } : node,
  );
}
