package com.acme.staticforge.template.cdl;

import com.acme.staticforge.template.cdl.CdlLexer.Token;
import com.acme.staticforge.template.cdl.CdlLexer.TokenType;
import com.acme.staticforge.template.content.SelectOption;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.BooleanNode;
import com.fasterxml.jackson.databind.node.IntNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.TextNode;
import java.util.ArrayList;
import java.util.List;

/**
 * Recursive-descent CDL parser (spec §14.2–§14.6). Turns a token stream into an immutable
 * intermediate node tree carrying source positions for later validation, while emitting
 * positioned syntax/attribute diagnostics as it goes.
 */
final class CdlParser {

    /** An editor declaration (or {@code group "…"} wrapper) as it appears in the AST. */
    static final class EditorNode {
        String name;
        int nameLine = -1;
        int nameCol = -1;
        String typeKeyword;
        int typeLine = -1;
        int typeCol = -1;
        boolean groupWrapper;

        String label;
        String help;
        boolean required;
        boolean readOnly;
        boolean hidden;
        boolean localizable;
        int localizableLine = -1;
        int localizableCol = -1;
        JsonNode defaultValue;
        Integer min;
        Integer max;
        Integer maxLength;
        Integer maxChars;
        String pattern;
        String patternMessage;
        String visibleWhen;
        int visibleWhenLine = -1;
        int visibleWhenCol = -1;
        String renamedFrom;
        String dataset;
        int datasetLine = -1;
        int datasetCol = -1;
        /** Pagination attributes (M21.1.1); {@code paginationLine} is the first one's position, -1 when none. */
        List<String> sources;
        Integer pageSize;
        Integer maxPageSize;
        List<String> sort;
        int paginationLine = -1;
        int paginationCol = -1;
        final List<String> mimeTypes = new ArrayList<>();
        final List<String> assetTypes = new ArrayList<>();
        final List<SelectOption> options = new ArrayList<>();
        final List<String> features = new ArrayList<>();
        final List<String> allow = new ArrayList<>();
        final List<EditorNode> items = new ArrayList<>();
    }

    /** A {@code body} declaration inside a {@code bodies} block. */
    static final class BodyNode {
        String name;
        int nameLine = -1;
        int nameCol = -1;
        String label;
        Integer min;
        Integer max;
        final List<String> allow = new ArrayList<>();
    }

    /** The parsed content definition tree: top-level editors and declared bodies. */
    static final class ContentNode {
        final List<EditorNode> editors = new ArrayList<>();
        final List<BodyNode> bodies = new ArrayList<>();
    }

    record ParseResult(ContentNode content, List<Diagnostic> diagnostics) {}

    private final List<Token> tokens;
    private final List<Diagnostic> diagnostics = new ArrayList<>();
    private int pos;

    CdlParser(List<Token> tokens) {
        this.tokens = tokens;
    }

    ParseResult parse() {
        ContentNode content = new ContentNode();
        while (!atEnd()) {
            if (peek().isIdent("content")) {
                parseContentBlock(content);
            } else if (peek().isIdent("bodies")) {
                parseBodiesBlock(content);
            } else {
                Token t = next();
                error(DiagnosticCodes.CDL_SYNTAX, "Unexpected token '" + t.text() + "'", t);
            }
        }
        return new ParseResult(content, diagnostics);
    }

    private void parseContentBlock(ContentNode content) {
        acceptIdent("content");
        accept(TokenType.LBRACE);
        while (!atEnd() && !at(TokenType.RBRACE)) {
            if (peek().isIdent("group") && nextIsString()) {
                content.editors.add(parseGroupWrapper());
            } else if (peek().isIdent("editor")) {
                content.editors.add(parseEditor());
            } else {
                Token t = next();
                error(DiagnosticCodes.CDL_SYNTAX, "Expected 'editor' or 'group', found '" + t.text() + "'", t);
            }
        }
        accept(TokenType.RBRACE);
    }

    private EditorNode parseGroupWrapper() {
        acceptIdent("group");
        Token label = next();
        String labelText = "";
        if (label.type() == TokenType.STRING) {
            labelText = label.text();
        } else {
            error(DiagnosticCodes.CDL_INVALID_ATTRIBUTE, "Expected a group label string", label);
        }
        EditorNode node = new EditorNode();
        node.groupWrapper = true;
        node.typeKeyword = "group";
        node.label = labelText;
        node.typeLine = label.line();
        node.typeCol = label.column();
        accept(TokenType.LBRACE);
        parseEditorList(node.items);
        accept(TokenType.RBRACE);
        return node;
    }

