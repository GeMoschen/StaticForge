package com.acme.staticforge.search.extract;

import com.acme.staticforge.asset.AssetType;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/**
 * An asset's current version as text extraction sees it (M23.1.2), built from an {@code AssetVersion} and its asset.
 *
 * @param templateUuid the version's template column (a page's template, a record's dataset), or {@code null}
 * @param revision the version's {@code validFromRevision}
 */
public record IndexableAsset(
        UUID uuid,
        AssetType type,
        String uid,
        String displayName,
        String folderPath,
        UUID templateUuid,
        long revision,
        JsonNode payload) {}
