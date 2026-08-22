package com.acme.staticforge.template.render;

import com.acme.staticforge.common.Slugifier;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.databind.node.IntNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.TextNode;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The built-in OCTL filter catalogue and escaping helpers (spec §16.3). Filters are pure
 * functions over {@link JsonNode}; a {@code null} input is normalized to {@link NullNode}.
 *
 * <p>The {@code md} (markdown → HTML) and {@code plain} (HTML → text) filters are a minimal
 * hand-written subset — no external markdown library is pulled in. They cover headings,
 * emphasis, links, images, lists, code spans and paragraph breaks on the {@code md} side,
 * and tag removal plus entity decoding plus whitespace collapsing on the {@code plain} side.
 */
public final class Filters {

    private static final ObjectMapper JSON = JsonMapper.builder().build();

    private static final Set<String> ESCAPING_OR_RAW = Set.of("html", "attr", "js", "url", "raw");

    private static final Map<String, Filter> REGISTRY = buildRegistry();

    private Filters() {}

    private static Map<String, Filter> buildRegistry() {
        return Map.ofEntries(
                Map.entry("html", (in, a) -> TextNode.valueOf(escapeHtml(text(in)))),
                Map.entry("attr", (in, a) -> TextNode.valueOf(escapeAttr(text(in)))),
                Map.entry("js", (in, a) -> TextNode.valueOf(escapeJs(text(in)))),
                Map.entry("url", (in, a) -> TextNode.valueOf(encodeUrl(text(in)))),
                Map.entry("raw", (in, a) -> TextNode.valueOf(text(in))),
                Map.entry("upper", (in, a) -> TextNode.valueOf(text(in).toUpperCase(Locale.ROOT))),
                Map.entry("lower", (in, a) -> TextNode.valueOf(text(in).toLowerCase(Locale.ROOT))),
                Map.entry("capitalize", (in, a) -> TextNode.valueOf(capitalize(text(in)))),
                Map.entry("trim", (in, a) -> TextNode.valueOf(text(in).trim())),
                Map.entry("truncate", Filters::truncate),
                Map.entry("default", Filters::defaultValue),
                Map.entry("date", Filters::date),
                Map.entry("number", Filters::number),
                Map.entry("stripTags", (in, a) -> TextNode.valueOf(stripTags(text(in)))),
                Map.entry("nl2br", (in, a) -> TextNode.valueOf(escapeHtml(text(in)).replace("\n", "<br>\n"))),
                Map.entry("md", (in, a) -> TextNode.valueOf(markdown(text(in)))),
                Map.entry("plain", (in, a) -> TextNode.valueOf(plain(text(in)))),
                Map.entry("json", (in, a) -> TextNode.valueOf(toJson(normalize(in)))),
                Map.entry("slug", (in, a) -> TextNode.valueOf(new Slugifier().slug(text(in)))),
                Map.entry("join", Filters::join),
                Map.entry("size", Filters::size));
    }

    /** True when {@code name} is a built-in filter. */
    public static boolean isKnown(String name) {
        return REGISTRY.containsKey(name);
    }

    /** Returns the filter for {@code name}, or {@code null} when unknown. */
    public static Filter lookup(String name) {
        return REGISTRY.get(name);
    }

    /** True for filters that already escape, or {@code raw}, which suppress auto-escaping. */
    public static boolean isEscapingOrRaw(String name) {
        return ESCAPING_OR_RAW.contains(name);
    }

    /** Converts a value to its string form: scalars render as text, containers as JSON. */
    public static String stringify(JsonNode node) {
        return text(node);
    }

    /** Applies the default escaping for a channel mode. */
    public static String escape(String s, Escaping mode) {
        return switch (mode) {
            case HTML -> escapeHtml(s);
            case MARKDOWN, NONE -> s;
        };
    }

    // ------------------------------------------------------------------
    // Escaping
    // ------------------------------------------------------------------