    private EditorNode parseEditor() {
        acceptIdent("editor");
        EditorNode node = new EditorNode();
        Token typeTok = next();
        if (typeTok.type() == TokenType.IDENT) {
            node.typeKeyword = typeTok.text();
            node.typeLine = typeTok.line();
            node.typeCol = typeTok.column();
        } else {
            error(DiagnosticCodes.CDL_SYNTAX, "Expected an editor type, found '" + typeTok.text() + "'", typeTok);
            node.typeKeyword = typeTok.text();
        }
        Token nameTok = next();
        if (nameTok.type() == TokenType.IDENT || nameTok.type() == TokenType.NUMBER) {
            node.name = nameTok.text();
            node.nameLine = nameTok.line();
            node.nameCol = nameTok.column();
        } else {
            error(DiagnosticCodes.CDL_SYNTAX, "Expected an editor name, found '" + nameTok.text() + "'", nameTok);
            node.name = nameTok.text();
        }
        accept(TokenType.LBRACE);
        parseEditorBody(node);
        accept(TokenType.RBRACE);
        return node;
    }

    private void parseEditorList(List<EditorNode> out) {
        while (!atEnd() && !at(TokenType.RBRACE)) {
            if (peek().isIdent("group") && nextIsString()) {
                out.add(parseGroupWrapper());
            } else if (peek().isIdent("editor")) {
                out.add(parseEditor());
            } else {
                Token t = next();
                error(DiagnosticCodes.CDL_SYNTAX, "Expected 'editor' or 'group', found '" + t.text() + "'", t);
            }
        }
    }

    private void parseEditorBody(EditorNode node) {
        while (!atEnd() && !at(TokenType.RBRACE)) {
            Token attrTok = peek();
            if (attrTok.type() != TokenType.IDENT) {
                next();
                error(DiagnosticCodes.CDL_SYNTAX, "Expected an attribute name, found '" + attrTok.text() + "'", attrTok);
                continue;
            }
            next();
            dispatch(attrTok.text(), attrTok, node);
        }
    }

    private void dispatch(String attr, Token attrTok, EditorNode node) {
        switch (attr) {
            case "label" -> node.label = expectString(attrTok);
            case "help" -> node.help = expectString(attrTok);
            case "required" -> node.required = true;
            case "readOnly" -> node.readOnly = true;
            case "hidden" -> node.hidden = true;
            case "localizable" -> {
                node.localizable = true;
                node.localizableLine = attrTok.line();
                node.localizableCol = attrTok.column();
            }
            case "default" -> node.defaultValue = parseLiteral(attrTok);
            case "visibleWhen" -> {
                Token v = peek();
                node.visibleWhen = expectString(attrTok);
                node.visibleWhenLine = v.line();
                node.visibleWhenCol = v.column();
            }
            case "renamedFrom" -> node.renamedFrom = expectString(attrTok);
            case "min" -> node.min = expectInt(attrTok);
            case "max" -> node.max = expectInt(attrTok);
            case "maxLength" -> node.maxLength = expectInt(attrTok);
            case "maxChars" -> node.maxChars = expectInt(attrTok);
            case "mimeTypes" -> node.mimeTypes.addAll(expectStringArray(attrTok));
            case "assetTypes" -> node.assetTypes.addAll(expectIdentArray(attrTok));
            case "dataset" -> {
                node.datasetLine = attrTok.line();
                node.datasetCol = attrTok.column();
                node.dataset = expectString(attrTok);
            }
            case "sources" -> {
                markPagination(node, attrTok);
                node.sources = expectStringArray(attrTok);
            }
            case "pageSize" -> {
                markPagination(node, attrTok);
                node.pageSize = expectInt(attrTok);
            }
            case "maxPageSize" -> {
                markPagination(node, attrTok);
                node.maxPageSize = expectInt(attrTok);
            }
            case "sort" -> {
                markPagination(node, attrTok);
                node.sort = expectStringArray(attrTok);
            }
            case "options" -> node.options.addAll(parseOptions(attrTok));
            case "features" -> node.features.addAll(expectIdentArray(attrTok));
            case "allow" -> node.allow.addAll(expectStringArray(attrTok));
            case "validate" -> parseValidate(node);
            case "item" -> parseItem(attrTok, node);
            case "format", "folder", "minWidth", "group", "order", "pattern", "message" ->
                    skipValue();
            default -> {
                error(DiagnosticCodes.CDL_INVALID_ATTRIBUTE, "Unknown attribute '" + attr + "'", attrTok);
                skipValue();
            }
        }
    }

    private static void markPagination(EditorNode node, Token attrTok) {
        if (node.paginationLine < 0) {
            node.paginationLine = attrTok.line();
            node.paginationCol = attrTok.column();
        }
    }

