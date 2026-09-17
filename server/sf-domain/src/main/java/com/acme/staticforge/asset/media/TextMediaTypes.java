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
 * <p>Text is every {@code text/*} type, every structured {@code +json}/{@code +xml} type, and the
 * application types below. Tika reports specific subtypes from the name and the content — a
 * {@code robots.txt} starting with {@code User-agent:} is {@code text/x-robots}, {@code .md} is
 * {@code text/x-web-markdown}, {@code .rss} is {@code application/rss+xml} — so an exact list of types
 * silently hides the process toggle for ordinary text files (checked by {@code TextMediaTypesTest}).
 */
public final class TextMediaTypes {

    /** The media payload flag that opts a text file into OCTL processing. Absent reads as {@code false}. */
    public static final String PROCESS_FLAG = "processCms";

    /** The text media types outside {@code text/*} that carry no {@code +json}/{@code +xml} suffix. */
    private static final Set<String> APPLICATION_TEXT = Set.of(
            "application/javascript",
            "application/json",
            "application/xml",
            "application/yaml",
            "application/x-yaml");

    /** Types whose string literals an unescaped value can break out of (JS and JSON). */
    private static final Set<String> SCRIPT_LIKE = Set.of(
            "application/javascript", "text/javascript", "application/json", "application/manifest+json");

    private TextMediaTypes() {}

    /**
     * True when {@code mimeType} (parameters such as {@code ;charset=} ignored) is text media: {@code text/*}, a
     * {@code +json} or {@code +xml} type, or one of the textual application types.
     */
    public static boolean isText(String mimeType) {
        String type = normalize(mimeType);
        return type.startsWith("text/")
                || type.endsWith("+json")
                || type.endsWith("+xml")
                || APPLICATION_TEXT.contains(type);
    }

    /** True for JS/JSON types (any {@code +json} too), where an unescaped {@code $CMS_VALUE} can break a string literal. */
    public static boolean isScriptLike(String mimeType) {
        String type = normalize(mimeType);
        return SCRIPT_LIKE.contains(type) || type.endsWith("+json");
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
