package com.acme.staticforge.generate.postprocess;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;

/**
 * Shared helpers for the post-processors.
 */
final class PostProcessSupport {

    static final ObjectMapper json = new ObjectMapper();

    private PostProcessSupport() {}

    /** Serializes {@code node} to UTF-8 JSON bytes, wrapping checked serialization errors. */
    static byte[] jsonBytes(JsonNode node) {
        try {
            return json.writeValueAsBytes(node);
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new java.io.UncheckedIOException("Failed to serialize JSON", e);
        }
    }

    /** Joins {@code baseUrl} and a normalized (no leading slash) {@code path} into a full URL. */
    static String url(String baseUrl, String path) {
        String base = baseUrl == null ? "" : baseUrl;
        while (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        String p = path == null ? "" : path;
        while (p.startsWith("/")) {
            p = p.substring(1);
        }
        return base + "/" + p;
    }

    /** Escapes XML special characters in {@code value}. */
    static String xml(String value) {
        StringBuilder sb = new StringBuilder(value.length());
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '&' -> sb.append("&amp;");
                case '<' -> sb.append("&lt;");
                case '>' -> sb.append("&gt;");
                case '"' -> sb.append("&quot;");
                case '\'' -> sb.append("&apos;");
                default -> sb.append(c);
            }
        }
        return sb.toString();
    }
}
