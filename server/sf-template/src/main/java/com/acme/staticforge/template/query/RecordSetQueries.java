package com.acme.staticforge.template.query;

import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.octl.Accessor;
import com.acme.staticforge.template.octl.Expr;
import com.acme.staticforge.template.octl.OctlExpressions;
import com.acme.staticforge.template.render.Filters;
import com.fasterxml.jackson.databind.JsonNode;
import java.text.Collator;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;

/**
 * The one place a record set's stored query is validated, evaluated and rewritten (M25.1.2, epic
 * decision 3). Preview, generation, the record grid's "apply set query" mode and the incremental planner
 * all go through here, so a set selects the same records everywhere.
 *
 * <p><b>Grammar.</b> The {@link RecordSetQuery} is the record listing's flavour of the dataset query:
 * {@code where} is an OCTL expression over <em>bare</em> field names ({@code role == 'lead'}), {@code sort}
 * the loop sort-key syntax ({@code "name,-joined"}), {@code limit}/{@code offset} non-negative integers.
 * A set query is static: it cannot read the render scope, so {@code CMS_PAGE}, the other {@code CMS_*}
 * roots and asset references are {@code SF-TPL-0140}, and any other root that is not a dataset field — a
 * {@code $CMS_SET} variable included — is an unknown field, {@code SF-TPL-0141}. Sorting by an editor
 * without a natural order is {@code SF-TPL-0142}.
 *
 * <p><b>Evaluation.</b> {@code where} → {@code sort} (then {@code _displayName}, {@code _uid}) →
 * {@code offset} → {@code limit}, by {@link DatasetQueryEvaluator}. Language-dependent values are resolved
 * for the given locale chain first, and strings sort in the chain's first language — the rule dataset loops
 * follow (M24.3.3). A query that does not validate selects <em>nothing</em>: a broken set is never shown
 * unfiltered.
 *
 * <p>Pure and thread-safe.
 */
public final class RecordSetQueries {

    public static final String WHERE = "where";
    public static final String SORT = "sort";
    public static final String LIMIT = "limit";
    public static final String OFFSET = "offset";

    private RecordSetQueries() {}

    /**
     * A stored query compiled against one dataset definition.
     *
     * @param source the stored query
     * @param query the evaluable form (bare field names); best-effort when there are errors, and never
     *     evaluated then
     * @param diagnostics every finding, in field order ({@code where}, {@code sort}, {@code limit},
     *     {@code offset})
     */
    public record Compiled(RecordSetQuery source, DatasetQuery query, List<RecordSetQueryDiagnostic> diagnostics) {

        public Compiled {
            diagnostics = List.copyOf(diagnostics);
        }

        /** Whether the query has no error: only a valid query selects records. */
        public boolean valid() {
            return diagnostics.stream().noneMatch(d -> d.severity() == Severity.ERROR);
        }
    }

    // ------------------------------------------------------------------
    // Validation
    // ------------------------------------------------------------------

    /**
     * Parses {@code stored} and checks it against {@code definition}, the set's dataset schema. A
     * {@code null} definition (no schema to check against) skips the field checks, not the grammar.
     */
    public static Compiled compile(RecordSetQuery stored, ContentDefinition definition) {
        RecordSetQuery query = RecordSetQuery.orAll(stored);
        List<RecordSetQueryDiagnostic> diagnostics = new ArrayList<>();
        Expr where = query.where() == null ? null : compileWhere(query.where(), definition, diagnostics);
        List<SortKey> sort = query.sort() == null ? List.of() : compileSort(query.sort(), definition, diagnostics);
        checkNonNegative(LIMIT, query.limit(), diagnostics);
        checkNonNegative(OFFSET, query.offset(), diagnostics);
        return new Compiled(query, new DatasetQuery(null, where, sort, query.limit(), query.offset(), null), diagnostics);
    }

    /** Whether {@code stored} validates against {@code definition}: the cheap "is this set broken?" check. */
    public static boolean isValid(RecordSetQuery stored, ContentDefinition definition) {
        return compile(stored, definition).valid();
    }

    /**
     * The generation/preview warning for a set whose stored query no longer validates (typically a field
     * removed from the dataset schema): the set renders no records, {@code SF-GEN-0240}.
     */
    public static Diagnostic invalidQueryWarning(String setUid, Compiled query) {
        String reason = query.diagnostics().stream()
                .filter(d -> d.severity() == Severity.ERROR)
                .findFirst()
                .map(d -> d.field() + ": " + d.message())
                .orElse("invalid query");
        return Diagnostic.warning(
                DiagnosticCodes.GEN_RECORD_SET_QUERY_INVALID,
                "Record set '" + setUid + "' has an invalid query (" + reason + ") and renders no records.",
                0,
                0);
    }

