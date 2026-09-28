package com.acme.staticforge.generate.quality;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The {@code quality.json} codec of {@link QualitySidecar} (M30.1.3 performance): the sidecar holds every checked output
 * of a build, so it is written and read with the streaming API instead of data binding, which spends far longer
 * introspecting the records than it takes to copy the few fields. The format is exactly what data binding wrote — the
 * fields in record order, {@code null}s left out, and an entry's empty {@code findings}/{@code references} too — and
 * reading ignores fields it doesn't know.
 */
final class QualitySidecarJson {

    private static final JsonFactory FACTORY = new JsonFactory();

    private QualitySidecarJson() {}

    // ------------------------------------------------------------------
    // Write
    // ------------------------------------------------------------------

    static byte[] write(QualitySidecar sidecar) {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(Math.max(256, sidecar.outputs().size() * 512));
        try (JsonGenerator json = FACTORY.createGenerator(bytes)) {
            json.writeStartObject();
            json.writeNumberField("version", sidecar.version());
            string(json, "configFingerprint", sidecar.configFingerprint());
            json.writeObjectFieldStart("outputs");
            for (Map.Entry<String, QualitySidecar.Entry> output : sidecar.outputs().entrySet()) {
                json.writeFieldName(output.getKey());
                entry(json, output.getValue());
            }
            json.writeEndObject();
            json.writeEndObject();
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to serialize the quality sidecar", e);
        }
        return bytes.toByteArray();
    }

    private static void entry(JsonGenerator json, QualitySidecar.Entry entry) throws IOException {
        json.writeStartObject();
        if (entry.facts() != null) {
            json.writeFieldName("facts");
            facts(json, entry.facts());
        }
        if (!entry.findings().isEmpty()) {
            json.writeArrayFieldStart("findings");
            for (QualitySidecar.PageFinding finding : entry.findings()) {
                json.writeStartObject();
                string(json, "code", finding.code());
                string(json, "category", finding.category() == null ? null : finding.category().name());
                string(json, "severity", finding.severity() == null ? null : finding.severity().name());
                string(json, "message", finding.message());
                string(json, "selector", finding.selector());
                string(json, "sectionInstanceId", finding.sectionInstanceId());
                json.writeEndObject();
            }
            json.writeEndArray();
        }
        if (!entry.references().isEmpty()) {
            json.writeArrayFieldStart("references");
            for (ReferenceEvent event : entry.references()) {
                json.writeStartObject();
                string(json, "kind", event.kind().name());
                string(json, "targetKind", event.targetKind());
                string(json, "target", event.target() == null ? null : event.target().toString());
                string(json, "targetUid", event.targetUid());
                string(json, "locale", event.locale());
                string(json, "editorPath", event.editorPath());
                json.writeEndObject();
            }
            json.writeEndArray();
        }
        json.writeEndObject();
    }

    private static void facts(JsonGenerator json, HtmlFacts facts) throws IOException {
        json.writeStartObject();
        string(json, "title", facts.title());
        string(json, "metaDescription", facts.metaDescription());
        json.writeNumberField("h1Count", facts.h1Count());
        string(json, "lang", facts.lang());
        if (facts.canonical() != null) {
            json.writeFieldName("canonical");
            link(json, facts.canonical());
        }
        json.writeArrayFieldStart("alternates");
        for (HtmlFacts.Alternate alternate : facts.alternates()) {
            json.writeStartObject();
            string(json, "hreflang", alternate.hreflang());
            if (alternate.link() != null) {
                json.writeFieldName("link");
                link(json, alternate.link());
            }
            json.writeEndObject();
        }
        json.writeEndArray();
        string(json, "robotsMeta", facts.robotsMeta());
        strings(json, "ids", facts.ids());
        strings(json, "anchors", facts.anchors());
        json.writeArrayFieldStart("links");
        for (LinkRef link : facts.links()) {
            link(json, link);
        }
        json.writeEndArray();
        json.writeBooleanField("idsTruncated", facts.idsTruncated());
        json.writeBooleanField("linksTruncated", facts.linksTruncated());
        json.writeEndObject();
    }

    private static void link(JsonGenerator json, LinkRef link) throws IOException {
        json.writeStartObject();
        string(json, "element", link.element());
        string(json, "attribute", link.attribute());
        string(json, "raw", link.raw());
        string(json, "resolvedPath", link.resolvedPath());
        string(json, "fragment", link.fragment());
        string(json, "selector", link.selector());
        json.writeEndObject();
    }

    private static void strings(JsonGenerator json, String name, List<String> values) throws IOException {
        json.writeArrayFieldStart(name);
        for (String value : values) {
            json.writeString(value);
        }
        json.writeEndArray();
    }

    /** Writes a string field; a {@code null} value is left out. */
    private static void string(JsonGenerator json, String name, String value) throws IOException {
        if (value != null) {
            json.writeStringField(name, value);
        }
    }

    // ------------------------------------------------------------------
    // Read
    // ------------------------------------------------------------------

