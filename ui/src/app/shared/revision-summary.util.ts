import type { components } from '../core/api/generated/schema.d.ts';

type RevisionView = components['schemas']['RevisionView'];

/**
 * Shape of `RevisionView.summary` / `Revision.summary` as built server-side by
 * `RevisionServiceImpl.appendSummary` (§7.2: "denormalized list of touched assets").
 * The generated OpenAPI type for `summary` is the opaque `JsonNode` placeholder
 * (`Record<string, never>`), since the backend annotates it as a generic Jackson
 * `JsonNode` rather than a concrete DTO — so this shape is asserted here, once, rather
 * than read via scattered unchecked casts at each call site.
 */
export interface RevisionSummaryAsset {
  uuid?: string;
  uid?: string;
  type?: string;
  action?: string;
}

export interface RevisionSummary {
  assets?: RevisionSummaryAsset[];
}

/** Reads the list of assets a revision's `summary` records, defaulting to empty when absent. */
export function revisionSummaryAssets(rev: RevisionView): RevisionSummaryAsset[] {
  const summary = rev.summary as unknown as RevisionSummary | undefined;
  return summary?.assets ?? [];
}

/** The uuids of the assets the given revisions created (`summary.assets[].action === 'CREATE'`). */
export function assetsCreatedIn(revisions: readonly RevisionView[]): Set<string> {
  const created = new Set<string>();
  for (const revision of revisions) {
    for (const asset of revisionSummaryAssets(revision)) {
      if (asset.action === 'CREATE' && asset.uuid) {
        created.add(asset.uuid);
      }
    }
  }
  return created;
}

/**
 * Number of assets a revision touched. Falls back to 1 when `summary.assets` is absent
 * (e.g. an older/synthetic revision without a populated summary) so callers can treat
 * "no summary" the same as the single-asset common case rather than as zero.
 */
export function revisionAssetCount(rev: RevisionView): number {
  const assets = revisionSummaryAssets(rev);
  return assets.length > 0 ? assets.length : 1;
}

/**
 * Builds the revision's display label: today's plain `comment ?? changeType` when the
 * revision touched exactly one asset (unchanged from before this helper existed), plus a
 * terse asset-count affordance (spec §24.2's "Uploaded 3 files" precedent) appended when
 * it touched more than one.
 */
export function revisionSummaryLabel(rev: RevisionView): string {
  const base = rev.comment ?? rev.changeType ?? '';
  const count = revisionAssetCount(rev);
  return count > 1 ? `${base} · ${count} assets` : base;
}
