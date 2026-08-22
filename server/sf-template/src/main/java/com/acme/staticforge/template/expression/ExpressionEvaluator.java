package com.acme.staticforge.template.expression;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;

/**
 * The tiny {@code visibleWhen} expression grammar (spec §14.4):
 * {@code identifier (== | != | > | < | >= | <= | in) literal} combined with
 * {@code &&}, {@code ||}, {@code !} and parentheses. Evaluated identically by the
 * backend content validator and the Angular form engine (same test-fixture file).
 */
public final class ExpressionEvaluator {

    public boolean evaluate(String expression, JsonNode scope) {
        if (expression == null || expression.isBlank()) {
            return true;
        }
        Parser parser = new Parser(tokenize(expression), scope);
        boolean result = parser.parseOr();
        parser.expect(TokenType.EOF);
        return result;
    }

    /** Returns the identifiers referenced by the expression (used for grammar checks). */
    public List<String> identifiers(String expression) {
        List<String> ids = new ArrayList<>();
        for (Token t : tokenize(expression)) {
            if (t.type == TokenType.IDENT && !ids.contains(t.text)) {
                ids.add(t.text);
            }
        }
        return ids;
    }

    private static List<Token> tokenize(String input) {
        List<Token> tokens = new ArrayList<>();
        int i = 0;
        int n = input.length();
        while (i < n) {
            char c = input.charAt(i);
            if (Character.isWhitespace(c)) {
                i++;
            } else if (c == '(') {
                tokens.add(new Token(TokenType.LPAREN, "("));
                i++;
            } else if (c == ')') {
                tokens.add(new Token(TokenType.RPAREN, ")"));
                i++;
            } else if (c == '[') {
                tokens.add(new Token(TokenType.LBRACKET, "["));
                i++;
            } else if (c == ']') {
                tokens.add(new Token(TokenType.RBRACKET, "]"));
                i++;
            } else if (c == ',') {
                tokens.add(new Token(TokenType.COMMA, ","));
                i++;
            } else if (c == '=') {
                tokens.add(new Token(TokenType.EQ, "=="));
                i += 2;
            } else if (c == '!' && i + 1 < n && input.charAt(i + 1) == '=') {
                tokens.add(new Token(TokenType.NEQ, "!="));
                i += 2;
            } else if (c == '!') {
                tokens.add(new Token(TokenType.NOT, "!"));
                i++;
            } else if (c == '&' && i + 1 < n && input.charAt(i + 1) == '&') {
                tokens.add(new Token(TokenType.AND, "&&"));
                i += 2;
            } else if (c == '|' && i + 1 < n && input.charAt(i + 1) == '|') {
                tokens.add(new Token(TokenType.OR, "||"));
                i += 2;
            } else if (c == '>' && i + 1 < n && input.charAt(i + 1) == '=') {
                tokens.add(new Token(TokenType.GTE, ">="));
                i += 2;
            } else if (c == '<' && i + 1 < n && input.charAt(i + 1) == '=') {
                tokens.add(new Token(TokenType.LTE, "<="));
                i += 2;
            } else if (c == '>') {
                tokens.add(new Token(TokenType.GT, ">"));
                i++;
            } else if (c == '<') {
                tokens.add(new Token(TokenType.LT, "<"));
                i++;
            } else if (c == '"' || c == '\'') {
                int start = ++i;
                while (i < n && input.charAt(i) != c) {
                    i++;
                }
                tokens.add(new Token(TokenType.STRING, input.substring(start, i)));
                i++;
            } else if (Character.isDigit(c) || c == '-' || c == '.') {
                int start = i;
                while (i < n && (Character.isDigit(input.charAt(i))
                        || input.charAt(i) == '.'
                        || input.charAt(i) == '-')) {
                    i++;
                }
                tokens.add(new Token(TokenType.NUMBER, input.substring(start, i)));
            } else if (Character.isLetter(c) || c == '_') {
                int start = i;
                while (i < n && (Character.isLetterOrDigit(input.charAt(i)) || input.charAt(i) == '_' || input.charAt(i) == '.')) {
                    i++;
                }
                String word = input.substring(start, i);
                tokens.add(switch (word) {
                    case "true" -> new Token(TokenType.BOOL, "true");
                    case "false" -> new Token(TokenType.BOOL, "false");
                    case "null" -> new Token(TokenType.NULL, "null");
                    case "in" -> new Token(TokenType.IN, "in");
                    default -> new Token(TokenType.IDENT, word);
                });
            } else {
                throw new IllegalArgumentException("Unexpected character '" + c + "' in expression: " + input);
            }
        }
        tokens.add(new Token(TokenType.EOF, ""));
        return tokens;
    }

    private enum TokenType { IDENT, STRING, NUMBER, BOOL, NULL, AND, OR, NOT, EQ, NEQ, GT, LT, GTE, LTE, IN, LPAREN, RPAREN, LBRACKET, RBRACKET, COMMA, EOF }

    private record Token(TokenType type, String text) {}

    private static final class Parser {
        private final List<Token> tokens;
        private final JsonNode scope;
        private int pos;

