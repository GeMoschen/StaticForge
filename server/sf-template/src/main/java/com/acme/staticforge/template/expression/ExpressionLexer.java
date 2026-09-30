package com.acme.staticforge.template.expression;

import java.util.ArrayList;
import java.util.List;

/**
 * Tokenizes an expression (M33.1). {@link ExpressionMode#V1} reproduces the original {@code visibleWhen} tokenizer
 * exactly — dotted identifiers are one token, numbers may contain {@code -} and {@code .}, a single {@code =} is
 * {@code ==} and skips two characters, an unterminated string runs to the end — so existing expressions behave as before.
 */
final class ExpressionLexer {

    enum Type {
        IDENT, GLOBAL, STRING, NUMBER, TRUE, FALSE, NULL, IN, AND, OR, NOT,
        EQ, NEQ, LT, LTE, GT, GTE, PLUS, MINUS, STAR, SLASH, PERCENT, QUESTION, COALESCE, COLON,
        LPAREN, RPAREN, LBRACKET, RBRACKET, COMMA, DOT, EOF
    }

    record Token(Type type, String text, int pos) {}

    private ExpressionLexer() {}

    static List<Token> tokenize(String input, ExpressionMode mode) {
        return mode == ExpressionMode.V1 ? tokenizeV1(input) : tokenizeV2(input);
    }

    private static List<Token> tokenizeV1(String input) {
        List<Token> tokens = new ArrayList<>();
        int i = 0;
        int n = input.length();
        while (i < n) {
            char c = input.charAt(i);
            int start = i;
            if (Character.isWhitespace(c)) {
                i++;
            } else if (c == '(') {
                tokens.add(new Token(Type.LPAREN, "(", start));
                i++;
            } else if (c == ')') {
                tokens.add(new Token(Type.RPAREN, ")", start));
                i++;
            } else if (c == '[') {
                tokens.add(new Token(Type.LBRACKET, "[", start));
                i++;
            } else if (c == ']') {
                tokens.add(new Token(Type.RBRACKET, "]", start));
                i++;
            } else if (c == ',') {
                tokens.add(new Token(Type.COMMA, ",", start));
                i++;
            } else if (c == '=') {
                // The v1 quirk: '=' always consumes two characters, so '=' and '==' both mean equality.
                tokens.add(new Token(Type.EQ, "==", start));
                i += 2;
            } else if (c == '!' && i + 1 < n && input.charAt(i + 1) == '=') {
                tokens.add(new Token(Type.NEQ, "!=", start));
                i += 2;
            } else if (c == '!') {
                tokens.add(new Token(Type.NOT, "!", start));
                i++;
            } else if (c == '&' && i + 1 < n && input.charAt(i + 1) == '&') {
                tokens.add(new Token(Type.AND, "&&", start));
                i += 2;
            } else if (c == '|' && i + 1 < n && input.charAt(i + 1) == '|') {
                tokens.add(new Token(Type.OR, "||", start));
                i += 2;
            } else if (c == '>' && i + 1 < n && input.charAt(i + 1) == '=') {
                tokens.add(new Token(Type.GTE, ">=", start));
                i += 2;
            } else if (c == '<' && i + 1 < n && input.charAt(i + 1) == '=') {
                tokens.add(new Token(Type.LTE, "<=", start));
                i += 2;
            } else if (c == '>') {
                tokens.add(new Token(Type.GT, ">", start));
                i++;
            } else if (c == '<') {
                tokens.add(new Token(Type.LT, "<", start));
                i++;
            } else if (c == '"' || c == '\'') {
                int from = ++i;
                while (i < n && input.charAt(i) != c) {
                    i++;
                }
                tokens.add(new Token(Type.STRING, input.substring(from, i), start));
                i++;
            } else if (Character.isDigit(c) || c == '-' || c == '.') {
                while (i < n && (Character.isDigit(input.charAt(i)) || input.charAt(i) == '.' || input.charAt(i) == '-')) {
                    i++;
                }
                tokens.add(new Token(Type.NUMBER, input.substring(start, i), start));
            } else if (Character.isLetter(c) || c == '_') {
                while (i < n && (Character.isLetterOrDigit(input.charAt(i)) || input.charAt(i) == '_' || input.charAt(i) == '.')) {
                    i++;
                }
                String word = input.substring(start, i);
                tokens.add(switch (word) {
                    case "true" -> new Token(Type.TRUE, word, start);
                    case "false" -> new Token(Type.FALSE, word, start);
                    case "null" -> new Token(Type.NULL, word, start);
                    case "in" -> new Token(Type.IN, word, start);
                    default -> new Token(Type.IDENT, word, start);
                });
            } else {
                throw new ExpressionError("Unexpected character '" + c + "' in expression: " + input, start);
            }
        }
        tokens.add(new Token(Type.EOF, "", n));
        return tokens;
    }

