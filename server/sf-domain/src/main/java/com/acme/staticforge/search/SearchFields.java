package com.acme.staticforge.search;

import java.util.List;

/**
 * Field names of a search document (M23.1.1). Identity and filter fields are keywords; text fields are analyzed by
 * {@link SearchAnalyzers}. Language fields are named {@code text_<locale>} so more locales drop in without a
 * document-model change (M24.3.3).
 */
public final class SearchFields {

    /** Asset UUID, the document key ({@code updateDocument} term). Keyword, stored. */
    public static final String UUID = "uuid";

    /** Asset type name. Keyword, stored, and sorted-set doc values for facet counts. */
    public static final String TYPE = "type";

    /** The uid as stored. Keyword, stored. */
    public static final String UID = "uid";

    /** The uid lowercased, for case-insensitive exact and prefix matches. Keyword. */
    public static final String UID_LOWER = "uid_lower";

    /** The asset's folder path ({@code /pages_root/news/}). Keyword (prefix-queryable), stored. */
    public static final String FOLDER_PATH = "folderPath";

    public static final String DISPLAY_NAME = "displayName";

    public static final String TEMPLATE_UUID = "templateUuid";

    /** The {@code validFromRevision} of the indexed version. Stored. */
    public static final String REVISION = "revision";

    /** Display name and uid, neutral analyzer, stored. */
    public static final String TITLE = "title";

    /** Prose, language-neutral analyzer (folded). */
    public static final String TEXT = "text";

    /** Prose, German analyzer. */
    public static final String TEXT_DE = "text_de";

    /** Prose, English analyzer. */
    public static final String TEXT_EN = "text_en";

    /** Code (CDL, OCTL, processed text media), neutral analyzer only: no stemming on code. */
    public static final String SOURCE = "source";

    /** The plain text snippets are cut from: prose, then code, capped. Stored only. */
    public static final String SNIPPET_SOURCE = "snippetSource";

    /** The prose fields, each analyzed differently. */
    public static final List<String> PROSE = List.of(TEXT, TEXT_DE, TEXT_EN);

    /**
     * The prose field of one language (M24.3.3): {@code text_de} for {@code de} and {@code de-CH}, since
     * the analyzer is chosen by language, not by region. A language with no analyzer of its own indexes
     * into the neutral {@link #TEXT} field, which every query already searches.
     */
    public static String proseFor(String locale) {
        if (locale == null || locale.isBlank()) {
            return TEXT;
        }
        int dash = locale.indexOf('-');
        String language = (dash < 0 ? locale : locale.substring(0, dash)).toLowerCase(java.util.Locale.ROOT);
        String field = "text_" + language;
        return PROSE.contains(field) ? field : TEXT;
    }

    private SearchFields() {}
}
