package com.acme.staticforge.revision;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Splits a rich-text HTML document into its top-level block fragments (spec §7.6). The editor
 * stores rich text as an HTML string produced by a {@code contenteditable} area, so the natural
 * diff unit is the block element ({@code <p>}, {@code <h2>}, {@code <ul>}, …) rather than the
 * whole document.
 *
 * <p>This is a lightweight, tag-nesting-aware scanner — deliberately not a full HTML parser: it
 * only needs to find top-level block boundaries. Blocks start when a block-level element opens
 * at nesting depth zero; stray text outside any block is wrapped into its own fragment.
 */
final class HtmlBlockSplitter {

    private static final Set<String> BLOCK_TAGS = Set.of(
            "address", "article", "aside", "blockquote", "div", "dl", "dt", "dd", "fieldset",
            "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6",
            "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table",
            "tbody", "td", "tfoot", "th", "thead", "tr", "ul");

    private HtmlBlockSplitter() {}

    static List<String> splitBlocks(String html) {
        List<String> blocks = new ArrayList<>();
        if (html == null) {
            return blocks;
        }
        StringBuilder current = new StringBuilder();
        int depth = 0;
        int i = 0;
        int n = html.length();

        while (i < n) {
            if (html.charAt(i) == '<') {
                int close = html.indexOf('>', i);
                if (close < 0) {
                    current.append(html.substring(i));
                    break;
                }
                String token = html.substring(i, close + 1);
                Tag tag = parseTag(token);
                if (tag == null) {
                    // Not a start/end tag (comment, doctype, declaration, or stray '<').
                    current.append(token);
                    i = close + 1;
                    continue;
                }
                if (tag.closing()) {
                    if (depth > 0) {
                        depth--;
                    }
                    current.append(token);
                } else if (tag.selfClosing()) {
                    if (BLOCK_TAGS.contains(tag.name()) && depth == 0) {
                        flush(current, blocks);
                    }
                    current.append(token);
                } else {
                    boolean block = BLOCK_TAGS.contains(tag.name());
                    if (block && depth == 0) {
                        flush(current, blocks);
                    }
                    current.append(token);
                    depth++;
                }
                i = close + 1;
            } else {
                int nextTag = html.indexOf('<', i);
                if (nextTag < 0) {
                    nextTag = n;
                }
                String text = html.substring(i, nextTag);
                if (depth == 0 && !text.isBlank()) {
                    flush(current, blocks);
                }
                current.append(text);
                i = nextTag;
            }
        }
        flush(current, blocks);
        return blocks;
    }

    private static void flush(StringBuilder current, List<String> blocks) {
        String content = current.toString();
        if (content != null && !content.isBlank()) {
            blocks.add(content.trim());
        }
        current.setLength(0);
    }

    /** Parses a {@code <tag>}-shaped token into name/closing/self-closing components. */
    private static Tag parseTag(String token) {
        String body = token.substring(1, token.length() - 1).trim();
        if (body.isEmpty()) {
            return null;
        }
        boolean closing = body.startsWith("/");
        if (closing) {
            body = body.substring(1).trim();
        }
        boolean selfClosing = body.endsWith("/");
        if (selfClosing) {
            body = body.substring(0, body.length() - 1).trim();
        }
        if (body.isEmpty() || !Character.isLetter(body.charAt(0))) {
            return null;
        }
        int end = 0;
        while (end < body.length() && (Character.isLetterOrDigit(body.charAt(end)) || body.charAt(end) == '-')) {
            end++;
        }
        String name = body.substring(0, end).toLowerCase(Locale.ROOT);
        return new Tag(name, closing, selfClosing);
    }

    private record Tag(String name, boolean closing, boolean selfClosing) {}
}
