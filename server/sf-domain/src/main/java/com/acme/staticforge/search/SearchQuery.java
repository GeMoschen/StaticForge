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
 * @param locale searches this language's prose field instead of every language's (M24.3.3);
 *     {@code null} searches them all, which is what a project without languages always does
 */
public record SearchQuery(String text, Set<AssetType> types, String folder, int page, int size, String locale) {

    public SearchQuery {
        text = text == null ? "" : text;
        types = types == null ? Set.of() : Set.copyOf(types);
        folder = folder == null || folder.isBlank() ? null : folder;
        locale = locale == null || locale.isBlank() ? null : locale;
    }

    /** A query over every language. */
    public SearchQuery(String text, Set<AssetType> types, String folder, int page, int size) {
        this(text, types, folder, page, size, null);
    }

    /** A first page of {@code size} hits over every type, folder and language. */
    public static SearchQuery of(String text, int size) {
        return new SearchQuery(text, Set.of(), null, 0, size, null);
    }
}
