package com.acme.staticforge.template.query;

import com.acme.staticforge.template.octl.Accessor;
import com.acme.staticforge.template.octl.Expr;
import com.acme.staticforge.template.octl.FilterNode;
import com.acme.staticforge.template.render.Filter;
import com.acme.staticforge.template.render.Filters;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.BooleanNode;
import com.fasterxml.jackson.databind.node.MissingNode;
import com.fasterxml.jackson.databind.node.TextNode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;

/**
 * Applies a {@link DatasetQuery} to a dataset's records (M19.3.1). Pure and thread-safe: no state,
 * no I/O, the same input always yields the same output.
 *
 * <p><b>Order of operations:</b> {@code folder} → {@code where} → {@code sort} → {@code offset} →
 * {@code limit}.
 *
 * <p><b>Comparisons</b> ({@code == != < > <= >= in}):
 * <ul>
 *   <li>numbers compare numerically; two strings that are both ISO dates or date-times
 *       ({@code 2024-05-01}, {@code 2024-05-01T10:00:00Z}) compare chronologically (a date is the start
 *       of its day in UTC); other strings compare case-sensitively; booleans compare by value;
 *   <li>a typed reference value ({@code ASSET_REF}, {@code MEDIA_REF}: any object with a {@code uuid})
 *       compares as its {@code uuid};
 *   <li>a missing field equals {@code null}; {@code ==}/{@code !=} with {@code null} test presence;
 *       ordering comparisons with a missing value and comparisons across types are {@code false},
 *       never an error;
 *   <li>{@code in} tests membership in an array ({@code member.role in ['lead', 'cto']},
 *       {@code 'vip' in member.tags}) or a substring of a string.
 * </ul>
 *
 * <p><b>Sorting</b> is stable and multi-key. Missing and {@code null} values sort last in both
 * directions. Values compare as above; strings use a fixed, locale-independent collation
 * (case-insensitive, then case-sensitive as a tie-break), so generated output never depends on the
 * JVM's default locale. After the given keys, records are ordered by {@code _displayName} then
 * {@code _uid}; with no keys that is the whole order. Since uids are unique, the result order is
 * fully deterministic.
 */
public final class DatasetQueryEvaluator {

    /** The default order, and the tie-break after explicit keys. */
    private static final List<SortKey> DEFAULT_ORDER = List.of(SortKey.asc("_displayName"), SortKey.asc("_uid"));

    private DatasetQueryEvaluator() {}

    /**
     * The records the query selects, in order.
     *
     * @param scope evaluates a {@code where} accessor that is not a record field (a render-scope value
     *     such as {@code CMS_PAGE.team}); {@code null} makes such accessors missing
     */
    public static List<RecordView> apply(List<RecordView> records, DatasetQuery query, Function<Accessor, JsonNode> scope) {
        List<RecordView> selected = filterAndSort(records, query, scope);
        int from = query.offset() == null ? 0 : Math.min(query.offset(), selected.size());
        int to = query.limit() == null ? selected.size() : (int) Math.min((long) from + query.limit(), selected.size());
        return List.copyOf(selected.subList(from, to));
    }

    /** How many records the query selects before {@code offset}/{@code limit}: the size a paginator needs. */
    public static int count(List<RecordView> records, DatasetQuery query, Function<Accessor, JsonNode> scope) {
        int count = 0;
        for (RecordView record : records) {
            if (matches(record, query, scope)) {
                count++;
            }
        }
        return count;
    }

    /** Whether one record passes the query's {@code folder} and {@code where}. */
    public static boolean matches(RecordView record, DatasetQuery query, Function<Accessor, JsonNode> scope) {
        if (query.folder() != null && !record.folderPath().startsWith(query.folder())) {
            return false;
        }
        return query.where() == null || truthy(eval(query.where(), record, query.variable(), scope));
    }

    /**
     * Whether the query can select {@code record} in <em>some</em> render (incremental planning): false
     * only when {@code folder} or {@code where} excludes the record whatever the render scope holds. A
     * {@code where} that reads the render scope ({@code CMS_PAGE.team}, a {@code $CMS_SET} variable, an
     * outer loop) can't be decided without rendering, so it may select any record in the folder.
     *
     * <p>A record that no loop can select doesn't change the loop's output — not its items, their order,
     * {@code _count} or the {@code offset}/{@code limit} window — since filtering precedes all of them.
     */
    public static boolean maySelect(RecordView record, DatasetQuery query) {
        if (query.folder() != null && !record.folderPath().startsWith(query.folder())) {
            return false;
        }
        return query.where() == null
                || !DatasetQueryParser.scopeAccesses(query).isEmpty()
                || truthy(eval(query.where(), record, query.variable(), null));
    }

    private static List<RecordView> filterAndSort(List<RecordView> records, DatasetQuery query, Function<Accessor, JsonNode> scope) {
        List<RecordView> selected = new ArrayList<>();
        for (RecordView record : records) {
            if (matches(record, query, scope)) {
                selected.add(record);
            }
        }
        List<SortKey> keys = new ArrayList<>(query.sort());
        keys.addAll(DEFAULT_ORDER);
        return sort(selected, keys);
    }

