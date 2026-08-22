package com.acme.staticforge.generate.stage;

import com.acme.staticforge.generate.pipeline.OutputFile;
import java.util.List;

/**
 * The result of the media asset-copy stage (spec §18.2 ASSETS): the ordered list of files to
 * write, plus the copied/skipped counts. {@code filesCopied} counts every primary binary and
 * variant emitted; {@code filesSkipped} counts referenced blobs that could not be read.
 */
public record AssetCopyResult(List<OutputFile> files, long filesCopied, long filesSkipped) {

    public AssetCopyResult {
        files = files == null ? List.of() : List.copyOf(files);
    }
}
