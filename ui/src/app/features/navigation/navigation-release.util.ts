import { type ReleaseChoice, choicesFor } from '../release/release-choice.util';
import { type NavEntry, type NavIndex, navChildren } from './navigation-tree.util';

/** The entries themselves and, for a folder, everything inside it (recursively), each once, in menu order. Pure. */
export function withNavDescendants(index: NavIndex, entries: readonly NavEntry[]): NavEntry[] {
  const seen = new Set<string>();
  const out: NavEntry[] = [];
  const visit = (entry: NavEntry): void => {
    if (seen.has(entry.uuid)) {
      return;
    }
    seen.add(entry.uuid);
    out.push(entry);
    if (entry.kind === 'folder') {
      navChildren(index, entry.uuid).forEach(visit);
    }
  };
  entries.forEach(visit);
  return out;
}

/**
 * What *Release…* offers for navigation entries (tree and folder table share this): every language of every entry — a
 * folder with all that lies inside it — that has something to release, all ticked. Empty when nothing is waiting. Pure.
 */
export function navReleaseChoices(
  index: NavIndex,
  entries: readonly NavEntry[],
  editingLocale: string | null,
  labelOf: (code: string) => string,
): ReleaseChoice[] {
  return withNavDescendants(index, entries).flatMap((entry) =>
    choicesFor(
      {
        uuid: entry.uuid,
        type: entry.kind === 'folder' ? 'FOLDER' : 'PAGE_REFERENCE',
        uid: entry.uid,
        displayName: entry.label,
        release: entry.release,
      },
      'release',
      editingLocale,
      labelOf,
    ).map((choice) => ({ ...choice, label: `${entry.label} · ${choice.label}`, checked: true })),
  );
}
