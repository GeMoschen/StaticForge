package com.acme.staticforge.generate.stage;

import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import java.util.List;

/**
 * The result of the ASSETS stage (spec §18.2): the ordered list of files to write, plus the
 * copied/skipped counts. {@code filesCopied} counts every primary binary, rendered processed media
 * file and variant emitted; {@code filesSkipped} counts referenced blobs that could not be read.
 * {@code warnings} are render-time warnings of processed media, and {@code fileErrors} name the
 * processed media files that failed to render and were left out (M18.3.1), which makes the run PARTIAL.
 */
public record AssetCopyResult(
        List<OutputFile> files,
        long filesCopied,
        long filesSkipped,
        List<Diagnostic> warnings,
        List<Diagnostic> fileErrors) {

    public AssetCopyResult {
        files = files == null ? List.of() : List.copyOf(files);
        warnings = warnings == null ? List.of() : List.copyOf(warnings);
        fileErrors = fileErrors == null ? List.of() : List.copyOf(fileErrors);
    }
}
