package com.acme.staticforge.template.expression;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.DecimalNode;
import com.fasterxml.jackson.databind.node.IntNode;
import com.fasterxml.jackson.databind.node.LongNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.POJONode;
import com.fasterxml.jackson.databind.node.TextNode;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.time.temporal.Temporal;
import java.util.Iterator;
import java.util.Map;

/**
 * The value model of the expression language (M33.1): JSON values plus dates. Numbers are exact ({@link BigDecimal});
 * a date is a {@link LocalDate}, a date-time an {@link OffsetDateTime}, both carried in a {@link POJONode} and written as
 * ISO text when a value leaves the language (a fill result, a message placeholder).
 */
public final class ExpressionValues {

    private ExpressionValues() {}

    // ------------------------------------------------------------------
    // Construction
    // ------------------------------------------------------------------

    /** A number node: integral values as {@code int}/{@code long}, others as decimals without trailing zeros. */
    public static JsonNode number(BigDecimal value) {
        BigDecimal v = value.stripTrailingZeros();
        if (v.scale() < 0) {
            v = v.setScale(0);
        }
        if (v.scale() == 0) {
            try {
                long l = v.longValueExact();
                return l >= Integer.MIN_VALUE && l <= Integer.MAX_VALUE ? IntNode.valueOf((int) l) : LongNode.valueOf(l);
            } catch (ArithmeticException e) {
                return DecimalNode.valueOf(v);
            }
        }
        return DecimalNode.valueOf(v);
    }

    static JsonNode date(LocalDate date) {
        return new POJONode(date);
    }

    static JsonNode dateTime(OffsetDateTime dateTime) {
        return new POJONode(dateTime);
    }

    static JsonNode nullNode() {
        return NullNode.getInstance();
    }

    // ------------------------------------------------------------------
    // Classification
    // ------------------------------------------------------------------

    public static boolean isNull(JsonNode node) {
        return node == null || node.isNull() || node.isMissingNode();
    }

    static boolean isTemporal(JsonNode node) {
        return node instanceof POJONode pojo && pojo.getPojo() instanceof Temporal;
    }

    static Temporal temporal(JsonNode node) {
        return (Temporal) ((POJONode) node).getPojo();
    }

    /** Truthiness: null, {@code false}, {@code 0}, {@code ""} and empty lists/objects are false. */
    public static boolean truthy(JsonNode node) {
        if (isNull(node)) {
            return false;
        }
        if (node.isBoolean()) {
            return node.asBoolean();
        }
        if (node.isNumber()) {
            return node.decimalValue().signum() != 0;
        }
        if (node.isTextual()) {
            return !node.asText().isEmpty();
        }
        if (node.isContainerNode()) {
            return node.size() > 0;
        }
        return true;
    }

    /**
     * Whether a value counts as empty: null, blank text, an empty list or object, or the placeholder an untouched
     * object editor stores (a {@code *_REF} without {@code uuid}, a link without target, a richtext with a blank
     * {@code value}, a catalog without cards) — the same notion as the built-in {@code required}.
     */
    public static boolean isEmpty(JsonNode node) {
        if (isNull(node)) {
            return true;
        }
        if (node.isTextual()) {
            return node.asText().isBlank();
        }
        if (node.isArray()) {
            return node.isEmpty();
        }
        if (!node.isObject()) {
            return false;
        }
        if (node.isEmpty()) {
            return true;
        }
        String type = node.path("type").asText("");
        if (type.endsWith("_REF")) {
            return blank(node.get("uuid"));
        }
        if ("CATALOG".equals(type)) {
            return node.path("cards").isArray() && node.path("cards").isEmpty();
        }
        if (node.has("kind") || node.has("url") || node.has("anchor")) {
            return blank(node.get("uuid")) && blank(node.get("url")) && blank(node.get("anchor"));
        }
        if (node.has("value") && node.size() <= 2) {
            return blank(node.get("value"));
        }
        return false;
    }

    private static boolean blank(JsonNode node) {
        return isNull(node) || (node.isTextual() && node.asText().isBlank());
    }

    // ------------------------------------------------------------------
    // Conversion
    // ------------------------------------------------------------------

    /**
     * The text of a value: text as is, numbers in plain notation, booleans, ISO dates; a richtext object its
     * {@code value}; null as {@code ""}; other structures as JSON.
     */
    public static String text(JsonNode node) {
        if (isNull(node)) {
            return "";
        }
        if (node.isTextual()) {
            return node.asText();
        }
        if (node.isNumber()) {
            BigDecimal d = node.decimalValue().stripTrailingZeros();
            return (d.scale() < 0 ? d.setScale(0) : d).toPlainString();
        }
        if (isTemporal(node)) {
            return temporal(node).toString();
        }
        if (node.isObject() && node.path("value").isTextual()) {
            return node.get("value").asText();
        }
        if (node.isValueNode()) {
            return node.asText();
        }
        return node.toString();
    }

    /** A value as it is stored when it leaves the language: dates become ISO text, everything else is kept. */
    public static JsonNode toJson(JsonNode node) {
        if (node == null) {
            return NullNode.getInstance();
        }
        return isTemporal(node) ? TextNode.valueOf(temporal(node).toString()) : node;
    }

