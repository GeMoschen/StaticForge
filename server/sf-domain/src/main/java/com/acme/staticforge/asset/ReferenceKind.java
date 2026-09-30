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
     * A template's, dataset's or property set's editor rules read a property set ({@code global:<uid>}, M33.7); the
     * source path names the reader ({@code rules.<name>}, {@code states.<path>}, {@code fills.<path>}).
     */
    RULE_REFERENCE
}
