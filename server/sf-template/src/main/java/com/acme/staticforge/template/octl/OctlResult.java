package com.acme.staticforge.template.octl;

import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.Severity;
import java.util.List;

/**
 * The result of compiling OCTL source (spec §16.10): a best-effort immutable
 * {@link CompiledTemplate} plus the complete list of diagnostics. The template is never
 * null even when hard errors are reported, but consumers must inspect {@link #hasErrors()}
 * before persisting or rendering it.
 */
public record OctlResult(CompiledTemplate template, List<Diagnostic> diagnostics) {

    public OctlResult {
        diagnostics = diagnostics == null ? List.of() : List.copyOf(diagnostics);
    }

    /** True when at least one {@code ERROR}-severity diagnostic was produced. */
    public boolean hasErrors() {
        return diagnostics.stream().anyMatch(d -> d.severity() == Severity.ERROR);
    }
}
