package com.acme.staticforge.template.cdl;

import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.Severity;
import java.util.List;

/**
 * The result of compiling CDL source: a best-effort {@link ContentDefinition} plus the
 * complete list of diagnostics (spec §14.7). The definition is never null even when hard
 * errors are reported, but it may be partial.
 */
public record CdlResult(ContentDefinition definition, List<Diagnostic> diagnostics) {

    public CdlResult {
        definition = definition == null ? new ContentDefinition(List.of(), List.of()) : definition;
        diagnostics = diagnostics == null ? List.of() : diagnostics;
    }

    /** True when at least one {@code ERROR}-severity diagnostic was produced. */
    public boolean hasErrors() {
        return diagnostics.stream().anyMatch(d -> d.severity() == Severity.ERROR);
    }
}