    /** HTML-escapes {@code & < > " '}. */
    public static String escapeHtml(String s) {
        if (s == null || s.isEmpty()) {
            return s == null ? "" : s;
        }
        StringBuilder sb = new StringBuilder(s.length() + 16);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            sb.append(switch (c) {
                case '&' -> "&amp;";
                case '<' -> "&lt;";
                case '>' -> "&gt;";
                case '"' -> "&quot;";
                case '\'' -> "&#39;";
                default -> String.valueOf(c);
            });
        }
        return sb.toString();
    }

    /** Attribute-context escaping: same as {@link #escapeHtml}. */
    public static String escapeAttr(String s) {
        return escapeHtml(s);
    }

    /** JS string-literal escaping for {@code \ " ' < > &} and control characters. */
    public static String escapeJs(String s) {
        if (s == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder(s.length() + 16);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '\\' -> sb.append("\\\\");
                case '"' -> sb.append("\\\"");
                case '\'' -> sb.append("\\'");
                case '<' -> sb.append("\\u003C");
                case '>' -> sb.append("\\u003E");
                case '&' -> sb.append("\\u0026");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> sb.append(c);
            }
        }
        return sb.toString();
    }

    /** Percent-encodes for URL insertion. */
    public static String encodeUrl(String s) {
        if (s == null || s.isEmpty()) {
            return s == null ? "" : s;
        }
        return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20");
    }

    // ------------------------------------------------------------------
    // Filters
    // ------------------------------------------------------------------

    private static JsonNode truncate(JsonNode in, List<String> args) {
        String v = text(in);
        int n = args.isEmpty() ? 0 : parseInt(args.get(0), 0);
        String suffix = args.size() > 1 ? args.get(1) : "";
        if (n < 0 || v.length() <= n) {
            return TextNode.valueOf(v);
        }
        return TextNode.valueOf(v.substring(0, n) + suffix);
    }

    private static JsonNode defaultValue(JsonNode in, List<String> args) {
        JsonNode node = normalize(in);
        if (node.isNull() || node.isMissingNode() || (node.isValueNode() && node.asText().isEmpty())
                || (node.isContainerNode() && node.size() == 0)) {
            return TextNode.valueOf(args.isEmpty() ? "" : args.get(0));
        }
        return node;
    }

    private static JsonNode date(JsonNode in, List<String> args) {
        String v = text(in);
        String pattern = args.isEmpty() ? "yyyy-MM-dd" : args.get(0);
        if (v.isEmpty()) {
            return TextNode.valueOf("");
        }
        try {
            DateTimeFormatter fmt = DateTimeFormatter.ofPattern(pattern).withZone(ZoneOffset.UTC);
            try {
                return TextNode.valueOf(fmt.format(Instant.ofEpochMilli(Long.parseLong(v))));
            } catch (NumberFormatException ignore) {
                // fall through
            }
            return TextNode.valueOf(fmt.format(Instant.parse(v)));
        } catch (DateTimeException | IllegalArgumentException ignore) {
            return in;
        }
    }

    private static JsonNode number(JsonNode in, List<String> args) {
        JsonNode node = normalize(in);
        if (args.isEmpty()) {
            return TextNode.valueOf(node.asText());
        }
        double d;
        try {
            d = node.asDouble();
        } catch (NumberFormatException e) {
            return in;
        }
        try {
            DecimalFormat df = new DecimalFormat(args.get(0), DecimalFormatSymbols.getInstance(Locale.ROOT));
            return TextNode.valueOf(df.format(d));
        } catch (IllegalArgumentException e) {
            return in;
        }
    }

    private static JsonNode join(JsonNode in, List<String> args) {
        String sep = args.isEmpty() ? "," : args.get(0);
        JsonNode node = normalize(in);
        if (!node.isArray()) {
            return node;
        }
        List<String> parts = new ArrayList<>();
        for (JsonNode e : node) {
            parts.add(text(e));
        }
        return TextNode.valueOf(String.join(sep, parts));
    }

    private static JsonNode size(JsonNode in, List<String> args) {
        JsonNode node = normalize(in);
        if (node.isArray() || node.isObject()) {
            return IntNode.valueOf(node.size());
        }
        if (node.isTextual()) {
            return IntNode.valueOf(node.asText().length());
        }
        if (node.isNull() || node.isMissingNode()) {
            return IntNode.valueOf(0);
        }
        return IntNode.valueOf(1);
    }

    private static String capitalize(String s) {
        if (s.isEmpty()) {
            return s;
        }
        return Character.toUpperCase(s.charAt(0)) + s.substring(1).toLowerCase(Locale.ROOT);
    }

    private static final Pattern TAGS = Pattern.compile("<[^>]*>");

    private static String stripTags(String s) {
        return TAGS.matcher(s).replaceAll("");
    }

    // Minimal markdown → HTML (see class javadoc).
    private static String markdown(String s) {
        String[] blocks = s.split("\\n\\s*\\n");
        StringBuilder out = new StringBuilder();
        for (String block : blocks) {
            out.append(renderBlock(block));
        }
        return out.toString();
    }

    private static String renderBlock(String block) {
        String b = block.trim();
        if (b.isEmpty()) {
            return "";
        }
        if (b.startsWith("# ")) {
            return "<h1>" + inline(b.substring(2)) + "</h1>";
        }
        if (b.startsWith("## ")) {
            return "<h2>" + inline(b.substring(3)) + "</h2>";
        }
        if (b.startsWith("### ")) {
            return "<h3>" + inline(b.substring(4)) + "</h3>";
        }
        if (b.startsWith("- ")) {
            String[] items = b.split("\\n- ");
            StringBuilder ul = new StringBuilder("<ul>");
            for (String item : items) {
                String text = item.startsWith("- ") ? item.substring(2) : item;
                ul.append("<li>").append(inline(text)).append("</li>");
            }
            return ul.append("</ul>").toString();
        }
        return "<p>" + inline(b) + "</p>";
    }

    private static String inline(String s) {
        String out = escapeHtml(s);
        out = out.replaceAll("`([^`]+)`", "<code>$1</code>");
        out = out.replaceAll("\\*\\*([^*]+)\\*\\*", "<strong>$1</strong>");
        out = out.replaceAll("\\*([^*]+)\\*", "<em>$1</em>");
        out = out.replaceAll("!\\[([^\\]]*)\\]\\(([^)]+)\\)", "<img alt=\"$1\" src=\"$2\">");
        out = out.replaceAll("\\[([^\\]]*)\\]\\(([^)]+)\\)", "<a href=\"$2\">$1</a>");
        return out;
    }

    private static String plain(String s) {
        String out = TAGS.matcher(s).replaceAll(" ");
        out = out.replace("&nbsp;", " ")
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&#39;", "'");
        return out.replaceAll("\\s+", " ").trim();
    }

    private static String toJson(JsonNode node) {
        try {
            return JSON.writeValueAsString(node);
        } catch (JsonProcessingException e) {
            return node.asText();
        }
    }

    private static JsonNode normalize(JsonNode in) {
        return in == null ? NullNode.getInstance() : in;
    }

    private static String text(JsonNode in) {
        JsonNode node = normalize(in);
        if (node.isNull() || node.isMissingNode()) {
            return "";
        }
        if (node.isTextual() || node.isNumber() || node.isBoolean()) {
            return node.asText();
        }
        return toJson(node);
    }

    private static int parseInt(String s, int def) {
        try {
            return Integer.parseInt(s.trim());
        } catch (NumberFormatException e) {
            return def;
        }
    }
}
