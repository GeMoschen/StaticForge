package com.acme.staticforge.generate.pipeline;

import com.acme.staticforge.generate.quality.ReferenceEvent;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * The rendered output of a single (page, channel) unit (spec §18.2 RENDER): the bytes and the
 * set of asset UUIDs whose contents it depends on (feeds incremental planning and the
 * ASSETS copy stage), plus any render-time diagnostics (warnings are tolerated; the callers
 * treat ERROR diagnostics found during VALIDATE as a run-aborting condition).
 *
 * <p>{@code references} (M30.1.3, epic decision 8) are the references the render could not resolve — deleted,
 * unreleased or missing targets, each rendered {@code ""} — which the quality checks report on this output.
 */
public record RenderedFile(
        String outputPath,
        byte[] bytes,
        Set<UUID> dependencies,
        List<Diagnostic> diagnostics,
        List<ReferenceEvent> references) {

    public RenderedFile {
        outputPath = OutputFile.normalize(outputPath);
        bytes = bytes == null ? new byte[0] : bytes;
        dependencies = dependencies == null ? Set.of() : Set.copyOf(dependencies);
        diagnostics = diagnostics == null ? List.of() : List.copyOf(diagnostics);
        references = references == null ? List.of() : List.copyOf(references);
    }

    /** A rendered file without unresolved references. */
    public RenderedFile(String outputPath, byte[] bytes, Set<UUID> dependencies, List<Diagnostic> diagnostics) {
        this(outputPath, bytes, dependencies, diagnostics, List.of());
    }

    /** A convenience view as a plain {@link OutputFile}. */
    public OutputFile toOutputFile() {
        return new OutputFile(outputPath, bytes);
    }
}