    private void parseItem(Token attrTok, EditorNode node) {
        if (!"list".equals(node.typeKeyword)) {
            error(DiagnosticCodes.CDL_INVALID_ATTRIBUTE, "'item' is only valid on a 'list' editor", attrTok);
        }
        accept(TokenType.LBRACE);
        parseEditorList(node.items);
        accept(TokenType.RBRACE);
    }

    private void parseValidate(EditorNode node) {
        Token t = peek();
        if (t.isIdent("pattern")) {
            next();
            node.pattern = expectString(t);
            if (peek().isIdent("message")) {
                next();
                node.patternMessage = expectString(t);
            }
        } else if (t.isIdent("maxLength")) {
            next();
            node.maxLength = expectInt(t);
        } else if (t.isIdent("maxChars")) {
            next();
            node.maxChars = expectInt(t);
        } else if (t.isIdent("min")) {
            next();
            node.min = expectInt(t);
        } else if (t.isIdent("max")) {
            next();
            node.max = expectInt(t);
        } else {
            next();
            skipValue();
        }
    }

    private List<String> expectStringArray(Token attrTok) {
        List<String> values = new ArrayList<>();
        if (!accept(TokenType.LBRACKET)) {
            error(DiagnosticCodes.CDL_INVALID_ATTRIBUTE, "Expected an array value", attrTok);
            skipValue();
            return values;
        }
        while (!atEnd() && !at(TokenType.RBRACKET)) {
            if (accept(TokenType.COMMA)) {
                continue;
            }
            Token t = next();
            if (t.type() == TokenType.STRING || t.type() == TokenType.NUMBER || t.type() == TokenType.BOOLEAN
                    || t.type() == TokenType.IDENT) {
                values.add(t.text());
            } else {
                error(DiagnosticCodes.CDL_INVALID_ATTRIBUTE, "Expected a string value", t);
            }
        }
        accept(TokenType.RBRACKET);
        return values;
    }

    private List<String> expectIdentArray(Token attrTok) {
        List<String> values = new ArrayList<>();
        if (!accept(TokenType.LBRACKET)) {
            error(DiagnosticCodes.CDL_INVALID_ATTRIBUTE, "Expected an array value", attrTok);
            skipValue();
            return values;
        }
        while (!atEnd() && !at(TokenType.RBRACKET)) {
            if (accept(TokenType.COMMA)) {
                continue;
            }
            Token t = next();
            if (t.type() == TokenType.IDENT) {
                values.add(t.text());
            } else {
                error(DiagnosticCodes.CDL_INVALID_ATTRIBUTE, "Expected an identifier value", t);
            }
        }
        accept(TokenType.RBRACKET);
        return values;
    }

    private List<SelectOption> parseOptions(Token attrTok) {
        List<SelectOption> options = new ArrayList<>();
        if (!accept(TokenType.LBRACKET)) {
            error(DiagnosticCodes.CDL_INVALID_ATTRIBUTE, "Expected an array of options", attrTok);
            skipValue();
            return options;
        }
        while (!atEnd() && !at(TokenType.RBRACKET)) {
            if (accept(TokenType.COMMA)) {
                continue;
            }
            if (!accept(TokenType.LBRACE)) {
                Token t = next();
                error(DiagnosticCodes.CDL_INVALID_ATTRIBUTE, "Expected an option object", t);
                continue;
            }
            String value = null;
            String label = null;
            while (!atEnd() && !at(TokenType.RBRACE)) {
                if (accept(TokenType.COMMA)) {
                    continue;
                }
                Token key = next();
                String keyText = key.text();
                if (key.type() == TokenType.IDENT && "value".equals(keyText)) {
                    Token val = next();
                    if (val.type() == TokenType.STRING || val.type() == TokenType.NUMBER
                            || val.type() == TokenType.BOOLEAN || val.type() == TokenType.IDENT) {
                        value = val.text();
                    } else {
                        error(DiagnosticCodes.CDL_INVALID_ATTRIBUTE, "Expected an option value", val);
                    }
                } else if (key.type() == TokenType.IDENT && "label".equals(keyText)) {
                    label = expectString(key);
                } else {
                    error(DiagnosticCodes.CDL_INVALID_ATTRIBUTE, "Unknown option attribute '" + keyText + "'", key);
                    skipValue();
                }
            }
            accept(TokenType.RBRACE);
            if (value != null) {
                options.add(new SelectOption(value, label == null ? "" : label));
            }
        }
        accept(TokenType.RBRACKET);
        return options;
    }