    /**
     * The sidecar in {@code bytes}.
     *
     * @throws IOException when it isn't JSON of the sidecar's shape
     * @throws RuntimeException when a value doesn't fit its field (an unknown enum constant, a missing required field)
     */
    static QualitySidecar read(byte[] bytes) throws IOException {
        try (JsonParser json = FACTORY.createParser(bytes)) {
            expect(json.nextToken(), JsonToken.START_OBJECT);
            int version = 0;
            String fingerprint = null;
            Map<String, QualitySidecar.Entry> outputs = null;
            while (json.nextToken() == JsonToken.FIELD_NAME) {
                String field = json.currentName();
                JsonToken value = json.nextToken();
                switch (field) {
                    case "version" -> version = value == JsonToken.VALUE_NULL ? 0 : json.getIntValue();
                    case "configFingerprint" -> fingerprint = text(json, value);
                    case "outputs" -> outputs = outputs(json, value);
                    default -> json.skipChildren();
                }
            }
            expect(json.currentToken(), JsonToken.END_OBJECT);
            return new QualitySidecar(version, fingerprint, outputs);
        }
    }

    private static Map<String, QualitySidecar.Entry> outputs(JsonParser json, JsonToken token) throws IOException {
        if (token == JsonToken.VALUE_NULL) {
            return null;
        }
        expect(token, JsonToken.START_OBJECT);
        Map<String, QualitySidecar.Entry> outputs = new LinkedHashMap<>();
        while (json.nextToken() == JsonToken.FIELD_NAME) {
            String path = json.currentName();
            outputs.put(path, entry(json, json.nextToken()));
        }
        expect(json.currentToken(), JsonToken.END_OBJECT);
        return outputs;
    }

    private static QualitySidecar.Entry entry(JsonParser json, JsonToken token) throws IOException {
        if (token == JsonToken.VALUE_NULL) {
            return null;
        }
        expect(token, JsonToken.START_OBJECT);
        HtmlFacts facts = null;
        List<QualitySidecar.PageFinding> findings = null;
        List<ReferenceEvent> references = null;
        while (json.nextToken() == JsonToken.FIELD_NAME) {
            String field = json.currentName();
            JsonToken value = json.nextToken();
            switch (field) {
                case "facts" -> facts = facts(json, value);
                case "findings" -> findings = list(json, value, QualitySidecarJson::finding);
                case "references" -> references = list(json, value, QualitySidecarJson::reference);
                default -> json.skipChildren();
            }
        }
        expect(json.currentToken(), JsonToken.END_OBJECT);
        return new QualitySidecar.Entry(facts, findings, references);
    }

    private static HtmlFacts facts(JsonParser json, JsonToken token) throws IOException {
        if (token == JsonToken.VALUE_NULL) {
            return null;
        }
        expect(token, JsonToken.START_OBJECT);
        String title = null;
        String metaDescription = null;
        int h1Count = 0;
        String lang = null;
        LinkRef canonical = null;
        List<HtmlFacts.Alternate> alternates = null;
        String robotsMeta = null;
        List<String> ids = null;
        List<String> anchors = null;
        List<LinkRef> links = null;
        boolean idsTruncated = false;
        boolean linksTruncated = false;
        while (json.nextToken() == JsonToken.FIELD_NAME) {
            String field = json.currentName();
            JsonToken value = json.nextToken();
            switch (field) {
                case "title" -> title = text(json, value);
                case "metaDescription" -> metaDescription = text(json, value);
                case "h1Count" -> h1Count = value == JsonToken.VALUE_NULL ? 0 : json.getIntValue();
                case "lang" -> lang = text(json, value);
                case "canonical" -> canonical = link(json, value);
                case "alternates" -> alternates = list(json, value, QualitySidecarJson::alternate);
                case "robotsMeta" -> robotsMeta = text(json, value);
                case "ids" -> ids = list(json, value, QualitySidecarJson::text);
                case "anchors" -> anchors = list(json, value, QualitySidecarJson::text);
                case "links" -> links = list(json, value, QualitySidecarJson::link);
                case "idsTruncated" -> idsTruncated = value == JsonToken.VALUE_TRUE;
                case "linksTruncated" -> linksTruncated = value == JsonToken.VALUE_TRUE;
                default -> json.skipChildren();
            }
        }
        expect(json.currentToken(), JsonToken.END_OBJECT);
        return new HtmlFacts(title, metaDescription, h1Count, lang, canonical, alternates, robotsMeta, ids, anchors, links,
                idsTruncated, linksTruncated);
    }

    private static HtmlFacts.Alternate alternate(JsonParser json, JsonToken token) throws IOException {
        if (token == JsonToken.VALUE_NULL) {
            return null;
        }
        expect(token, JsonToken.START_OBJECT);
        String hreflang = null;
        LinkRef link = null;
        while (json.nextToken() == JsonToken.FIELD_NAME) {
            String field = json.currentName();
            JsonToken value = json.nextToken();
            switch (field) {
                case "hreflang" -> hreflang = text(json, value);
                case "link" -> link = link(json, value);
                default -> json.skipChildren();
            }
        }
        expect(json.currentToken(), JsonToken.END_OBJECT);
        return new HtmlFacts.Alternate(hreflang, link);
    }

