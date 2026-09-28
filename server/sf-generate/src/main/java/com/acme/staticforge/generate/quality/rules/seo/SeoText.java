package com.acme.staticforge.generate.quality.rules.seo;

import com.acme.staticforge.generate.quality.OutputKey;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Evaluator;
import org.jsoup.select.Selector;

/** Text and element helpers shared by the SEO rules (M30.2.2). */
final class SeoText {

    private static final Pattern WHITESPACE = Pattern.compile("\\s+");

    /** An {@code <svg>}, parsed once: a query string would be parsed for every document. */
    private static final Evaluator SVG = Selector.evaluatorOf("svg");

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
            if (title.closest(SVG) == null) {
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

    /**
     * {@code paths} without the one at index {@code except}, for a message: the first {@link #MAX_NAMED}, then how many
     * more. Reads only the first {@code MAX_NAMED + 1} paths.
     */
    static String namesExcept(List<String> paths, int except) {
        List<String> named = new ArrayList<>(MAX_NAMED);
        for (int i = 0; i < paths.size() && named.size() < MAX_NAMED; i++) {
            if (i != except) {
                named.add(paths.get(i));
            }
        }
        int others = paths.size() - 1;
        String text = String.join(", ", named);
        return others <= MAX_NAMED ? text : text + " and " + (others - MAX_NAMED) + " more";
    }

    /** Where an output is: its channel and, in a localized project, its language — for messages. */
    static String where(OutputKey key) {
        return key.locale() == null ? key.channel() : key.channel() + ", " + key.locale();
    }
}