    private static List<Token> tokenizeV2(String input) {
        List<Token> tokens = new ArrayList<>();
        int i = 0;
        int n = input.length();
        while (i < n) {
            char c = input.charAt(i);
            int start = i;
            char next = i + 1 < n ? input.charAt(i + 1) : '\0';
            if (Character.isWhitespace(c)) {
                i++;
                continue;
            }
            switch (c) {
                case '(' -> tokens.add(new Token(Type.LPAREN, "(", start));
                case ')' -> tokens.add(new Token(Type.RPAREN, ")", start));
                case '[' -> tokens.add(new Token(Type.LBRACKET, "[", start));
                case ']' -> tokens.add(new Token(Type.RBRACKET, "]", start));
                case ',' -> tokens.add(new Token(Type.COMMA, ",", start));
                case '+' -> tokens.add(new Token(Type.PLUS, "+", start));
                case '-' -> tokens.add(new Token(Type.MINUS, "-", start));
                case '*' -> tokens.add(new Token(Type.STAR, "*", start));
                case '/' -> tokens.add(new Token(Type.SLASH, "/", start));
                case '%' -> tokens.add(new Token(Type.PERCENT, "%", start));
                case ':' -> tokens.add(new Token(Type.COLON, ":", start));
                default -> {
                    // multi-character and literal tokens below
                }
            }
            if ("()[],+-*/%:".indexOf(c) >= 0) {
                i++;
                continue;
            }
            if (c == '.' && !Character.isDigit(next)) {
                tokens.add(new Token(Type.DOT, ".", start));
                i++;
            } else if (c == '=' && next == '=') {
                tokens.add(new Token(Type.EQ, "==", start));
                i += 2;
            } else if (c == '=') {
                throw new ExpressionError("A single '=' is not an operator; compare with '=='", start);
            } else if (c == '!' && next == '=') {
                tokens.add(new Token(Type.NEQ, "!=", start));
                i += 2;
            } else if (c == '!') {
                tokens.add(new Token(Type.NOT, "!", start));
                i++;
            } else if (c == '&' && next == '&') {
                tokens.add(new Token(Type.AND, "&&", start));
                i += 2;
            } else if (c == '|' && next == '|') {
                tokens.add(new Token(Type.OR, "||", start));
                i += 2;
            } else if (c == '<' && next == '=') {
                tokens.add(new Token(Type.LTE, "<=", start));
                i += 2;
            } else if (c == '>' && next == '=') {
                tokens.add(new Token(Type.GTE, ">=", start));
                i += 2;
            } else if (c == '<') {
                tokens.add(new Token(Type.LT, "<", start));
                i++;
            } else if (c == '>') {
                tokens.add(new Token(Type.GT, ">", start));
                i++;
            } else if (c == '?' && next == '?') {
                tokens.add(new Token(Type.COALESCE, "??", start));
                i += 2;
            } else if (c == '?') {
                tokens.add(new Token(Type.QUESTION, "?", start));
                i++;
            } else if (c == '"' || c == '\'') {
                StringBuilder text = new StringBuilder();
                i++;
                boolean closed = false;
                while (i < n) {
                    char ch = input.charAt(i);
                    if (ch == c) {
                        closed = true;
                        i++;
                        break;
                    }
                    if (ch == '\\' && i + 1 < n) {
                        char esc = input.charAt(i + 1);
                        text.append(switch (esc) {
                            case 'n' -> '\n';
                            case 't' -> '\t';
                            default -> esc;
                        });
                        i += 2;
                        continue;
                    }
                    text.append(ch);
                    i++;
                }
                if (!closed) {
                    throw new ExpressionError("Unterminated string", start);
                }
                tokens.add(new Token(Type.STRING, text.toString(), start));
            } else if (Character.isDigit(c) || c == '.') {
                while (i < n && Character.isDigit(input.charAt(i))) {
                    i++;
                }
                if (i < n && input.charAt(i) == '.' && i + 1 < n && Character.isDigit(input.charAt(i + 1))) {
                    i++;
                    while (i < n && Character.isDigit(input.charAt(i))) {
                        i++;
                    }
                }
                tokens.add(new Token(Type.NUMBER, input.substring(start, i), start));
            } else if (Character.isLetter(c) || c == '_') {
                while (i < n && (Character.isLetterOrDigit(input.charAt(i)) || input.charAt(i) == '_')) {
                    i++;
                }
                String word = input.substring(start, i);
                if ("global".equals(word) && i < n && input.charAt(i) == ':'
                        && i + 1 < n && (Character.isLetter(input.charAt(i + 1)) || input.charAt(i + 1) == '_')) {
                    int from = ++i;
                    while (i < n && (Character.isLetterOrDigit(input.charAt(i)) || input.charAt(i) == '_' || input.charAt(i) == '-')) {
                        i++;
                    }
                    tokens.add(new Token(Type.GLOBAL, input.substring(from, i), start));
                    continue;
                }
                tokens.add(switch (word) {
                    case "true" -> new Token(Type.TRUE, word, start);
                    case "false" -> new Token(Type.FALSE, word, start);
                    case "null" -> new Token(Type.NULL, word, start);
                    case "in" -> new Token(Type.IN, word, start);
                    case "and" -> new Token(Type.AND, word, start);
                    case "or" -> new Token(Type.OR, word, start);
                    case "not" -> new Token(Type.NOT, word, start);
                    default -> new Token(Type.IDENT, word, start);
                });
            } else {
                throw new ExpressionError("Unexpected character '" + c + "'", start);
            }
        }
        tokens.add(new Token(Type.EOF, "", n));
        return tokens;
    }
}