    static BigDecimal decimal(JsonNode node, String what, int pos) {
        if (node.isNumber()) {
            return node.decimalValue();
        }
        throw new ExpressionError(what + " needs a number, got " + describe(node), pos);
    }

    static String describe(JsonNode node) {
        if (isNull(node)) {
            return "null";
        }
        if (isTemporal(node)) {
            return temporal(node) instanceof LocalDate ? "a date" : "a date-time";
        }
        return switch (node.getNodeType()) {
            case STRING -> "text";
            case NUMBER -> "a number";
            case BOOLEAN -> "a boolean";
            case ARRAY -> "a list";
            case OBJECT -> "an object";
            default -> "a value";
        };
    }

    /**
     * A date or date-time from a value: a date value as is, ISO text {@code 2026-09-29} as a date,
     * {@code 2026-09-29T10:00:00+02:00} (or without offset: UTC) as a date-time; {@code null} for null.
     */
    static Temporal toTemporal(JsonNode node, int pos) {
        if (isNull(node)) {
            return null;
        }
        if (isTemporal(node)) {
            return temporal(node);
        }
        if (node.isTextual()) {
            String s = node.asText().trim();
            try {
                if (s.indexOf('T') < 0 && s.indexOf(' ') < 0) {
                    return LocalDate.parse(s);
                }
                String iso = s.replace(' ', 'T');
                try {
                    return OffsetDateTime.parse(iso);
                } catch (DateTimeParseException e) {
                    return LocalDateTime.parse(iso).atOffset(ZoneOffset.UTC);
                }
            } catch (DateTimeParseException e) {
                throw new ExpressionError("Not a date: '" + s + "'", pos);
            }
        }
        throw new ExpressionError("Expected a date, got " + describe(node), pos);
    }

    /** The calendar date of a date or date-time, a date-time taken in the clock's zone. */
    static LocalDate toLocalDate(Temporal t, Clock clock) {
        if (t instanceof LocalDate d) {
            return d;
        }
        return ((OffsetDateTime) t).atZoneSameInstant(clock.getZone()).toLocalDate();
    }

    // ------------------------------------------------------------------
    // Equality and ordering
    // ------------------------------------------------------------------

    /** Deep equality: numbers numerically, dates by value (a date equals its ISO text), everything else structurally. */
    public static boolean equal(JsonNode a, JsonNode b) {
        if (isNull(a) || isNull(b)) {
            return isNull(a) && isNull(b);
        }
        if (a.isNumber() && b.isNumber()) {
            return a.decimalValue().compareTo(b.decimalValue()) == 0;
        }
        if (isTemporal(a) || isTemporal(b)) {
            try {
                return compareTemporal(toTemporal(a, -1), toTemporal(b, -1)) == 0;
            } catch (ExpressionError e) {
                return false;
            }
        }
        if (a.isArray() && b.isArray()) {
            if (a.size() != b.size()) {
                return false;
            }
            for (int i = 0; i < a.size(); i++) {
                if (!equal(a.get(i), b.get(i))) {
                    return false;
                }
            }
            return true;
        }
        if (a.isObject() && b.isObject()) {
            if (a.size() != b.size()) {
                return false;
            }
            Iterator<Map.Entry<String, JsonNode>> fields = a.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> e = fields.next();
                if (!b.has(e.getKey()) || !equal(e.getValue(), b.get(e.getKey()))) {
                    return false;
                }
            }
            return true;
        }
        return a.equals(b);
    }

    /**
     * Orders two values of the same kind: numbers, text, booleans, dates (a date against ISO text too). Anything else is
     * a type error.
     */
    static int compare(JsonNode a, JsonNode b, int pos) {
        if (a.isNumber() && b.isNumber()) {
            return a.decimalValue().compareTo(b.decimalValue());
        }
        if (isTemporal(a) || isTemporal(b)) {
            return compareTemporal(toTemporal(a, pos), toTemporal(b, pos));
        }
        if (a.isTextual() && b.isTextual()) {
            return a.asText().compareTo(b.asText());
        }
        if (a.isBoolean() && b.isBoolean()) {
            return Boolean.compare(a.asBoolean(), b.asBoolean());
        }
        throw new ExpressionError("Can't compare " + describe(a) + " with " + describe(b), pos);
    }

    private static int compareTemporal(Temporal a, Temporal b) {
        if (a instanceof LocalDate da && b instanceof LocalDate db) {
            return da.compareTo(db);
        }
        if (a instanceof OffsetDateTime ta && b instanceof OffsetDateTime tb) {
            return ta.toInstant().compareTo(tb.toInstant());
        }
        // A date against a date-time: compare the date with the date-time's UTC date.
        LocalDate da = a instanceof LocalDate d ? d : ((OffsetDateTime) a).withOffsetSameInstant(ZoneOffset.UTC).toLocalDate();
        LocalDate db = b instanceof LocalDate d ? d : ((OffsetDateTime) b).withOffsetSameInstant(ZoneOffset.UTC).toLocalDate();
        return da.compareTo(db);
    }
}
