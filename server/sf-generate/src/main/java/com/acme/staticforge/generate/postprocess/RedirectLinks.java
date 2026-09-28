package com.acme.staticforge.generate.postprocess;

import com.acme.staticforge.channel.ChannelOutputSettings;
import com.acme.staticforge.generate.render.SiteLinks;
import com.acme.staticforge.redirect.RedirectPaths;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;

/**
 * How a redirect's paths become URLs in the redirect formats (M30.5.1). Registry paths are decoded output paths
 * ({@code old page & more.html}, {@code docs/über.html}); links are percent-encoded per segment, in the form the channel
 * links its pages (a directory {@code about/} instead of {@code about/index.html} with pretty URLs and a trailing
 * slash), and a fixed target keeps its query and fragment. Absolute {@code http(s)} targets are used as they are.
 */
final class RedirectLinks {

    /** The status every redirect is published with. */
    static final int STATUS = 301;

    private static final char[] HEX = "0123456789ABCDEF".toCharArray();

    private RedirectLinks() {}

    /** Whether {@code target} is an absolute URL rather than an output path of the site. */
    static boolean isAbsolute(String target) {
        return RedirectPaths.isAbsoluteUrl(target);
    }

    /** {@code target}'s query and fragment ({@code ?a=1#top}); {@code ""} for none. */
    static String suffix(String target) {
        String path = RedirectPaths.pathOf(target);
        return path == null ? "" : target.substring(path.length());
    }

    /** Whether {@code target} names a fragment of its page. */
    static boolean hasFragment(String target) {
        return !isAbsolute(target) && suffix(target).contains("#");
    }

    /**
     * An output path as the channel links it: with pretty URLs and a trailing slash, the index file becomes its
     * directory ({@code about/index.html} → {@code about/}, {@code index.html} → {@code ""}, the site root).
     */
    static String linkPath(String outputPath, ChannelOutputSettings settings) {
        if (!settings.directoryUrls()) {
            return outputPath;
        }
        String index = settings.indexFileName();
        if (outputPath.equals(index)) {
            return "";
        }
        return outputPath.endsWith("/" + index) ? outputPath.substring(0, outputPath.length() - index.length()) : outputPath;
    }

    /**
     * The link from the stub at {@code fromPath} to {@code target}, relative to the stub's own path (lessons
     * 2026-09-15); an absolute URL as it is.
     */
    static String relative(String fromPath, String target, ChannelOutputSettings settings) {
        if (isAbsolute(target)) {
            return target;
        }
        String link = linkPath(RedirectPaths.pathOf(target), settings);
        return encodePath(SiteLinks.relativeUrl(fromPath, link.isEmpty() ? "./" : link)) + suffix(target);
    }

    /**
     * The absolute URL of {@code target} under {@code baseUrl}; an absolute target as it is; {@code null} when the target
     * has no {@code baseUrl}.
     */
    static String absolute(String baseUrl, String target, ChannelOutputSettings settings) {
        if (isAbsolute(target)) {
            return target;
        }
        if (baseUrl == null || baseUrl.isBlank()) {
            return null;
        }
        return PostProcessSupport.url(baseUrl, encodePath(linkPath(RedirectPaths.pathOf(target), settings)))
                + suffix(target);
    }

    /**
     * The URL path visitors request for {@code outputPath}: {@code /} + its link path, below the path of
     * {@code baseUrl} when it has one ({@code https://example.com/docs} → {@code /docs/…}).
     *
     * @param encoded percent-encode it (a URL to send); otherwise decoded (what Apache matches a request against)
     */
    static String urlPath(String baseUrl, String outputPath, ChannelOutputSettings settings, boolean encoded) {
        String link = linkPath(outputPath, settings);
        return basePath(baseUrl, encoded) + "/" + (encoded ? encodePath(link) : link);
    }

    /** The path of {@code baseUrl} without its trailing slash ({@code /docs}); {@code ""} for none. */
    static String basePath(String baseUrl, boolean encoded) {
        if (baseUrl == null || baseUrl.isBlank()) {
            return "";
        }
        String path;
        try {
            URI uri = new URI(baseUrl.trim());
            path = encoded ? uri.getRawPath() : uri.getPath();
        } catch (URISyntaxException e) {
            return "";
        }
        if (path == null) {
            return "";
        }
        while (path.endsWith("/")) {
            path = path.substring(0, path.length() - 1);
        }
        return path.isEmpty() || path.startsWith("/") ? path : "/" + path;
    }

    /**
     * Percent-encodes each segment of a relative or site path as UTF-8, keeping {@code /} and the characters that are
     * safe unquoted in a path, an HTML attribute, a refresh URL and an Apache directive: letters, digits and
     * {@code - . _ ~ ! $ & + , ; = : @}. A space, a quote and everything else are encoded.
     */
    static String encodePath(String path) {
        StringBuilder out = new StringBuilder(path.length() + 16);
        for (byte b : path.getBytes(StandardCharsets.UTF_8)) {
            int c = b & 0xff;
            if (c == '/' || isSafe(c)) {
                out.append((char) c);
            } else {
                out.append('%').append(HEX[c >> 4]).append(HEX[c & 0xf]);
            }
        }
        return out.toString();
    }

    private static boolean isSafe(int c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                || "-._~!$&+,;=:@".indexOf(c) >= 0;
    }

    /** Escapes {@code value} for an HTML attribute value or text. */
    static String html(String value) {
        StringBuilder out = new StringBuilder(value.length() + 16);
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '&' -> out.append("&amp;");
                case '<' -> out.append("&lt;");
                case '>' -> out.append("&gt;");
                case '"' -> out.append("&quot;");
                case '\'' -> out.append("&#39;");
                default -> out.append(c);
            }
        }
        return out.toString();
    }

    /**
     * {@code value} as a JavaScript string literal inside a {@code <script>} element: JSON-escaped, and {@code <}
     * escaped as well so no {@code </script>} can end the element early.
     */
    static String jsString(String value) {
        try {
            return PostProcessSupport.json.writeValueAsString(value).replace("<", "\\u003c");
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException("Could not encode a string", e);
        }
    }
}