    private static Expr compileWhere(String source, ContentDefinition definition, List<RecordSetQueryDiagnostic> out) {
        OctlExpressions.Parsed parsed = OctlExpressions.parse(source);
        if (!parsed.ok()) {
            out.add(error(WHERE, DiagnosticCodes.OCTL_DATASET_QUERY,
                    "Invalid where expression: " + parsed.error(), source, parsed.column() - 1));
            return null;
        }
        List<Expr.Access> accesses = new ArrayList<>();
        DatasetQueryParser.collectAllAccesses(parsed.expr(), accesses);
        Set<String> reported = new LinkedHashSet<>();
        for (Expr.Access access : accesses) {
            Accessor accessor = access.accessor();
            if (accessor.isAssetReference()) {
                if (reported.add(accessor.referenceKey())) {
                    out.add(error(WHERE, DiagnosticCodes.OCTL_DATASET_QUERY,
                            "A record set query cannot read other assets: " + accessor.referenceKey(),
                            source, offsetOf(source, accessor.assetType(), true)));
                }
                continue;
            }
            String root = accessor.path().get(0);
            if (!reported.add(root)) {
                continue;
            }
            if (isRenderScopeRoot(root)) {
                out.add(error(WHERE, DiagnosticCodes.OCTL_DATASET_QUERY,
                        "A record set query cannot read the render scope: " + root, source, offsetOf(source, root, false)));
            } else if (definition != null && !RecordView.META_FIELDS.contains(root) && definition.findEditor(root).isEmpty()) {
                out.add(error(WHERE, DiagnosticCodes.OCTL_DATASET_UNKNOWN_FIELD,
                        "Unknown dataset field in where: " + root, source, offsetOf(source, root, false)));
            }
        }
        return parsed.expr();
    }

    private static List<SortKey> compileSort(String source, ContentDefinition definition, List<RecordSetQueryDiagnostic> out) {
        DatasetQueryParser.ParsedSort parsed = DatasetQueryParser.parseSort(source);
        if (!parsed.ok()) {
            out.add(error(SORT, DiagnosticCodes.OCTL_DATASET_QUERY, "Invalid sort: " + parsed.error(), source, 0));
            return List.of();
        }
        for (SortKey key : parsed.keys()) {
            if (definition == null || RecordView.META_FIELDS.contains(key.field())) {
                continue;
            }
            int offset = sortKeyOffset(source, key.field());
            Optional<EditorDefinition> editor = definition.findEditor(key.field());
            if (editor.isEmpty()) {
                out.add(error(SORT, DiagnosticCodes.OCTL_DATASET_UNKNOWN_FIELD,
                        "Unknown dataset field in sort: " + key.field(), source, offset));
            } else if (!DatasetQueryParser.SCALAR_TYPES.contains(editor.get().type())) {
                out.add(error(SORT, DiagnosticCodes.OCTL_DATASET_UNSORTABLE_FIELD,
                        "Cannot sort by " + key.field() + ": " + editor.get().type().name().toLowerCase(Locale.ROOT)
                                + " editors have no order",
                        source, offset));
            }
        }
        return parsed.keys();
    }

    private static void checkNonNegative(String field, Integer value, List<RecordSetQueryDiagnostic> out) {
        if (value != null && value < 0) {
            out.add(new RecordSetQueryDiagnostic(field, Severity.ERROR, DiagnosticCodes.OCTL_DATASET_QUERY,
                    field + " must be a non-negative integer, got " + value, 0, 0));
        }
    }

    /**
     * A root the render scope provides and a static query can't: {@code CMS_PAGE}, {@code CMS_PAGINATION},
     * {@code CMS_LOCALES} and every other {@code CMS_*} name (reserved for the renderer).
     */
    private static boolean isRenderScopeRoot(String root) {
        return root.startsWith("CMS_");
    }

    // ------------------------------------------------------------------
    // Evaluation
    // ------------------------------------------------------------------

    /**
     * The records the set shows, in order: {@code records} (the set's live records) resolved for
     * {@code localeChain} (render locale first; empty in a project without languages) and run through the
     * query. An invalid query selects nothing.
     */
    public static List<RecordView> select(List<RecordView> records, Compiled query, List<String> localeChain) {
        return select(records, query, localeChain, null, null);
    }

