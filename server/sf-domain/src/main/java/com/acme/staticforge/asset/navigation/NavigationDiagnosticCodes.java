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
}
