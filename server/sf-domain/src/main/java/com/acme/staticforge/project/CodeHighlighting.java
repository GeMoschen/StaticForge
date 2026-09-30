package com.acme.staticforge.project;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * A project's code highlighting overrides (M33 follow-up): the format the code editors highlight a file as, by file
 * extension ({@code tpl → HTML}) or MIME type ({@code text/x-template → HTML}). Read for processed text media and for
 * the templates of channels whose own "Highlight as" is {@code AUTO}, before the built-in detection; an extension
 * entry wins over a MIME entry. Stored as {@code {"extensions": {…}, "mimeTypes": {…}}}; empty maps are "no overrides".
 */
public record CodeHighlighting(Map<String, String> extensions, Map<String, String> mimeTypes) {

    /** The formats the code editors can highlight as. */
    public static final Set<String> FORMATS = Set.of("HTML", "MARKDOWN", "JSON", "XML", "CSS", "JAVASCRIPT", "YAML", "PLAIN");

    /** A channel's "Highlight as" value that means: detect (project overrides, then MIME type, then extension). */
    public static final String AUTO = "AUTO";

    public static final CodeHighlighting EMPTY = new CodeHighlighting(Map.of(), Map.of());

    private static final Pattern EXTENSION = Pattern.compile("[a-z0-9]{1,10}");
    private static final Pattern MIME_TYPE = Pattern.compile("[a-z0-9][a-z0-9!#$&^_.+-]{0,63}/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}");

    /** Normalizes: extensions lower case without a leading dot, MIME types lower case, formats upper case. */
    public CodeHighlighting {
        extensions = normalize(extensions, true);
        mimeTypes = normalize(mimeTypes, false);
    }

    private static Map<String, String> normalize(Map<String, String> entries, boolean extension) {
        Map<String, String> out = new LinkedHashMap<>();
        if (entries != null) {
            entries.forEach((key, format) -> {
                if (key == null) {
                    return;
                }
                String k = key.trim().toLowerCase(Locale.ROOT);
                if (extension && k.startsWith(".")) {
                    k = k.substring(1);
                }
                out.put(k, format == null ? null : format.trim().toUpperCase(Locale.ROOT));
            });
        }
        return java.util.Collections.unmodifiableMap(out);
    }

    /** What's wrong with the entries, one message each; empty when valid. */
    public List<String> validate() {
        List<String> errors = new ArrayList<>();
        extensions.forEach((extension, format) -> {
            if (!EXTENSION.matcher(extension).matches()) {
                errors.add("extension '" + extension + "' must be 1–10 lower-case letters or digits");
            }
            if (format == null || !FORMATS.contains(format)) {
                errors.add("extension '" + extension + "': unknown format '" + format + "'");
            }
        });
        mimeTypes.forEach((mimeType, format) -> {
            if (!MIME_TYPE.matcher(mimeType).matches()) {
                errors.add("MIME type '" + mimeType + "' is not a type/subtype");
            }
            if (format == null || !FORMATS.contains(format)) {
                errors.add("MIME type '" + mimeType + "': unknown format '" + format + "'");
            }
        });
        return errors;
    }

    @JsonIgnore
    public boolean isEmpty() {
        return extensions.isEmpty() && mimeTypes.isEmpty();
    }

    /** The stored form; {@code null} when empty (the column stays NULL). */
    public JsonNode toJson() {
        if (isEmpty()) {
            return null;
        }
        ObjectNode out = JsonNodeFactory.instance.objectNode();
        ObjectNode ext = out.putObject("extensions");
        extensions.forEach(ext::put);
        ObjectNode mime = out.putObject("mimeTypes");
        mimeTypes.forEach(mime::put);
        return out;
    }

    /** Reads the stored form; {@code null} or anything unreadable is {@link #EMPTY}. Unknown formats are dropped. */
    public static CodeHighlighting fromJson(JsonNode node) {
        if (node == null || !node.isObject()) {
            return EMPTY;
        }
        return new CodeHighlighting(read(node.get("extensions")), read(node.get("mimeTypes")));
    }

    private static Map<String, String> read(JsonNode node) {
        Map<String, String> out = new LinkedHashMap<>();
        if (node != null && node.isObject()) {
            node.fields().forEachRemaining(field -> {
                String format = field.getValue().asText("").toUpperCase(Locale.ROOT);
                if (FORMATS.contains(format)) {
                    out.put(field.getKey(), format);
                }
            });
        }
        return out;
    }
}
