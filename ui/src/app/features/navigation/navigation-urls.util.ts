import type { NavUrls } from './navigation-tree.util';
import type { UrlRegistryEntryView } from './navigation.service';

/** How well a registry row fits what the menu shows: lower is better. */
function rank(entry: UrlRegistryEntryView, locale: string | null): number {
  const area = entry.area?.toUpperCase() === 'GENERATED' ? 0 : 1;
  const language = locale && entry.locale === locale ? 0 : !entry.locale ? 1 : 2;
  return area * 10 + language;
}

/**
 * The public URL of each page, from the URL registry's page rows (M35.22): the page itself (not its further pagination
 * pages), preferring the generated site's URL over the preview's, and the editing language's over a language-less row
 * over another language's. Pages without a row are left out — nothing was built or previewed for them yet. Pure.
 */
export function pickPageUrls(entries: readonly UrlRegistryEntryView[], locale: string | null): NavUrls {
  const best = new Map<string, { url: string; rank: number }>();
  for (const entry of entries) {
    if (!entry.targetUuid || !entry.url || entry.targetDeleted || (entry.pageNumber ?? 1) > 1 || (entry.variant ?? '') !== '') {
      continue;
    }
    const entryRank = rank(entry, locale);
    const current = best.get(entry.targetUuid);
    if (!current || entryRank < current.rank) {
      best.set(entry.targetUuid, { url: entry.url, rank: entryRank });
    }
  }
  return new Map([...best].map(([uuid, { url }]) => [uuid, url]));
}
