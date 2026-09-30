package com.acme.staticforge.template.cdl;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.acme.staticforge.template.cdl.CdlLexer.Token;
import com.acme.staticforge.template.cdl.CdlLexer.TokenType;
import java.util.ArrayList;
import java.util.List;

/**
 * The CDL of a content holder as its three sections (M34): the text inside {@code content { … }}, inside
 * {@code bodies { … }} and inside {@code rules { … }}, each without its keyword and braces. Templates, datasets and
 * global sets store them as the payload fields {@code contentCdl}, {@code bodiesCdl} and {@code rulesCdl} and edit
 * them in one tab each; {@link CdlCompiler#compile(CdlSources)} compiles them as one definition.
 *
 * <p>Positions: the compiler shifts each section's lines by {@code section × }{@link #LINE_BASE}, so the definition
 * and every diagnostic built from it know which section a position is in. {@code Diagnostic}'s constructor decodes
 * such a line into its section ({@code field}) and the line inside it. Lines below {@link #LINE_BASE} are plain.
 */
public record CdlSources(String content, String bodies, String rules) {

    /** Section names, also the {@code field} of a diagnostic in that section. */
    public static final String CONTENT = "content";
    public static final String BODIES = "bodies";
    public static final String RULES = "rules";

    /** The sections in source order; a section's number is its index + 1. */
    static final List<String> SECTIONS = List.of(CONTENT, BODIES, RULES);

    /** The payload field of each section. */
    public static final String CONTENT_FIELD = "contentCdl";
    public static final String BODIES_FIELD = "bodiesCdl";
    public static final String RULES_FIELD = "rulesCdl";

    /** The line offset of one section: far above any real line count. */
    public static final int LINE_BASE = 1_000_000;

    public static final CdlSources EMPTY = new CdlSources("", "", "");

    public CdlSources {
        content = content == null ? "" : content;
        bodies = bodies == null ? "" : bodies;
        rules = rules == null ? "" : rules;
    }

    /** Only a content section. */
    public static CdlSources content(String content) {
        return new CdlSources(content, "", "");
    }

    /** The sections stored in a payload; missing fields are empty. */
    public static CdlSources of(JsonNode payload) {
        if (payload == null) {
            return EMPTY;
        }
        return new CdlSources(
                payload.path(CONTENT_FIELD).asText(""),
                payload.path(BODIES_FIELD).asText(""),
                payload.path(RULES_FIELD).asText(""));
    }

    /** Whether a payload carries a CDL definition at all. */
    public static boolean presentIn(JsonNode payload) {
        return payload != null && (payload.has(CONTENT_FIELD) || payload.has(BODIES_FIELD) || payload.has(RULES_FIELD));
    }

    /** Writes the three payload fields. */
    public void writeTo(ObjectNode payload) {
        payload.put(CONTENT_FIELD, content);
        payload.put(BODIES_FIELD, bodies);
        payload.put(RULES_FIELD, rules);
    }

    /** The text of one section by name. */
    public String section(String name) {
        return switch (name) {
            case CONTENT -> content;
            case BODIES -> bodies;
            case RULES -> rules;
            default -> throw new IllegalArgumentException("Unknown CDL section: " + name);
        };
    }

    /** All sections concatenated, for full-text search. */
    public String text() {
        StringBuilder out = new StringBuilder(content);
        for (String part : List.of(bodies, rules)) {
            if (!part.isBlank()) {
                out.append('\n').append(part);
            }
        }
        return out.toString();
    }

    /** {@code line} of section {@code name} as the compiler numbers it. */
    public static int encodeLine(String name, int line) {
        return (SECTIONS.indexOf(name) + 1) * LINE_BASE + line;
    }

    /** Whether {@code line} was encoded with {@link #encodeLine}. */
    public static boolean isEncodedLine(int line) {
        return line >= LINE_BASE && line / LINE_BASE <= SECTIONS.size();
    }

    /** The section an encoded line is in. */
    public static String sectionOfLine(int line) {
        return SECTIONS.get(line / LINE_BASE - 1);
    }

    /** The line inside its section; 0 for a position the compiler made up (a section's own braces). */
    public static int localLine(int line) {
        return line % LINE_BASE;
    }

    /**
     * Splits a whole CDL text ({@code content { … } bodies { … } rules { … }}) into its sections, each without its
     * keyword and braces and dedented. Text outside the sections is dropped; a section written twice is joined.
     * For fixtures and tests that write a definition as one text.
     */
    public static CdlSources split(String text) {
        String source = text == null ? "" : text;
        List<Integer> lineStarts = new ArrayList<>();
        lineStarts.add(0);
        for (int i = 0; i < source.length(); i++) {
            if (source.charAt(i) == '\n') {
                lineStarts.add(i + 1);
            }
        }
        List<Token> tokens = new CdlLexer().lex(source).tokens();
        StringBuilder[] parts = {new StringBuilder(), new StringBuilder(), new StringBuilder()};
        int i = 0;
        while (i < tokens.size() - 1) {
            Token head = tokens.get(i);
            int section = head.type() == TokenType.IDENT ? SECTIONS.indexOf(head.text()) : -1;
            if (section < 0 || tokens.get(i + 1).type() != TokenType.LBRACE) {
                i++;
                continue;
            }
            Token open = tokens.get(i + 1);
            int depth = 0;
            int j = i + 1;
            for (; j < tokens.size() - 1; j++) {
                TokenType type = tokens.get(j).type();
                if (type == TokenType.LBRACE) {
                    depth++;
                } else if (type == TokenType.RBRACE && --depth == 0) {
                    break;
                }
            }
            Token close = tokens.get(j);
            int from = offset(lineStarts, open) + 1;
            int to = close.type() == TokenType.RBRACE ? offset(lineStarts, close) : source.length();
            String inner = dedent(source.substring(Math.min(from, to), to));
            if (!inner.isEmpty()) {
                StringBuilder part = parts[section];
                if (!part.isEmpty()) {
                    part.append('\n');
                }
                part.append(inner);
            }
            i = j + 1;
        }
        return new CdlSources(parts[0].toString(), parts[1].toString(), parts[2].toString());
    }

    private static int offset(List<Integer> lineStarts, Token token) {
        return lineStarts.get(token.line() - 1) + token.column() - 1;
    }

    /** Drops blank edge lines and the indentation all remaining lines share. */
    private static String dedent(String text) {
        List<String> lines = new ArrayList<>(List.of(text.split("\n", -1)));
        while (!lines.isEmpty() && lines.get(0).isBlank()) {
            lines.remove(0);
        }
        while (!lines.isEmpty() && lines.get(lines.size() - 1).isBlank()) {
            lines.remove(lines.size() - 1);
        }
        if (lines.size() == 1) {
            return lines.get(0).strip();
        }
        int indent = Integer.MAX_VALUE;
        for (String line : lines) {
            if (!line.isBlank()) {
                indent = Math.min(indent, line.length() - line.stripLeading().length());
            }
        }
        List<String> out = new ArrayList<>();
        for (String line : lines) {
            out.add(line.isBlank() ? "" : line.substring(indent).stripTrailing());
        }
        return String.join("\n", out);
    }
}
