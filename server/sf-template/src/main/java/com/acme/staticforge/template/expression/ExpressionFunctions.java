package com.acme.staticforge.template.expression;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.BooleanNode;
import com.fasterxml.jackson.databind.node.IntNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.TextNode;
import java.math.BigDecimal;
import java.text.Normalizer;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.time.temporal.Temporal;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The function registry of the expression language (M33.1, epic decision 4). Name and arity are checked when an
 * expression compiles; {@code any} and {@code all} are evaluated lazily by the interpreter (their second argument runs
 * once per list element with the element as {@code it}); {@code ref} delegates to the {@link ExpressionHost}.
 * Functions treat null leniently: text functions read null as {@code ""}, list functions as an empty list.
 */
public final class ExpressionFunctions {

    /** A function's arity: {@code max = -1} means any number of arguments from {@code min}. */
    record Definition(String name, int min, int max, boolean lazy, Impl impl) {}

    @FunctionalInterface
    interface Impl {
        JsonNode apply(List<JsonNode> args, Call call);
    }

    /** What a function sees of its call: the host (clock, {@code ref}) and the source position for errors. */
    record Call(ExpressionHost host, int pos) {}

    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;
    private static final Map<String, Definition> REGISTRY = new LinkedHashMap<>();

    static {
        register("length", 1, 1, (a, c) -> IntNode.valueOf(length(a.get(0), c.pos())));
        register("isEmpty", 1, 1, (a, c) -> BooleanNode.valueOf(ExpressionValues.isEmpty(a.get(0))));
        register("count", 1, 1, (a, c) -> IntNode.valueOf(list(a.get(0), "count", c.pos()).size()));
        register("matches", 2, 2, (a, c) -> BooleanNode.valueOf(
                SafeRegex.matches(ExpressionValues.text(a.get(0)), ExpressionValues.text(a.get(1)), c.pos())));
        register("lower", 1, 1, (a, c) -> TextNode.valueOf(ExpressionValues.text(a.get(0)).toLowerCase(Locale.ROOT)));
        register("upper", 1, 1, (a, c) -> TextNode.valueOf(ExpressionValues.text(a.get(0)).toUpperCase(Locale.ROOT)));
        register("trim", 1, 1, (a, c) -> TextNode.valueOf(ExpressionValues.text(a.get(0)).strip()));
        register("substring", 2, 3, ExpressionFunctions::substring);
        register("concat", 0, -1, (a, c) -> {
            StringBuilder out = new StringBuilder();
            a.forEach(v -> out.append(ExpressionValues.text(v)));
            return TextNode.valueOf(out.toString());
        });
        register("slugify", 1, 1, (a, c) -> TextNode.valueOf(slugify(ExpressionValues.text(a.get(0)))));
        register("stripTags", 1, 1, (a, c) -> TextNode.valueOf(stripTags(ExpressionValues.text(a.get(0)))));
        register("wordCount", 1, 1, (a, c) -> {
            String text = stripTags(ExpressionValues.text(a.get(0))).strip();
            return IntNode.valueOf(text.isEmpty() ? 0 : text.split("\\s+").length);
        });
        register("now", 0, 0, (a, c) -> ExpressionValues.dateTime(OffsetDateTime.now(c.host().clock())));
        register("today", 0, 0, (a, c) -> ExpressionValues.date(LocalDate.now(c.host().clock())));
        register("date", 1, 1, (a, c) -> {
            Temporal t = ExpressionValues.toTemporal(a.get(0), c.pos());
            if (t == null) {
                return ExpressionValues.nullNode();
            }
            return t instanceof LocalDate d ? ExpressionValues.date(d) : ExpressionValues.dateTime((OffsetDateTime) t);
        });
        register("daysBetween", 2, 2, (a, c) -> {
            Temporal from = ExpressionValues.toTemporal(a.get(0), c.pos());
            Temporal to = ExpressionValues.toTemporal(a.get(1), c.pos());
            if (from == null || to == null) {
                return ExpressionValues.nullNode();
            }
            return ExpressionValues.number(BigDecimal.valueOf(ChronoUnit.DAYS.between(
                    ExpressionValues.toLocalDate(from, c.host().clock()), ExpressionValues.toLocalDate(to, c.host().clock()))));
        });
        register("min", 1, -1, (a, c) -> extreme(a, c, true));
        register("max", 1, -1, (a, c) -> extreme(a, c, false));
        register("sum", 1, -1, (a, c) -> {
            BigDecimal sum = BigDecimal.ZERO;
            for (JsonNode n : numbers(a)) {
                sum = sum.add(ExpressionValues.decimal(n, "sum", c.pos()));
            }
            return ExpressionValues.number(sum);
        });
        registerLazy("any", 2, 2);
        registerLazy("all", 2, 2);
        register("sections", 1, 2, ExpressionFunctions::sections);
        register("ref", 1, 1, (a, c) -> {
            JsonNode resolved = ExpressionValues.isNull(a.get(0)) ? null : c.host().ref(a.get(0));
            return resolved == null ? ExpressionValues.nullNode() : resolved;
        });
    }

