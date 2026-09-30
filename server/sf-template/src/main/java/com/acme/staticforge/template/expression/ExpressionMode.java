package com.acme.staticforge.template.expression;

/**
 * The two grammars of the expression language (spec §14.4, M33.1).
 *
 * <ul>
 *   <li>{@link #V1} — the original boolean {@code visibleWhen} grammar, kept bit for bit because the Angular form engine
 *       evaluates it too: {@code identifier op literal} joined by {@code &&}, {@code ||}, {@code !} and parentheses,
 *       {@code in} against a list or a string (substring), dotted identifiers, a single {@code =} read as {@code ==},
 *       and {@code !} binding to a whole comparison.</li>
 *   <li>{@link #V2} — the rule language: values of any type, arithmetic, ternary, {@code ??}, function calls, member
 *       and index access, {@code and}/{@code or}/{@code not}. A single {@code =} is a parse error.</li>
 * </ul>
 */
public enum ExpressionMode {
    V1,
    V2
}
