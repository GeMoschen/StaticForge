package com.acme.staticforge.common;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Optional;

/**
 * Small JSON helpers shared across layers. Deliberately dependency-free beyond Jackson
 * so that {@code sf-common} keeps no Spring or persistence coupling.
 */
public final class JsonUtil {

    private JsonUtil() {}

    /** Parses a JSON string into a tree, wrapping parse errors in {@link IllegalArgumentException}. */
    public static JsonNode parse(String json) {
        try {
            return new ObjectMapper().readTree(json);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("Invalid JSON: " + e.getOriginalMessage(), e);
        }
    }

    /** Returns {@code true} when the node is null, missing, or (for text) blank. */
    public static boolean isBlank(JsonNode node) {
        return node == null || node.isNull() || (node.isTextual() && node.asText().isBlank());
    }

    /** Returns an {@link ObjectNode} view, creating an empty object when the node is null/missing. */
    public static ObjectNode object(JsonNode node) {
        if (node == null || node.isNull() || node.isMissingNode()) {
            return new ObjectMapper().createObjectNode();
        }
        return (ObjectNode) node;
    }

    /** Reads a child as text if present and non-null, otherwise {@link Optional#empty()}. */
    public static Optional<String> text(JsonNode node, String field) {
        return Optional.ofNullable(node)
                .map(n -> n.get(field))
                .filter(JsonNode::isTextual)
                .map(JsonNode::asText);
    }
}
