package com.acme.staticforge.common;

import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * HTML fragment → plain text, the one implementation shared by the OCTL {@code plain} filter and search text
 * extraction (M23.1.2). Inline formatting tags vanish ({@code <b>Ha</b>us} reads {@code Haus}); every other tag
 * becomes a space (so {@code <p>a</p><p>b</p>} reads {@code a b}), the content of {@code script} and {@code style}
 * elements is dropped, character references are decoded and whitespace is collapsed.
 *
 * <p>The input is treated as untrusted markup and only ever parsed into text; nothing is rendered.
 */
public final class HtmlText {

    private static final Pattern RAW_TEXT_ELEMENTS =
            Pattern.compile("<(script|style)\\b[^>]*>.*?</\\1\\s*>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    /** Inline formatting that doesn't separate words; a {@code <br>} or any block tag does. */
    private static final Pattern INLINE_TAGS = Pattern.compile(
            "</?(?:a|abbr|b|bdi|bdo|cite|code|data|dfn|em|i|kbd|mark|q|s|samp|small|span|strong|sub|sup|time|u|var)"
                    + "(?:\\s[^>]*)?>",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern TAGS = Pattern.compile("<[^>]*>");
    private static final Pattern REFERENCE = Pattern.compile("&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});");
    private static final Pattern WHITESPACE = Pattern.compile("\\s+");

    private static final Map<String, String> NAMED = Map.ofEntries(
            Map.entry("nbsp", " "),
            Map.entry("amp", "&"),
            Map.entry("lt", "<"),
            Map.entry("gt", ">"),
            Map.entry("quot", "\""),
            Map.entry("apos", "'"),
            Map.entry("shy", ""),
            Map.entry("ndash", "–"),
            Map.entry("mdash", "—"),
            Map.entry("hellip", "…"),
            Map.entry("lsquo", "‘"),
            Map.entry("rsquo", "’"),
            Map.entry("ldquo", "“"),
            Map.entry("rdquo", "”"),
            Map.entry("laquo", "«"),
            Map.entry("raquo", "»"),
            Map.entry("bdquo", "„"),
            Map.entry("euro", "€"),
            Map.entry("copy", "©"),
            Map.entry("reg", "®"),
            Map.entry("auml", "ä"),
            Map.entry("ouml", "ö"),
            Map.entry("uuml", "ü"),
            Map.entry("Auml", "Ä"),
            Map.entry("Ouml", "Ö"),
            Map.entry("Uuml", "Ü"),
            Map.entry("szlig", "ß"));

    private HtmlText() {}

    /** The text of an HTML fragment; {@code ""} for {@code null}. */
    public static String toPlainText(String html) {
        if (html == null || html.isEmpty()) {
            return "";
        }
        String text = RAW_TEXT_ELEMENTS.matcher(html).replaceAll(" ");
        text = INLINE_TAGS.matcher(text).replaceAll("");
        text = TAGS.matcher(text).replaceAll(" ");
        text = decodeReferences(text);
        return WHITESPACE.matcher(text).replaceAll(" ").trim();
    }

    /** Decodes named (common ones) and numeric character references; unknown or invalid ones are kept as written. */
    static String decodeReferences(String text) {
        if (text.indexOf('&') < 0) {
            return text;
        }
        Matcher matcher = REFERENCE.matcher(text);
        StringBuilder out = new StringBuilder(text.length());
        while (matcher.find()) {
            matcher.appendReplacement(out, Matcher.quoteReplacement(decode(matcher.group(1), matcher.group())));
        }
        matcher.appendTail(out);
        return out.toString();
    }

    private static String decode(String reference, String original) {
        if (reference.charAt(0) != '#') {
            return NAMED.getOrDefault(reference, original);
        }
        try {
            int codePoint = reference.length() > 1 && (reference.charAt(1) == 'x' || reference.charAt(1) == 'X')
                    ? Integer.parseInt(reference.substring(2), 16)
                    : Integer.parseInt(reference.substring(1));
            if (codePoint == 0 || !Character.isValidCodePoint(codePoint)
                    || (codePoint >= Character.MIN_SURROGATE && codePoint <= Character.MAX_SURROGATE)) {
                return original;
            }
            return new String(Character.toChars(codePoint));
        } catch (NumberFormatException e) {
            return original;
        }
    }
}
