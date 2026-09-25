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
 * @param releaseStatuses restricts hits to assets with one of these release statuses in some locale (M27.1.3);
 *     empty for any
 */
public record SearchQuery(
        String text, Set<AssetType> types, String folder, int page, int size, String locale, Set<String> releaseStatuses) {

    public SearchQuery {
        text = text == null ? "" : text;
        types = types == null ? Set.of() : Set.copyOf(types);
        folder = folder == null || folder.isBlank() ? null : folder;
        locale = locale == null || locale.isBlank() ? null : locale;
        releaseStatuses = releaseStatuses == null ? Set.of() : Set.copyOf(releaseStatuses);
    }

    /** A query without a release-status filter. */
    public SearchQuery(String text, Set<AssetType> types, String folder, int page, int size, String locale) {
        this(text, types, folder, page, size, locale, Set.of());
    }

    /** A query over every language. */
    public SearchQuery(String text, Set<AssetType> types, String folder, int page, int size) {
        this(text, types, folder, page, size, null, Set.of());
    }

    /** A first page of {@code size} hits over every type, folder and language. */
    public static SearchQuery of(String text, int size) {
        return new SearchQuery(text, Set.of(), null, 0, size, null, Set.of());
    }
}