    private JsonNode parseLiteral(Token attrTok) {
        Token t = peek();
        return switch (t.type()) {
            case STRING -> {
                next();
                yield TextNode.valueOf(t.text());
            }
            case NUMBER -> {
                next();
                yield parseNumber(t);
            }
            case BOOLEAN -> {
                next();
                yield BooleanNode.valueOf(Boolean.parseBoolean(t.text()));
            }
            default -> {
                error(DiagnosticCodes.CDL_INVALID_ATTRIBUTE, "Expected a literal value", attrTok);
                yield NullNode.getInstance();
            }
        };
    }

    private static JsonNode parseNumber(Token t) {
        try {
            return IntNode.valueOf(Integer.parseInt(t.text()));
        } catch (NumberFormatException e) {
            return TextNode.valueOf(t.text());
        }
    }

    private void parseBodiesBlock(ContentNode content) {
        acceptIdent("bodies");
        accept(TokenType.LBRACE);
        while (!atEnd() && !at(TokenType.RBRACE)) {
            if (peek().isIdent("body")) {
                content.bodies.add(parseBody());
            } else {
                Token t = next();
                error(DiagnosticCodes.CDL_SYNTAX, "Expected 'body', found '" + t.text() + "'", t);
            }
        }
        accept(TokenType.RBRACE);
    }

    private BodyNode parseBody() {
        acceptIdent("body");
        BodyNode node = new BodyNode();
        Token nameTok = next();
        node.name = nameTok.text();
        node.nameLine = nameTok.line();
        node.nameCol = nameTok.column();
        accept(TokenType.LBRACE);
        while (!atEnd() && !at(TokenType.RBRACE)) {
            Token attrTok = peek();
            if (attrTok.type() != TokenType.IDENT) {
                next();
                error(DiagnosticCodes.CDL_SYNTAX, "Expected a body attribute, found '" + attrTok.text() + "'", attrTok);
                continue;
            }
            next();
            switch (attrTok.text()) {
                case "label" -> node.label = expectString(attrTok);
                case "min" -> node.min = expectInt(attrTok);
                case "max" -> node.max = expectInt(attrTok);
                case "allow" -> node.allow.addAll(expectStringArray(attrTok));
                default -> {
                    error(DiagnosticCodes.CDL_INVALID_ATTRIBUTE, "Unknown body attribute '" + attrTok.text() + "'", attrTok);
                    skipValue();
                }
            }
        }
        accept(TokenType.RBRACE);
        return node;
    }

    private String expectString(Token attrTok) {
        Token t = peek();
        if (t.type() == TokenType.STRING) {
            next();
            return t.text();
        }
        error(DiagnosticCodes.CDL_INVALID_ATTRIBUTE, "Expected a string value", attrTok);
        skipValue();
        return "";
    }

    private Integer expectInt(Token attrTok) {
        Token t = peek();
        if (t.type() == TokenType.NUMBER) {
            next();
            try {
                return Integer.parseInt(t.text());
            } catch (NumberFormatException e) {
                error(DiagnosticCodes.CDL_INVALID_ATTRIBUTE, "Expected an integer value", attrTok);
                return null;
            }
        }
        error(DiagnosticCodes.CDL_INVALID_ATTRIBUTE, "Expected a number value", attrTok);
        skipValue();
        return null;
    }

    /** Consumes the next value token (or balanced bracket group) best-effort, for ignored attributes. */
    private void skipValue() {
        Token t = peek();
        if (t.type() == TokenType.LBRACKET) {
            next();
            while (!atEnd() && !at(TokenType.RBRACKET)) {
                next();
            }
            accept(TokenType.RBRACKET);
        } else if (t.type() == TokenType.STRING || t.type() == TokenType.NUMBER
                || t.type() == TokenType.BOOLEAN || t.type() == TokenType.IDENT) {
            next();
        }
    }

    private boolean nextIsString() {
        return pos + 1 < tokens.size() && tokens.get(pos + 1).type() == TokenType.STRING;
    }

    private boolean acceptIdent(String kw) {
        if (peek().isIdent(kw)) {
            next();
            return true;
        }
        return false;
    }

    private boolean accept(TokenType type) {
        if (at(type)) {
            next();
            return true;
        }
        return false;
    }

    private boolean at(TokenType type) {
        return peek().type() == type;
    }

    private boolean atEnd() {
        return peek().type() == TokenType.EOF;
    }

    private Token peek() {
        return tokens.get(Math.min(pos, tokens.size() - 1));
    }

    private Token next() {
        Token t = tokens.get(Math.min(pos, tokens.size() - 1));
        if (pos < tokens.size() - 1) {
            pos++;
        }
        return t;
    }

    private void error(String code, String message, Token token) {
        diagnostics.add(Diagnostic.error(code, message, token.line(), token.column()));
    }
}
