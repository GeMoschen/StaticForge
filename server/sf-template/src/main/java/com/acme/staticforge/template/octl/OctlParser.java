package com.acme.staticforge.template.octl;

import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.BooleanNode;
import com.fasterxml.jackson.databind.node.DoubleNode;
import com.fasterxml.jackson.databind.node.IntNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.TextNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Recursive-descent OCTL parser (spec §16.9). Consumes the lexer's text/instruction token
 * stream and produces the immutable {@link OctlNode} AST, emitting positioned diagnostics
 * for unknown instructions ({@code SF-TPL-0101}) and unbalanced blocks ({@code SF-TPL-0102}).
 *
 * <p>The inner grammar (accessors, expressions, filters, named arguments) is parsed with a
 * lightweight character cursor over each instruction body.
 */
final class OctlParser {

    /**
     * The comparison operators spelled as words: {@code in}, {@code contains} (text containment, or list
     * membership — {@code a contains b} is {@code b in a}), {@code startsWith} and {@code endsWith} (text prefix
     * and suffix).
     */
    private static final Set<String> WORD_OPERATORS = Set.of("in", "contains", "startsWith", "endsWith");

    record ParseResult(List<OctlNode> nodes, List<Diagnostic> diagnostics) {}

    private final List<OctlLexer.Token> tokens;
    private final List<Diagnostic> diagnostics = new ArrayList<>();
    private int pos;

    OctlParser(List<OctlLexer.Token> tokens) {
        this.tokens = tokens;
    }

    ParseResult parse() {
        List<OctlNode> nodes = parseSequence(Set.of());
        return new ParseResult(nodes, diagnostics);
    }

    private List<OctlNode> parseSequence(Set<String> stop) {
        List<OctlNode> out = new ArrayList<>();
        while (!atEnd()) {
            OctlLexer.Token t = peek();
            if (!t.isInstruction()) {
                next();
                out.add(new OctlNode.Text(t.text()));
                continue;
            }
            String kw = keyword(t.text());
            if (stop.contains(kw)) {
                break;
            }
            next();
            parseInstruction(kw, t, out);
        }
        return out;
    }

