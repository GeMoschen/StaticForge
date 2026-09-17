package com.acme.staticforge.search;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.text.BreakIterator;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import org.apache.lucene.analysis.Analyzer;
import org.apache.lucene.search.Query;
import org.apache.lucene.search.uhighlight.Passage;
import org.apache.lucene.search.uhighlight.PassageFormatter;
import org.apache.lucene.search.uhighlight.UnifiedHighlighter;

/**
 * Cuts a hit's snippet from its stored plain text (M23.3.1). {@link UnifiedHighlighter} finds the match offsets by
 * re-analyzing the text per field, so stemmed ({@code text_de}, {@code text_en}), folded and prefix matches are all
 * marked. The result is plain text plus offset ranges — never HTML — so a client escapes the text and marks the
 * ranges itself.
 */
final class SnippetBuilder {

    /** Longest snippet, ellipses included. */
    static final int MAX_CHARS = 240;

    /** Characters shown before the first match of the window. */
    private static final int LEAD_CHARS = 40;

    /** Matches beyond this many characters of the stored text aren't looked for; highlighting cost stays bounded. */
    private static final int HIGHLIGHT_CHARS = 50_000;

    private static final String ELLIPSIS = "…";

    private static final List<String> FIELDS =
            List.of(SearchFields.TEXT, SearchFields.TEXT_DE, SearchFields.TEXT_EN, SearchFields.SOURCE);

    private final UnifiedHighlighter highlighter;

    SnippetBuilder(Analyzer analyzer) {
        this.highlighter = UnifiedHighlighter.builderWithoutSearcher(analyzer)
                .withFormatter(new RangeFormatter())
                .withMaxLength(HIGHLIGHT_CHARS)
                .withBreakIterator(() -> BreakIterator.getSentenceInstance(Locale.ROOT))
                .build();
    }

    SearchHit.Snippet build(Query query, String storedText) {
        if (storedText == null || storedText.isEmpty()) {
            return SearchHit.Snippet.empty();
        }
        // Line breaks separate prose and code; same length, so offsets stay valid.
        String text = storedText.replace('\n', ' ').replace('\r', ' ').replace('\t', ' ');
        List<SearchHit.Range> matches = merge(matches(query, text));
        return window(text, matches);
    }

    @SuppressWarnings("unchecked")
    private List<SearchHit.Range> matches(Query query, String text) {
        String content = text.length() > HIGHLIGHT_CHARS ? text.substring(0, HIGHLIGHT_CHARS) : text;
        List<SearchHit.Range> found = new ArrayList<>();
        for (String field : FIELDS) {
            try {
                Object result = highlighter.highlightWithoutSearcher(field, query, content, 5);
                if (result instanceof List<?> ranges) {
                    found.addAll((List<SearchHit.Range>) ranges);
                }
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }
        return found;
    }

    /** Sorted, with overlapping or touching ranges joined. */
    static List<SearchHit.Range> merge(List<SearchHit.Range> ranges) {
        List<SearchHit.Range> sorted = new ArrayList<>(ranges);
        sorted.sort(Comparator.comparingInt(SearchHit.Range::start).thenComparingInt(SearchHit.Range::end));
        List<SearchHit.Range> merged = new ArrayList<>();
        for (SearchHit.Range range : sorted) {
            if (range.end() <= range.start()) {
                continue;
            }
            SearchHit.Range last = merged.isEmpty() ? null : merged.get(merged.size() - 1);
            if (last != null && range.start() <= last.end()) {
                merged.set(merged.size() - 1, new SearchHit.Range(last.start(), Math.max(last.end(), range.end())));
            } else {
                merged.add(range);
            }
        }
        return merged;
    }

    /**
     * The excerpt of at most {@link #MAX_CHARS} characters holding the most matches (the earliest such window), cut at
     * word boundaries, with {@code …} where text was cut off, and the matches inside it as ranges into the excerpt.
     */
    static SearchHit.Snippet window(String text, List<SearchHit.Range> matches) {
        int start = 0;
        if (!matches.isEmpty()) {
            int best = 0;
            int bestCount = -1;
            for (int i = 0; i < matches.size(); i++) {
                int from = Math.max(0, matches.get(i).start() - LEAD_CHARS);
                int count = 0;
                for (int j = i; j < matches.size() && matches.get(j).end() <= from + MAX_CHARS - 2; j++) {
                    count++;
                }
                if (count > bestCount) {
                    bestCount = count;
                    best = from;
                }
            }
            start = best;
        }
        if (start > 0) {
            // Start at a word: skip the partial word the lead cut into (never past the first match).
            int firstMatch = matches.isEmpty() ? text.length() : firstAtOrAfter(matches, start);
            int space = text.indexOf(' ', start);
            if (space >= 0 && space < firstMatch) {
                start = space + 1;
            }
            while (start < text.length() && start < firstMatch && text.charAt(start) == ' ') {
                start++;
            }
        }
        String prefix = start > 0 ? ELLIPSIS : "";
        int budget = MAX_CHARS - prefix.length();
        int end = Math.min(text.length(), start + budget);
        String suffix = "";
        if (end < text.length()) {
            suffix = ELLIPSIS;
            end = Math.min(text.length(), start + budget - suffix.length());
            int space = text.lastIndexOf(' ', end);
            if (space > start) {
                end = space;
            }
        }
        if (end > start && Character.isHighSurrogate(text.charAt(end - 1))) {
            end--;
        }
        String excerpt = text.substring(start, end).stripTrailing();
        String snippet = prefix + excerpt + suffix;
        List<SearchHit.Range> ranges = new ArrayList<>();
        for (SearchHit.Range match : matches) {
            int from = Math.max(match.start(), start);
            int to = Math.min(match.end(), start + excerpt.length());
            if (from < to) {
                ranges.add(new SearchHit.Range(from - start + prefix.length(), to - start + prefix.length()));
            }
        }
        return new SearchHit.Snippet(snippet, ranges);
    }

    private static int firstAtOrAfter(List<SearchHit.Range> matches, int offset) {
        for (SearchHit.Range match : matches) {
            if (match.start() >= offset) {
                return match.start();
            }
        }
        return Integer.MAX_VALUE;
    }

    /** Emits the match offsets of every passage instead of formatted text. */
    private static final class RangeFormatter extends PassageFormatter {

        @Override
        public Object format(Passage[] passages, String content) {
            List<SearchHit.Range> ranges = new ArrayList<>();
            for (Passage passage : passages) {
                for (int i = 0; i < passage.getNumMatches(); i++) {
                    ranges.add(new SearchHit.Range(passage.getMatchStarts()[i], passage.getMatchEnds()[i]));
                }
            }
            return ranges;
        }
    }
}
