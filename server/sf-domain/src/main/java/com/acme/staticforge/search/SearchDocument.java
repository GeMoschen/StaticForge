package com.acme.staticforge.search;

import com.acme.staticforge.asset.AssetType;
import java.util.Objects;
import java.util.UUID;

/**
 * One asset as the search index stores it (M23.1.1). Built by a {@code SearchTextExtractor} from the asset's current
 * version; the index service knows nothing about payloads.
 *
 * @param templateUuid the page's template, a record's dataset; {@code null} for other types
 * @param revision the {@code validFromRevision} of the extracted version
 * @param title display name and uid
 * @param text prose: indexed language-neutral, German and English
 * @param source code (CDL, OCTL, processed text media): indexed language-neutral only
 */
public record SearchDocument(
        UUID uuid,
        AssetType assetType,
        String uid,
        String displayName,
        String folderPath,
        UUID templateUuid,
        long revision,
        String title,
        String text,
        String source) {

    public SearchDocument {
        Objects.requireNonNull(uuid, "uuid");
        Objects.requireNonNull(assetType, "assetType");
        uid = uid == null ? "" : uid;
        displayName = displayName == null ? "" : displayName;
        folderPath = folderPath == null ? "/" : folderPath;
        title = title == null ? "" : title;
        text = text == null ? "" : text;
        source = source == null ? "" : source;
    }
}
