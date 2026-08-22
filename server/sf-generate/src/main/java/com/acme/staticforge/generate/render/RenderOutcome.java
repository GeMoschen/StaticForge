package com.acme.staticforge.generate.render;

import com.acme.staticforge.generate.pipeline.RenderedFile;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import java.util.List;

/**
 * The result of a render-pipeline execution (spec §18.2). {@code errors} carries the
 * ERROR-severity findings from VALIDATE (run-aborting when non-empty, in which case
 * {@code files} is empty); {@code warnings} carries tolerated render-time findings. Files are
 * sorted deterministically by {@code outputPath}.
 */
public record RenderOutcome(List<RenderedFile> files, List<Diagnostic> errors, List<Diagnostic> warnings) {

    public RenderOutcome {
        files = files == null ? List.of() : List.copyOf(files);
        errors = errors == null ? List.of() : List.copyOf(errors);
        warnings = warnings == null ? List.of() : List.copyOf(warnings);
    }
}
