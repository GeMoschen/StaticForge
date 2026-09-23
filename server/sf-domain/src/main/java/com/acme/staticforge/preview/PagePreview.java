package com.acme.staticforge.preview;

import com.acme.staticforge.template.diagnostic.Diagnostic;
import java.util.List;

/**
 * A rendered page preview (spec §19) and which page of it was rendered (M21.3.1): {@code pageNumber} of
 * {@code totalPages}, both {@code 1} for a page that isn't paginated. {@code warnings} are the render warnings of the
 * page and every section rendered inside it (M25.2.2) — the preview counterpart of a generated file's warnings, for
 * example a record set whose stored query no longer validates ({@code SF-GEN-0240}).
 */
public record PagePreview(String html, int pageNumber, int totalPages, List<Diagnostic> warnings) {

    public PagePreview {
        warnings = warnings == null ? List.of() : List.copyOf(warnings);
    }
}
