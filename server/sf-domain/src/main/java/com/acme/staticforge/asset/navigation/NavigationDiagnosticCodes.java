package com.acme.staticforge.asset.navigation;

/**
 * Navigation resolution diagnostic codes (spec §17, §18; `M8.1.3`). These live alongside the
 * generation diagnostic codes' numbering convention ({@code SF-GEN-04xx} — the range the
 * deleted {@code NavigationBuilder} used for its own cycle diagnostic, {@code SF-GEN-0410})
 * even though the resolver itself lives in {@code sf-domain}: the diagnostic is reported
 * through generic {@code Diagnostic} findings (from {@code sf-template}), not through the
 * {@code sf-generate}-only {@code GenerationDiagnosticCodes} class, so there is no module
 * coupling — only the shared code-string convention.
 */
public final class NavigationDiagnosticCodes {

    private NavigationDiagnosticCodes() {}

    /**
     * A {@code startNode} chain revisited a folder it had already visited, or exceeded the
     * hard recursion cap ({@code PathService.MAX_DEPTH}); the chain is truncated at that point
     * and treated as unresolved from there on.
     */
    public static final String NAV_START_NODE_CYCLE = "SF-GEN-0410";

    /**
     * A {@code PAGE_REFERENCE} node inside a rendered {@code $CMS_NAVIGATION} tree does not
     * resolve to any page at all — {@code NavigationService.resolve} returned {@code null}
     * (`M8.2.3`): the reference's target asset is missing/deleted, or (for a {@code FOLDER}
     * target) the target folder has no navigable page anywhere in its subtree. This can only
     * happen for data written before `M8.1.2`'s validation started blocking it, or a target
     * soft-deleted after the reference was created. The page's render fails with this diagnostic
     * rather than silently emitting a broken (non-linked) nav entry.
     */
    public static final String NAV_DANGLING_PAGE_REFERENCE = "SF-GEN-0411";
}
