package com.acme.staticforge.asset.navigation;

import java.util.UUID;

/**
 * Command to create a {@code PAGE_REFERENCE} asset (spec §17, `M8.1.2`). {@code folderUuid}
 * is the navigation folder (a {@code FolderScope.NAVIGATION} folder) it is placed under, or
 * {@code null} for the implicit root; {@code label} overrides the target's display name when
 * present.
 */
public record CreatePageReferenceCommand(
        String displayName, UUID folderUuid, PageReferenceTargetKind targetKind, UUID targetAssetUuid, String label) {}
