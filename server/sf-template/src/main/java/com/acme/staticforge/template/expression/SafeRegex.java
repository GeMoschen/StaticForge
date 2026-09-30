package com.acme.staticforge.template.expression;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/**
 * Regular expressions with a match-time limit (M33.1): the input is wrapped in a {@link CharSequence} that counts
 * character reads and aborts a match that reads more than {@link #MAX_READS} characters, so a catastrophically
 * backtracking pattern ends in an {@link ExpressionError} instead of stalling a save or a build. Compiled patterns are
 * cached (bounded, least-recently-used).
 */
final class SafeRegex {

    /** Character reads allowed per match. */
    static final long MAX_READS = 1_000_000;

    private static final int CACHE_SIZE = 256;

    private static final Map<String, Pattern> CACHE = new LinkedHashMap<>(64, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Pattern> eldest) {
            return size() > CACHE_SIZE;
        }
    };

    private SafeRegex() {}

    /** Whether {@code input} matches {@code regex} anywhere ({@code find}); anchor with {@code ^…$} for a full match. */
    static boolean matches(String input, String regex, int pos) {
        Pattern pattern = compile(regex, pos);
        try {
            return pattern.matcher(new CountingSequence(input, new long[] {0})).find();
        } catch (LimitReached e) {
            throw new ExpressionError("Regular expression too complex for this input: " + regex, pos);
        } catch (StackOverflowError e) {
            throw new ExpressionError("Regular expression too complex for this input: " + regex, pos);
        }
    }

    static Pattern compile(String regex, int pos) {
        synchronized (CACHE) {
            Pattern cached = CACHE.get(regex);
            if (cached != null) {
                return cached;
            }
        }
        try {
            Pattern compiled = Pattern.compile(regex);
            synchronized (CACHE) {
                CACHE.put(regex, compiled);
            }
            return compiled;
        } catch (PatternSyntaxException e) {
            throw new ExpressionError("Invalid regular expression '" + regex + "': " + e.getDescription(), pos);
        }
    }

    private static final class LimitReached extends RuntimeException {
        LimitReached() {
            super(null, null, false, false);
        }
    }

    private record CountingSequence(CharSequence text, long[] reads) implements CharSequence {

        @Override
        public char charAt(int index) {
            if (++reads[0] > MAX_READS) {
                throw new LimitReached();
            }
            return text.charAt(index);
        }

        @Override
        public int length() {
            return text.length();
        }

        @Override
        public CharSequence subSequence(int start, int end) {
            return new CountingSequence(text.subSequence(start, end), reads);
        }

        @Override
        public String toString() {
            return text.toString();
        }
    }
}
