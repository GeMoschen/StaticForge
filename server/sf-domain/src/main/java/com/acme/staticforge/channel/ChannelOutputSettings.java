package com.acme.staticforge.channel;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * The typed output-path configuration of one channel (spec §15.2 {@code output_channel.settings}
 * plus {@code file_extension}; §18.3 index handling): the single input {@link OutputPathExpander}
 * reads for the extension, the folder-index page, the directory form and the URL strategy.
 * Generation, the URL registry and preview all resolve it through {@link ChannelService}.
 *
 * <p>Two related names are easy to mix up: {@code indexUid} is the <em>page UID</em> that becomes
 * a folder's index page; {@code indexFileName} is the <em>file name</em> that index is written
 * to. An index page's {@code {uid}} placeholder expands to the file name's stem, and the PRETTY
 * directory form writes {@code about.html} as {@code about/<indexFileName>}.
 *
 * <p>Parsing ({@link #of}) is lenient, because channels also arrive through project import,
 * which bypasses {@link ChannelService}: a missing or unusable value falls back to its default.
 * {@link #validate} is the strict check applied on channel create/update. Unknown settings keys
 * ({@code prettyPrint}, {@code minify}, …) are neither read nor rejected here.
 *
 * @param extension the {@code {ext}} placeholder value, without a dot
 * @param indexUid the page UID rendered as the folder index
 * @param indexFileName the folder index file name, e.g. {@code index.html}
 * @param urlStrategy how page URLs are formed
 * @param trailingSlash with {@link UrlStrategy#PRETTY}, write pages as directories and link to
 *     them with a trailing slash; has no effect with {@link UrlStrategy#RELATIVE}
 */
public record ChannelOutputSettings(
        String extension, String indexUid, String indexFileName, UrlStrategy urlStrategy, boolean trailingSlash) {

    /** The default {@code indexUid}; a page with this UID renders as the folder index. */
    public static final String DEFAULT_INDEX_UID = "index";

    /** Settings key for {@link #indexUid}. */
    public static final String KEY_INDEX_UID = "indexUid";
    /** Settings key for {@link #indexFileName}. */
    public static final String KEY_INDEX_FILE_NAME = "indexFileName";
    /** Settings key for {@link #urlStrategy}. */
    public static final String KEY_URL_STRATEGY = "urlStrategy";
    /** Settings key for {@link #trailingSlash}. */
    public static final String KEY_TRAILING_SLASH = "trailingSlash";

    private static final String DEFAULT_INDEX_STEM = "index";
    private static final Pattern EXTENSION_PATTERN = Pattern.compile("[a-z0-9]{1,10}");
    private static final Pattern INDEX_FILE_NAME_PATTERN = Pattern.compile("[A-Za-z0-9._-]{1,64}");

    /** URL strategy (spec §15.2 {@code urlStrategy}). */
    public enum UrlStrategy {
        /** Pages are files ({@code about.html}); links point at the file. */
        RELATIVE,
        /** With {@code trailingSlash}, pages are directories ({@code about/index.html}) linked as {@code about/}. */
        PRETTY
    }

    /** A field-addressed validation finding from {@link #validate}. */
    public record FieldError(String field, String message) {}

    public ChannelOutputSettings {
        extension = isBlank(extension) ? "html" : extension;
        indexUid = isBlank(indexUid) ? DEFAULT_INDEX_UID : indexUid;
        indexFileName = isBlank(indexFileName) ? DEFAULT_INDEX_STEM + "." + extension : indexFileName;
        urlStrategy = urlStrategy == null ? UrlStrategy.RELATIVE : urlStrategy;
    }

    /** The settings a channel without any configuration gets (also the fallback for an unknown channel key). */
    public static ChannelOutputSettings defaults(String channelKey) {
        return new ChannelOutputSettings(extensionForChannel(channelKey), null, null, null, false);
    }

    /** Parses a channel's {@code fileExtension} and {@code settings}, falling back to defaults per value. */
    public static ChannelOutputSettings of(OutputChannel channel) {
        return of(channel.getKey(), channel.getFileExtension(), channel.getSettings());
    }

    /** Parses {@code fileExtension} and {@code settings} for {@code channelKey}, falling back to defaults per value. */
    public static ChannelOutputSettings of(String channelKey, String fileExtension, JsonNode settings) {
        String extension = fileExtension == null ? "" : fileExtension.trim();
        if (!EXTENSION_PATTERN.matcher(extension).matches()) {
            extension = extensionForChannel(channelKey);
        }
        JsonNode node = settings != null && settings.isObject() ? settings : null;
        String indexFileName = text(node, KEY_INDEX_FILE_NAME);
        if (indexFileName != null && !INDEX_FILE_NAME_PATTERN.matcher(indexFileName).matches()) {
            indexFileName = null;
        }
        UrlStrategy strategy = parseStrategy(text(node, KEY_URL_STRATEGY));
        boolean trailingSlash = node != null && node.path(KEY_TRAILING_SLASH).asBoolean(false);
        return new ChannelOutputSettings(extension, text(node, KEY_INDEX_UID), indexFileName, strategy, trailingSlash);
    }

    /**
     * Strict validation for channel create/update. Blank or absent values are allowed (they fall
     * back to defaults); present values must be well-formed. Field names are the request's JSON
     * paths ({@code fileExtension}, {@code settings.urlStrategy}, …).
     */
    public static List<FieldError> validate(String fileExtension, JsonNode settings) {
        List<FieldError> errors = new ArrayList<>();
        if (!isBlank(fileExtension) && !EXTENSION_PATTERN.matcher(fileExtension).matches()) {
            errors.add(new FieldError("fileExtension", "must match [a-z0-9]{1,10}"));
        }
        if (settings == null || settings.isNull()) {
            return errors;
        }
        if (!settings.isObject()) {
            errors.add(new FieldError("settings", "must be a JSON object"));
            return errors;
        }
        JsonNode strategy = settings.get(KEY_URL_STRATEGY);
        if (isPresent(strategy) && (!strategy.isTextual() || !isStrategyName(strategy.asText()))) {
            errors.add(new FieldError("settings." + KEY_URL_STRATEGY, "must be one of RELATIVE, PRETTY"));
        }
        JsonNode indexFileName = settings.get(KEY_INDEX_FILE_NAME);
        if (isPresent(indexFileName)
                && (!indexFileName.isTextual() || !INDEX_FILE_NAME_PATTERN.matcher(indexFileName.asText()).matches())) {
            errors.add(new FieldError("settings." + KEY_INDEX_FILE_NAME, "must match [A-Za-z0-9._-]{1,64}"));
        }
        JsonNode indexUid = settings.get(KEY_INDEX_UID);
        if (isPresent(indexUid) && !indexUid.isTextual()) {
            errors.add(new FieldError("settings." + KEY_INDEX_UID, "must be a string"));
        }
        JsonNode trailingSlash = settings.get(KEY_TRAILING_SLASH);
        if (isPresent(trailingSlash) && !trailingSlash.isBoolean()) {
            errors.add(new FieldError("settings." + KEY_TRAILING_SLASH, "must be a boolean"));
        }
        return errors;
    }

    /** The file extension a channel key implies when no {@code fileExtension} is set (markdown→md, else the key). */
    public static String extensionForChannel(String channelKey) {
        if ("markdown".equals(channelKey)) {
            return "md";
        }
        return isBlank(channelKey) ? "html" : channelKey;
    }

    /** {@code true} when pages are written as directories and linked with a trailing slash. */
    public boolean directoryUrls() {
        return urlStrategy == UrlStrategy.PRETTY && trailingSlash;
    }

    /** {@link #indexFileName} without its last extension ({@code index.html} → {@code index}). */
    public String indexStem() {
        int dot = indexFileName.lastIndexOf('.');
        return dot > 0 ? indexFileName.substring(0, dot) : indexFileName;
    }

    private static UrlStrategy parseStrategy(String value) {
        if (value == null) {
            return null;
        }
        String name = value.trim().toUpperCase(Locale.ROOT);
        return isStrategyName(name) ? UrlStrategy.valueOf(name) : null;
    }

    private static boolean isStrategyName(String value) {
        for (UrlStrategy strategy : UrlStrategy.values()) {
            if (strategy.name().equals(value)) {
                return true;
            }
        }
        return false;
    }

    private static String text(JsonNode node, String key) {
        if (node == null) {
            return null;
        }
        JsonNode value = node.get(key);
        return value != null && value.isTextual() && !value.asText().isBlank() ? value.asText().trim() : null;
    }

    private static boolean isPresent(JsonNode value) {
        return value != null && !value.isNull() && !(value.isTextual() && value.asText().isBlank());
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
