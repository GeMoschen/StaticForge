package com.acme.staticforge.generate.insight;

/**
 * How one step of a rebuild chain depends on the next one towards the root (M22.1.1). Stored and served by name; an
 * unknown name reads as {@link #UNKNOWN}, and clients show the raw name of an edge they have no label for.
 *
 * <p>Later epics add their kinds here rather than changing the model (e.g. a locale edge for M24); each addition
 * comes with a planner test producing it.
 */
public enum RebuildEdgeKind {
    /** A page uses its page template ({@code TEMPLATE} row, source path {@code templateRef}). */
    PAGE_TEMPLATE,
    /** A page places a section template in a body ({@code bodies.<body>[i].templateRef}). */
    SECTION_TEMPLATE,
    /** A page template extends a parent template (M20, {@code parentTemplateRef}). */
    PARENT_TEMPLATE,
    /** Any other {@code asset_reference} row; the step carries its {@code ReferenceKind} and source path. */
    REFERENCE,
    /**
     * The §18.2 navigation rule: a navigation-affecting change reaches the navigation folders that render it (a
     * page reference's or folder's navigation ancestors, or the page references pointing at a changed page's folder).
     */
    NAVIGATION,
    /** A template or processed media file loops a dataset that may select the changed record (M19). */
    DATASET_MEMBERSHIP,
    /** A page paginates the navigation folder or dataset the changed item belongs to (M21). */
    PAGINATION_SOURCE,
    /**
     * A template, record template, page, record or global set reads a record set whose query may select the changed
     * record, now or at the baseline (M25.2.3); the source path is the set's uid.
     */
    RECORD_SET_MEMBERSHIP,
    /** A reader of a record set whose stored query changed (M25.2.3); the source path is the reference row's. */
    RECORD_SET_QUERY,
    /**
     * A reader renders a record set's records through the dataset's record template, which changed or reads a change
     * (M25.2.3); the source path is the set's uid.
     */
    RECORD_TEMPLATE,
    UNKNOWN;

    /** The kind named {@code name}; {@link #UNKNOWN} for {@code null} or a name this build doesn't know. */
    public static RebuildEdgeKind parse(String name) {
        return InsightNames.parse(RebuildEdgeKind.class, name, UNKNOWN);
    }
}
