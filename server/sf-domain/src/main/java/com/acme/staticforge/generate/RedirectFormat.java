package com.acme.staticforge.generate;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.EnumSet;
import java.util.Locale;
import java.util.Set;

/**
 * How a generation target publishes the redirects of a build (M30.5.1, epic decision 18), chosen per target in its
 * config ({@code "redirectFormats": ["HTML_STUB", "HTACCESS", "JSON"]}). Without the key a target writes HTML stubs —
 * the only format that works on every static host and for a ZIP opened locally; an empty array writes no redirect
 * output at all. The list is an enum so further host formats (nginx map, {@code _redirects}) can be added later.
 */
public enum RedirectFormat {
    /** A small HTML page at each old path: meta refresh, canonical link, script fallback and a visible link. */
    HTML_STUB,
    /** A marked block of {@code Redirect 301} lines in the site's {@code .htaccess} (Apache only). */
    HTACCESS,
    /** {@code redirects.json}: the machine-readable list, for a host or proxy that reads it. */
    JSON;

    /** The target config key. */
    public static final String CONFIG_KEY = "redirectFormats";

    /** What a target without the key writes. */
    public static final Set<RedirectFormat> DEFAULT = Set.of(HTML_STUB);

    /**
     * The formats {@code config} chooses — leniently, for building: without the key (or with a value that isn't an
     * array) the {@link #DEFAULT}; unknown names are ignored (a target is validated when it is saved).
     */
    public static Set<RedirectFormat> of(JsonNode config) {
        JsonNode node = config == null ? null : config.get(CONFIG_KEY);
        if (node == null || node.isNull() || !node.isArray()) {
            return DEFAULT;
        }
        Set<RedirectFormat> formats = EnumSet.noneOf(RedirectFormat.class);
        for (JsonNode item : node) {
            RedirectFormat format = item.isTextual() ? parse(item.asText()) : null;
            if (format != null) {
                formats.add(format);
            }
        }
        return Set.copyOf(formats);
    }

    /**
     * Checks {@code config}'s {@code redirectFormats} strictly (target create and update): absent or {@code null} is
     * the default; otherwise an array of distinct format names.
     *
     * @throws IllegalArgumentException with a user-facing message when it isn't
     */
    public static void validate(JsonNode config) {
        JsonNode node = config == null ? null : config.get(CONFIG_KEY);
        if (node == null || node.isNull()) {
            return;
        }
        if (!node.isArray()) {
            throw new IllegalArgumentException(CONFIG_KEY + " must be an array of HTML_STUB, HTACCESS and JSON.");
        }
        Set<RedirectFormat> seen = EnumSet.noneOf(RedirectFormat.class);
        for (JsonNode item : node) {
            RedirectFormat format = item.isTextual() ? parse(item.asText()) : null;
            if (format == null) {
                throw new IllegalArgumentException(
                        "Unknown redirect format " + item + "; use HTML_STUB, HTACCESS or JSON.");
            }
            if (!seen.add(format)) {
                throw new IllegalArgumentException("Redirect format " + format + " is listed twice.");
            }
        }
    }

    private static RedirectFormat parse(String name) {
        try {
            return valueOf(name.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
