package com.acme.staticforge.search;

import java.io.IOException;
import java.io.StringReader;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.apache.lucene.analysis.standard.StandardTokenizer;
import org.apache.lucene.analysis.tokenattributes.CharTermAttribute;

/**
 * The user's search input split into words and quoted phrases (M23.3.1). Never interpreted as query syntax: words
 * are what the standard tokenizer finds, so operators, wildcards, field prefixes and escapes are just punctuation.
 *
 * @param words the words outside quotes, in order
 * @param phrases the words of each quoted segment with at least one word
 * @param prefixLast whether the last word may match as a prefix (it is outside quotes and ends the input), for
 *     as-you-type queries
 * @param uidCandidate the whole input lowercased when it is a single whitespace-free token (possibly an exact uid),
 *     else {@code null}
 */
public record SearchInput(List<String> words, List<List<String>> phrases, boolean prefixLast, String uidCandidate) {

    /** Words beyond this many, across words and phrases, are ignored: no input builds an unbounded query. */
    public static final int MAX_WORDS = 32;

    public SearchInput {
        words = List.copyOf(words);
        phrases = phrases.stream().map(List::copyOf).toList();
    }

    public boolean isEmpty() {
        return words.isEmpty() && phrases.isEmpty() && uidCandidate == null;
    }

    public static SearchInput parse(String text) {
        String trimmed = text == null ? "" : text.strip();
        List<String> words = new ArrayList<>();
        List<List<String>> phrases = new ArrayList<>();
        int budget = MAX_WORDS;
        String[] segments = trimmed.split("\"", -1);
        boolean lastWordEndsInput = false;
        for (int i = 0; i < segments.length && budget > 0; i++) {
            List<String> tokens = tokenize(segments[i], budget);
            budget -= tokens.size();
            // Odd segments are inside quotes; an unbalanced trailing quote leaves its segment as plain words.
            boolean quoted = i % 2 == 1 && i < segments.length - 1;
            if (quoted) {
                if (!tokens.isEmpty()) {
                    phrases.add(tokens);
                }
            } else {
                words.addAll(tokens);
                lastWordEndsInput = i == segments.length - 1 && !tokens.isEmpty();
            }
        }
        boolean singleToken = !trimmed.isEmpty()
                && trimmed.length() <= 120
                && trimmed.indexOf('"') < 0
                && trimmed.chars().noneMatch(Character::isWhitespace);
        String uidCandidate = singleToken ? trimmed.toLowerCase(Locale.ROOT) : null;
        return new SearchInput(words, phrases, lastWordEndsInput && !words.isEmpty(), uidCandidate);
    }

    private static List<String> tokenize(String segment, int max) {
        List<String> tokens = new ArrayList<>();
        if (segment.isBlank() || max <= 0) {
            return tokens;
        }
        try (StandardTokenizer tokenizer = new StandardTokenizer()) {
            tokenizer.setReader(new StringReader(segment));
            CharTermAttribute term = tokenizer.addAttribute(CharTermAttribute.class);
            tokenizer.reset();
            while (tokens.size() < max && tokenizer.incrementToken()) {
                tokens.add(term.toString());
            }
            tokenizer.end();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return tokens;
    }
}
