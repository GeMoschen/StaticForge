package com.acme.staticforge.generate.quality;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Resolves a URL written in an output against the build (M30.1.1, epic decision 1): internal references become a site
 * path, everything else is skipped. No network access, ever.
 *
 * <ul>
 *   <li><b>relative</b> ({@code ../a.html}, {@code img/x.png}): against the directory of the output's own path —
 *       generated links are page-relative;</li>
 *   <li><b>root-relative</b> ({@code /a.html}): against the host root; with a {@code baseUrl} that has a path
 *       ({@code https://example.com/docs}) only paths under it are in the site;</li>
 *   <li><b>absolute</b> {@code http(s)} (and protocol-relative {@code //host/…}): internal only when it points at the
 *       target's {@code baseUrl} — the same host (case-insensitively, {@code http} and {@code https} alike) and a path
 *       under the base path;</li>
 *   <li>every other scheme ({@code mailto:}, {@code tel:}, {@code data:}, {@code javascript:}) and every external URL
 *       resolves to {@code null}, as does a path that escapes the site root with {@code ..}.</li>
 * </ul>
 * The path is percent-decoded and {@code ./}/{@code ../} normalized; the {@code ?query} is ignored; a path ending in
 * {@code /} (a pretty URL, or the site root) resolves to the channel's index file ({@code indexFileName}, §18.3).
 *
 * <p>Immutable and thread-safe.
 */
public final class LinkResolver {

    private static final Pattern SCHEME = Pattern.compile("^[A-Za-z][A-Za-z0-9+.-]*:");

    /** The base URL's authority ({@code host[:port]}), lower case; {@code null} without a usable base URL. */
    private final String baseAuthority;
    private final String basePath;
    private final String baseScheme;
    private final String indexFileName;

    /**
     * @param baseUrl the target's {@code baseUrl}; blank when it has none (then no absolute URL is internal)
     * @param indexFileName the file a directory URL serves ({@code index.html})
     */
    public LinkResolver(String baseUrl, String indexFileName) {
        this.indexFileName = indexFileName == null || indexFileName.isBlank() ? "index.html" : indexFileName;
        String base = baseUrl == null ? "" : baseUrl.trim();
        int schemeEnd = base.indexOf("://");
        if (base.isEmpty() || schemeEnd <= 0 || !SCHEME.matcher(base).lookingAt()) {
            this.baseAuthority = null;
            this.basePath = "";
            this.baseScheme = null;
            return;
        }
        int pathStart = firstOf(base, schemeEnd + 3, "/?#");
        this.baseScheme = base.substring(0, schemeEnd).toLowerCase(Locale.ROOT);
        this.baseAuthority = base.substring(schemeEnd + 3, pathStart).toLowerCase(Locale.ROOT);
        String path = base.substring(pathStart);
        int end = firstOf(path, 0, "?#");
        this.basePath = trimSlashes(decode(path.substring(0, end)));
    }

    /** A resolved reference: the site path and the decoded fragment ({@code null} when there is none). */
    public record Target(String path, String fragment) {}

    /**
     * Resolves {@code raw} as written in the output at {@code fromPath}.
     *
     * @return the target, or {@code null} when the URL is external, another scheme, empty, or escapes the site root
     */
    public Target resolve(String fromPath, String raw) {
        if (raw == null) {
            return null;
        }
        String url = raw.strip();
        if (url.isEmpty()) {
            return null;
        }
        String fragment = null;
        int hash = url.indexOf('#');
        if (hash >= 0) {
            fragment = decode(url.substring(hash + 1));
            url = url.substring(0, hash);
        }
        int query = url.indexOf('?');
        if (query >= 0) {
            url = url.substring(0, query);
        }

        List<String> segments;
        if (url.startsWith("//")) {
            return baseScheme == null ? null : fromSiteUrl(baseScheme + ":" + url, fragment);
        } else if (SCHEME.matcher(url).lookingAt()) {
            return fromSiteUrl(url, fragment);
        } else if (url.startsWith("/")) {
            segments = underBasePath(url);
            if (segments == null) {
                return null;
            }
        } else {
            segments = directorySegments(fromPath);
            if (url.isEmpty()) {
                // "#top" or "?page=2": the output itself.
                return new Target(normalizedFromPath(fromPath), fragment);
            }
            segments.addAll(split(url));
        }
        boolean directory = url.endsWith("/") || url.endsWith("/.") || url.endsWith("/..") || url.equals(".")
                || url.equals("..");
        String path = normalize(segments, directory);
        return path == null ? null : new Target(path, fragment);
    }

    /** An absolute {@code http(s)} URL: internal only under the {@code baseUrl}. */
    private Target fromSiteUrl(String url, String fragment) {
        if (baseAuthority == null) {
            return null;
        }
        int schemeEnd = url.indexOf("://");
        if (schemeEnd <= 0) {
            return null;
        }
        String scheme = url.substring(0, schemeEnd).toLowerCase(Locale.ROOT);
        if (!scheme.equals("http") && !scheme.equals("https")) {
            return null;
        }
        int pathStart = firstOf(url, schemeEnd + 3, "/");
        if (!url.substring(schemeEnd + 3, pathStart).toLowerCase(Locale.ROOT).equals(baseAuthority)) {
            return null;
        }
        String path = url.substring(pathStart);
        List<String> segments = underBasePath(path.isEmpty() ? "/" : path);
        if (segments == null) {
            return null;
        }
        boolean directory = path.isEmpty() || path.endsWith("/");
        String resolved = normalize(segments, directory);
        return resolved == null ? null : new Target(resolved, fragment);
    }

    /** The segments of host-root path {@code url} below the base path; {@code null} when it lies outside it. */
    private List<String> underBasePath(String url) {
        List<String> all = split(url);
        if (basePath.isEmpty()) {
            return all;
        }
        // Normalize first, so /docs/../docs/a.html is still under /docs.
        List<String> normalized = normalizeSegments(all);
        if (normalized == null) {
            return null;
        }
        List<String> base = split(basePath);
        if (normalized.size() < base.size() || !normalized.subList(0, base.size()).equals(base)) {
            return null;
        }
        return new ArrayList<>(normalized.subList(base.size(), normalized.size()));
    }

    /** The decoded segments of a URL path (empty segments dropped). */
    private static List<String> split(String path) {
        List<String> segments = new ArrayList<>();
        for (String segment : path.split("/", -1)) {
            if (!segment.isEmpty()) {
                segments.add(decode(segment));
            }
        }
        return segments;
    }

    /** {@code segments} normalized and joined, the index file appended for a directory; {@code null} when escaping. */
    private String normalize(List<String> segments, boolean directory) {
        List<String> normalized = normalizeSegments(segments);
        if (normalized == null) {
            return null;
        }
        if (directory || normalized.isEmpty()) {
            normalized.add(indexFileName);
        }
        return String.join("/", normalized);
    }

    /** Applies {@code .} and {@code ..}; {@code null} when a {@code ..} climbs above the root. */
    private static List<String> normalizeSegments(List<String> segments) {
        List<String> out = new ArrayList<>(segments.size());
        for (String segment : segments) {
            if (segment.equals(".")) {
                continue;
            }
            if (segment.equals("..")) {
                if (out.isEmpty()) {
                    return null;
                }
                out.remove(out.size() - 1);
                continue;
            }
            out.add(segment);
        }
        return out;
    }

    /** The folder segments of an output path: {@code pf/pf1/p3.html} gives {@code [pf, pf1]}. */
    private static List<String> directorySegments(String fromPath) {
        List<String> segments = new ArrayList<>();
        if (fromPath == null) {
            return segments;
        }
        String[] parts = fromPath.replace('\\', '/').split("/");
        for (int i = 0; i < parts.length - 1; i++) {
            if (!parts[i].isEmpty()) {
                segments.add(parts[i]);
            }
        }
        return segments;
    }

    private static String normalizedFromPath(String fromPath) {
        String path = fromPath == null ? "" : fromPath.replace('\\', '/');
        while (path.startsWith("/")) {
            path = path.substring(1);
        }
        return path;
    }

    /**
     * Percent-decodes {@code value} as UTF-8. A {@code %} not followed by two hex digits stays as written; {@code +}
     * stays a plus (URL paths, not form data).
     */
    static String decode(String value) {
        if (value.indexOf('%') < 0) {
            return value;
        }
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(value.length());
        StringBuilder out = new StringBuilder(value.length());
        int i = 0;
        while (i < value.length()) {
            char c = value.charAt(i);
            if (c == '%' && isHex(value, i + 1) && isHex(value, i + 2)) {
                bytes.write(Integer.parseInt(value.substring(i + 1, i + 3), 16));
                i += 3;
                continue;
            }
            flush(bytes, out);
            out.append(c);
            i++;
        }
        flush(bytes, out);
        return out.toString();
    }

    private static boolean isHex(String value, int index) {
        return index < value.length() && Character.digit(value.charAt(index), 16) >= 0;
    }

    private static void flush(ByteArrayOutputStream bytes, StringBuilder out) {
        if (bytes.size() > 0) {
            out.append(bytes.toString(StandardCharsets.UTF_8));
            bytes.reset();
        }
    }

    private static int firstOf(String value, int from, String chars) {
        for (int i = from; i < value.length(); i++) {
            if (chars.indexOf(value.charAt(i)) >= 0) {
                return i;
            }
        }
        return value.length();
    }

    private static String trimSlashes(String path) {
        String p = path;
        while (p.startsWith("/")) {
            p = p.substring(1);
        }
        while (p.endsWith("/")) {
            p = p.substring(0, p.length() - 1);
        }
        return p;
    }
}
