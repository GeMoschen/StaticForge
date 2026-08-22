package com.acme.staticforge.template.render;

import com.acme.staticforge.template.diagnostic.Diagnostic;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * The result of rendering a compiled template (spec §16.10, §21.3): the output string plus
 * the set of asset UUIDs actually touched (resolved references and any media/asset
 * references inside editor values), which feeds {@code asset_reference} and incremental
 * builds. Render-time warnings (for example a {@code raw} filter on a plain-text editor
 * discovered at render time) are surfaced in {@code warnings}.
 */
public record RenderResult(String output, Set<UUID> dependencies, List<Diagnostic> warnings) {

    public RenderResult {
        output = output == null ? "" : output;
        dependencies = dependencies == null ? Set.of() : Set.copyOf(dependencies);
        warnings = warnings == null ? List.of() : List.copyOf(warnings);
    }

    /** Convenience constructor for the common case with no render warnings. */
    public RenderResult(String output, Set<UUID> dependencies) {
        this(output, dependencies, List.of());
    }
}
