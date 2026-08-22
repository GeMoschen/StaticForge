package com.acme.staticforge.exportimport;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;
import java.util.Map;
import java.util.UUID;

/**
 * Purely-functional payload reference remap used by the import path (spec §6.1). The
 * {@code old-uuid → new-uuid} mapping is built up-front for every imported asset; this
 * helper rewrites any textual node in a payload — {@code templateRef}, {@code MEDIA_REF}
 * / {@code ASSET_REF} / {@code link} {@code uuid} fields, section {@code templateRef}s,
 * compiled structure AST nodes, and so on — whose value is one of the known source UUIDs.
 * Non-referencing text and random instance identifiers are left untouched.
 */
public final class UuidRemapper {

    private static final JsonNodeFactory FACTORY = JsonNodeFactory.instance;

    private UuidRemapper() {}

    /**
     * Returns a deep copy of {@code payload} with every textual node equal to a key of
     * {@code remap} (compared case-insensitively) replaced by the mapped UUID string.
     */
    public static JsonNode remap(JsonNode payload, Map<String, UUID> remap) {
        return remapNode(payload, remap);
    }

    private static JsonNode remapNode(JsonNode node, Map<String, UUID> remap) {
        if (node == null || node.isNull() || node.isMissingNode()) {
            return node;
        }
        if (node.isTextual()) {
            UUID mapped = remap.get(node.asText().toLowerCase());
            return mapped == null ? node : TextNode.valueOf(mapped.toString());
        }
        if (node.isObject()) {
            ObjectNode out = FACTORY.objectNode();
            node.fields().forEachRemaining(e -> out.set(e.getKey(), remapNode(e.getValue(), remap)));
            return out;
        }
        if (node.isArray()) {
            ArrayNode out = FACTORY.arrayNode();
            node.forEach(child -> out.add(remapNode(child, remap)));
            return out;
        }
        return node;
    }
}
