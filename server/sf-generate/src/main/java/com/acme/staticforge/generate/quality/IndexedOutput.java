package com.acme.staticforge.generate.quality;

import com.acme.staticforge.generate.target.BuildManifest;
import java.util.Objects;

/**
 * One output a check can resolve a link to (M30): a page output, a media file or a site file of the build — rendered by
 * this run or carried from the base build. In a draft check (M30.3.1) the outputs are the draft's planned paths.
 *
 * @param carried the output was carried forward from the base build (not rendered by this run)
 */
public record IndexedOutput(OutputKey key, BuildManifest.Kind kind, boolean carried) {

    public IndexedOutput {
        Objects.requireNonNull(key, "key");
        Objects.requireNonNull(kind, "kind");
    }

    public String path() {
        return key.path();
    }
}
