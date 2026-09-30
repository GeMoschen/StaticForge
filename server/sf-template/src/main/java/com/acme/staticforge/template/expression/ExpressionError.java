package com.acme.staticforge.template.expression;

/**
 * A parse, compile or evaluation error of an expression (M33.1), with the 0-based character position it points at
 * ({@code -1} when it has none, e.g. an exhausted evaluation budget). An {@link IllegalArgumentException}, so callers
 * that validated v1 expressions by catching that type keep working.
 */
public class ExpressionError extends IllegalArgumentException {

    private final int position;

    public ExpressionError(String message, int position) {
        super(position >= 0 ? message + " (at position " + position + ")" : message);
        this.position = position;
    }

    public ExpressionError(String message) {
        this(message, -1);
    }

    /** The 0-based character position in the source, or {@code -1}. */
    public int position() {
        return position;
    }
}