    private void parseInstruction(String keyword, OctlLexer.Token token, List<OctlNode> out) {
        int line = token.line();
        int col = token.col();
        switch (keyword) {
            case "VALUE" -> out.add(parseValue(token, line, col));
            case "REF" -> {
                Cursor c = cursor(token);
                Accessor accessor = parseAccessor(c);
                List<NamedArg> args = parseRefArgs(c);
                out.add(new OctlNode.Ref(accessor, args, line, col));
            }
            case "BODY" -> {
                Cursor c = cursor(token);
                c.skipWs();
                String name = c.readIdent();
                out.add(new OctlNode.Body(name, line, col));
            }
            case "INCLUDE" -> {
                Cursor c = cursor(token);
                Accessor accessor = parseAccessor(c);
                List<NamedArg> args = parseNamedArgs(c);
                out.add(new OctlNode.Include(accessor, args, line, col));
            }
            case "NAVIGATION" -> out.add(parseNavigation(token, line, col));
            case "NAVIGATION_RECURSE" -> {
                Cursor c = cursor(token);
                c.skipWs();
                String variable = c.readIdent();
                out.add(new OctlNode.NavigationRecurse(variable, line, col));
            }
            case "SET" -> {
                Cursor c = cursor(token);
                c.skipWs();
                String name = c.readIdent();
                c.skipWs();
                c.expect('=');
                Expr expr = parseExpr(c);
                out.add(new OctlNode.Set(name, expr, line, col));
            }
            case "META" -> {
                Cursor c = cursor(token);
                Accessor accessor = parseAccessor(c);
                List<FilterNode> filters = parseFilters(c);
                out.add(new OctlNode.Meta(accessor, filters, line, col));
            }
            case "IF" -> out.add(parseIf(token, line, col));
            case "FOR" -> out.add(parseFor(token, line, col));
            case "COMMENT" -> parseComment(line, col);
            case "EXTENDS" -> out.add(new OctlNode.Extends(parseAccessor(cursor(token)), line, col));
            case "BLOCK" -> out.add(parseBlock(token, line, col));
            case "PARENT" -> out.add(new OctlNode.Parent(token.text().indexOf('(') >= 0, line, col));
            default -> diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.OCTL_UNKNOWN_INSTRUCTION,
                    "Unknown instruction: " + keyword, line, col));
        }
    }

    private OctlNode.Value parseValue(OctlLexer.Token token, int line, int col) {
        Cursor c = cursor(token);
        Accessor accessor = parseAccessor(c);
        List<FilterNode> filters = parseFilters(c);
        List<NamedArg> args = parseNamedArgs(c);
        return new OctlNode.Value(accessor, filters, args, line, col);
    }

    private OctlNode.If parseIf(OctlLexer.Token token, int line, int col) {
        Expr first = parseExpr(cursor(token));
        List<OctlNode.Branch> branches = new ArrayList<>();
        branches.add(new OctlNode.Branch(first, parseSequence(Set.of("ELSEIF", "ELSE", "END_IF"))));

        while (isInstruction("ELSEIF")) {
            OctlLexer.Token t = next();
            Expr cond = parseExpr(cursor(t));
            branches.add(new OctlNode.Branch(cond, parseSequence(Set.of("ELSEIF", "ELSE", "END_IF"))));
        }

        List<OctlNode> elseBody = List.of();
        if (isInstruction("ELSE")) {
            next();
            elseBody = parseSequence(Set.of("END_IF"));
        }

        if (!consumeInstruction("END_IF")) {
            diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.OCTL_UNBALANCED_BLOCK,
                    "Unbalanced block: $CMS_IF$ without $CMS_END_IF$", line, col));
        }
        return new OctlNode.If(branches, elseBody, line, col);
    }

    private OctlNode.For parseFor(OctlLexer.Token token, int line, int col) {
        Cursor c = cursor(token);
        c.skipWs();
        String variable = c.readIdent();
        c.skipWs();
        c.expect(':');
        Accessor accessor = parseAccessor(c);
        List<NamedArg> args = parseNamedArgs(c);
        List<OctlNode> body = parseSequence(Set.of("END_FOR"));
        if (!consumeInstruction("END_FOR")) {
            diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.OCTL_UNBALANCED_BLOCK,
                    "Unbalanced block: $CMS_FOR$ without $CMS_END_FOR$", line, col));
        }
        return new OctlNode.For(variable, accessor, args, body, line, col);
    }

    /**
     * {@code $CMS_NAVIGATION(nav:uid [, args])$} (leaf form) or {@code $CMS_NAVIGATION(nav:uid
     * [, args]) as item$ … $CMS_END_NAVIGATION$} (block form). The {@code as item} clause lives
     * *after* the closing paren, outside what {@link #cursor} exposes (it only sees the
     * parenthesized content), so it's read separately from the token's raw text.
     */
    private OctlNode.Navigation parseNavigation(OctlLexer.Token token, int line, int col) {
        Cursor c = cursor(token);
        Accessor accessor = parseAccessor(c);
        List<NamedArg> args = parseNamedArgs(c);

        String tail = afterParen(token.text()).trim();
        if (!tail.startsWith("as")) {
            return new OctlNode.Navigation(accessor, args, null, List.of(), line, col);
        }
        Cursor tailCursor = new Cursor(tail);
        tailCursor.readIdent(); // "as"
        tailCursor.skipWs();
        String variable = tailCursor.readIdent();

        List<OctlNode> body = parseSequence(Set.of("END_NAVIGATION"));
        if (!consumeInstruction("END_NAVIGATION")) {
            diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.OCTL_UNBALANCED_BLOCK,
                    "Unbalanced block: $CMS_NAVIGATION$ without $CMS_END_NAVIGATION$", line, col));
        }
        return new OctlNode.Navigation(accessor, args, variable, body, line, col);
    }

    /** {@code $CMS_BLOCK(name)$ … $CMS_END_BLOCK$}; blocks may nest. The name is checked by the compiler. */
    private OctlNode.Block parseBlock(OctlLexer.Token token, int line, int col) {
        Cursor c = cursor(token);
        c.skipWs();
        String name = c.readIdent();
        List<OctlNode> body = parseSequence(Set.of("END_BLOCK"));
        if (!consumeInstruction("END_BLOCK")) {
            diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.OCTL_UNBALANCED_BLOCK,
                    "Unbalanced block: $CMS_BLOCK(" + name + ")$ without $CMS_END_BLOCK$", line, col));
        }
        return new OctlNode.Block(name, body, line, col);
    }

    private void parseComment(int line, int col) {
        // Discard everything up to and including $CMS_END_COMMENT$.
        while (!atEnd()) {
            if (isInstruction("END_COMMENT")) {
                next();
                return;
            }
            next();
        }
        diagnostics.add(Diagnostic.error(
                DiagnosticCodes.OCTL_UNBALANCED_BLOCK,
                "Unbalanced block: $CMS_COMMENT$ without $CMS_END_COMMENT$", line, col));
    }

    // ------------------------------------------------------------------
    // Inner grammar
    // ------------------------------------------------------------------

    private Accessor parseAccessor(Cursor c) {
        c.skipWs();
        String first = c.readIdent();
        c.skipWs();
        if (c.tryConsume(':')) {
            String assetType = first;
            c.skipWs();
            String uid = c.readIdent();
            List<String> path = new ArrayList<>();
            c.skipWs();
            while (c.tryConsumeStart(".")) {
                c.skipWs();
                path.add(c.readIdent());
                c.skipWs();
            }
            return new Accessor(assetType, uid, path);
        }
        List<String> path = new ArrayList<>();
        path.add(first);
        c.skipWs();
        while (c.tryConsumeStart(".")) {
            c.skipWs();
            String seg = c.readIdent();
            path.add(seg);
            c.skipWs();
        }
        return Accessor.scope(path);
    }

    private List<FilterNode> parseFilters(Cursor c) {
        List<FilterNode> filters = new ArrayList<>();
        while (true) {
            c.skipWs();
            if (!c.tryConsumeStart("|")) {
                break;
            }
            if (c.startsWith("|")) {
                // An empty pipe (||) — not a filter; leave it.
                c.back();
                break;
            }
            c.skipWs();
            String name = c.readIdent();
            List<String> args = List.of();
            c.skipWs();
            if (c.tryConsumeStart("(")) {
                args = parseArgs(c);
                c.skipWs();
                c.expect(')');
            }
            filters.add(new FilterNode(name, args));
        }
        return filters;
    }

    private List<String> parseArgs(Cursor c) {
        List<String> args = new ArrayList<>();
        while (true) {
            c.skipWs();
            if (c.eof() || c.peek() == ')') {
                break;
            }
            args.add(parseArgValue(c));
            c.skipWs();
            if (!c.tryConsumeStart(",")) {
                break;
            }
        }
        return args;
    }

    private String parseArgValue(Cursor c) {
        c.skipWs();
        if (c.startsWith("\"") || c.startsWith("'")) {
            return c.readString();
        }
        int start = c.pos;
        while (!c.eof() && c.peek() != ',' && c.peek() != ')') {
            c.advance();
        }
        String v = c.s.substring(start, c.pos).trim();
        c.skipWs();
        return v;
    }

    private List<NamedArg> parseNamedArgs(Cursor c) {
        List<NamedArg> args = new ArrayList<>();
        while (true) {
            c.skipWs();
            if (!c.tryConsumeStart(",")) {
                break;
            }
            c.skipWs();
            String name = c.readIdent();
            c.skipWs();
            c.expect('=');
            c.skipWs();
            String value = c.startsWith("\"") || c.startsWith("'") ? c.readString() : c.readIdent();
            args.add(new NamedArg(name, value));
        }
        return args;
    }

    /**
     * The named arguments of a {@code $CMS_REF}: a quoted value is literal; an unquoted one is a dotted path evaluated
     * at render time ({@code locale=l}, {@code locale=l.code}), whose single word falls back to its literal text when it
     * resolves to nothing ({@link NamedArg#expression()}).
     */
    private List<NamedArg> parseRefArgs(Cursor c) {
        List<NamedArg> args = new ArrayList<>();
        while (true) {
            c.skipWs();
            if (!c.tryConsumeStart(",")) {
                break;
            }
            c.skipWs();
            String name = c.readIdent();
            c.skipWs();
            c.expect('=');
            c.skipWs();
            if (c.startsWith("\"") || c.startsWith("'")) {
                args.add(new NamedArg(name, c.readString()));
                continue;
            }
            List<String> path = new ArrayList<>();
            path.add(c.readIdent());
            c.skipWs();
            while (c.tryConsumeStart(".")) {
                c.skipWs();
                path.add(c.readIdent());
                c.skipWs();
            }
            args.add(new NamedArg(name, String.join(".", path), Accessor.scope(path)));
        }
        return args;
    }

    // Expr grammar (§16.9)
    Expr parseExpr(Cursor c) {
        return parseOr(c);
    }

    private Expr parseOr(Cursor c) {
        Expr left = parseAnd(c);
        while (true) {
            c.skipWs();
            if (c.tryConsumeStart("||")) {
                Expr right = parseAnd(c);
                left = new Expr.Or(left, right);
            } else {
                return left;
            }
        }
    }

    private Expr parseAnd(Cursor c) {
        Expr left = parseCmp(c);
        while (true) {
            c.skipWs();
            if (c.tryConsumeStart("&&")) {
                Expr right = parseCmp(c);
                left = new Expr.And(left, right);
            } else {
                return left;
            }
        }
    }

    private Expr parseCmp(Cursor c) {
        Expr left = parseUnary(c);
        c.skipWs();
        String op = matchOperator(c);
        if (op == null) {
            return left;
        }
        c.skipWs();
        Expr right = parseUnary(c);
        return new Expr.Cmp(op, left, right);
    }

    private Expr parseUnary(Cursor c) {
        c.skipWs();
        if (c.tryConsumeStart("!")) {
            Expr operand = parseUnary(c);
            return new Expr.Not(operand);
        }
        return parseAtom(c);
    }

    private Expr parseAtom(Cursor c) {
        c.skipWs();
        if (c.tryConsumeStart("(")) {
            Expr inner = parseExpr(c);
            c.skipWs();
            c.expect(')');
            return new Expr.Group(inner);
        }
        if (c.startsWith("[")) {
            return new Expr.Literal(parseArrayLiteral(c));
        }
        if (c.startsWith("\"") || c.startsWith("'")) {
            return new Expr.Literal(TextNode.valueOf(c.readString()));
        }
        if (Character.isDigit(c.peekSafe()) || c.peekSafe() == '-') {
            return new Expr.Literal(parseNumber(c));
        }
        // Accessor (with optional filter chain), boolean, or null.
        String word = c.readWord();
        if ("true".equals(word)) {
            return new Expr.Literal(BooleanNode.TRUE);
        }
        if ("false".equals(word)) {
            return new Expr.Literal(BooleanNode.FALSE);
        }
        if ("null".equals(word)) {
            return new Expr.Literal(NullNode.getInstance());
        }
        // Re-parse as accessor using the word we just consumed.
        Accessor accessor = accessorFrom(c, word);
        List<FilterNode> filters = parseFilters(c);
        return new Expr.Access(accessor, filters);
    }

    private Accessor accessorFrom(Cursor c, String firstWord) {
        c.skipWs();
        if (c.tryConsumeStart(":")) {
            c.skipWs();
            String uid = c.readIdent();
            List<String> path = new ArrayList<>();
            c.skipWs();
            while (c.tryConsumeStart(".")) {
                c.skipWs();
                path.add(c.readIdent());
                c.skipWs();
            }
            return new Accessor(firstWord, uid, path);
        }
        List<String> path = new ArrayList<>();
        path.add(firstWord);
        c.skipWs();
        while (c.tryConsumeStart(".")) {
            c.skipWs();
            path.add(c.readIdent());
            c.skipWs();
        }
        return Accessor.scope(path);
    }

    private JsonNode parseArrayLiteral(Cursor c) {
        c.expect('[');
        var array = JsonNodeFactory.instance.arrayNode();
        while (true) {
            c.skipWs();
            if (c.tryConsumeStart("]")) {
                break;
            }
            c.skipWs();
            if (c.startsWith("\"") || c.startsWith("'")) {
                array.add(TextNode.valueOf(c.readString()));
            } else if (Character.isDigit(c.peekSafe()) || c.peekSafe() == '-') {
                array.add(parseNumber(c));
            } else {
                array.add(TextNode.valueOf(c.readWord()));
            }
            c.skipWs();
            if (!c.tryConsumeStart(",")) {
                c.skipWs();
                c.expect(']');
                break;
            }
        }
        return array;
    }

    private JsonNode parseNumber(Cursor c) {
        int start = c.pos;
        if (c.peekSafe() == '-') {
            c.advance();
        }
        boolean decimal = false;
        while (!c.eof() && (Character.isDigit(c.peekSafe()) || c.peekSafe() == '.')) {
            if (c.peekSafe() == '.') {
                decimal = true;
            }
            c.advance();
        }
        String text = c.s.substring(start, c.pos);
        try {
            if (decimal) {
                return DoubleNode.valueOf(Double.parseDouble(text));
            }
            return IntNode.valueOf(Integer.parseInt(text));
        } catch (NumberFormatException e) {
            return TextNode.valueOf(text);
        }
    }

    private String matchOperator(Cursor c) {
        if (c.tryConsumeStart("==")) {
            return "==";
        }
        if (c.tryConsumeStart("!=")) {
            return "!=";
        }
        if (c.tryConsumeStart("<=")) {
            return "<=";
        }
        if (c.tryConsumeStart(">=")) {
            return ">=";
        }
        if (c.startsWith("<")) {
            c.advance();
            return "<";
        }
        if (c.startsWith(">")) {
            c.advance();
            return ">";
        }
        c.skipWs();
        int mark = c.pos;
        String word = c.readWord();
        if (WORD_OPERATORS.contains(word)) {
            return word;
        }
        c.pos = mark;
        return null;
    }

    // ------------------------------------------------------------------
    // Token-stream helpers
    // ------------------------------------------------------------------

    /** The instruction keyword at the start of a raw {@code $CMS_…$} token body ({@code VALUE}, {@code END_IF}, …). */
    static String keyword(String raw) {
        int i = 0;
        int n = raw.length();
        while (i < n) {
            char ch = raw.charAt(i);
            if (Character.isUpperCase(ch) || ch == '_' || Character.isDigit(ch)) {
                i++;
            } else {
                break;
            }
        }
        return raw.substring(0, i);
    }

    private static String parenContent(String raw) {
        int open = raw.indexOf('(');
        if (open < 0) {
            return "";
        }
        int close = raw.lastIndexOf(')');
        if (close <= open) {
            return raw.substring(open + 1).trim();
        }
        return raw.substring(open + 1, close).trim();
    }

    private static Cursor cursor(OctlLexer.Token token) {
        return new Cursor(parenContent(token.text()));
    }

    /** Raw text following the instruction's closing paren (e.g. {@code "as item"}); {@code ""} if none. */
    private static String afterParen(String raw) {
        int close = raw.lastIndexOf(')');
        return close < 0 || close + 1 >= raw.length() ? "" : raw.substring(close + 1);
    }

    private boolean isInstruction(String kw) {
        return !atEnd() && peek().isInstruction() && keyword(peek().text()).equals(kw);
    }

    private boolean consumeInstruction(String kw) {
        if (isInstruction(kw)) {
            next();
            return true;
        }
        return false;
    }

    private boolean atEnd() {
        return pos >= tokens.size();
    }

    private OctlLexer.Token peek() {
        return tokens.get(Math.min(pos, tokens.size() - 1));
    }

    private OctlLexer.Token next() {
        return tokens.get(pos++);
    }

    /**
     * A lightweight cursor over an instruction body (or sub-expression) with whitespace and
     * quoting support. Used for the accessor/expr/filter/named-arg grammar.
     */
    static final class Cursor {
        final String s;
        int pos;

        Cursor(String s) {
            this.s = s == null ? "" : s;
        }

        boolean eof() {
            return pos >= s.length();
        }

        char peek() {
            return s.charAt(pos);
        }

        char peekSafe() {
            return pos < s.length() ? s.charAt(pos) : '\0';
        }

        void advance() {
            pos++;
        }

        void back() {
            if (pos > 0) {
                pos--;
            }
        }

        boolean startsWith(String prefix) {
            return s.startsWith(prefix, pos);
        }

        void skipWs() {
            while (pos < s.length() && Character.isWhitespace(s.charAt(pos))) {
                pos++;
            }
        }

        boolean tryConsume(char c) {
            skipWs();
            if (pos < s.length() && s.charAt(pos) == c) {
                pos++;
                return true;
            }
            return false;
        }

        boolean tryConsumeStart(String prefix) {
            if (pos < s.length() && s.startsWith(prefix, pos)) {
                // Guard against treating "||"/"&&" as a single "|"/"&" inside nested calls.
                pos += prefix.length();
                return true;
            }
            return false;
        }

        void expect(char c) {
            skipWs();
            if (pos < s.length() && s.charAt(pos) == c) {
                pos++;
            }
        }

        String readIdent() {
            skipWs();
            int start = pos;
            while (pos < s.length() && isIdentChar(s.charAt(pos))) {
                pos++;
            }
            return s.substring(start, pos);
        }

        String readWord() {
            skipWs();
            int start = pos;
            while (pos < s.length() && isIdentChar(s.charAt(pos))) {
                pos++;
            }
            return s.substring(start, pos);
        }

        String readString() {
            skipWs();
            if (pos >= s.length()) {
                return "";
            }
            char quote = s.charAt(pos);
            pos++;
            StringBuilder sb = new StringBuilder();
            while (pos < s.length()) {
                char c = s.charAt(pos);
                if (c == '\\' && pos + 1 < s.length()) {
                    pos++;
                    char nx = s.charAt(pos);
                    sb.append(switch (nx) {
                        case 'n' -> '\n';
                        case 't' -> '\t';
                        case 'r' -> '\r';
                        case '"' -> '"';
                        case '\'' -> '\'';
                        case '\\' -> '\\';
                        default -> nx;
                    });
                    pos++;
                } else if (c == quote) {
                    pos++;
                    break;
                } else {
                    sb.append(c);
                    pos++;
                }
            }
            return sb.toString();
        }

        private static boolean isIdentChar(char c) {
            return Character.isLetterOrDigit(c) || c == '_' || c == '-';
        }
    }
}