        Parser(List<Token> tokens, JsonNode scope) {
            this.tokens = tokens;
            this.scope = scope;
        }

        boolean parseOr() {
            boolean left = parseAnd();
            while (peek().type == TokenType.OR) {
                next();
                boolean right = parseAnd();
                left = left || right;
            }
            return left;
        }

        private boolean parseAnd() {
            boolean left = parseNot();
            while (peek().type == TokenType.AND) {
                next();
                boolean right = parseNot();
                left = left && right;
            }
            return left;
        }

        private boolean parseNot() {
            if (peek().type == TokenType.NOT) {
                next();
                return !parseNot();
            }
            return parseComparison();
        }

        private boolean parseComparison() {
            JsonNode left = parseAtom();
            Token op = peek();
            if (op.type == TokenType.EQ || op.type == TokenType.NEQ || op.type == TokenType.GT
                    || op.type == TokenType.LT || op.type == TokenType.GTE || op.type == TokenType.LTE
                    || op.type == TokenType.IN) {
                next();
                JsonNode right = (op.type == TokenType.IN && peek().type == TokenType.LBRACKET)
                        ? parseArray()
                        : parseAtom();
                return compare(op.type, left, right);
            }
            return truthy(left);
        }

        private JsonNode parseAtom() {
            Token t = next();
            return switch (t.type) {
                case IDENT -> scopeValue(t.text);
                case STRING -> com.fasterxml.jackson.databind.node.TextNode.valueOf(t.text);
                case NUMBER -> com.fasterxml.jackson.databind.node.DoubleNode.valueOf(Double.parseDouble(t.text));
                case BOOL -> com.fasterxml.jackson.databind.node.BooleanNode.valueOf(Boolean.parseBoolean(t.text));
                case NULL -> com.fasterxml.jackson.databind.node.NullNode.getInstance();
                case LPAREN -> {
                    boolean v = parseOr();
                    expect(TokenType.RPAREN);
                    yield com.fasterxml.jackson.databind.node.BooleanNode.valueOf(v);
                }
                default -> throw new IllegalArgumentException("Unexpected token: " + t.type);
            };
        }

        private JsonNode parseArray() {
            expect(TokenType.LBRACKET);
            com.fasterxml.jackson.databind.node.ArrayNode array =
                    com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.arrayNode();
            if (peek().type == TokenType.RBRACKET) {
                next();
                return array;
            }
            while (true) {
                array.add(parseAtom());
                if (peek().type == TokenType.COMMA) {
                    next();
                } else {
                    expect(TokenType.RBRACKET);
                    return array;
                }
            }
        }

        private JsonNode scopeValue(String identifier) {
            if (scope == null || scope.isMissingNode() || scope.isNull()) {
                return com.fasterxml.jackson.databind.node.NullNode.getInstance();
            }
            String[] parts = identifier.split("\\.");
            JsonNode node = scope;
            for (String part : parts) {
                node = node.get(part);
                if (node == null) {
                    return com.fasterxml.jackson.databind.node.NullNode.getInstance();
                }
            }
            return node;
        }

        private static boolean compare(TokenType op, JsonNode left, JsonNode right) {
            return switch (op) {
                case EQ -> equalsNode(left, right);
                case NEQ -> !equalsNode(left, right);
                case GT -> cmp(left, right) > 0;
                case LT -> cmp(left, right) < 0;
                case GTE -> cmp(left, right) >= 0;
                case LTE -> cmp(left, right) <= 0;
                case IN -> inArray(right, left);
                default -> false;
            };
        }

        private static boolean equalsNode(JsonNode a, JsonNode b) {
            if (a.isNull() || b.isNull()) {
                return a.isNull() && b.isNull();
            }
            if (a.isNumber() && b.isNumber()) {
                return a.asDouble() == b.asDouble();
            }
            return a.equals(b);
        }

        private static int cmp(JsonNode a, JsonNode b) {
            if (a.isNumber() && b.isNumber()) {
                return Double.compare(a.asDouble(), b.asDouble());
            }
            return a.asText().compareTo(b.asText());
        }

        private static boolean inArray(JsonNode array, JsonNode value) {
            if (array.isArray()) {
                for (JsonNode e : array) {
                    if (equalsNode(e, value)) {
                        return true;
                    }
                }
                return false;
            }
            if (array.isTextual()) {
                return array.asText().contains(value.asText());
            }
            return false;
        }

        private static boolean truthy(JsonNode node) {
            if (node == null || node.isNull() || node.isMissingNode()) {
                return false;
            }
            if (node.isBoolean()) {
                return node.asBoolean();
            }
            if (node.isNumber()) {
                return node.asDouble() != 0;
            }
            if (node.isTextual()) {
                return !node.asText().isEmpty();
            }
            if (node.isContainerNode()) {
                return node.size() > 0;
            }
            return true;
        }

        private Token peek() {
            return tokens.get(pos);
        }

        private Token next() {
            return tokens.get(pos++);
        }

        private void expect(TokenType type) {
            Token t = next();
            if (t.type != type) {
                throw new IllegalArgumentException("Expected " + type + " but got " + t.type);
            }
        }
    }
}
