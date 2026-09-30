package com.acme.staticforge.template.expression;

import com.acme.staticforge.template.expression.ExpressionLexer.Token;
import com.acme.staticforge.template.expression.ExpressionLexer.Type;
import com.acme.staticforge.template.expression.ExpressionNode.BinaryOp;
import com.acme.staticforge.template.expression.ExpressionNode.UnaryOp;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.BooleanNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.TextNode;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Builds the syntax tree of an expression (M33.1).
 *
 * <p>{@link ExpressionMode#V1} is the original recursive descent, unchanged: {@code or → and → not → comparison}, where a
 * comparison is {@code atom [op (atom | [atoms])]} and a bare atom is tested for truthiness, so {@code !} applies to the
 * whole comparison. {@link ExpressionMode#V2} has the usual precedence, lowest first: ternary {@code ?:}, {@code ??},
 * {@code or}/{@code ||}, {@code and}/{@code &&}, comparisons and {@code in} (not chained), {@code + -},
 * {@code * / %}, unary {@code ! not -}, then member access {@code .name}, indexing {@code [i]} and calls.
 */
final class ExpressionParser {

    private final List<Token> tokens;
    private final ExpressionMode mode;
    private int pos;

    private ExpressionParser(List<Token> tokens, ExpressionMode mode) {
        this.tokens = tokens;
        this.mode = mode;
    }

    static ExpressionNode parse(String source, ExpressionMode mode) {
        ExpressionParser parser = new ExpressionParser(ExpressionLexer.tokenize(source, mode), mode);
        ExpressionNode node = mode == ExpressionMode.V1 ? parser.v1Or() : parser.ternary();
        Token end = parser.peek();
        if (end.type() != Type.EOF) {
            throw new ExpressionError("Unexpected '" + end.text() + "'", end.pos());
        }
        return node;
    }

    // ------------------------------------------------------------------
    // v1
    // ------------------------------------------------------------------

    private ExpressionNode v1Or() {
        ExpressionNode left = v1And();
        while (peek().type() == Type.OR) {
            Token op = next();
            left = new ExpressionNode.Binary(BinaryOp.OR, left, v1And(), true, op.pos());
        }
        return left;
    }

    private ExpressionNode v1And() {
        ExpressionNode left = v1Not();
        while (peek().type() == Type.AND) {
            Token op = next();
            left = new ExpressionNode.Binary(BinaryOp.AND, left, v1Not(), true, op.pos());
        }
        return left;
    }

    private ExpressionNode v1Not() {
        if (peek().type() == Type.NOT) {
            Token op = next();
            return new ExpressionNode.Unary(UnaryOp.NOT, v1Not(), op.pos());
        }
        return v1Comparison();
    }

    private ExpressionNode v1Comparison() {
        ExpressionNode left = v1Atom();
        BinaryOp op = comparisonOp(peek().type());
        if (op != null) {
            Token opToken = next();
            ExpressionNode right = op == BinaryOp.IN && peek().type() == Type.LBRACKET ? v1Array() : v1Atom();
            return new ExpressionNode.Binary(op, left, right, true, opToken.pos());
        }
        return new ExpressionNode.Unary(UnaryOp.TRUTHY, left, left.pos());
    }

    private ExpressionNode v1Atom() {
        Token t = next();
        return switch (t.type()) {
            case IDENT -> new ExpressionNode.Ident(Arrays.asList(t.text().split("\\.")), t.pos());
            case STRING -> new ExpressionNode.Literal(TextNode.valueOf(t.text()), t.pos());
            case NUMBER -> new ExpressionNode.Literal(number(t), t.pos());
            case TRUE -> new ExpressionNode.Literal(BooleanNode.TRUE, t.pos());
            case FALSE -> new ExpressionNode.Literal(BooleanNode.FALSE, t.pos());
            case NULL -> new ExpressionNode.Literal(NullNode.getInstance(), t.pos());
            case LPAREN -> {
                ExpressionNode inner = v1Or();
                expect(Type.RPAREN);
                yield new ExpressionNode.Unary(UnaryOp.TRUTHY, inner, t.pos());
            }
            default -> throw new ExpressionError("Unexpected token: " + t.type(), t.pos());
        };
    }

    private ExpressionNode v1Array() {
        Token open = expect(Type.LBRACKET);
        List<ExpressionNode> items = new ArrayList<>();
        if (peek().type() == Type.RBRACKET) {
            next();
            return new ExpressionNode.ListLiteral(items, open.pos());
        }
        while (true) {
            items.add(v1Atom());
            if (peek().type() == Type.COMMA) {
                next();
            } else {
                expect(Type.RBRACKET);
                return new ExpressionNode.ListLiteral(items, open.pos());
            }
        }
    }

    // ------------------------------------------------------------------
    // v2
    // ------------------------------------------------------------------

    private ExpressionNode ternary() {
        ExpressionNode condition = coalesce();
        if (peek().type() == Type.QUESTION) {
            Token q = next();
            ExpressionNode then = ternary();
            expect(Type.COLON);
            ExpressionNode otherwise = ternary();
            return new ExpressionNode.Ternary(condition, then, otherwise, q.pos());
        }
        return condition;
    }

    private ExpressionNode coalesce() {
        ExpressionNode left = or();
        while (peek().type() == Type.COALESCE) {
            Token op = next();
            left = new ExpressionNode.Binary(BinaryOp.COALESCE, left, or(), false, op.pos());
        }
        return left;
    }

    private ExpressionNode or() {
        ExpressionNode left = and();
        while (peek().type() == Type.OR) {
            Token op = next();
            left = new ExpressionNode.Binary(BinaryOp.OR, left, and(), false, op.pos());
        }
        return left;
    }

    private ExpressionNode and() {
        ExpressionNode left = comparison();
        while (peek().type() == Type.AND) {
            Token op = next();
            left = new ExpressionNode.Binary(BinaryOp.AND, left, comparison(), false, op.pos());
        }
        return left;
    }

    private ExpressionNode comparison() {
        ExpressionNode left = additive();
        BinaryOp op = comparisonOp(peek().type());
        if (op != null) {
            Token opToken = next();
            ExpressionNode right = additive();
            if (comparisonOp(peek().type()) != null) {
                throw new ExpressionError("Comparisons can't be chained; use 'and'", peek().pos());
            }
            return new ExpressionNode.Binary(op, left, right, false, opToken.pos());
        }
        return left;
    }

    private ExpressionNode additive() {
        ExpressionNode left = multiplicative();
        while (peek().type() == Type.PLUS || peek().type() == Type.MINUS) {
            Token op = next();
            BinaryOp kind = op.type() == Type.PLUS ? BinaryOp.ADD : BinaryOp.SUB;
            left = new ExpressionNode.Binary(kind, left, multiplicative(), false, op.pos());
        }
        return left;
    }

    private ExpressionNode multiplicative() {
        ExpressionNode left = unary();
        while (peek().type() == Type.STAR || peek().type() == Type.SLASH || peek().type() == Type.PERCENT) {
            Token op = next();
            BinaryOp kind = switch (op.type()) {
                case STAR -> BinaryOp.MUL;
                case SLASH -> BinaryOp.DIV;
                default -> BinaryOp.MOD;
            };
            left = new ExpressionNode.Binary(kind, left, unary(), false, op.pos());
        }
        return left;
    }

    private ExpressionNode unary() {
        if (peek().type() == Type.NOT) {
            Token op = next();
            return new ExpressionNode.Unary(UnaryOp.NOT, unary(), op.pos());
        }
        if (peek().type() == Type.MINUS) {
            Token op = next();
            return new ExpressionNode.Unary(UnaryOp.NEGATE, unary(), op.pos());
        }
        return postfix(primary());
    }

    private ExpressionNode postfix(ExpressionNode node) {
        while (true) {
            if (peek().type() == Type.DOT) {
                next();
                Token name = expect(Type.IDENT);
                node = switch (node) {
                    case ExpressionNode.Ident ident -> new ExpressionNode.Ident(append(ident.path(), name.text()), ident.pos());
                    case ExpressionNode.GlobalRef ref -> new ExpressionNode.GlobalRef(
                            ref.set(), append(ref.path(), name.text()), ref.pos());
                    default -> new ExpressionNode.Member(node, name.text(), name.pos());
                };
            } else if (peek().type() == Type.LBRACKET) {
                Token open = next();
                ExpressionNode index = ternary();
                expect(Type.RBRACKET);
                node = new ExpressionNode.Index(node, index, open.pos());
            } else {
                return node;
            }
        }
    }

    private ExpressionNode primary() {
        Token t = next();
        return switch (t.type()) {
            case IDENT -> {
                if (peek().type() == Type.LPAREN) {
                    next();
                    List<ExpressionNode> args = new ArrayList<>();
                    if (peek().type() != Type.RPAREN) {
                        do {
                            args.add(ternary());
                        } while (peek().type() == Type.COMMA && next() != null);
                    }
                    expect(Type.RPAREN);
                    yield new ExpressionNode.Call(t.text(), args, t.pos());
                }
                yield new ExpressionNode.Ident(List.of(t.text()), t.pos());
            }
            case GLOBAL -> new ExpressionNode.GlobalRef(t.text(), List.of(), t.pos());
            case STRING -> new ExpressionNode.Literal(TextNode.valueOf(t.text()), t.pos());
            case NUMBER -> new ExpressionNode.Literal(number(t), t.pos());
            case TRUE -> new ExpressionNode.Literal(BooleanNode.TRUE, t.pos());
            case FALSE -> new ExpressionNode.Literal(BooleanNode.FALSE, t.pos());
            case NULL -> new ExpressionNode.Literal(NullNode.getInstance(), t.pos());
            case LPAREN -> {
                ExpressionNode inner = ternary();
                expect(Type.RPAREN);
                yield inner;
            }
            case LBRACKET -> {
                List<ExpressionNode> items = new ArrayList<>();
                if (peek().type() != Type.RBRACKET) {
                    do {
                        items.add(ternary());
                    } while (peek().type() == Type.COMMA && next() != null);
                }
                expect(Type.RBRACKET);
                yield new ExpressionNode.ListLiteral(items, t.pos());
            }
            case EOF -> throw new ExpressionError("Unexpected end of expression", t.pos());
            default -> throw new ExpressionError("Unexpected '" + t.text() + "'", t.pos());
        };
    }

    // ------------------------------------------------------------------

    private static BinaryOp comparisonOp(Type type) {
        return switch (type) {
            case EQ -> BinaryOp.EQ;
            case NEQ -> BinaryOp.NEQ;
            case LT -> BinaryOp.LT;
            case LTE -> BinaryOp.LTE;
            case GT -> BinaryOp.GT;
            case GTE -> BinaryOp.GTE;
            case IN -> BinaryOp.IN;
            default -> null;
        };
    }

    private static JsonNode number(Token t) {
        try {
            return ExpressionValues.number(new BigDecimal(t.text()));
        } catch (NumberFormatException e) {
            throw new ExpressionError("Invalid number '" + t.text() + "'", t.pos());
        }
    }

    private static List<String> append(List<String> path, String name) {
        List<String> out = new ArrayList<>(path);
        out.add(name);
        return out;
    }

    private Token peek() {
        return tokens.get(pos);
    }

    private Token next() {
        Token t = tokens.get(pos);
        if (t.type() != Type.EOF) {
            pos++;
        }
        return t;
    }

    private Token expect(Type type) {
        Token t = next();
        if (t.type() != type) {
            throw new ExpressionError(
                    "Expected " + type + " but got " + (t.type() == Type.EOF ? "end of expression" : "'" + t.text() + "'"),
                    t.pos());
        }
        return t;
    }

    ExpressionMode mode() {
        return mode;
    }
}
