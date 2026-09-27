package com.acme.staticforge.redirect;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Normalizes and validates the paths of a redirect (M30.4.1, epic decision 19: {@code SF-DOM-0193}). Registry paths
 * are <em>output paths</em> as a build manifest stores them — {@code products/hammer.html}, {@code de/about/index.html}:
 * no leading slash, no {@code .} or empty segments, no {@code ..}, no scheme, percent-decoded. A path that names a
 * directory ({@code old/}, {@code /}) means that directory's index file in the channel ({@code old/index.html}).
 *
 * <p>A target may also be an absolute {@code http(s)} URL, kept as given, and a target path may carry a query and a
 * fragment ({@code docs/api.html#auth}). Every other scheme ({@code javascript:}, {@code data:}, {@code mailto:}, …)
 * and a protocol-relative {@code //host} is refused.
 */
public final class RedirectPaths {

    /** The longest source path (the column holds 1000 characters). */
    public static final int MAX_PATH_LENGTH = 1000;

    /** The longest target (the column holds 2000 characters). */
    public static final int MAX_TARGET_LENGTH = 2000;

    private static final Pattern SCHEME = Pattern.compile("^[A-Za-z][A-Za-z0-9+.-]*:");
    private static final Pattern HTTP = Pattern.compile("^(?i)https?://.*");

    private RedirectPaths() {}

    /**
     * The normalized source output path of {@code raw}; a directory path gets {@code indexFileName}. Throws
     * {@code 422 SF-DOM-0193} naming {@code field} when it isn't a path of the site.
     */
    public static String source(String raw, String indexFileName, String field) {
        if (raw == null || raw.isBlank()) {
            throw RedirectProblems.invalid("The source path is required.", field);
        }
        String value = raw.trim();
        if (value.indexOf('?') >= 0 || value.indexOf('#') >= 0) {
            throw RedirectProblems.invalid("A source path has no query or fragment: '" + raw + "'.", field);
        }
        String path = path(value, indexFileName, field);
        if (path.length() > MAX_PATH_LENGTH) {
            throw RedirectProblems.invalid("The source path is longer than " + MAX_PATH_LENGTH + " characters.", field);
        }
        return path;
    }

    /**
     * The normalized target {@code raw}: an absolute {@code http(s)} URL as given, or an output path (a directory path
     * gets {@code indexFileName}) with its query and fragment kept. Throws {@code 422 SF-DOM-0193} naming {@code field}
     * otherwise.
     */
    public static String target(String raw, String indexFileName, String field) {
        if (raw == null || raw.isBlank()) {
            throw RedirectProblems.invalid("The target path is required.", field);
        }
        String value = raw.trim();
        String normalized;
        if (HTTP.matcher(value).matches()) {
            normalized = absoluteUrl(value, field);
        } else {
            int suffixAt = firstOf(value, '?', '#');
            String pathPart = suffixAt < 0 ? value : value.substring(0, suffixAt);
            String suffix = suffixAt < 0 ? "" : value.substring(suffixAt);
            if (pathPart.isEmpty()) {
                throw RedirectProblems.invalid("The target needs a path before its query or fragment: '" + raw + "'.", field);
            }
            if (suffix.chars().anyMatch(c -> Character.isISOControl(c) || Character.isWhitespace(c))) {
                throw RedirectProblems.invalid("The target's query or fragment contains spaces or control characters.", field);
            }
            normalized = path(pathPart, indexFileName, field) + suffix;
        }
        if (normalized.length() > MAX_TARGET_LENGTH) {
            throw RedirectProblems.invalid("The target is longer than " + MAX_TARGET_LENGTH + " characters.", field);
        }
        return normalized;
    }

    /** Whether a normalized target is an absolute URL rather than an output path. */
    public static boolean isAbsoluteUrl(String target) {
        return target != null && HTTP.matcher(target).matches();
    }

    /** The output path of a normalized target without query and fragment; {@code null} for an absolute URL. */
    public static String pathOf(String target) {
        if (target == null || isAbsoluteUrl(target)) {
            return null;
        }
        int suffixAt = firstOf(target, '?', '#');
        return suffixAt < 0 ? target : target.substring(0, suffixAt);
    }

    private static String path(String value, String indexFileName, String field) {
        if (value.startsWith("//")) {
            throw RedirectProblems.invalid("A path can't start with '//' (that names another host): '" + value + "'.", field);
        }
        if (SCHEME.matcher(value).find()) {
            throw RedirectProblems.invalid(
                    "Only paths of the site and absolute http(s) URLs are allowed, not '" + value + "'.", field);
        }
        if (value.indexOf('\\') >= 0 || value.chars().anyMatch(Character::isISOControl)) {
            throw RedirectProblems.invalid("A path can't contain backslashes or control characters: '" + value + "'.", field);
        }
        String decoded = percentDecode(value, field);
        if (decoded.indexOf('\\') >= 0 || decoded.chars().anyMatch(Character::isISOControl)) {
            throw RedirectProblems.invalid("A path can't contain backslashes or control characters: '" + value + "'.", field);
        }
        boolean directory = decoded.endsWith("/") || decoded.isEmpty();
        List<String> segments = new ArrayList<>();
        for (String segment : decoded.split("/")) {
            if (segment.isEmpty() || segment.equals(".")) {
                continue;
            }
            if (segment.equals("..")) {
                throw RedirectProblems.invalid("A path can't leave the site with '..': '" + value + "'.", field);
            }
            if (segment.isBlank()) {
                throw RedirectProblems.invalid("A path segment can't be blank: '" + value + "'.", field);
            }
            segments.add(segment);
        }
        if (directory || segments.isEmpty()) {
            segments.add(indexFileName);
        }
        return String.join("/", segments);
    }

    /** Decodes {@code %XX} escapes as UTF-8 ({@code +} stays a plus: this is a path, not a form). */
    private static String percentDecode(String value, String field) {
        if (value.indexOf('%') < 0) {
            return value;
        }
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        StringBuilder out = new StringBuilder();
        int i = 0;
        while (i < value.length()) {
            char c = value.charAt(i);
            if (c == '%') {
                if (i + 2 >= value.length() || hex(value.charAt(i + 1)) < 0 || hex(value.charAt(i + 2)) < 0) {
                    throw RedirectProblems.invalid("Invalid percent-encoding in '" + value + "'.", field);
                }
                bytes.write(hex(value.charAt(i + 1)) * 16 + hex(value.charAt(i + 2)));
                i += 3;
                continue;
            }
            flush(bytes, out, value, field);
            out.append(c);
            i++;
        }
        flush(bytes, out, value, field);
        return out.toString();
    }

    private static void flush(ByteArrayOutputStream bytes, StringBuilder out, String value, String field) {
        if (bytes.size() == 0) {
            return;
        }
        try {
            out.append(StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes.toByteArray())));
        } catch (CharacterCodingException e) {
            throw RedirectProblems.invalid("Invalid percent-encoding in '" + value + "' (not UTF-8).", field);
        }
        bytes.reset();
    }

    private static int hex(char c) {
        return Character.digit(c, 16);
    }

    private static String absoluteUrl(String value, String field) {
        if (value.chars().anyMatch(c -> Character.isISOControl(c) || Character.isWhitespace(c))) {
            throw RedirectProblems.invalid("A URL can't contain spaces or control characters: '" + value + "'.", field);
        }
        try {
            URI uri = new URI(value);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            if (!scheme.equals("http") && !scheme.equals("https") || uri.getHost() == null || uri.getHost().isBlank()) {
                throw RedirectProblems.invalid("Not an absolute http(s) URL with a host: '" + value + "'.", field);
            }
        } catch (URISyntaxException e) {
            throw RedirectProblems.invalid("Not a valid URL: '" + value + "'.", field);
        }
        return value;
    }

    private static int firstOf(String value, char a, char b) {
        int i = value.indexOf(a);
        int j = value.indexOf(b);
        if (i < 0) {
            return j;
        }
        return j < 0 ? i : Math.min(i, j);
    }
}
