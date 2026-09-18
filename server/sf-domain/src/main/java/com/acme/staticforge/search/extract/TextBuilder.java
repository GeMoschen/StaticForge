package com.acme.staticforge.search.extract;

import com.acme.staticforge.search.TextCap;

/**
 * Collects extracted text values, one per line, up to a character budget (M23.1.2).
 *
 * <p>Text of a language-dependent value is collected per language (M24.3.3) so each language's text
 * ends up in the field its own analyzer reads. The budget is shared across all of them, so a
 * many-language project can't blow the per-document cap.
 */
final class TextBuilder {

    private final StringBuilder text = new StringBuilder();
    private final java.util.Map<String, StringBuilder> byLocale = new java.util.LinkedHashMap<>();
    private final int maxChars;

    TextBuilder(int maxChars) {
        this.maxChars = maxChars;
    }

    /** Appends a value that belongs to no particular language. */
    TextBuilder add(String value) {
        return add(null, value);
    }

    /**
     * Appends a value; blank values are skipped, and nothing is added once the budget is spent.
     *
     * @param locale the language the value belongs to, or {@code null} for language-neutral text
     */
    TextBuilder add(String locale, String value) {
        if (value == null || value.isBlank() || full()) {
            return this;
        }
        StringBuilder target = locale == null
                ? text
                : byLocale.computeIfAbsent(locale, key -> new StringBuilder());
        if (!target.isEmpty()) {
            target.append('\n');
        }
        target.append(value.strip());
        return this;
    }

    boolean full() {
        return length() >= maxChars;
    }

    private int length() {
        int total = text.length();
        for (StringBuilder value : byLocale.values()) {
            total += value.length();
        }
        return total;
    }

    /** The language-neutral text, cut at a word boundary within the budget. */
    String build() {
        return TextCap.cap(text.toString(), maxChars);
    }

    /** The text of each language that contributed any, cut within the same budget. */
    java.util.Map<String, String> buildByLocale() {
        if (byLocale.isEmpty()) {
            return java.util.Map.of();
        }
        java.util.Map<String, String> out = new java.util.LinkedHashMap<>();
        byLocale.forEach((locale, value) -> out.put(locale, TextCap.cap(value.toString(), maxChars)));
        return java.util.Map.copyOf(out);
    }
}
