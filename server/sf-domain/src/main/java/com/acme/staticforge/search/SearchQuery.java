package com.acme.staticforge.search;

import com.acme.staticforge.asset.AssetType;
import java.util.Set;

/**
 * A search over one project's index (M23.3.1).
 *
 * @param text the user's input, never interpreted as Lucene syntax
 * @param types restricts hits to these types; empty for every type
 * @param folder restricts hits to this folder path prefix; {@code null} for any folder
 * @param page zero-based page number
 * @param size hits per page
 */
public record SearchQuery(String text, Set<AssetType> types, String folder, int page, int size) {

    public SearchQuery {
        text = text == null ? "" : text;
        types = types == null ? Set.of() : Set.copyOf(types);
        folder = folder == null || folder.isBlank() ? null : folder;
    }

    /** A first page of {@code size} hits over every type and folder. */
    public static SearchQuery of(String text, int size) {
        return new SearchQuery(text, Set.of(), null, 0, size);
    }
}