    /**
     * As {@link #select(List, Compiled, List)}, then narrowed by {@code narrowing} (epic decision 5): its
     * {@code where} is AND-ed, a non-empty {@code sort} re-sorts (stable, so ties keep the set's order) and
     * its {@code offset}/{@code limit} slice the set's result. {@code narrowing}'s {@code folder} filters
     * too. {@code scope} evaluates a narrowing accessor that is not a record field (a loop's
     * {@code CMS_PAGE.team}); {@code null} makes such accessors missing.
     */
    public static List<RecordView> select(
            List<RecordView> records,
            Compiled query,
            List<String> localeChain,
            DatasetQuery narrowing,
            Function<Accessor, JsonNode> scope) {
        if (!query.valid()) {
            return List.of();
        }
        Collator collator = collator(localeChain);
        List<RecordView> selected = DatasetQueryEvaluator.apply(resolved(records, localeChain), query.query(), null, collator);
        if (narrowing == null) {
            return selected;
        }
        List<RecordView> narrowed = new ArrayList<>();
        for (RecordView record : selected) {
            if (DatasetQueryEvaluator.matches(record, narrowing, scope)) {
                narrowed.add(record);
            }
        }
        if (!narrowing.sort().isEmpty()) {
            narrowed = DatasetQueryEvaluator.sort(narrowed, narrowing.sort(), collator);
        }
        int from = narrowing.offset() == null ? 0 : Math.min(narrowing.offset(), narrowed.size());
        int to = narrowing.limit() == null
                ? narrowed.size()
                : (int) Math.min((long) from + narrowing.limit(), narrowed.size());
        return List.copyOf(narrowed.subList(from, to));
    }

    /**
     * How many of {@code records} the query's {@code where} matches, before {@code offset}/{@code limit}
     * (a query editor's live "N matching records"); {@code 0} for an invalid query.
     */
    public static int count(List<RecordView> records, Compiled query, List<String> localeChain) {
        if (!query.valid()) {
            return 0;
        }
        return DatasetQueryEvaluator.count(resolved(records, localeChain), query.query(), null);
    }

    /**
     * Whether the set can select {@code record} in some render (incremental planning, M25.2.3): its
     * {@code where} passes for at least one of {@code localeChains} (one per project language; empty in a
     * project without languages) and, when given, {@code narrowing} (a loop's arguments) may select it as
     * well. Sorting and slicing follow the filter, so a record no filter lets through cannot change the
     * set's output. An invalid query selects nothing, whatever the record holds.
     */
    public static boolean maySelect(
            RecordView record, Compiled query, DatasetQuery narrowing, List<List<String>> localeChains) {
        if (!query.valid()) {
            return false;
        }
        List<List<String>> chains = localeChains == null || localeChains.isEmpty() ? List.of(List.of()) : localeChains;
        for (List<String> chain : chains) {
            RecordView resolved = record.resolvedFor(chain);
            if (DatasetQueryEvaluator.maySelect(resolved, query.query())
                    && (narrowing == null || DatasetQueryEvaluator.maySelect(resolved, narrowing))) {
                return true;
            }
        }
        return false;
    }

    private static List<RecordView> resolved(List<RecordView> records, List<String> localeChain) {
        if (records == null || records.isEmpty()) {
            return List.of();
        }
        if (localeChain == null || localeChain.isEmpty()) {
            return records;
        }
        return records.stream().map(record -> record.resolvedFor(localeChain)).toList();
    }

    private static Collator collator(List<String> localeChain) {
        return localeChain == null || localeChain.isEmpty() ? null : Collator.getInstance(Filters.localeOf(localeChain.get(0)));
    }

    // ------------------------------------------------------------------
    // Schema rename
    // ------------------------------------------------------------------

    /**
     * {@code stored} with its field names renamed ({@code renames}: previous name → new name, the
     * dataset's {@code renamedFrom} hops). {@code where} is rewritten on its syntax tree and printed back
     * ({@link OctlExpressions#print}), so a string literal that happens to spell a field name stays as it
     * is; only accessor roots and sort keys change. A part that does not parse is left untouched (it stays
     * invalid). Returns {@code stored} itself when nothing was renamed.
     */
    public static RecordSetQuery rename(RecordSetQuery stored, Map<String, String> renames) {
        if (stored == null || renames == null || renames.isEmpty()) {
            return stored;
        }
        String where = stored.where();
        if (where != null) {
            OctlExpressions.Parsed parsed = OctlExpressions.parse(where);
            if (parsed.ok()) {
                Expr renamed = renameRoots(parsed.expr(), renames);
                if (!renamed.equals(parsed.expr())) {
                    where = OctlExpressions.print(renamed);
                }
            }
        }
        String sort = stored.sort();
        if (sort != null) {
            DatasetQueryParser.ParsedSort parsed = DatasetQueryParser.parseSort(sort);
            if (parsed.ok() && parsed.keys().stream().anyMatch(key -> renamedField(key.field(), renames) != null)) {
                List<String> keys = new ArrayList<>();
                for (SortKey key : parsed.keys()) {
                    String to = renamedField(key.field(), renames);
                    keys.add((key.descending() ? "-" : "") + (to == null ? key.field() : to));
                }
                sort = String.join(",", keys);
            }
        }
        if (Objects.equals(where, stored.where()) && Objects.equals(sort, stored.sort())) {
            return stored;
        }
        return new RecordSetQuery(where, sort, stored.limit(), stored.offset());
    }

