package com.acme.staticforge.exportimport;

import java.time.Instant;
import java.util.List;

/**
 * Top-level {@code manifest.json} entry of an export archive (spec §26.5). Carries the
 * source project's identity metadata together with the protocol version so an importer can
 * reject unknown or incompatible archives up front.
 *
 * @param locales the source project's language codes (M27.5.1, protocol {@code 8}): empty for a project without
 *     languages, {@code null} in an older archive. Written whether or not the settings are exported, because an
 *     import only releases the languages the archive has.
 */
public record ExportManifest(
        int protocolVersion,
        String sourceProjectKey,
        String name,
        String description,
        Instant exportedAt,
        List<String> locales) {}
