package com.acme.staticforge.asset.media;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Locale;
import java.util.Set;

/**
 * The single source of truth for which media files are <em>text</em> (M18.1.1): only these can have
 * {@link #PROCESS_FLAG} switched on, be read and written as text, and show the process toggle in the
 * UI. Independent of the upload allow-list ({@code sf.media.allowed-mime}), which decides what may be
 * uploaded at all.
 *
 * <p>The types are what Tika actually reports for real files (checked by {@code TextMediaTypesTest}):
 * detection is driven by the file name, so {@code .js} is {@code application/javascript} and
 * {@code .webmanifest} is {@code application/manifest+json}.
 */
public final class TextMediaTypes {

    /** The media payload flag that opts a text file into OCTL processing. Absent reads as {@code false}. */
    public static final String PROCESS_FLAG = "processCms";

    /** Every MIME type that counts as text media. */
    public static final Set<String> ALL = Set.of(
            "text/css",
            "application/javascript",
            "text/javascript",
            "application/json",
            "application/manifest+json",
            "image/svg+xml",
            "text/plain",
            "application/xml",
            "text/xml");

    /** Types whose string literals an unescaped value can break out of (JS and JSON). */
    private static final Set<String> SCRIPT_LIKE = Set.of(
            "application/javascript", "text/javascript", "application/json", "application/manifest+json");

    private TextMediaTypes() {}

    /** True when {@code mimeType} (parameters such as {@code ;charset=} ignored) is text media. */
    public static boolean isText(String mimeType) {
        return ALL.contains(normalize(mimeType));
    }

    /** True for JS/JSON types, where an unescaped {@code $CMS_VALUE} can break a string literal. */
    public static boolean isScriptLike(String mimeType) {
        return SCRIPT_LIKE.contains(normalize(mimeType));
    }

    /** True when a media payload has {@link #PROCESS_FLAG} on and a text MIME type. */
    public static boolean isProcessed(JsonNode payload) {
        return payload != null
                && payload.path(PROCESS_FLAG).asBoolean(false)
                && isText(payload.path("mimeType").asText(null));
    }

    private static String normalize(String mimeType) {
        if (mimeType == null) {
            return "";
        }
        int semicolon = mimeType.indexOf(';');
        String bare = semicolon < 0 ? mimeType : mimeType.substring(0, semicolon);
        return bare.trim().toLowerCase(Locale.ROOT);
    }
}
