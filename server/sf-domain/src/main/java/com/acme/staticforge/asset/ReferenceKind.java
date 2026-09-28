package com.acme.staticforge.asset;

/** Kind of a materialized outgoing asset reference (spec §5.4). */
public enum ReferenceKind {
    /**
     * Page → page template ({@code templateRef}), page → section template (body section
     * {@code templateRef}) and record → dataset ({@code datasetRef}, M19.1.2).
     */
    TEMPLATE,
    CONTENT_REF,
    MEDIA_REF,
    OCTL_VALUE,
    OCTL_REF,
    OCTL_INCLUDE,
    /** Navigation edge: a {@code PAGE_REFERENCE} → its target page or pages folder. */
    NAV,
    /**
     * A {@code PAGES} folder → its start page (M31, payload {@code startPage}): usages list the folder and releasing
     * the folder proposes the page. It never blocks deleting the page — the folder then falls back to the channel's
     * {@code indexUid} rule.
     */
    START_PAGE
}