    /**
     * Sorts records by {@code keys} (stable). Each record's sort values are computed once up front,
     * so a date string is parsed once per record rather than once per comparison.
     */
    public static List<RecordView> sort(List<RecordView> records, List<SortKey> keys) {
        List<Keyed> keyed = new ArrayList<>(records.size());
        for (RecordView record : records) {
            SortValue[] values = new SortValue[keys.size()];
            for (int i = 0; i < keys.size(); i++) {
                values[i] = SortValue.of(record.field(keys.get(i).field()));
            }
            keyed.add(new Keyed(record, values));
        }
        keyed.sort((a, b) -> {
            for (int i = 0; i < keys.size(); i++) {
                int result = a.values[i].compareTo(b.values[i], keys.get(i).descending());
                if (result != 0) {
                    return result;
                }
            }
            return 0;
        });
        List<RecordView> sorted = new ArrayList<>(keyed.size());
        keyed.forEach(k -> sorted.add(k.record));
        return sorted;
    }

    private record Keyed(RecordView record, SortValue[] values) {}

    // ------------------------------------------------------------------
    // Expression evaluation
    // ------------------------------------------------------------------

    private static JsonNode eval(Expr expr, RecordView record, String variable, Function<Accessor, JsonNode> scope) {
        return switch (expr) {
            case Expr.Literal l -> l.value();
            case Expr.Access a -> pipe(access(a.accessor(), record, variable, scope), a.filters());
            case Expr.Group g -> eval(g.inner(), record, variable, scope);
            case Expr.Not n -> BooleanNode.valueOf(!truthy(eval(n.operand(), record, variable, scope)));
            case Expr.And a -> BooleanNode.valueOf(
                    truthy(eval(a.left(), record, variable, scope)) && truthy(eval(a.right(), record, variable, scope)));
            case Expr.Or o -> BooleanNode.valueOf(
                    truthy(eval(o.left(), record, variable, scope)) || truthy(eval(o.right(), record, variable, scope)));
            case Expr.Cmp c -> BooleanNode.valueOf(
                    compare(c.operator(), eval(c.left(), record, variable, scope), eval(c.right(), record, variable, scope)));
        };
    }

    private static JsonNode access(Accessor accessor, RecordView record, String variable, Function<Accessor, JsonNode> scope) {
        List<String> path = accessor.path();
        if (!accessor.isAssetReference() && !path.isEmpty()) {
            if (variable == null) {
                return walk(record.field(path.get(0)), path, 1);
            }
            if (variable.equals(path.get(0))) {
                return path.size() == 1 ? record.item() : walk(record.field(path.get(1)), path, 2);
            }
        }
        if (scope == null) {
            return MissingNode.getInstance();
        }
        JsonNode value = scope.apply(accessor);
        return value == null ? MissingNode.getInstance() : value;
    }

    private static JsonNode walk(JsonNode base, List<String> path, int from) {
        JsonNode node = base;
        for (int i = from; i < path.size(); i++) {
            if (node == null || !node.isObject()) {
                return MissingNode.getInstance();
            }
            node = node.get(path.get(i));
        }
        return node == null ? MissingNode.getInstance() : node;
    }

    private static JsonNode pipe(JsonNode value, List<FilterNode> filters) {
        JsonNode result = value;
        for (FilterNode node : filters) {
            Filter filter = Filters.lookup(node.name());
            if (filter != null) {
                result = filter.apply(result, node.args());
            }
        }
        return result;
    }

    static boolean truthy(JsonNode node) {
        if (isAbsent(node)) {
            return false;
        }
        if (node.isBoolean()) {
            return node.asBoolean();
        }
        if (node.isNumber()) {
            return node.asDouble() != 0;
        }
        if (node.isTextual()) {
            return !node.asText().isEmpty();
        }
        return node.size() > 0;
    }

    static boolean compare(String operator, JsonNode left, JsonNode right) {
        JsonNode l = scalar(left);
        JsonNode r = scalar(right);
        return switch (operator) {
            case "==" -> same(l, r);
            case "!=" -> !same(l, r);
            case "in" -> in(l, right);
            case "<", ">", "<=", ">=" -> {
                Integer order = order(l, r);
                yield order != null && switch (operator) {
                    case "<" -> order < 0;
                    case ">" -> order > 0;
                    case "<=" -> order <= 0;
                    default -> order >= 0;
                };
            }
            default -> false;
        };
    }

    private static boolean same(JsonNode a, JsonNode b) {
        if (isAbsent(a) || isAbsent(b)) {
            return isAbsent(a) && isAbsent(b);
        }
        if (a.isNumber() && b.isNumber()) {
            return a.decimalValue().compareTo(b.decimalValue()) == 0;
        }
        if (a.isTextual() && b.isTextual()) {
            Instant ta = temporal(a.asText());
            Instant tb = ta == null ? null : temporal(b.asText());
            return tb != null ? ta.equals(tb) : a.asText().equals(b.asText());
        }
        if (a.isBoolean() && b.isBoolean()) {
            return a.asBoolean() == b.asBoolean();
        }
        return a.isContainerNode() && b.isContainerNode() && a.equals(b);
    }

