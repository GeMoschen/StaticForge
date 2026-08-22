package com.acme.staticforge.template.cdl;

import com.acme.staticforge.template.cdl.CdlParser.BodyNode;
import com.acme.staticforge.template.cdl.CdlParser.ContentNode;
import com.acme.staticforge.template.cdl.CdlParser.EditorNode;
import com.acme.staticforge.template.content.BodyDefinition;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.acme.staticforge.template.content.EditorType;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.expression.ExpressionEvaluator;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Lowers the parsed node tree into the normalized {@link ContentDefinition} while
 * enforcing semantic rules (spec §14.5): editor-name uniqueness, reserved names, name
 * grammar, editor-type validity and {@code visibleWhen} expression grammar. Groups are
 * transparent for name uniqueness, but each {@code list} item opens its own namespace.
 */
final class CdlValidator {

    private static final Set<String> RESERVED = Set.of(
            "uid", "uuid", "type", "template", "bodies", "nav", "meta", "_orphaned");

    private static final Map<String, EditorType> TYPES = Map.ofEntries(
            Map.entry("text", EditorType.TEXT),
            Map.entry("textarea", EditorType.TEXTAREA),
            Map.entry("richtext", EditorType.RICHTEXT),
            Map.entry("markdown", EditorType.MARKDOWN),
            Map.entry("number", EditorType.NUMBER),
            Map.entry("boolean", EditorType.BOOLEAN),
            Map.entry("date", EditorType.DATE),
            Map.entry("datetime", EditorType.DATETIME),
            Map.entry("select", EditorType.SELECT),
            Map.entry("multiselect", EditorType.MULTISELECT),
            Map.entry("color", EditorType.COLOR),
            Map.entry("link", EditorType.LINK),
            Map.entry("media", EditorType.MEDIA),
            Map.entry("reference", EditorType.REFERENCE),
            Map.entry("list", EditorType.LIST),
            Map.entry("group", EditorType.GROUP),
            Map.entry("json", EditorType.JSON));

    private final ExpressionEvaluator expressionEvaluator = new ExpressionEvaluator();
    private int groupCounter;

    record Result(ContentDefinition definition, List<Diagnostic> diagnostics) {}

    Result validate(ContentNode content) {
        List<Diagnostic> diagnostics = new ArrayList<>();
        checkNames(content.editors, new HashSet<>(), diagnostics);
        List<EditorDefinition> editors = buildEditors(content.editors, diagnostics);
        List<BodyDefinition> bodies = buildBodies(content.bodies, diagnostics);
        return new Result(new ContentDefinition(editors, bodies), diagnostics);
    }

    private void checkNames(List<EditorNode> nodes, Set<String> seen, List<Diagnostic> diagnostics) {
        for (EditorNode node : nodes) {
            boolean isList = "list".equals(node.typeKeyword);
            boolean isGroup = "group".equals(node.typeKeyword);
            if (!node.groupWrapper) {
                checkName(node, seen, diagnostics);
            }
            if (isList) {
                checkNames(node.items, new HashSet<>(), diagnostics);
            } else if (isGroup) {
                checkNames(node.items, seen, diagnostics);
            }
        }
    }

    private void checkName(EditorNode node, Set<String> seen, List<Diagnostic> diagnostics) {
        String name = node.name;
        if (RESERVED.contains(name)) {
            diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.CDL_RESERVED_NAME, "Reserved editor name: " + name, node.nameLine, node.nameCol));
        } else if (!name.matches("[a-zA-Z][a-zA-Z0-9_]{0,63}")) {
            diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.CDL_INVALID_NAME, "Invalid editor name: " + name, node.nameLine, node.nameCol));
        }
        if (!seen.add(name)) {
            diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.CDL_DUPLICATE_EDITOR, "Duplicate editor name: " + name, node.nameLine, node.nameCol));
        }
    }

    private List<EditorDefinition> buildEditors(List<EditorNode> nodes, List<Diagnostic> diagnostics) {
        List<EditorDefinition> out = new ArrayList<>();
        for (EditorNode node : nodes) {
            EditorDefinition def = buildEditor(node, diagnostics);
            if (def != null) {
                out.add(def);
            }
        }
        return out;
    }

    private EditorDefinition buildEditor(EditorNode node, List<Diagnostic> diagnostics) {
        EditorType type = TYPES.get(node.typeKeyword);
        if (type == null) {
            diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.CDL_UNKNOWN_EDITOR_TYPE,
                    "Unknown editor type: " + node.typeKeyword, node.typeLine, node.typeCol));
            return null;
        }
        checkExpression(node, diagnostics);
        List<EditorDefinition> items = buildEditors(node.items, diagnostics);
        String name = node.groupWrapper ? syntheticGroupName() : node.name;
        return new EditorDefinition(
                name,
                type,
                node.label,
                node.help,
                node.required,
                node.readOnly,
                node.hidden,
                node.defaultValue,
                node.min,
                node.max,
                node.maxLength,
                node.maxChars,
                node.pattern,
                node.patternMessage,
                node.mimeTypes,
                node.options,
                node.features,
                node.visibleWhen,
                node.renamedFrom,
                items);
    }

    private void checkExpression(EditorNode node, List<Diagnostic> diagnostics) {
        if (node.visibleWhen == null || node.visibleWhen.isBlank()) {
            return;
        }
        try {
            expressionEvaluator.evaluate(node.visibleWhen, null);
        } catch (IllegalArgumentException e) {
            diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.CDL_INVALID_EXPRESSION,
                    "Invalid visibleWhen expression: " + e.getMessage(),
                    node.visibleWhenLine,
                    node.visibleWhenCol));
        }
    }

    private List<BodyDefinition> buildBodies(List<BodyNode> members, List<Diagnostic> diagnostics) {
        List<BodyDefinition> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (BodyNode node : members) {
            if (!seen.add(node.name)) {
                diagnostics.add(Diagnostic.error(
                        DiagnosticCodes.CDL_DUPLICATE_EDITOR,
                        "Duplicate body name: " + node.name, node.nameLine, node.nameCol));
            }
            out.add(new BodyDefinition(node.name, node.label, node.allow, node.min, node.max));
        }
        return out;
    }

    private String syntheticGroupName() {
        groupCounter++;
        return "_group_" + groupCounter;
    }
}
