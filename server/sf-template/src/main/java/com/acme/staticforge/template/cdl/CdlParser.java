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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

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
        /** Built-in modifiers written after an attribute (M33): built-in name → its modifiers. */
        final Map<String, ModifierNode> builtinModifiers = new LinkedHashMap<>();
    }

    /**
     * The modifiers after a built-in attribute (M33): {@code level warning scope [release] onGeneration fail
     * message { en "…" }}. Unwritten parts are {@code null}.
     */
    static final class ModifierNode {
        String level;
        List<String> scopes;
        String onGeneration;
        Map<String, String> messages;
        int line;
        int column;
    }

    /** One value of a {@code rules {}} entry key, with its position (M33). */
    record RuleAttr(String text, List<String> list, Map<String, String> map, int line, int column) {}

    /**
     * An entry of the {@code rules {}} section (M33): {@code kind} is {@code rule}, {@code state} or {@code fill};
     * {@code name} is a rule's name, {@code target} the path after {@code on} (rules) or after the keyword (states,
     * fills), {@code null} when a rule has none. {@code attrs} maps each written key to its value.
     */
    static final class RuleEntryNode {
        String kind;
        String name;
        boolean off;
        String target;
        int targetLine;
        int targetColumn;
        int line;
        int column;
        final Map<String, RuleAttr> attrs = new LinkedHashMap<>();
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
        final List<RuleEntryNode> rules = new ArrayList<>();
        boolean rulesSeen;
    }

    /** The keys each rules entry kind accepts (M33, epic decision 1). */
    private static final Map<String, Set<String>> RULE_KEYS = Map.of(
            "rule", Set.of("level", "scope", "when", "assert", "message", "locales", "onGeneration"),
            "state", Set.of("requiredWhen", "readOnlyWhen", "level", "scope", "message"),
            "fill", Set.of("value", "mode", "on"));

    /** The attributes that take built-in modifiers after their value (M33). */
    private static final Set<String> MODIFIABLE = Set.of("required", "maxLength", "maxChars", "min", "max", "mimeTypes");

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
            } else if (peek().isIdent("rules")) {
                parseRulesBlock(content);
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
            if (MODIFIABLE.contains(attrTok.text())) {
                parseModifiers(node, attrTok.text(), attrTok);
            }
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
            if (peek().isIdent("message") && !nextIs(TokenType.LBRACE)) {
                next();
                node.patternMessage = expectString(t);
            }
            parseModifiers(node, "pattern", t);
        } else if (t.isIdent("maxLength")) {
            next();
            node.maxLength = expectInt(t);
            parseModifiers(node, "maxLength", t);
        } else if (t.isIdent("maxChars")) {
            next();
            node.maxChars = expectInt(t);
            parseModifiers(node, "maxChars", t);
        } else if (t.isIdent("min")) {
            next();
            node.min = expectInt(t);
            parseModifiers(node, "min", t);
        } else if (t.isIdent("max")) {
            next();
            node.max = expectInt(t);
            parseModifiers(node, "max", t);
        } else {
            next();
            skipValue();
        }
    }

    /**
     * The modifiers after a built-in (M33): any of {@code level <l>}, {@code scope [<s>…]}, {@code onGeneration <g>},
     * {@code message { <lang> "…" … }} in any order. Values are checked by the validator ({@code SF-CDL-0119}).
     */
    private void parseModifiers(EditorNode node, String builtin, Token attrTok) {
        ModifierNode modifiers = null;
        while (true) {
            Token t = peek();
            if (!(t.isIdent("level") || t.isIdent("scope") || t.isIdent("onGeneration")
                    || (t.isIdent("message") && nextIs(TokenType.LBRACE)))) {
                break;
            }
            if (modifiers == null) {
                modifiers = node.builtinModifiers.computeIfAbsent(builtin, k -> new ModifierNode());
                modifiers.line = attrTok.line();
                modifiers.column = attrTok.column();
            }
            next();
            switch (t.text()) {
                case "level" -> modifiers.level = expectRuleWord(t);
                case "scope" -> modifiers.scopes = expectIdentArray(t);
                case "onGeneration" -> modifiers.onGeneration = expectRuleWord(t);
                default -> modifiers.messages = parseMessageMap(t);
            }
        }
    }

    // ------------------------------------------------------------------
    // rules { … } (M33)
    // ------------------------------------------------------------------

    private void parseRulesBlock(ContentNode content) {
        Token block = next();
        if (content.rulesSeen) {
            ruleError("A CDL source has one 'rules' section; merge the entries into the first", block);
        }
        content.rulesSeen = true;
        if (!accept(TokenType.LBRACE)) {
            ruleError("Expected '{' after 'rules'", peek());
            return;
        }
        while (!atEnd() && !at(TokenType.RBRACE)) {
            Token t = peek();
            if (t.isIdent("rule") || t.isIdent("state") || t.isIdent("fill")) {
                RuleEntryNode entry = parseRuleEntry();
                if (entry != null) {
                    content.rules.add(entry);
                }
            } else {
                next();
                ruleError("Expected 'rule', 'state' or 'fill', found '" + t.text() + "'", t);
                if (t.type() == TokenType.LBRACE) {
                    skipBraced();
                }
            }
        }
        accept(TokenType.RBRACE);
    }

    private RuleEntryNode parseRuleEntry() {
        Token kind = next();
        RuleEntryNode entry = new RuleEntryNode();
        entry.kind = kind.text();
        entry.line = kind.line();
        entry.column = kind.column();
        if ("rule".equals(entry.kind)) {
            Token name = peek();
            if (name.type() != TokenType.STRING) {
                ruleError("Expected the rule's name as a string, e.g. rule \"title-length\"", name);
                recoverToEntryEnd();
                return null;
            }
            next();
            entry.name = name.text();
            if (peek().isIdent("off")) {
                next();
                entry.off = true;
                return entry;
            }
            if (peek().isIdent("on")) {
                next();
                parseRuleTarget(entry);
            }
        } else {
            parseRuleTarget(entry);
        }
        if (!accept(TokenType.LBRACE)) {
            ruleError("Expected '{' to open the " + entry.kind + "'s keys", peek());
            recoverToEntryEnd();
            return entry;
        }
        Set<String> keys = RULE_KEYS.get(entry.kind);
        while (!atEnd() && !at(TokenType.RBRACE)) {
            Token key = next();
            if (key.type() != TokenType.IDENT) {
                ruleError("Expected a key, found '" + key.text() + "'", key);
                if (key.type() == TokenType.LBRACE) {
                    skipBraced();
                }
                continue;
            }
            if (!keys.contains(key.text())) {
                ruleError("Unknown key '" + key.text() + "' in a " + entry.kind + "; allowed: "
                        + String.join(", ", keys.stream().sorted().toList()), key);
                skipRuleValue();
                continue;
            }
            if (entry.attrs.containsKey(key.text())) {
                ruleError("Key '" + key.text() + "' is written twice", key);
            }
            RuleAttr value = parseRuleValue(key);
            if (value != null) {
                entry.attrs.put(key.text(), value);
            }
        }
        accept(TokenType.RBRACE);
        return entry;
    }

    /** {@code page} | {@code name[]?(.name[]?)*}; stored as text with its position. */
    private void parseRuleTarget(RuleEntryNode entry) {
        Token first = peek();
        if (first.type() != TokenType.IDENT) {
            ruleError("Expected a target: an editor path such as title, seo.title or gallery[], or the definition"
                    + " keyword (page, section, record, global)", first);
            return;
        }
        StringBuilder text = new StringBuilder();
        entry.targetLine = first.line();
        entry.targetColumn = first.column();
        while (true) {
            Token name = next();
            if (name.type() != TokenType.IDENT) {
                ruleError("Expected an editor name in the target path", name);
                break;
            }
            text.append(name.text());
            if (at(TokenType.LBRACKET) && nextIs(TokenType.RBRACKET)) {
                next();
                next();
                text.append("[]");
            }
            if (!at(TokenType.DOT)) {
                break;
            }
            next();
            text.append('.');
        }
        entry.target = text.toString();
    }

    private RuleAttr parseRuleValue(Token key) {
        Token t = peek();
        switch (key.text()) {
            case "level", "onGeneration", "mode" -> {
                if (t.type() != TokenType.IDENT) {
                    ruleError("Expected a keyword after '" + key.text() + "'", t);
                    skipRuleValue();
                    return null;
                }
                next();
                return new RuleAttr(t.text(), null, null, t.line(), t.column());
            }
            case "scope", "on" -> {
                if (t.type() != TokenType.LBRACKET) {
                    ruleError("Expected a list after '" + key.text() + "', e.g. [edit, save]", t);
                    skipRuleValue();
                    return null;
                }
                return new RuleAttr(null, expectIdentArray(key), null, t.line(), t.column());
            }
            case "locales" -> {
                if (t.type() == TokenType.IDENT) {
                    next();
                    return new RuleAttr(t.text(), null, null, t.line(), t.column());
                }
                if (t.type() != TokenType.LBRACKET) {
                    ruleError("Expected 'all' or a list after 'locales', e.g. [default] or [de, en]", t);
                    skipRuleValue();
                    return null;
                }
                return new RuleAttr(null, expectStringArray(key), null, t.line(), t.column());
            }
            case "message" -> {
                if (t.type() == TokenType.STRING) {
                    next();
                    return new RuleAttr(null, null, Map.of("en", t.text()), t.line(), t.column());
                }
                return new RuleAttr(null, null, parseMessageMap(key), t.line(), t.column());
            }
            default -> {
                // when, assert, requiredWhen, readOnlyWhen, value: an expression string
                if (t.type() != TokenType.STRING) {
                    ruleError("Expected the expression of '" + key.text() + "' as a string", t);
                    skipRuleValue();
                    return null;
                }
                next();
                return new RuleAttr(t.text(), null, null, t.line(), t.column());
            }
        }
    }

    /** {@code { en "…" de "…" }} (colons and commas optional), or a single string for English. */
    private Map<String, String> parseMessageMap(Token keyTok) {
        Map<String, String> messages = new LinkedHashMap<>();
        if (at(TokenType.STRING)) {
            messages.put("en", next().text());
            return messages;
        }
        if (!accept(TokenType.LBRACE)) {
            ruleError("Expected a message map, e.g. message { en \"…\" de \"…\" }", keyTok);
            return messages;
        }
        while (!atEnd() && !at(TokenType.RBRACE)) {
            if (accept(TokenType.COMMA)) {
                continue;
            }
            Token lang = next();
            if (lang.type() != TokenType.IDENT && lang.type() != TokenType.STRING) {
                ruleError("Expected a language code in the message map, found '" + lang.text() + "'", lang);
                continue;
            }
            accept(TokenType.COLON);
            Token text = peek();
            if (text.type() != TokenType.STRING) {
                ruleError("Expected the message text for '" + lang.text() + "'", text);
                continue;
            }
            next();
            messages.put(lang.text(), text.text());
        }
        accept(TokenType.RBRACE);
        return messages;
    }

    private String expectRuleWord(Token keyTok) {
        Token t = peek();
        if (t.type() == TokenType.IDENT) {
            next();
            return t.text();
        }
        error(DiagnosticCodes.CDL_RULE_INVALID_MODIFIER, "Expected a keyword after '" + keyTok.text() + "'", keyTok);
        return null;
    }

    private void skipRuleValue() {
        if (at(TokenType.LBRACE)) {
            skipBraced();
        } else {
            skipValue();
        }
    }

    /** Skips a balanced {@code { … }} group. */
    private void skipBraced() {
        int depth = at(TokenType.LBRACE) ? 0 : 1;
        while (!atEnd()) {
            Token t = next();
            if (t.type() == TokenType.LBRACE) {
                depth++;
            } else if (t.type() == TokenType.RBRACE) {
                depth--;
                if (depth <= 0) {
                    return;
                }
            }
        }
    }

    /** After a malformed entry head: skip to the entry's closing brace, or to the next entry keyword. */
    private void recoverToEntryEnd() {
        while (!atEnd() && !at(TokenType.RBRACE)) {
            if (peek().isIdent("rule") || peek().isIdent("state") || peek().isIdent("fill")) {
                return;
            }
            if (at(TokenType.LBRACE)) {
                skipBraced();
                return;
            }
            next();
        }
    }

    private void ruleError(String message, Token token) {
        error(DiagnosticCodes.CDL_RULE_INVALID, message, token);
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

    private boolean nextIs(TokenType type) {
        return pos + 1 < tokens.size() && tokens.get(pos + 1).type() == type;
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