    private static Expr renameRoots(Expr expr, Map<String, String> renames) {
        return switch (expr) {
            case Expr.Literal l -> l;
            case Expr.Access a -> {
                Accessor accessor = a.accessor();
                String to = accessor.isAssetReference() ? null : renamedField(accessor.path().get(0), renames);
                if (to == null) {
                    yield a;
                }
                List<String> path = new ArrayList<>(accessor.path());
                path.set(0, to);
                yield new Expr.Access(new Accessor(null, null, path), a.filters());
            }
            case Expr.Group g -> new Expr.Group(renameRoots(g.inner(), renames));
            case Expr.Not n -> new Expr.Not(renameRoots(n.operand(), renames));
            case Expr.And a -> new Expr.And(renameRoots(a.left(), renames), renameRoots(a.right(), renames));
            case Expr.Or o -> new Expr.Or(renameRoots(o.left(), renames), renameRoots(o.right(), renames));
            case Expr.Cmp c -> new Expr.Cmp(c.operator(), renameRoots(c.left(), renames), renameRoots(c.right(), renames));
        };
    }

    /** The new name of a renamed dataset field; {@code null} for a field that keeps its name (meta fields always do). */
    private static String renamedField(String field, Map<String, String> renames) {
        if (field == null || RecordView.META_FIELDS.contains(field)) {
            return null;
        }
        String to = renames.get(field);
        return to == null || to.equals(field) ? null : to;
    }

    // ------------------------------------------------------------------
    // Positions
    // ------------------------------------------------------------------

    private static RecordSetQueryDiagnostic error(String field, String code, String message, String source, int offset) {
        int line = 1;
        int column = 1;
        int end = Math.max(0, Math.min(offset, source.length()));
        for (int i = 0; i < end; i++) {
            if (source.charAt(i) == '\n') {
                line++;
                column = 1;
            } else {
                column++;
            }
        }
        return new RecordSetQueryDiagnostic(field, Severity.ERROR, code, message, line, column);
    }

    /**
     * Best-effort offset of an accessor root in a {@code where} source (the AST keeps no positions): the
     * first identifier spelling {@code name} outside string literals that starts an accessor — not after a
     * {@code .} or a filter's {@code |}; for an asset reference ({@code reference}), one followed by
     * {@code :}. {@code 0} when not found.
     */
    private static int offsetOf(String source, String name, boolean reference) {
        int i = 0;
        while (i < source.length()) {
            char c = source.charAt(i);
            if (c == '"' || c == '\'') {
                i = skipString(source, i);
                continue;
            }
            if (!isIdentChar(c)) {
                i++;
                continue;
            }
            int start = i;
            while (i < source.length() && isIdentChar(source.charAt(i))) {
                i++;
            }
            if (!source.substring(start, i).equals(name)) {
                continue;
            }
            int before = previousNonBlank(source, start);
            char previous = before < 0 ? '\0' : source.charAt(before);
            // A filter name follows a single '|'; the '||' operator is followed by an operand.
            boolean filterName = previous == '|' && (before == 0 || source.charAt(before - 1) != '|');
            boolean accessorStart = previous != '.' && previous != ':' && !filterName;
            if (accessorStart && (nextNonBlank(source, i) == ':') == reference) {
                return start;
            }
        }
        return 0;
    }

    /** The offset of a sort key's field in the sort source, {@code 0} when not found. */
    private static int sortKeyOffset(String source, String field) {
        int from = 0;
        for (String part : source.split(",", -1)) {
            String trimmed = part.strip();
            String name = trimmed.startsWith("-") ? trimmed.substring(1).strip() : trimmed;
            if (name.equals(field)) {
                return from + part.indexOf(name, part.indexOf(trimmed) + (trimmed.startsWith("-") ? 1 : 0));
            }
            from += part.length() + 1;
        }
        return 0;
    }

    private static int skipString(String source, int open) {
        char quote = source.charAt(open);
        int i = open + 1;
        while (i < source.length()) {
            char c = source.charAt(i);
            if (c == '\\') {
                i += 2;
            } else if (c == quote) {
                return i + 1;
            } else {
                i++;
            }
        }
        return i;
    }

    /** The index of the last non-blank character before {@code index}, {@code -1} when there is none. */
    private static int previousNonBlank(String source, int index) {
        for (int i = index - 1; i >= 0; i--) {
            if (!Character.isWhitespace(source.charAt(i))) {
                return i;
            }
        }
        return -1;
    }

    private static char nextNonBlank(String source, int index) {
        for (int i = index; i < source.length(); i++) {
            if (!Character.isWhitespace(source.charAt(i))) {
                return source.charAt(i);
            }
        }
        return '\0';
    }

    private static boolean isIdentChar(char c) {
        return Character.isLetterOrDigit(c) || c == '_' || c == '-';
    }
}