    private static LinkRef link(JsonParser json, JsonToken token) throws IOException {
        if (token == JsonToken.VALUE_NULL) {
            return null;
        }
        expect(token, JsonToken.START_OBJECT);
        String element = null;
        String attribute = null;
        String raw = null;
        String resolvedPath = null;
        String fragment = null;
        String selector = null;
        while (json.nextToken() == JsonToken.FIELD_NAME) {
            String field = json.currentName();
            JsonToken value = json.nextToken();
            switch (field) {
                case "element" -> element = text(json, value);
                case "attribute" -> attribute = text(json, value);
                case "raw" -> raw = text(json, value);
                case "resolvedPath" -> resolvedPath = text(json, value);
                case "fragment" -> fragment = text(json, value);
                case "selector" -> selector = text(json, value);
                default -> json.skipChildren();
            }
        }
        expect(json.currentToken(), JsonToken.END_OBJECT);
        return new LinkRef(element, attribute, raw, resolvedPath, fragment, selector);
    }

    private static QualitySidecar.PageFinding finding(JsonParser json, JsonToken token) throws IOException {
        if (token == JsonToken.VALUE_NULL) {
            return null;
        }
        expect(token, JsonToken.START_OBJECT);
        String code = null;
        QualityCategory category = null;
        QualitySeverity severity = null;
        String message = null;
        String selector = null;
        String section = null;
        while (json.nextToken() == JsonToken.FIELD_NAME) {
            String field = json.currentName();
            JsonToken value = json.nextToken();
            switch (field) {
                case "code" -> code = text(json, value);
                case "category" -> category = constant(QualityCategory.class, text(json, value));
                case "severity" -> severity = constant(QualitySeverity.class, text(json, value));
                case "message" -> message = text(json, value);
                case "selector" -> selector = text(json, value);
                case "sectionInstanceId" -> section = text(json, value);
                default -> json.skipChildren();
            }
        }
        expect(json.currentToken(), JsonToken.END_OBJECT);
        return new QualitySidecar.PageFinding(code, category, severity, message, selector, section);
    }

    private static ReferenceEvent reference(JsonParser json, JsonToken token) throws IOException {
        if (token == JsonToken.VALUE_NULL) {
            return null;
        }
        expect(token, JsonToken.START_OBJECT);
        ReferenceEvent.Kind kind = null;
        String targetKind = null;
        UUID target = null;
        String targetUid = null;
        String locale = null;
        String editorPath = null;
        while (json.nextToken() == JsonToken.FIELD_NAME) {
            String field = json.currentName();
            JsonToken value = json.nextToken();
            switch (field) {
                case "kind" -> kind = constant(ReferenceEvent.Kind.class, text(json, value));
                case "targetKind" -> targetKind = text(json, value);
                case "target" -> {
                    String uuid = text(json, value);
                    target = uuid == null ? null : UUID.fromString(uuid);
                }
                case "targetUid" -> targetUid = text(json, value);
                case "locale" -> locale = text(json, value);
                case "editorPath" -> editorPath = text(json, value);
                default -> json.skipChildren();
            }
        }
        expect(json.currentToken(), JsonToken.END_OBJECT);
        return new ReferenceEvent(kind, targetKind, target, targetUid, locale, editorPath);
    }

    /** Reads one value at the parser's current token. */
    @FunctionalInterface
    private interface ValueReader<T> {

        T read(JsonParser json, JsonToken token) throws IOException;
    }

    /** An array of values; {@code null} for a JSON {@code null}. */
    private static <T> List<T> list(JsonParser json, JsonToken token, ValueReader<T> reader) throws IOException {
        if (token == JsonToken.VALUE_NULL) {
            return null;
        }
        expect(token, JsonToken.START_ARRAY);
        List<T> values = new ArrayList<>();
        for (JsonToken item = json.nextToken(); item != JsonToken.END_ARRAY; item = json.nextToken()) {
            if (item == null) {
                throw new IOException("Unexpected end of the quality sidecar");
            }
            values.add(reader.read(json, item));
        }
        return values;
    }

    /** A string value; {@code null} for a JSON {@code null}. */
    private static String text(JsonParser json, JsonToken token) throws IOException {
        if (token == JsonToken.VALUE_NULL) {
            return null;
        }
        if (token != JsonToken.VALUE_STRING) {
            throw new IOException("Expected a string in the quality sidecar, found " + token);
        }
        return json.getText();
    }

    private static <E extends Enum<E>> E constant(Class<E> type, String name) {
        return name == null ? null : Enum.valueOf(type, name);
    }

    private static void expect(JsonToken actual, JsonToken expected) throws IOException {
        if (actual != expected) {
            throw new IOException("Expected " + expected + " in the quality sidecar, found " + actual);
        }
    }
}
