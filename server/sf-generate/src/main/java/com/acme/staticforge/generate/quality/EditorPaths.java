package com.acme.staticforge.generate.quality;

import com.acme.staticforge.asset.ReferenceKind;
import com.acme.staticforge.asset.content.ContentReferenceService;
import com.acme.staticforge.asset.content.ExtractedReference;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Where a page's content holds its references (M30.2.1): the editor path of every asset a page or record payload
 * references, as the reference table records it (spec §5.4, {@code source_path}) — {@code content.cta},
 * {@code bodies.main[0].content.image}, {@code bodies.main[1].templateRef}. A link finding built from a
 * {@link ReferenceEvent} names this path, so the editor can jump to the field that holds the broken reference.
 */
final class EditorPaths {

    /** A pure scanner, no dependencies: safe to share. */
    private static final ContentReferenceService CONTENT_REFERENCES = new ContentReferenceService();

    private EditorPaths() {}

    /**
     * The first editor path of each referenced asset in {@code payload}, in document order ({@code content} first, then
     * each body's sections); empty for a payload without references.
     */
    static Map<UUID, String> of(JsonNode payload) {
        Map<UUID, String> paths = new HashMap<>();
        if (payload == null || !payload.isObject()) {
            return paths;
        }
        List<ExtractedReference> found = new ArrayList<>(CONTENT_REFERENCES.extract(payload.get("content"), "content"));
        JsonNode bodies = payload.get("bodies");
        if (bodies != null && bodies.isObject()) {
            bodies.fields().forEachRemaining(body -> {
                JsonNode sections = body.getValue();
                if (sections == null || !sections.isArray()) {
                    return;
                }
                for (int i = 0; i < sections.size(); i++) {
                    JsonNode section = sections.get(i);
                    String path = "bodies." + body.getKey() + "[" + i + "]";
                    UUID template = uuid(section.path("templateRef").asText(null));
                    if (template != null) {
                        found.add(new ExtractedReference(ReferenceKind.TEMPLATE, template, path + ".templateRef"));
                    }
                    found.addAll(CONTENT_REFERENCES.extract(section.get("content"), path + ".content"));
                }
            });
        }
        for (ExtractedReference reference : found) {
            paths.putIfAbsent(reference.target(), reference.sourcePath());
        }
        return paths;
    }

    private static UUID uuid(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
