package com.acme.staticforge.asset.globals;

import com.acme.staticforge.template.cdl.CdlSources;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/**
 * Read model of one global property set at a single revision (M17.1.2): its identity, the CDL
 * source a developer edits, the compiled definition the value form and the content validator are
 * driven by, and the values themselves.
 *
 * <p>{@code revision} is the version's {@code validFromRevision}, which doubles as the
 * optimistic-concurrency token carried as {@code ETag: "rev-{n}"} (§7.5).
 */
public record GlobalSetView(
        UUID uuid,
        String uid,
        String displayName,
        String folderPath,
        CdlSources cdl,
        JsonNode compiledDefinition,
        JsonNode content,
        long revision,
        boolean deleted) {}
