package com.acme.staticforge.search.extract;

import com.acme.staticforge.search.TextCap;

/** Collects extracted text values, one per line, up to a character budget (M23.1.2). */
final class TextBuilder {

    private final StringBuilder text = new StringBuilder();
    private final int maxChars;

    TextBuilder(int maxChars) {
        this.maxChars = maxChars;
    }

    /** Appends a value; blank values are skipped, and nothing is added once the budget is spent. */
    TextBuilder add(String value) {
        if (value == null || value.isBlank() || full()) {
            return this;
        }
        if (!text.isEmpty()) {
            text.append('\n');
        }
        text.append(value.strip());
        return this;
    }

    boolean full() {
        return text.length() >= maxChars;
    }

    /** The text, cut at a word boundary within the budget. */
    String build() {
        return TextCap.cap(text.toString(), maxChars);
    }
}
