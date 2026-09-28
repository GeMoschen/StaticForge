package com.acme.staticforge.generate.target;

import java.nio.file.Path;
import java.time.Instant;

/**
 * One thing a {@link TargetWriter} keeps on disk (M29.2.2), as {@code build-output-cleanup} sees it.
 *
 * @param kind what it is
 * @param runId the run it belongs to; {@code -1} for a {@link Kind#TEMP_LINK}
 * @param path where it is, always under the target's root
 * @param modified its last modification (of the link itself for a link)
 */
public record StoredItem(Kind kind, long runId, Path path, Instant modified) {

    public enum Kind {
        /** A build: {@code builds/{runId}} (filesystem) or {@code builds/{runId}.zip} (ZIP, published by construction). */
        BUILD,
        /** A staged archive that was never published: {@code builds/{runId}.zip.tmp}. */
        STAGED,
        /** A build manifest, {@code builds/{runId}.manifest.json}; present for every published build. */
        MANIFEST,
        /** A build sidecar, {@code builds/{runId}.{name}.json} (M30.1.3: {@code quality}); kept and removed like its manifest. */
        SIDECAR,
        /** A temporary link of an interrupted flip of {@code current}: {@code .current-<nanos>.link}. */
        TEMP_LINK
    }
}
