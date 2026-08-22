package com.acme.staticforge.template.octl;

import com.acme.staticforge.template.diagnostic.Diagnostic;
import java.util.ArrayList;
import java.util.List;

/**
 * Hand-written, dependency-free OCTL lexer (spec §16.1, §16.10). Reduces the source to an
 * ordered stream of {@link Token}s: passthrough text and {@code $CMS_…$} instructions.
 *
 * <p>Only {@code $CMS_} and {@code $} are interpreted sequences. {@code $$} collapses to a
 * literal {@code $}; every other delimiter ({@code {{}}, {@code <%}, {@code ${}}) passes
 * through untouched. Positions are 1-based; a {@code $} inside a quoted string of an
 * instruction does not terminate the instruction.
 */
final class OctlLexer {

    /** Either literal text or the raw body of a {@code $CMS_…$} instruction. */
    record Token(boolean instruction, String text, int line, int col) {

        boolean isInstruction() {
            return instruction;
        }
    }

    record LexResult(List<Token> tokens, List<Diagnostic> diagnostics) {}

    LexResult lex(String source) {
        String s = source == null ? "" : source;
        List<Token> tokens = new ArrayList<>();
        List<Diagnostic> diagnostics = new ArrayList<>();
        int n = s.length();
        int i = 0;
        int line = 1;
        int col = 1;
        StringBuilder text = new StringBuilder();
        int textLine = 1;
        int textCol = 1;

        while (i < n) {
            if (s.startsWith("$CMS_", i)) {
                flush(text, tokens, textLine, textCol);
                textLine = line;
                textCol = col;
                int sl = line;
                int sc = col;
                int body = i + 5;
                int end = findEnd(s, body, line, col);
                String raw = s.substring(body, end);
                tokens.add(new Token(true, raw, sl, sc));
                // Advance line/col accounting for the consumed span.
                int consumed = i + 5; // start of body
                while (consumed < end) {
                    char c = s.charAt(consumed);
                    if (c == '\n') {
                        line++;
                        col = 1;
                    } else if (c == '\r') {
                        // ignore, tracked below
                    } else {
                        col++;
                    }
                    consumed++;
                }
                // Skip the terminating '$'.
                col++;
                i = end + 1;
            } else if (s.startsWith("$$", i)) {
                if (text.isEmpty()) {
                    textLine = line;
                    textCol = col;
                }
                text.append('$');
                i += 2;
                col += 2;
            } else {
                char c = s.charAt(i);
                if (text.isEmpty()) {
                    textLine = line;
                    textCol = col;
                }
                text.append(c);
                if (c == '\n') {
                    line++;
                    col = 1;
                } else if (c == '\r') {
                    // skip; \n will bump the line
                } else {
                    col++;
                }
                i++;
            }
        }
        flush(text, tokens, textLine, textCol);
        return new LexResult(tokens, diagnostics);
    }

    private int findEnd(String s, int body, int line, int col) {
        int i = body;
        int n = s.length();
        while (i < n) {
            char c = s.charAt(i);
            if (c == '"' || c == '\'') {
                char q = c;
                i++;
                while (i < n) {
                    char d = s.charAt(i);
                    if (d == '\\' && i + 1 < n) {
                        i += 2;
                    } else if (d == q) {
                        i++;
                        break;
                    } else {
                        i++;
                    }
                }
            } else if (c == '$') {
                return i;
            } else {
                i++;
            }
        }
        return n;
    }

    private static void flush(StringBuilder text, List<Token> tokens, int line, int col) {
        if (text.length() > 0) {
            tokens.add(new Token(false, text.toString(), line, col));
            text.setLength(0);
        }
    }
}
