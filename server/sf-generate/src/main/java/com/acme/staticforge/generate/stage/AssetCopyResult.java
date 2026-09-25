package com.acme.staticforge.generate.stage;

import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.render.MediaOutputs;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * The result of the ASSETS stage (spec §18.2): the ordered list of files to write, plus the
 * copied/skipped counts. {@code filesCopied} counts every primary binary, rendered processed media
 * file and variant emitted; {@code filesSkipped} counts referenced blobs that could not be read.
 * {@code warnings} are render-time warnings of processed media, and {@code fileErrors} name the
 * processed media files that failed to render and were left out (M18.3.1), which makes the run PARTIAL.
 *
 * <p>{@code owners} maps each file's path to its media output — the media asset and, for localized media, the locale
 * the file is written for (M27.3.2) — and {@code dependencies} each rendered processed media output to the media it
 * links (M22.4.1): what a build manifest records so a later run can carry them.
 */
public record AssetCopyResult(
        List<OutputFile> files,
        long filesCopied,
        long filesSkipped,
        List<Diagnostic> warnings,
        List<Diagnostic> fileErrors,
        Map<String, MediaOutputs.Key> owners,
        Map<MediaOutputs.Key, Set<UUID>> dependencies) {

    public AssetCopyResult {
        files = files == null ? List.of() : List.copyOf(files);
        warnings = warnings == null ? List.of() : List.copyOf(warnings);
        fileErrors = fileErrors == null ? List.of() : List.copyOf(fileErrors);
        owners = owners == null ? Map.of() : Map.copyOf(owners);
        dependencies = dependencies == null ? Map.of() : Map.copyOf(dependencies);
    }

    public AssetCopyResult(
            List<OutputFile> files, long filesCopied, long filesSkipped, List<Diagnostic> warnings, List<Diagnostic> fileErrors) {
        this(files, filesCopied, filesSkipped, warnings, fileErrors, Map.of(), Map.of());
    }
}
