package com.acme.staticforge.search.extract;

import com.acme.staticforge.search.SearchDocument;
import com.fasterxml.jackson.databind.JsonNode;

/** Shared document construction for the extractors (M23.1.2). */
final class Documents {

    private Documents() {}

    /** A document with the asset's identity, its title (display name and uid) and the given prose and code. */
    static SearchDocument of(IndexableAsset asset, String text, String source) {
        return of(asset, text, java.util.Map.of(), source);
    }

    /** As {@link #of(IndexableAsset, String, String)}, with the prose of each language (M24.3.3). */
    static SearchDocument of(
            IndexableAsset asset, String text, java.util.Map<String, String> textByLocale, String source) {
        return new SearchDocument(
                asset.uuid(),
                asset.type(),
                asset.uid(),
                asset.displayName(),
                asset.folderPath(),
                asset.templateUuid(),
                asset.revision(),
                title(asset),
                text,
                textByLocale,
                source);
    }

    /** The document a {@link TextBuilder} produced, language-dependent text included. */
    static SearchDocument of(IndexableAsset asset, TextBuilder text, String source) {
        return of(asset, text.build(), text.buildByLocale(), source);
    }

    static String title(IndexableAsset asset) {
        String name = asset.displayName() == null ? "" : asset.displayName().strip();
        String uid = asset.uid() == null ? "" : asset.uid().strip();
        return name.equals(uid) || uid.isEmpty() ? name : (name + " " + uid).strip();
    }

    static String text(JsonNode payload, String field) {
        JsonNode value = payload == null ? null : payload.get(field);
        return value != null && value.isTextual() ? value.asText() : null;
    }
}
