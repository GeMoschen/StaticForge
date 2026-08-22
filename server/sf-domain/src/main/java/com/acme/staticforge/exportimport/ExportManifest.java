package com.acme.staticforge.exportimport;

import java.time.Instant;

/**
 * Top-level {@code manifest.json} entry of an export archive (spec §26.5). Carries the
 * source project's identity metadata together with the protocol version so an importer can
 * reject unknown or incompatible archives up front.
 */
public record ExportManifest(
        int protocolVersion,
        String sourceProjectKey,
        String name,
        String description,
        Instant exportedAt) {}
