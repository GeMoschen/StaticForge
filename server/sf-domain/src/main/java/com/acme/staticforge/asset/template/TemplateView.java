package com.acme.staticforge.asset.template;

import com.acme.staticforge.asset.AssetType;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/**
 * Projection of a section/page template's current state (spec §12, §13). Combines the
 * identity columns with the {@code payload} carrying the CDL source, the compiled
 * content definition and the per-channel OCTL templates.
 */
public record TemplateView(
        UUID uuid,
        String uid,
        AssetType kind,
        String displayName,
        JsonNode payload,
        long validFromRevision,
        boolean deleted) {}
