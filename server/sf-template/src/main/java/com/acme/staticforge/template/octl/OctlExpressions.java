package com.acme.staticforge.template.octl;

/**
 * Public entry point to the OCTL expression grammar (spec §16.9) outside a {@code $CMS_…$}
 * instruction: the grammar {@code $CMS_IF} uses, parsed strictly. It exists for the dataset query
 * model (M19.3.1), whose {@code where} argument is an OCTL expression carried in a string.
 *
 * <p>The instruction parser is lenient by design (a template keeps compiling around a typo and
 * the renderer degrades to empty). A standalone expression has no surrounding template to fall
 * back on, so this entry point rejects what the lenient parser would silently accept: input left
 * over after the expression, an operand that is not a value, an unbalanced parenthesis or bracket
 * and an unterminated string.
 */
public final class OctlExpressions {

    private OctlExpressions() {}

    /**
     * The result of parsing one expression.
     *
     * @param expr the parsed expression, {@code null} when {@code error} is set
     * @param error what is wrong, {@code null} on success
     * @param column the 1-based column of the problem within the source, {@code 0} on success
     */
    public record Parsed(Expr expr, String error, int column) {

        public boolean ok() {
            return error == null;
        }

        static Parsed failure(String error, int column) {
            return new Parsed(null, error, column);
        }
    }

    /** Parses {@code source} as a single OCTL expression. A blank source is an error. */
    public static Parsed parse(String source) {
        String text = source == null ? "" : source;
        if (text.isBlank()) {
            return Parsed.failure("Expression is empty", 1);
        }
        Parsed structural = checkDelimiters(text);
        if (structural != null) {
            return structural;
        }

        OctlParser.Cursor cursor = new OctlParser.Cursor(text);
        Expr expr = new OctlParser(java.util.List.of()).parseExpr(cursor);
        cursor.skipWs();
        if (!cursor.eof()) {
            return Parsed.failure("Unexpected input '" + text.substring(cursor.pos).trim() + "'", cursor.pos + 1);
        }
        if (hasEmptyOperand(expr)) {
            return Parsed.failure("Expected a value", emptyOperandColumn(text));
        }
        return new Parsed(expr, null, 0);
    }

    /**
     * Prints an expression back to source that {@link #parse} turns into the same tree (M25.1.2): the
     * inverse of parsing up to formatting. Operators get single spaces, strings single quotes (with
     * {@code \} escapes), groups keep their parentheses and nothing else is added — the tree already
     * encodes precedence, since every parenthesis the author wrote is a {@link Expr.Group}. Used to
     * store a query rewritten on the tree (a schema rename) rather than by string replacement.
     */
    public static String print(Expr expr) {
        StringBuilder out = new StringBuilder();
        print(expr, out);
        return out.toString();
    }

    private static void print(Expr expr, StringBuilder out) {
        switch (expr) {
            case Expr.Literal l -> printLiteral(l.value(), out);
            case Expr.Access a -> {
                printAccessor(a.accessor(), out);
                for (FilterNode filter : a.filters()) {
                    out.append('|').append(filter.name());
                    if (!filter.args().isEmpty()) {
                        out.append('(');
                        for (int i = 0; i < filter.args().size(); i++) {
                            if (i > 0) {
                                out.append(", ");
                            }
                            printFilterArg(filter.args().get(i), out);
                        }
                        out.append(')');
                    }
                }
            }
            case Expr.Group g -> {
                out.append('(');
                print(g.inner(), out);
                out.append(')');
            }
            case Expr.Not n -> {
                out.append('!');
                print(n.operand(), out);
            }
            case Expr.And a -> {
                print(a.left(), out);
                out.append(" && ");
                print(a.right(), out);
            }
            case Expr.Or o -> {
                print(o.left(), out);
                out.append(" || ");
                print(o.right(), out);
            }
            case Expr.Cmp c -> {
                print(c.left(), out);
                out.append(' ').append(c.operator()).append(' ');
                print(c.right(), out);
            }
        }
    }

    private static void printAccessor(Accessor accessor, StringBuilder out) {
        if (accessor.isAssetReference()) {
            out.append(accessor.assetType()).append(':').append(accessor.uid());
            accessor.path().forEach(segment -> out.append('.').append(segment));
        } else {
            out.append(String.join(".", accessor.path()));
        }
    }

