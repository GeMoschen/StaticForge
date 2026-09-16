package com.acme.staticforge.template.query;

import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.acme.staticforge.template.content.EditorType;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.octl.Accessor;
import com.acme.staticforge.template.octl.Expr;
import com.acme.staticforge.template.octl.OctlExpressions;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Parses and validates dataset query arguments (M19.3.1) — the named arguments of
 * {@code $CMS_FOR(member : dataset:team, where="…", sort="…", limit=…, offset=…, folder="…")$}.
 *
 * <ul>
 *   <li>{@code where}: an OCTL expression (spec §16.9, the {@code $CMS_IF} grammar, parsed strictly by
 *       {@link OctlExpressions}). Record fields are read through the loop variable
 *       ({@code member.role}, {@code member._uid}); any other root ({@code CMS_PAGE.team}, a
 *       {@code $CMS_SET} variable, an editor of the template) is a value of the render scope. There
 *       are no bare field names in a template, so a field can never be confused with a variable.
 *       Outside a template ({@code variable == null}: the REST listing) fields are bare names.
 *   <li>{@code sort}: comma-separated fields, a leading {@code -} for descending ({@code "name,-joined"}).
 *   <li>{@code limit}, {@code offset}: non-negative integers.
 *   <li>{@code folder}: a Content folder path prefix ({@code "team"} or {@code "/team/leads/"}).
 * </ul>
 *
 * <p>Argument errors are {@code SF-TPL-0140} diagnostics. With the dataset's content definition,
 * {@link #validateFields} additionally reports unknown fields ({@code SF-TPL-0141}) and sorting on a
 * field that has no natural order ({@code SF-TPL-0142}). Diagnostics carry the position of the
 * instruction the arguments belong to; messages name the argument and the column inside it.
 */
public final class DatasetQueryParser {

    /** The named arguments a dataset loop accepts. */
    public static final Set<String> ARGUMENTS = Set.of("where", "sort", "limit", "offset", "folder");

    /** Editor types with a natural order: sortable, and shown as grid columns. */
    public static final Set<EditorType> SCALAR_TYPES = EnumSet.of(
            EditorType.TEXT,
            EditorType.TEXTAREA,
            EditorType.NUMBER,
            EditorType.BOOLEAN,
            EditorType.DATE,
            EditorType.DATETIME,
            EditorType.SELECT,
            EditorType.COLOR);

    private DatasetQueryParser() {}

    /** A parsed query plus every finding; {@code query} is best-effort when there are errors. */
    public record Result(DatasetQuery query, List<Diagnostic> diagnostics) {

        public Result {
            diagnostics = List.copyOf(diagnostics);
        }

        public boolean hasErrors() {
            return diagnostics.stream().anyMatch(d -> d.severity() == Severity.ERROR);
        }
    }

    /** A parsed sort specification, or the first problem in it. */
    public record ParsedSort(List<SortKey> keys, String error) {

        public boolean ok() {
            return error == null;
        }
    }

    /**
     * Parses a dataset loop's named arguments.
     *
     * @param args the instruction's named arguments, in source order
     * @param variable the loop variable record fields are read through
     * @param line the instruction's line, for diagnostics
     * @param col the instruction's column, for diagnostics
     */
    public static Result parse(Map<String, String> args, String variable, int line, int col) {
        List<Diagnostic> diagnostics = new ArrayList<>();
        Expr where = null;
        List<SortKey> sort = List.of();
        Integer limit = null;
        Integer offset = null;
        String folder = null;

        for (Map.Entry<String, String> arg : args.entrySet()) {
            String name = arg.getKey();
            String value = arg.getValue() == null ? "" : arg.getValue();
            switch (name) {
                case "where" -> {
                    OctlExpressions.Parsed parsed = OctlExpressions.parse(value);
                    if (parsed.ok()) {
                        where = parsed.expr();
                        checkWhereRoots(where, variable, line, col, diagnostics);
                    } else {
                        diagnostics.add(error(
                                "Invalid where expression at column " + parsed.column() + ": " + parsed.error(), line, col));
                    }
                }
                case "sort" -> {
                    ParsedSort parsed = parseSort(value);
                    if (parsed.ok()) {
                        sort = parsed.keys();
                    } else {
                        diagnostics.add(error("Invalid sort: " + parsed.error(), line, col));
                    }
                }
                case "limit" -> limit = nonNegative(name, value, line, col, diagnostics);
                case "offset" -> offset = nonNegative(name, value, line, col, diagnostics);
                case "folder" -> folder = value;
                default -> diagnostics.add(error(
                        "Unknown dataset loop argument '" + name + "' (expected one of where, sort, limit, offset, folder)",
                        line, col));
            }
        }
        return new Result(new DatasetQuery(variable, where, sort, limit, offset, folder), diagnostics);
    }

    /**
     * Parses a template sort specification: comma-separated field names, each optionally prefixed
     * with {@code -} for descending. Duplicate fields keep their first occurrence.
     */
    public static ParsedSort parseSort(String spec) {
        if (spec == null || spec.isBlank()) {
            return new ParsedSort(List.of(), "sort is empty");
        }
        List<SortKey> keys = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        for (String raw : spec.split(",", -1)) {
            String part = raw.trim();
            boolean descending = part.startsWith("-");
            String field = descending ? part.substring(1).trim() : part;
            if (!isFieldName(field)) {
                return new ParsedSort(List.of(), "'" + part + "' is not a field name");
            }
            if (seen.add(field)) {
                keys.add(descending ? SortKey.desc(field) : SortKey.asc(field));
            }
        }
        return new ParsedSort(keys, null);
    }

    /**
     * Checks field names against the dataset's content definition: every record field a
     * {@code where} expression or a sort key names must be a declared editor or a meta field, and a
     * sort key must name a meta field or a {@link #SCALAR_TYPES scalar} editor.
     */
    public static List<Diagnostic> validateFields(DatasetQuery query, ContentDefinition definition, int line, int col) {
        List<Diagnostic> diagnostics = new ArrayList<>();
        if (definition == null) {
            return diagnostics;
        }
        Set<String> reported = new LinkedHashSet<>();
        for (String field : whereFields(query)) {
            if (!RecordView.META_FIELDS.contains(field)
                    && definition.findEditor(field).isEmpty()
                    && reported.add(field)) {
                diagnostics.add(Diagnostic.error(
                        DiagnosticCodes.OCTL_DATASET_UNKNOWN_FIELD,
                        "Unknown dataset field in where: " + field, line, col));
            }
        }
        for (SortKey key : query.sort()) {
            if (RecordView.META_FIELDS.contains(key.field())) {
                continue;
            }
            Optional<EditorDefinition> editor = definition.findEditor(key.field());
            if (editor.isEmpty()) {
                diagnostics.add(Diagnostic.error(
                        DiagnosticCodes.OCTL_DATASET_UNKNOWN_FIELD,
                        "Unknown dataset field in sort: " + key.field(), line, col));
            } else if (!SCALAR_TYPES.contains(editor.get().type())) {
                diagnostics.add(Diagnostic.error(
                        DiagnosticCodes.OCTL_DATASET_UNSORTABLE_FIELD,
                        "Cannot sort by " + key.field() + ": " + editor.get().type().name().toLowerCase(java.util.Locale.ROOT)
                                + " editors have no order",
                        line, col));
            }
        }
        return diagnostics;
    }

    /** The record field names a {@code where} expression reads, in source order. */
    public static Set<String> whereFields(DatasetQuery query) {
        Set<String> fields = new LinkedHashSet<>();
        if (query.where() != null) {
            collectFields(query.where(), query.variable(), fields);
        }
        return fields;
    }

    /**
     * The accessors of a {@code where} expression that are evaluated in the render scope rather
     * than against the record (every accessor not rooted at the loop variable).
     */
    public static List<Expr.Access> scopeAccesses(DatasetQuery query) {
        List<Expr.Access> out = new ArrayList<>();
        if (query.where() != null && query.variable() != null) {
            collectScopeAccesses(query.where(), query.variable(), out);
        }
        return out;
    }

    // ------------------------------------------------------------------

    private static void checkWhereRoots(Expr where, String variable, int line, int col, List<Diagnostic> diagnostics) {
        if (variable != null) {
            return;
        }
        // Without a loop variable there is no render scope: every accessor must be a bare field.
        List<Expr.Access> accesses = new ArrayList<>();
        collectAllAccesses(where, accesses);
        for (Expr.Access access : accesses) {
            if (access.accessor().isAssetReference()) {
                diagnostics.add(error(
                        "Asset references are not available in this where expression: "
                                + access.accessor().referenceKey(),
                        line, col));
            }
        }
    }

    private static void collectFields(Expr expr, String variable, Set<String> out) {
        List<Expr.Access> accesses = new ArrayList<>();
        collectAllAccesses(expr, accesses);
        for (Expr.Access access : accesses) {
            Accessor accessor = access.accessor();
            if (accessor.isAssetReference()) {
                continue;
            }
            List<String> path = accessor.path();
            if (variable == null) {
                if (!path.isEmpty()) {
                    out.add(path.get(0));
                }
            } else if (path.size() >= 2 && variable.equals(path.get(0))) {
                out.add(path.get(1));
            }
        }
    }

    private static void collectScopeAccesses(Expr expr, String variable, List<Expr.Access> out) {
        List<Expr.Access> accesses = new ArrayList<>();
        collectAllAccesses(expr, accesses);
        for (Expr.Access access : accesses) {
            Accessor accessor = access.accessor();
            if (accessor.isAssetReference() || accessor.path().isEmpty() || !variable.equals(accessor.path().get(0))) {
                out.add(access);
            }
        }
    }

    /** Every accessor of an expression, in source order. */
    public static void collectAllAccesses(Expr expr, List<Expr.Access> out) {
        switch (expr) {
            case Expr.Literal l -> { /* nothing */ }
            case Expr.Access a -> out.add(a);
            case Expr.Group g -> collectAllAccesses(g.inner(), out);
            case Expr.Not n -> collectAllAccesses(n.operand(), out);
            case Expr.And a -> {
                collectAllAccesses(a.left(), out);
                collectAllAccesses(a.right(), out);
            }
            case Expr.Or o -> {
                collectAllAccesses(o.left(), out);
                collectAllAccesses(o.right(), out);
            }
            case Expr.Cmp c -> {
                collectAllAccesses(c.left(), out);
                collectAllAccesses(c.right(), out);
            }
        }
    }

    private static Integer nonNegative(String name, String value, int line, int col, List<Diagnostic> diagnostics) {
        try {
            int parsed = Integer.parseInt(value.trim());
            if (parsed >= 0) {
                return parsed;
            }
        } catch (NumberFormatException e) {
            // reported below
        }
        diagnostics.add(error(name + " must be a non-negative integer, got '" + value + "'", line, col));
        return null;
    }

    private static boolean isFieldName(String field) {
        if (field.isEmpty()) {
            return false;
        }
        for (int i = 0; i < field.length(); i++) {
            char c = field.charAt(i);
            if (!Character.isLetterOrDigit(c) && c != '_' && c != '-') {
                return false;
            }
        }
        return true;
    }

    private static Diagnostic error(String message, int line, int col) {
        return Diagnostic.error(DiagnosticCodes.OCTL_DATASET_QUERY, message, line, col);
    }
}
