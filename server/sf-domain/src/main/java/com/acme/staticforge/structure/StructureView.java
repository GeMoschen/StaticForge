package com.acme.staticforge.structure;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/**
 * Projection of a structure asset's current state (spec §17.1). Combines identity columns with
 * the parsed fields from the asset version payload: the declarative {@code kind}, the editable
 * {@code sourceText}, the compiled {@code source} AST and the per-channel templates.
 */
public record StructureView(
        UUID uuid,
        String uid,
        String displayName,
        StructureKind kind,
        String sourceText,
        JsonNode source,
        JsonNode channelTemplates,
        long validFromRevision) {}
