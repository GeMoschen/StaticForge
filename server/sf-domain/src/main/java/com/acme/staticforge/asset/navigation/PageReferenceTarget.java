package com.acme.staticforge.asset.navigation;

import java.util.UUID;

/**
 * The {@code target} of a {@code PAGE_REFERENCE} asset (spec §17, `M8.1.2`): a pointer into
 * the page store, resolved at render time (`M8.1.3`) as follows — a {@code PAGE} target is
 * direct; a {@code FOLDER} target (a {@code FolderScope.PAGES} folder) resolves to that
 * folder's first navigable page.
 */
public record PageReferenceTarget(PageReferenceTargetKind kind, UUID assetUuid) {}
