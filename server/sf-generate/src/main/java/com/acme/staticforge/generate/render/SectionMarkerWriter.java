package com.acme.staticforge.generate.render;

import com.acme.staticforge.generate.quality.SectionMarkers;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Writes the section markers of a draft-check render (M30.3.1, epic decision 13):
 * {@code <!--sf:section {instanceId}-->…<!--/sf:section-->} around every rendered section instance, and only where a
 * comment is harmless — in the body's text content.
 *
 * <p>Two steps, because a section doesn't know where its output lands: while rendering, {@link #wrap} brackets each
 * section's output with sentinels made of Unicode noncharacters (reserved for internal use, never in content, left alone
 * by every escaping); once the page is rendered, {@link #finish} parses the document just enough to know the context of
 * each sentinel and turns a pair into comments when both ends sit in body text — not inside a tag or attribute, a
 * comment, a raw-text element ({@code script}, {@code style}, {@code title}, {@code textarea}, …) or {@code <head>}.
 * Every other pair is dropped, so a section rendered into a {@code <title>} or an attribute leaves its markup exactly as
 * generation writes it.
 */
final class SectionMarkerWriter {

    /** Starts an opening sentinel; the instance id follows, up to {@link #END}. */
    private static final char OPEN = '﷐';
    /** Ends an opening sentinel's instance id. */
    private static final char END = '﷑';
    /** The closing sentinel. */
    private static final char CLOSE = '﷒';

    /** Ids written into a comment: nothing that could end it ({@code --}, {@code >}) or break the marker's syntax. */
    private static final Pattern SAFE_ID = Pattern.compile("[A-Za-z0-9_:.]+(-[A-Za-z0-9_:.]+)*");

    /** Elements whose content is raw text or RCDATA: a comment written there is text, not a comment. */
    private static final Set<String> RAW_TEXT = Set.of(
            "script", "style", "title", "textarea", "xmp", "iframe", "noembed", "noframes", "noscript", "plaintext");

    private SectionMarkerWriter() {}

    /** Brackets the output of section instance {@code instanceId}; unchanged when the id can't be written safely. */
    static String wrap(String instanceId, String output) {
        if (instanceId == null || !SAFE_ID.matcher(instanceId).matches()) {
            return output;
        }
        return OPEN + instanceId + END + output + CLOSE;
    }

    /** Turns the sentinels of a rendered page into markers where they are safe and removes the rest. */
    static String finish(String html) {
        if (html.indexOf(OPEN) < 0 && html.indexOf(CLOSE) < 0) {
            return html;
        }
        List<Sentinel> sentinels = scan(html);
        Set<Sentinel> kept = pairs(sentinels);
        StringBuilder out = new StringBuilder(html.length() + kept.size() * 24);
        int from = 0;
        for (Sentinel sentinel : sentinels) {
            out.append(html, from, sentinel.start());
            if (kept.contains(sentinel)) {
                out.append(sentinel.open() ? SectionMarkers.open(sentinel.id()) : SectionMarkers.close());
            }
            from = sentinel.end();
        }
        out.append(html, from, html.length());
        return out.toString();
    }

    /**
     * One sentinel in the rendered page.
     *
     * @param start its first character
     * @param end the character after it
     * @param id the instance id of an opening sentinel; {@code null} for a closing one
     * @param safe whether it sits in body text, where a comment is harmless
     */
    private record Sentinel(int start, int end, String id, boolean safe) {

        boolean open() {
            return id != null;
        }
    }

    /** Matches each closing sentinel with its opening one; a pair is kept only when both ends are safe. */
    private static Set<Sentinel> pairs(List<Sentinel> sentinels) {
        Set<Sentinel> kept = new HashSet<>();
        Deque<Sentinel> open = new ArrayDeque<>();
        for (Sentinel sentinel : sentinels) {
            if (sentinel.open()) {
                open.push(sentinel);
            } else if (!open.isEmpty()) {
                Sentinel opening = open.pop();
                if (opening.safe() && sentinel.safe()) {
                    kept.add(opening);
                    kept.add(sentinel);
                }
            }
        }
        return kept;
    }

    /** The document's tokenizer states that matter for a comment. */
    private enum State {
        TEXT,
        /** Inside a start or end tag, its attributes included. */
        TAG,
        /** Inside {@code <!-- … -->}. */
        COMMENT,
        /** Inside {@code <!…>} or {@code <?…>} (a doctype, a bogus comment). */
        DECLARATION,
        /** Inside a raw-text element, up to its end tag. */
        RAW
    }

    /** Every sentinel with its context, in document order. */
    private static List<Sentinel> scan(String html) {
        List<Sentinel> sentinels = new ArrayList<>();
        State state = State.TEXT;
        boolean inHead = false;
        char quote = 0;
        String tagName = null;
        boolean endTag = false;
        String rawElement = null;
        int length = html.length();
        int i = 0;
        while (i < length) {
            char c = html.charAt(i);
            if (c == OPEN) {
                int idEnd = html.indexOf(END, i + 1);
                if (idEnd < 0) {
                    idEnd = length - 1;
                }
                sentinels.add(new Sentinel(i, idEnd + 1, html.substring(i + 1, idEnd), state == State.TEXT && !inHead));
                i = idEnd + 1;
                continue;
            }
            if (c == CLOSE) {
                sentinels.add(new Sentinel(i, i + 1, null, state == State.TEXT && !inHead));
                i++;
                continue;
            }
            switch (state) {
                case TEXT -> {
                    if (c == '<') {
                        if (html.startsWith("<!--", i)) {
                            state = State.COMMENT;
                            i += 4;
                            continue;
                        }
                        if (i + 1 < length && (html.charAt(i + 1) == '!' || html.charAt(i + 1) == '?')) {
                            state = State.DECLARATION;
                        } else {
                            int nameStart = i + 1;
                            endTag = nameStart < length && html.charAt(nameStart) == '/';
                            if (endTag) {
                                nameStart++;
                            }
                            int nameEnd = nameStart;
                            while (nameEnd < length && isNameChar(html.charAt(nameEnd))) {
                                nameEnd++;
                            }
                            if (nameEnd > nameStart && Character.isLetter(html.charAt(nameStart))) {
                                tagName = html.substring(nameStart, nameEnd).toLowerCase(Locale.ROOT);
                                state = State.TAG;
                                quote = 0;
                                i = nameEnd;
                                continue;
                            }
                        }
                    }
                }
                case TAG -> {
                    if (quote != 0) {
                        if (c == quote) {
                            quote = 0;
                        }
                    } else if (c == '"' || c == '\'') {
                        quote = c;
                    } else if (c == '>') {
                        boolean selfClosing = i > 0 && html.charAt(i - 1) == '/';
                        state = State.TEXT;
                        if (endTag) {
                            if (tagName.equals("head")) {
                                inHead = false;
                            }
                        } else if (tagName.equals("head")) {
                            inHead = true;
                        } else if (tagName.equals("body")) {
                            inHead = false;
                        } else if (RAW_TEXT.contains(tagName) && !selfClosing) {
                            state = State.RAW;
                            rawElement = tagName;
                        }
                    }
                }
                case COMMENT -> {
                    if (html.startsWith("-->", i)) {
                        state = State.TEXT;
                        i += 3;
                        continue;
                    }
                }
                case DECLARATION -> {
                    if (c == '>') {
                        state = State.TEXT;
                    }
                }
                case RAW -> {
                    if (c == '<' && closesRaw(html, i, rawElement)) {
                        state = State.TEXT;
                        continue; // the end tag itself is read in TEXT
                    }
                }
            }
            i++;
        }
        return sentinels;
    }

    /** Whether the end tag of raw-text element {@code element} starts at {@code i}. */
    private static boolean closesRaw(String html, int i, String element) {
        int nameStart = i + 2;
        int nameEnd = nameStart + element.length();
        if (!html.startsWith("</", i) || nameEnd > html.length()
                || !html.substring(nameStart, nameEnd).equalsIgnoreCase(element)) {
            return false;
        }
        return nameEnd == html.length() || !isNameChar(html.charAt(nameEnd));
    }

    private static boolean isNameChar(char c) {
        return Character.isLetterOrDigit(c) || c == '-' || c == ':' || c == '_';
    }
}