    /** {@code <0}, {@code 0} or {@code >0}; {@code null} for a missing value or a type mismatch (no order). */
    private static Integer order(JsonNode a, JsonNode b) {
        if (isAbsent(a) || isAbsent(b)) {
            return null;
        }
        if (a.isNumber() && b.isNumber()) {
            return a.decimalValue().compareTo(b.decimalValue());
        }
        if (a.isTextual() && b.isTextual()) {
            Instant ta = temporal(a.asText());
            Instant tb = ta == null ? null : temporal(b.asText());
            return tb != null ? ta.compareTo(tb) : a.asText().compareTo(b.asText());
        }
        return null;
    }

    private static boolean in(JsonNode value, JsonNode container) {
        if (isAbsent(value) || isAbsent(container)) {
            return false;
        }
        if (container.isArray()) {
            for (JsonNode element : container) {
                if (same(value, scalar(element))) {
                    return true;
                }
            }
            return false;
        }
        if (container.isTextual() && value.isTextual()) {
            return container.asText().contains(value.asText());
        }
        return false;
    }

    /** A typed reference value compares as its {@code uuid}; every other value as itself. */
    private static JsonNode scalar(JsonNode node) {
        if (node != null && node.isObject()) {
            JsonNode uuid = node.get("uuid");
            if (uuid != null && uuid.isTextual()) {
                return TextNode.valueOf(uuid.asText());
            }
        }
        return node;
    }

    private static boolean isAbsent(JsonNode node) {
        return node == null || node.isMissingNode() || node.isNull();
    }

    // ------------------------------------------------------------------
    // Sorting
    // ------------------------------------------------------------------

    /**
     * A field value reduced to what ordering needs. Ranks keep the order total (and therefore
     * transitive) across mixed types: numbers, then booleans, then dates and date-times, then other
     * strings, then anything else; a missing value sorts after all of them in both directions.
     */
    private record SortValue(int rank, java.math.BigDecimal number, boolean bool, Instant time, String text) {

        private static final int ABSENT = 5;

        static SortValue of(JsonNode raw) {
            JsonNode node = scalar(raw);
            if (isAbsent(node)) {
                return new SortValue(ABSENT, null, false, null, null);
            }
            if (node.isNumber()) {
                return new SortValue(0, node.decimalValue(), false, null, null);
            }
            if (node.isBoolean()) {
                return new SortValue(1, null, node.asBoolean(), null, null);
            }
            if (node.isTextual()) {
                Instant time = temporal(node.asText());
                return time != null
                        ? new SortValue(2, null, false, time, node.asText())
                        : new SortValue(3, null, false, null, node.asText());
            }
            return new SortValue(4, null, false, null, node.toString());
        }

        int compareTo(SortValue other, boolean descending) {
            if (rank == ABSENT || other.rank == ABSENT) {
                return Integer.compare(rank == ABSENT ? 1 : 0, other.rank == ABSENT ? 1 : 0);
            }
            int result;
            if (rank != other.rank) {
                result = Integer.compare(rank, other.rank);
            } else {
                result = switch (rank) {
                    case 0 -> number.compareTo(other.number);
                    case 1 -> Boolean.compare(bool, other.bool);
                    case 2 -> time.compareTo(other.time);
                    default -> collate(text, other.text);
                };
            }
            return descending ? -result : result;
        }
    }

    /** Locale-independent: case-insensitive first, then case-sensitive so the order is total. */
    static int collate(String a, String b) {
        int insensitive = String.CASE_INSENSITIVE_ORDER.compare(a, b);
        return insensitive != 0 ? insensitive : a.compareTo(b);
    }

    // ------------------------------------------------------------------
    // Temporal values
    // ------------------------------------------------------------------

    /** An ISO date ({@code yyyy-MM-dd}, start of day UTC) or date-time as an instant, else {@code null}. */
    static Instant temporal(String text) {
        if (text == null || text.length() < 10 || !looksLikeDate(text)) {
            return null;
        }
        try {
            if (text.length() == 10) {
                return LocalDate.parse(text).atStartOfDay(ZoneOffset.UTC).toInstant();
            }
            char last = text.charAt(text.length() - 1);
            boolean zoned = last == 'Z' || last == 'z' || text.lastIndexOf('+') > 10 || text.lastIndexOf('-') > 10;
            return zoned
                    ? OffsetDateTime.parse(text.toUpperCase(java.util.Locale.ROOT)).toInstant()
                    : LocalDateTime.parse(text).toInstant(ZoneOffset.UTC);
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    private static boolean looksLikeDate(String text) {
        for (int i = 0; i < 10; i++) {
            char c = text.charAt(i);
            boolean ok = (i == 4 || i == 7) ? c == '-' : Character.isDigit(c);
            if (!ok) {
                return false;
            }
        }
        return text.length() == 10 || text.charAt(10) == 'T' || text.charAt(10) == 't';
    }
}
