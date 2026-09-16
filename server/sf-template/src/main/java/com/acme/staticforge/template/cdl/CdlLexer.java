package com.acme.staticforge.template.cdl;

import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Hand-written, dependency-free CDL lexer (spec §14.7). Produces a position-tracked token
 * stream together with any lexical diagnostics (unterminated string, illegal character).
 * Keywords are emitted as {@link TokenType#IDENT} tokens; the parser recognizes them via
 * {@link #KEYWORDS}. Line/column are 1-based.
 */
final class CdlLexer {

    /** CDL keywords (spec §14.2–§14.6). Lowercase, case-sensitive. */
    static final Set<String> KEYWORDS = Set.of(
            "content", "editor", "group", "item", "label", "help", "required", "default",
            "readOnly", "hidden", "visibleWhen", "validate", "pattern", "message", "min",
            "max", "maxLength", "maxChars", "mimeTypes", "assetTypes", "folder", "options",
            "format", "features", "renamedFrom", "bodies", "body", "allow", "dataset");

    enum TokenType {
        LBRACE, RBRACE, LBRACKET, RBRACKET, COLON, COMMA, IDENT, STRING, NUMBER, BOOLEAN, EOF
    }

    record Token(TokenType type, String text, int line, int column) {

        boolean isIdent(String s) {
            return type == TokenType.IDENT && text.equals(s);
        }
    }

    record LexResult(List<Token> tokens, List<Diagnostic> diagnostics) {}

    LexResult lex(String source) {
        List<Token> tokens = new ArrayList<>();
        List<Diagnostic> diagnostics = new ArrayList<>();
        int n = source.length();
        int i = 0;
        int line = 1;
        int col = 1;
        while (i < n) {
            char c = source.charAt(i);
            if (c == '\r') {
                i++;
            } else if (c == '\n') {
                line++;
                col = 1;
                i++;
            } else if (Character.isWhitespace(c)) {
                i++;
                col++;
            } else {
                int sl = line;
                int sc = col;
                switch (c) {
                    case '{' -> {
                        tokens.add(new Token(TokenType.LBRACE, "{", sl, sc));
                        i++;
                        col++;
                    }
                    case '}' -> {
                        tokens.add(new Token(TokenType.RBRACE, "}", sl, sc));
                        i++;
                        col++;
                    }
                    case '[' -> {
                        tokens.add(new Token(TokenType.LBRACKET, "[", sl, sc));
                        i++;
                        col++;
                    }
                    case ']' -> {
                        tokens.add(new Token(TokenType.RBRACKET, "]", sl, sc));
                        i++;
                        col++;
                    }
                    case ':' -> {
                        tokens.add(new Token(TokenType.COLON, ":", sl, sc));
                        i++;
                        col++;
                    }
                    case ',' -> {
                        tokens.add(new Token(TokenType.COMMA, ",", sl, sc));
                        i++;
                        col++;
                    }
                    case '"', '\'' -> {
                        i++;
                        col++;
                        StringBuilder sb = new StringBuilder();
                        boolean terminated = false;
                        while (i < n) {
                            char ch = source.charAt(i);
                            if (ch == c) {
                                terminated = true;
                                i++;
                                col++;
                                break;
                            }
                            if (ch == '\n') {
                                line++;
                                col = 1;
                                i++;
                                sb.append(ch);
                            } else if (ch == '\r') {
                                i++;
                            } else if (ch == '\\' && i + 1 < n) {
                                char nx = source.charAt(i + 1);
                                i += 2;
                                col += 2;
                                sb.append(switch (nx) {
                                    case 'n' -> '\n';
                                    case 't' -> '\t';
                                    case 'r' -> '\r';
                                    default -> nx;
                                });
                            } else {
                                sb.append(ch);
                                i++;
                                col++;
                            }
                        }
                        if (!terminated) {
                            diagnostics.add(Diagnostic.error(
                                    DiagnosticCodes.CDL_SYNTAX, "Unterminated string literal", sl, sc));
                        }
                        tokens.add(new Token(TokenType.STRING, sb.toString(), sl, sc));
                    }
                    default -> {
                        if (Character.isDigit(c) || (c == '-' && i + 1 < n && Character.isDigit(source.charAt(i + 1)))) {
                            int s = i;
                            if (c == '-') {
                                i++;
                                col++;
                            }
                            while (i < n && Character.isDigit(source.charAt(i))) {
                                i++;
                                col++;
                            }
                            tokens.add(new Token(TokenType.NUMBER, source.substring(s, i), sl, sc));
                        } else if (Character.isLetter(c) || c == '_') {
                            int s = i;
                            while (i < n && (Character.isLetterOrDigit(source.charAt(i)) || source.charAt(i) == '_')) {
                                i++;
                                col++;
                            }
                            String word = source.substring(s, i);
                            TokenType type = "true".equals(word) || "false".equals(word)
                                    ? TokenType.BOOLEAN
                                    : TokenType.IDENT;
                            tokens.add(new Token(type, word, sl, sc));
                        } else {
                            diagnostics.add(Diagnostic.error(
                                    DiagnosticCodes.CDL_SYNTAX, "Unexpected character '" + c + "'", sl, sc));
                            i++;
                            col++;
                        }
                    }
                }
            }
        }
        tokens.add(new Token(TokenType.EOF, "", line, col));
        return new LexResult(tokens, diagnostics);
    }
}
