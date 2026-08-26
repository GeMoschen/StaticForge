package com.acme.staticforge.asset.navigation;

/**
 * What a {@code PAGE_REFERENCE} asset's {@code target} points at: a page-store
 * {@code Page}, or a page-store {@code Folder} (spec §17, `M8.1.2`). Never a
 * navigation-store folder — that is {@link com.acme.staticforge.asset.folder.StartNodeKind}'s
 * concern instead.
 */
public enum PageReferenceTargetKind {
    PAGE,
    FOLDER
}
