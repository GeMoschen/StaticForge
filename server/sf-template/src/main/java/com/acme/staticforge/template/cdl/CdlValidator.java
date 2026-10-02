package com.acme.staticforge.template.cdl;

import com.acme.staticforge.template.cdl.CdlParser.BodyNode;
import com.acme.staticforge.template.cdl.CdlParser.ContentNode;
import com.acme.staticforge.template.cdl.CdlParser.EditorNode;
import com.acme.staticforge.template.content.BodyDefinition;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.acme.staticforge.template.content.EditorType;
import com.acme.staticforge.template.content.PaginationOptions;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.expression.ExpressionEvaluator;
import com.acme.staticforge.template.rules.RuleSet;
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
            Map.entry("json", EditorType.JSON),
            Map.entry("catalog", EditorType.CATALOG),
            Map.entry("pagination", EditorType.PAGINATION));

    private final ExpressionEvaluator expressionEvaluator = new ExpressionEvaluator();
    private int groupCounter;

    record Result(ContentDefinition definition, List<Diagnostic> diagnostics) {}

    Result validate(ContentNode content) {
        List<Diagnostic> diagnostics = new ArrayList<>();
        checkNames(content.editors, new HashSet<>(), diagnostics);
        checkPaginationPlacement(content.editors, diagnostics);
        List<EditorDefinition> editors = buildEditors(content.editors, diagnostics);
        List<BodyDefinition> bodies = buildBodies(content.bodies, diagnostics);
        RuleSet rules = RulesCompiler.compile(content.rules, diagnostics);
        return new Result(new ContentDefinition(editors, bodies, rules), diagnostics);
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
        checkDataset(node, type, diagnostics);
        boolean localizable = checkLocalizable(node, type, diagnostics);
        String width = checkWidth(node, type, diagnostics);
        PaginationOptions pagination = paginationOptions(node, type, diagnostics);
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
                node.assetTypes,
                node.options,
                node.features,
                node.allow,
                node.visibleWhen,
                node.renamedFrom,
                localizable,
                items,
                node.dataset,
                pagination,
                RulesCompiler.builtins(node, diagnostics),
                width);
    }

    /**
     * {@code width half | full} lays a leaf editor out in the content form's two-column grid (M35.17); {@code full} is
     * the default and is not stored. A structural editor ({@code group}, {@code list}, {@code catalog},
     * {@code pagination}) spans the form, so a width there is meaningless and rejected.
     */
    private static String checkWidth(EditorNode node, EditorType type, List<Diagnostic> diagnostics) {
        if (node.width == null) {
            return null;
        }
        boolean container = type == EditorType.GROUP
                || type == EditorType.LIST
                || type == EditorType.CATALOG
                || type == EditorType.PAGINATION;
        if (container) {
            diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.CDL_INVALID_WIDTH,
                    "A " + node.typeKeyword + " editor cannot have a width: it always spans the form. Set the width on "
                            + "the leaf editors inside it instead.",
                    node.widthLine, node.widthCol));
            return null;
        }
        if (!"half".equals(node.width) && !"full".equals(node.width)) {
            diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.CDL_INVALID_WIDTH,
                    "Invalid width '" + node.width + "': use 'half' or 'full'.", node.widthLine, node.widthCol));
            return null;
        }
        return "half".equals(node.width) ? "half" : null;
    }

    /**
     * {@code localizable} marks a leaf editor language-dependent (M24.2.1). Structure is shared across
     * locales, so a container rejects it — its leaves may still be localizable individually.
     */
    private static boolean checkLocalizable(EditorNode node, EditorType type, List<Diagnostic> diagnostics) {
        if (!node.localizable) {
            return false;
        }
        boolean container = type == EditorType.GROUP
                || type == EditorType.LIST
                || type == EditorType.CATALOG
                || type == EditorType.PAGINATION;
        if (container) {
            diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.CDL_CONTAINER_NOT_LOCALIZABLE,
                    "A " + node.typeKeyword + " editor cannot be localizable: page structure is shared by all "
                            + "languages. Mark the leaf editors inside it instead.",
                    node.localizableLine, node.localizableCol));
            return false;
        }
        return true;
    }

    /**
     * A pagination editor is page-level (M21.1.1): it may not sit inside a {@code list} item or a group, and a
     * definition holds at most one. Section templates, property sets and datasets reject it in their own overlays.
     */
    private static void checkPaginationPlacement(List<EditorNode> topLevel, List<Diagnostic> diagnostics) {
        boolean seen = false;
        for (EditorNode node : topLevel) {
            if ("pagination".equals(node.typeKeyword)) {
                if (seen) {
                    diagnostics.add(Diagnostic.error(
                            DiagnosticCodes.CDL_PAGINATION_DUPLICATE,
                            "Only one pagination editor is allowed per page template: '" + node.name + "' is a second one",
                            node.typeLine, node.typeCol));
                }
                seen = true;
            }
            checkNestedPagination(node.items, diagnostics);
        }
    }

    private static void checkNestedPagination(List<EditorNode> nested, List<Diagnostic> diagnostics) {
        for (EditorNode node : nested) {
            if ("pagination".equals(node.typeKeyword)) {
                diagnostics.add(Diagnostic.error(
                        DiagnosticCodes.CDL_PAGINATION_PLACEMENT,
                        "Pagination editor '" + node.name + "' must be declared at the top level of the content block,"
                                + " not inside a list or group",
                        node.typeLine, node.typeCol));
            }
            checkNestedPagination(node.items, diagnostics);
        }
    }

    /**
     * The {@code sources}/{@code pageSize}/{@code maxPageSize}/{@code sort} attributes (M21.1.1): only valid on a
     * {@code pagination} editor, which always gets options (defaults for the absent ones). Sort keys of a
     * navigation-only editor must be navigation keys; dataset field names are checked when a page picks a dataset.
     */
    private static PaginationOptions paginationOptions(EditorNode node, EditorType type, List<Diagnostic> diagnostics) {
        if (type != EditorType.PAGINATION) {
            if (node.paginationLine >= 0) {
                diagnostics.add(Diagnostic.error(
                        DiagnosticCodes.CDL_INVALID_ATTRIBUTE,
                        "'sources', 'pageSize', 'maxPageSize' and 'sort' are only valid on a 'pagination' editor",
                        node.paginationLine, node.paginationCol));
            }
            return null;
        }
        int line = node.paginationLine >= 0 ? node.paginationLine : node.typeLine;
        int col = node.paginationLine >= 0 ? node.paginationCol : node.typeCol;
        List<String> sources = node.sources == null ? List.of() : node.sources;
        for (String source : sources) {
            if (!PaginationOptions.SOURCE_KINDS.contains(source)) {
                diagnostics.add(Diagnostic.error(
                        DiagnosticCodes.CDL_INVALID_ATTRIBUTE,
                        "Unknown pagination source '" + source + "': use \"nav\" or \"dataset\"", line, col));
            }
        }
        if (node.sources != null && sources.isEmpty()) {
            diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.CDL_INVALID_ATTRIBUTE, "'sources' needs at least one source kind", line, col));
        }
        int pageSize = node.pageSize == null ? PaginationOptions.DEFAULT_PAGE_SIZE : node.pageSize;
        if (pageSize < 1 || pageSize > PaginationOptions.MAX_PAGE_SIZE) {
            diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.CDL_INVALID_ATTRIBUTE,
                    "'pageSize' must be between 1 and " + PaginationOptions.MAX_PAGE_SIZE, line, col));
        }
        if (node.maxPageSize != null
                && (node.maxPageSize < pageSize || node.maxPageSize > PaginationOptions.MAX_PAGE_SIZE)) {
            diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.CDL_INVALID_ATTRIBUTE,
                    "'maxPageSize' must be at least 'pageSize' (" + pageSize + ") and at most "
                            + PaginationOptions.MAX_PAGE_SIZE,
                    line, col));
        }
        PaginationOptions options = new PaginationOptions(
                sources.stream().filter(PaginationOptions.SOURCE_KINDS::contains).distinct().toList(),
                pageSize, node.maxPageSize, node.sort);
        boolean navOnly = !options.sources().contains(PaginationOptions.DATASET);
        for (String key : options.sort()) {
            if (navOnly ? !PaginationOptions.NAV_SORT_KEYS.contains(key) : !key.matches("[A-Za-z_][A-Za-z0-9_]{0,63}")) {
                diagnostics.add(Diagnostic.error(
                        DiagnosticCodes.CDL_INVALID_ATTRIBUTE,
                        "Unknown sort key '" + key + "'" + (navOnly
                                ? ": a navigation source sorts by " + String.join(", ", PaginationOptions.NAV_SORT_KEYS)
                                : ""),
                        line, col));
            }
        }
        return options;
    }

    /**
     * {@code dataset "uid"} (M19.3.2) restricts a {@code reference} editor to one dataset's records — and, when
     * {@code assetTypes} allows {@code RECORD_SET}, to that dataset's record sets (M25.2.2) — so it is only
     * meaningful on a reference editor that can pick records or record sets at all.
     */
    private static void checkDataset(CdlParser.EditorNode node, EditorType type, List<Diagnostic> diagnostics) {
        if (node.dataset == null) {
            return;
        }
        if (type != EditorType.REFERENCE) {
            diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.CDL_INVALID_ATTRIBUTE,
                    "'dataset' is only valid on a 'reference' editor", node.datasetLine, node.datasetCol));
        } else if (node.dataset.isBlank()) {
            diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.CDL_INVALID_ATTRIBUTE,
                    "'dataset' needs the dataset's UID", node.datasetLine, node.datasetCol));
        } else if (!node.assetTypes.isEmpty()
                && !node.assetTypes.contains("RECORD")
                && !node.assetTypes.contains("RECORD_SET")) {
            diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.CDL_INVALID_ATTRIBUTE,
                    "'dataset' restricts the editor to records or record sets, but assetTypes includes neither"
                            + " RECORD nor RECORD_SET",
                    node.datasetLine, node.datasetCol));
        }
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
