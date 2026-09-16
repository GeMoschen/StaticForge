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
