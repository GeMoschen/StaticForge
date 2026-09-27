package com.acme.staticforge.generate.quality.rules.seo;

import com.acme.staticforge.generate.quality.OutputKey;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

/** Text and element helpers shared by the SEO rules (M30.2.2). */
final class SeoText {

    private static final Pattern WHITESPACE = Pattern.compile("\\s+");

    /** At most this many other outputs are named in one message; the rest are counted. */
    static final int MAX_NAMED = 10;

    private SeoText() {}

    /** {@code text} with every whitespace run collapsed to one space and trimmed; {@code null} stays {@code null}. */
    static String normalize(String text) {
        return text == null ? null : WHITESPACE.matcher(text).replaceAll(" ").strip();
    }

    /** Whether {@code text} is missing or blank. */
    static boolean blank(String text) {
        return text == null || text.isBlank();
    }

    /** The length a reader (and a search engine) counts: code points of the normalized text. */
    static int length(String normalized) {
        return normalized.codePointCount(0, normalized.length());
    }

    /** The document's {@code <title>} — the first one outside an {@code <svg>}, as the facts read it. */
    static Element title(Document document) {
        for (Element title : document.getElementsByTag("title")) {
            if (title.closest("svg") == null) {
                return title;
            }
        }
        return null;
    }

    /** The first {@code <meta name="…">} with {@code name} (case-insensitive, trimmed), as the facts read it. */
    static Element meta(Document document, String name) {
        for (Element meta : document.getElementsByTag("meta")) {
            if (meta.attr("name").strip().toLowerCase(Locale.ROOT).equals(name)) {
                return meta;
            }
        }
        return null;
    }

    /** {@code paths} for a message: the first {@link #MAX_NAMED}, then how many more. */
    static String names(List<String> paths) {
        if (paths.size() <= MAX_NAMED) {
            return String.join(", ", paths);
        }
        return String.join(", ", paths.subList(0, MAX_NAMED)) + " and " + (paths.size() - MAX_NAMED) + " more";
    }

    /** Where an output is: its channel and, in a localized project, its language — for messages. */
    static String where(OutputKey key) {
        return key.locale() == null ? key.channel() : key.channel() + ", " + key.locale();
    }
}
