package com.acme.staticforge.generate.render;

import com.acme.staticforge.generate.pipeline.RenderedFile;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import java.util.List;

/**
 * The result of a render-pipeline execution (spec §18.2). {@code errors} carries the
 * ERROR-severity findings from VALIDATE (run-aborting when non-empty, in which case
 * {@code files} is empty); {@code warnings} carries tolerated render-time findings;
 * {@code pageErrors} carries ERROR findings that kept individual pages from being published
 * without aborting the run ({@code SF-GEN-0120} incomplete content, spec §10.5, and render limits
 * such as an include cycle, {@code SF-TPL-0130}–{@code 0135}), which makes
 * the run PARTIAL. Files are sorted deterministically by {@code outputPath}.
 */
public record RenderOutcome(
        List<RenderedFile> files, List<Diagnostic> errors, List<Diagnostic> warnings, List<Diagnostic> pageErrors) {

    public RenderOutcome {
        files = files == null ? List.of() : List.copyOf(files);
        errors = errors == null ? List.of() : List.copyOf(errors);
        warnings = warnings == null ? List.of() : List.copyOf(warnings);
        pageErrors = pageErrors == null ? List.of() : List.copyOf(pageErrors);
    }

    public RenderOutcome(List<RenderedFile> files, List<Diagnostic> errors, List<Diagnostic> warnings) {
        this(files, errors, warnings, List.of());
    }
}
