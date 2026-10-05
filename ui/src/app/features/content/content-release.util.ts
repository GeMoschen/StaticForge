import { type ReleaseChoice, choicesFor } from '../release/release-choice.util';
import type { ContentEntry, ContentIndex } from './content-tree.util';

/**
 * The entries a Release… on `entries` covers: each entry itself and, for a folder, everything inside it recursively
 * (sub-folders and record sets), each once, in tree order. Pure.
 */
export function releaseScope(index: ContentIndex, entries: readonly ContentEntry[]): ContentEntry[] {
  const seen = new Set<string>();
  const out: ContentEntry[] = [];
  const visit = (entry: ContentEntry): void => {
    if (seen.has(entry.uuid)) {
      return;
    }
    seen.add(entry.uuid);
    out.push(entry);
    if (entry.kind === 'folder') {
      for (const child of index.childrenOf.get(entry.uuid) ?? []) {
        const next = index.entries.get(child);
        if (next) {
          visit(next);
        }
      }
    }
  };
  entries.forEach(visit);
  return out;
}

/**
 * The release dialog's choices for Release… on `entries` (the one helper of the Content tree and the folder table):
 * every language that has something to release on each entry in {@link releaseScope}, all ticked. Empty = nothing to
 * release.
 */
export function releaseChoicesOf(
  index: ContentIndex,
  entries: readonly ContentEntry[],
  locale: string | null,
  labelOf: (code: string) => string,
): ReleaseChoice[] {
  return releaseScope(index, entries).flatMap((entry) =>
    choicesFor(
      {
        uuid: entry.uuid,
        type: entry.kind === 'folder' ? 'FOLDER' : 'RECORD_SET',
        uid: entry.uid,
        displayName: entry.name,
        folderPath: entry.path,
        release: entry.release,
      },
      'release',
      locale,
      labelOf,
    ).map((choice) => ({ ...choice, label: `${entry.name} · ${choice.label}`, checked: true })),
  );
}
