package com.acme.staticforge.search;

/** Caps extracted text at a character budget, cutting at a word boundary (M23.1.2). */
public final class TextCap {

    private TextCap() {}

    /**
     * {@code text} when it fits {@code maxChars}; otherwise its longest prefix that ends before whitespace (or the
     * hard cut when the prefix has no whitespace at all), without trailing whitespace.
     */
    public static String cap(String text, int maxChars) {
        if (text == null) {
            return "";
        }
        if (text.length() <= maxChars) {
            return text;
        }
        int cut = maxChars;
        if (!Character.isWhitespace(text.charAt(cut))) {
            int space = cut - 1;
            while (space > 0 && !Character.isWhitespace(text.charAt(space))) {
                space--;
            }
            if (space > 0) {
                cut = space;
            }
        }
        // Don't leave half of a surrogate pair behind.
        if (cut > 0 && Character.isHighSurrogate(text.charAt(cut - 1))) {
            cut--;
        }
        return text.substring(0, cut).stripTrailing();
    }
}
