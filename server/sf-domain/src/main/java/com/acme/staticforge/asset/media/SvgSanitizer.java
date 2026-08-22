package com.acme.staticforge.asset.media;

import java.util.regex.Pattern;

/**
 * Best-effort SVG sanitizer (spec §11.5). Strips the active-content constructs that can carry
 * scripts in an SVG served from a CMS: {@code <script>} and {@code <foreignObject>} elements,
 * inline {@code on*} event attributes, and {@code javascript:} URIs. This is a deliberately
 * conservative regex pass — no full XML parser dependency is introduced for v1 — and is applied
 * to every {@code image/svg+xml} upload before the bytes are stored.
 */
final class SvgSanitizer {

    private static final Pattern SCRIPT = Pattern.compile("(?is)<script\\b[^>]*>.*?</script>", 0);
    private static final Pattern SELF_CLOSING_SCRIPT = Pattern.compile("(?is)<script\\b[^>]*/>", 0);
    private static final Pattern FOREIGN_OBJECT = Pattern.compile("(?is)<foreignObject\\b[^>]*>.*?</foreignObject>", 0);
    private static final Pattern EVENT_HANDLER = Pattern.compile("(?is)\\son[a-z]+\\s*=\\s*(\"[^\"]*\"|'[^']*'|[^\\s>]+)", 0);
    private static final Pattern JAVASCRIPT_URI = Pattern.compile("(?i)javascript\\s*:", 0);

    SvgSanitizer() {}

    String sanitize(String svg) {
        if (svg == null) {
            return svg;
        }
        String out = SCRIPT.matcher(svg).replaceAll("");
        out = SELF_CLOSING_SCRIPT.matcher(out).replaceAll("");
        out = FOREIGN_OBJECT.matcher(out).replaceAll("");
        out = EVENT_HANDLER.matcher(out).replaceAll("");
        out = JAVASCRIPT_URI.matcher(out).replaceAll("blocked:");
        return out;
    }
}