    private ExpressionFunctions() {}

    private static void register(String name, int min, int max, Impl impl) {
        REGISTRY.put(name, new Definition(name, min, max, false, impl));
    }

    private static void registerLazy(String name, int min, int max) {
        REGISTRY.put(name, new Definition(name, min, max, true, null));
    }

    static Definition lookup(String name) {
        return REGISTRY.get(name);
    }

    /** The function names, for completion and documentation. */
    public static Set<String> names() {
        return Collections.unmodifiableSet(REGISTRY.keySet());
    }

    // ------------------------------------------------------------------

    private static int length(JsonNode value, int pos) {
        if (ExpressionValues.isNull(value)) {
            return 0;
        }
        if (value.isArray() || (value.isObject() && !value.path("value").isTextual())) {
            return value.size();
        }
        if (value.isNumber() || value.isBoolean()) {
            throw new ExpressionError("length needs text or a list, got " + ExpressionValues.describe(value), pos);
        }
        String text = ExpressionValues.text(value);
        return text.codePointCount(0, text.length());
    }

    static List<JsonNode> list(JsonNode value, String function, int pos) {
        if (ExpressionValues.isNull(value)) {
            return List.of();
        }
        if (!value.isArray()) {
            throw new ExpressionError(function + " needs a list, got " + ExpressionValues.describe(value), pos);
        }
        List<JsonNode> out = new ArrayList<>(value.size());
        value.forEach(out::add);
        return out;
    }

    private static JsonNode substring(List<JsonNode> args, Call call) {
        String text = ExpressionValues.text(args.get(0));
        int[] codePoints = text.codePoints().toArray();
        int start = clamp(ExpressionValues.decimal(args.get(1), "substring", call.pos()).intValue(), codePoints.length);
        int end = args.size() > 2 && !ExpressionValues.isNull(args.get(2))
                ? clamp(ExpressionValues.decimal(args.get(2), "substring", call.pos()).intValue(), codePoints.length)
                : codePoints.length;
        return TextNode.valueOf(end <= start ? "" : new String(codePoints, start, end - start));
    }

    private static int clamp(int index, int length) {
        return Math.max(0, Math.min(index, length));
    }

    /**
     * A URL slug: NFKD, the ligatures NFKD keeps transliterated ({@code ß → ss}, {@code æ → ae}, …), combining marks
     * dropped, lower case, every run of other characters one hyphen, no leading or trailing hyphen.
     */
    static String slugify(String input) {
        String s = Normalizer.normalize(input, Normalizer.Form.NFKD)
                .replace("ß", "ss")
                .replace("æ", "ae")
                .replace("Æ", "AE")
                .replace("œ", "oe")
                .replace("Œ", "OE")
                .replace("ø", "o")
                .replace("Ø", "O")
                .replace("ł", "l")
                .replace("Ł", "L")
                .replace("đ", "d")
                .replace("ð", "d")
                .replace("þ", "th");
        s = s.replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT);
        s = s.replaceAll("[^a-z0-9]+", "-");
        return s.replaceAll("^-+|-+$", "");
    }

    /** Markup removed (tags, comments), the common entities decoded, whitespace runs collapsed. */
    static String stripTags(String html) {
        String s = html.replaceAll("(?s)<!--.*?-->", " ").replaceAll("<[^>]*>", " ");
        s = s.replace("&nbsp;", " ")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replace("&amp;", "&");
        return s.replaceAll("\\s+", " ").strip();
    }

    private static List<JsonNode> numbers(List<JsonNode> args) {
        List<JsonNode> values = args.size() == 1 && args.get(0) != null && args.get(0).isArray()
                ? list(args.get(0), "sum", -1)
                : args;
        List<JsonNode> out = new ArrayList<>();
        for (JsonNode v : values) {
            if (!ExpressionValues.isNull(v)) {
                out.add(v);
            }
        }
        return out;
    }

    private static JsonNode extreme(List<JsonNode> args, Call call, boolean min) {
        JsonNode best = null;
        for (JsonNode v : numbers(args)) {
            if (best == null) {
                best = v;
                continue;
            }
            int cmp = ExpressionValues.compare(v, best, call.pos());
            if (min ? cmp < 0 : cmp > 0) {
                best = v;
            }
        }
        return best == null ? ExpressionValues.nullNode() : best;
    }

    /**
     * {@code sections(body, templateUid?)}: the section instances of a body (a list of {@code {template, content}}),
     * optionally only those of one section template.
     */
    private static JsonNode sections(List<JsonNode> args, Call call) {
        List<JsonNode> instances = list(args.get(0), "sections", call.pos());
        String template = args.size() > 1 && !ExpressionValues.isNull(args.get(1)) ? ExpressionValues.text(args.get(1)) : null;
        ArrayNode out = JSON.arrayNode();
        for (JsonNode instance : instances) {
            if (template == null || template.equals(instance.path("template").asText(null))) {
                out.add(instance);
            }
        }
        return out;
    }
}
