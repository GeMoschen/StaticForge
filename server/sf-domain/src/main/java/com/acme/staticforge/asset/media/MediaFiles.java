package com.acme.staticforge.asset.media;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The files of a media payload per locale (M27.3.1, epic decision 18) — the single helper every locale-aware reader
 * uses.
 *
 * <p>A media payload without the {@code localized} flag holds one file in its top-level fields ({@link #FILE_FIELDS}).
 * A localized payload keeps the default locale's file there too, so every reader that doesn't care about locales
 * reads the default file unchanged, and adds {@code localeFiles: {locale: {…file fields…}}} for the other locales
 * that have their own file. {@code fileLocale} names the locale the top-level file belongs to (the default locale
 * when the media was localized), so a later change of the project's default locale doesn't hand that file to
 * another language. A locale without its own file falls back along its chain ({@code LocaleConfig#effectiveChain}),
 * which always ends with the default locale; the top-level file is the last resort.
 *
 * <p>Pure: no repository access.
 */
public final class MediaFiles {

    /** The payload flag that makes a media asset hold one file per locale. */
    public static final String LOCALIZED = "localized";

    /** The locale that owns the top-level file of a localized payload. */
    public static final String FILE_LOCALE = "fileLocale";

    /** The per-locale files of a localized payload, keyed by locale. */
    public static final String LOCALE_FILES = "localeFiles";

    /** The fields that describe one file; everything else in a media payload is metadata shared by every file. */
    public static final List<String> FILE_FIELDS =
            List.of("blobSha256", "fileName", "mimeType", "sizeBytes", "image", "variants", TextMediaTypes.PROCESS_FLAG);

    private MediaFiles() {}

    /** {@code true} for a payload flagged {@code localized}; absent means {@code false} (every media before M27.3.1). */
    public static boolean isLocalized(JsonNode payload) {
        return payload != null && payload.path(LOCALIZED).asBoolean(false);
    }

    /**
     * The locale the top-level file belongs to: {@code fileLocale}, else the last entry of {@code chain} (the default
     * locale); {@code null} for a payload that isn't localized or a chain that is empty.
     */
    public static String topLocale(JsonNode payload, List<String> chain) {
        if (!isLocalized(payload)) {
            return null;
        }
        String recorded = payload.path(FILE_LOCALE).asText(null);
        if (recorded != null && !recorded.isBlank()) {
            return recorded;
        }
        return chain == null || chain.isEmpty() ? null : chain.get(chain.size() - 1);
    }

    /**
     * The file {@code locale} renders, resolved along {@code chain} (its effective fallback chain, {@code locale}
     * first). A payload that isn't localized has one file for every locale.
     */
    public static Resolved fileFor(JsonNode payload, String locale, List<String> chain) {
        if (!isLocalized(payload)) {
            return new Resolved(null, topFile(payload), true);
        }
        String top = topLocale(payload, chain);
        JsonNode files = payload.path(LOCALE_FILES);
        for (String candidate : chain == null ? List.<String>of() : chain) {
            if (candidate.equals(top)) {
                return new Resolved(candidate, topFile(payload), candidate.equals(locale));
            }
            JsonNode own = files.get(candidate);
            if (own != null && own.isObject()) {
                return new Resolved(candidate, own, candidate.equals(locale));
            }
        }
        return new Resolved(top, topFile(payload), top != null && top.equals(locale));
    }

    /**
     * {@code payload} as {@code locale} renders it: the top-level file fields replaced by the resolved file, the
     * metadata unchanged. What a reader that only knows the top-level fields (binary serving, the ASSETS stage, text
     * media rendering) reads for one locale. Returns {@code payload} itself when nothing changes.
     */
    public static JsonNode effective(JsonNode payload, String locale, List<String> chain) {
        if (!isLocalized(payload)) {
            return payload;
        }
        Resolved resolved = fileFor(payload, locale, chain);
        if (resolved.locale() != null && resolved.locale().equals(topLocale(payload, chain))) {
            return payload;
        }
        ObjectNode copy = ((ObjectNode) payload).deepCopy();
        setFile(copy, resolved.file());
        return copy;
    }

    /** The top-level file of {@code payload} as its own object (only the file fields). */
    public static ObjectNode topFile(JsonNode payload) {
        ObjectNode file = JsonNodeFactory.instance.objectNode();
        if (payload == null) {
            return file;
        }
        for (String field : FILE_FIELDS) {
            JsonNode value = payload.get(field);
            if (value != null) {
                file.set(field, value.deepCopy());
            }
        }
        return file;
    }

    /** Replaces the top-level file fields of {@code payload} with {@code file}'s (a field {@code file} lacks is removed). */
    public static void setFile(ObjectNode payload, JsonNode file) {
        for (String field : FILE_FIELDS) {
            JsonNode value = file == null ? null : file.get(field);
            if (value == null) {
                payload.remove(field);
            } else {
                payload.set(field, value.deepCopy());
            }
        }
    }

    /**
     * The locales that have their own file, in {@code locales} order, each with its file: the top-level file's
     * locale and every {@code localeFiles} entry. Entries for locales not in {@code locales} (a locale the project
     * removed) are left out.
     */
    public static Map<String, JsonNode> ownFiles(JsonNode payload, List<String> locales, List<String> defaultChain) {
        Map<String, JsonNode> out = new LinkedHashMap<>();
        if (!isLocalized(payload)) {
            return out;
        }
        String top = topLocale(payload, defaultChain);
        JsonNode files = payload.path(LOCALE_FILES);
        for (String locale : locales) {
            if (locale.equals(top)) {
                out.put(locale, topFile(payload));
            } else if (files.get(locale) != null && files.get(locale).isObject()) {
                out.put(locale, files.get(locale));
            }
        }
        return out;
    }

    /** The locales of {@code localeFiles}, in stored order. */
    public static List<String> localeFileKeys(JsonNode payload) {
        List<String> keys = new ArrayList<>();
        JsonNode files = payload == null ? null : payload.get(LOCALE_FILES);
        if (files != null && files.isObject()) {
            files.fieldNames().forEachRemaining(keys::add);
        }
        return keys;
    }

    /**
     * Sets {@code locale}'s own file in a localized {@code payload}: the top-level fields when {@code locale} owns them
     * ({@code topLocale}), else its {@code localeFiles} entry.
     */
    public static void putOwnFile(ObjectNode payload, String locale, String topLocale, JsonNode file) {
        if (locale.equals(topLocale)) {
            setFile(payload, file);
            return;
        }
        JsonNode files = payload.get(LOCALE_FILES);
        ObjectNode target = files instanceof ObjectNode object ? object : payload.putObject(LOCALE_FILES);
        target.set(locale, file.deepCopy());
    }

    /**
     * Restores {@code locale}'s own file of {@code draft} from {@code released} (discarding one locale's changes,
     * M27.1.2): the released own file where it had one, else none, so the locale falls back again. The top-level
     * file's locale is restored only when both payloads agree on it; a draft or released payload that isn't
     * localized is left as it is.
     */
    public static void restoreOwnFile(ObjectNode draft, JsonNode released, String locale, List<String> chain) {
        if (!isLocalized(draft) || !isLocalized(released)) {
            return;
        }
        String draftTop = topLocale(draft, chain);
        String releasedTop = topLocale(released, chain);
        if (locale.equals(draftTop)) {
            if (locale.equals(releasedTop)) {
                setFile(draft, topFile(released));
            }
            return;
        }
        JsonNode releasedOwn = locale.equals(releasedTop) ? topFile(released) : released.path(LOCALE_FILES).get(locale);
        if (releasedOwn != null && releasedOwn.isObject()) {
            putOwnFile(draft, locale, draftTop, releasedOwn);
        } else if (draft.get(LOCALE_FILES) instanceof ObjectNode files) {
            files.remove(locale);
        }
    }

    /**
     * One locale's file.
     *
     * @param locale the locale whose own file this is; {@code null} for a payload that isn't localized
     * @param file the file fields ({@link #FILE_FIELDS})
     * @param own whether the asked locale has this file itself rather than by fallback (always {@code true} for a
     *     payload that isn't localized)
     */
    public record Resolved(String locale, JsonNode file, boolean own) {

        /** The file's blob. */
        public String blobSha256() {
            return file == null ? null : file.path("blobSha256").asText(null);
        }

        /** The file's MIME type. */
        public String mimeType() {
            return file == null ? null : file.path("mimeType").asText(null);
        }
    }
}