    private static void printLiteral(com.fasterxml.jackson.databind.JsonNode value, StringBuilder out) {
        if (value == null || value.isNull() || value.isMissingNode()) {
            out.append("null");
        } else if (value.isArray()) {
            out.append('[');
            for (int i = 0; i < value.size(); i++) {
                if (i > 0) {
                    out.append(", ");
                }
                printLiteral(value.get(i), out);
            }
            out.append(']');
        } else if (value.isNumber()) {
            // Plain notation: the parser reads digits and '.', never an exponent.
            out.append(value.isIntegralNumber() ? value.asText() : value.decimalValue().toPlainString());
        } else if (value.isBoolean()) {
            out.append(value.asBoolean());
        } else {
            printString(value.asText(), out);
        }
    }

    /** A filter argument is kept as decoded text; a plain word or number prints bare, anything else quoted. */
    private static void printFilterArg(String arg, StringBuilder out) {
        boolean bare = !arg.isEmpty();
        for (int i = 0; i < arg.length() && bare; i++) {
            char c = arg.charAt(i);
            bare = Character.isLetterOrDigit(c) || c == '_' || c == '-' || c == '.';
        }
        if (bare) {
            out.append(arg);
        } else {
            printString(arg, out);
        }
    }

    private static void printString(String text, StringBuilder out) {
        out.append('\'');
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            switch (c) {
                case '\\' -> out.append("\\\\");
                case '\'' -> out.append("\\'");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> out.append(c);
            }
        }
        out.append('\'');
    }

    /** Unbalanced {@code ()}/{@code []} or an unterminated string, outside quoted text. */
    private static Parsed checkDelimiters(String text) {
        java.util.Deque<Integer> open = new java.util.ArrayDeque<>();
        java.util.Deque<Character> kinds = new java.util.ArrayDeque<>();
        int i = 0;
        while (i < text.length()) {
            char c = text.charAt(i);
            if (c == '"' || c == '\'') {
                int start = i;
                i++;
                boolean closed = false;
                while (i < text.length()) {
                    char d = text.charAt(i);
                    if (d == '\\' && i + 1 < text.length()) {
                        i += 2;
                    } else if (d == c) {
                        closed = true;
                        break;
                    } else {
                        i++;
                    }
                }
                if (!closed) {
                    return Parsed.failure("Unterminated string", start + 1);
                }
            } else if (c == '(' || c == '[') {
                open.push(i);
                kinds.push(c);
            } else if (c == ')' || c == ']') {
                char expected = c == ')' ? '(' : '[';
                if (kinds.isEmpty() || kinds.peek() != expected) {
                    return Parsed.failure("Unexpected '" + c + "'", i + 1);
                }
                open.pop();
                kinds.pop();
            }
            i++;
        }
        if (!open.isEmpty()) {
            return Parsed.failure("Unclosed '" + kinds.peek() + "'", open.peek() + 1);
        }
        return null;
    }

    private static boolean hasEmptyOperand(Expr expr) {
        return switch (expr) {
            case Expr.Literal l -> false;
            case Expr.Access a -> isEmpty(a.accessor());
            case Expr.Group g -> hasEmptyOperand(g.inner());
            case Expr.Not n -> hasEmptyOperand(n.operand());
            case Expr.And a -> hasEmptyOperand(a.left()) || hasEmptyOperand(a.right());
            case Expr.Or o -> hasEmptyOperand(o.left()) || hasEmptyOperand(o.right());
            case Expr.Cmp c -> hasEmptyOperand(c.left()) || hasEmptyOperand(c.right());
        };
    }

    private static boolean isEmpty(Accessor accessor) {
        if (accessor.isAssetReference()) {
            return accessor.uid() == null || accessor.uid().isEmpty() || accessor.path().contains("");
        }
        return accessor.path().isEmpty() || accessor.path().contains("");
    }

    /**
     * Best-effort position of a missing operand: right after the last operator in the source, or
     * the end of the source. The lenient parser does not keep positions on AST nodes.
     */
    private static int emptyOperandColumn(String text) {
        String trimmed = text.stripTrailing();
        return trimmed.length() + 1;
    }
}
