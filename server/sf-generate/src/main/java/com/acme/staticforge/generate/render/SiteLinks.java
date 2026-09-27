package com.acme.staticforge.generate.render;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Links between outputs of one site, relative to the page that holds them (lessons 2026-09-15: generated links are
 * relative to the current page) — shared by the renderer and the redirect stubs (M30.5.1).
 */
public final class SiteLinks {

    private static final Pattern ABSOLUTE_URL = Pattern.compile("[A-Za-z][A-Za-z0-9+.-]*:");

    private SiteLinks() {}

    /**
     * Rewrites a resolved site path ({@code pf/p2.html}, {@code media/logo.png}, directory form
     * {@code products/}) into a link relative to the page being rendered, so generated output works
     * wherever the site is hosted (domain root, sub-path, {@code file://}, unpacked ZIP). From
     * {@code pf/pf1/p3.html}: {@code p1.html} becomes {@code ../../p1.html} and {@code pf/p2.html}
     * becomes {@code ../p2.html}. Blank (unresolved) stays blank; values that are already absolute
     * (a leading {@code /}, a scheme such as {@code https:}, a fragment) are returned unchanged,
     * e.g. a manual URL registry override.
     *
     * @param pagePath the current page's output path, relative to the site root
     * @param sitePath the link target relative to the site root ({@code ./} means the root itself)
     */
    public static String relativeUrl(String pagePath, String sitePath) {
        if (sitePath == null || sitePath.isBlank()) {
            return sitePath == null ? "" : sitePath;
        }
        if (sitePath.startsWith("/") || sitePath.startsWith("#") || ABSOLUTE_URL.matcher(sitePath).lookingAt()) {
            return sitePath;
        }
        List<String> from = directorySegments(pagePath);
        String target = sitePath.startsWith("./") ? sitePath.substring(2) : sitePath;
        boolean directory = target.isEmpty() || target.endsWith("/");
        List<String> to = new ArrayList<>(List.of(target.split("/")));
        to.removeIf(String::isEmpty);
        String fileName = directory || to.isEmpty() ? "" : to.remove(to.size() - 1);

        int common = 0;
        while (common < from.size() && common < to.size() && from.get(common).equals(to.get(common))) {
            common++;
        }
        StringBuilder url = new StringBuilder("../".repeat(from.size() - common));
        for (String segment : to.subList(common, to.size())) {
            url.append(segment).append('/');
        }
        url.append(fileName);
        return url.isEmpty() ? "./" : url.toString();
    }

    /** Folder segments of a site-relative file path: {@code pf/pf1/p3.html} gives {@code [pf, pf1]}. */
    private static List<String> directorySegments(String pagePath) {
        if (pagePath == null || pagePath.isBlank()) {
            return List.of();
        }
        List<String> segments = new ArrayList<>(List.of(pagePath.replace('\\', '/').split("/")));
        segments.removeIf(String::isEmpty);
        if (!segments.isEmpty()) {
            segments.remove(segments.size() - 1); // the file name
        }
        return segments;
    }
}
