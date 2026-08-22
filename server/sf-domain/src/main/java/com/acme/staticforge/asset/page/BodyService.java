package com.acme.staticforge.asset.page;

import com.acme.staticforge.common.JsonUtil;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * Pure JSON payload manipulation for page bodies (§10.3). Section instances are arrays of
 * {@code {instanceId, templateRef, content}}; the {@code instanceId} is a stable UUID across
 * edits so revisions can be diffed per section. No persistence here — callers own the write.
 */
@Component
public class BodyService {

    private final ObjectMapper objectMapper;

    public BodyService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /** Applies an RFC 7386 JSON merge patch onto {@code payload}. */
    public ObjectNode mergePatch(JsonNode payload, JsonNode patch) {
        ObjectNode target = object(payload);
        applyPatch(target, patch);
        return target;
    }

    /** Adds a section instance (stable {@code instanceId}) into {@code bodyName} at {@code position}. */
    public ObjectNode addSection(JsonNode payload, String bodyName, String templateUuid, Integer position, String instanceId) {
        ObjectNode page = object(payload);
        ObjectNode section = objectMapper.createObjectNode();
        section.put("instanceId", instanceId);
        section.put("templateRef", templateUuid);
        section.putObject("content");

        List<JsonNode> sections = sections(page, bodyName);
        int index = (position == null || position < 0 || position > sections.size()) ? sections.size() : position;
        sections.add(index, section);
        setSections(page, bodyName, sections);
        return page;
    }

    /** Reorders the sections of {@code bodyName} to match {@code instanceIds}. */
    public ObjectNode reorder(JsonNode payload, String bodyName, List<String> instanceIds) {
        ObjectNode page = object(payload);
        List<JsonNode> sections = sections(page, bodyName);
        Map<String, JsonNode> byId = new java.util.LinkedHashMap<>();
        for (JsonNode s : sections) {
            byId.put(s.path("instanceId").asText(), s);
        }
        List<JsonNode> ordered = new ArrayList<>();
        for (String id : instanceIds) {
            JsonNode s = byId.remove(id);
            if (s != null) {
                ordered.add(s);
            }
        }
        ordered.addAll(byId.values());
        setSections(page, bodyName, ordered);
        return page;
    }

    /** Removes the section instance with the given {@code instanceId}. */
    public ObjectNode removeSection(JsonNode payload, String bodyName, String instanceId) {
        ObjectNode page = object(payload);
        List<JsonNode> sections = sections(page, bodyName);
        sections.removeIf(s -> instanceId.equals(s.path("instanceId").asText()));
        setSections(page, bodyName, sections);
        return page;
    }

    private static ObjectNode object(JsonNode node) {
        return (ObjectNode) (node != null && node.isObject() ? node : JsonUtil.parse("{}"));
    }

    private static List<JsonNode> sections(ObjectNode page, String bodyName) {
        JsonNode bodies = page.get("bodies");
        JsonNode body = bodies != null ? bodies.get(bodyName) : null;
        List<JsonNode> list = new ArrayList<>();
        if (body != null && body.isArray()) {
            body.forEach(list::add);
        }
        return list;
    }

    private static void setSections(ObjectNode page, String bodyName, List<JsonNode> sections) {
        ObjectNode bodies = page.has("bodies") && page.get("bodies").isObject()
                ? (ObjectNode) page.get("bodies")
                : page.putObject("bodies");
        var array = bodies.putArray(bodyName);
        sections.forEach(array::add);
    }

    private static void applyPatch(ObjectNode target, JsonNode patch) {
        if (patch == null || !patch.isObject()) {
            return;
        }
        Iterator<Map.Entry<String, JsonNode>> fields = patch.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> entry = fields.next();
            String key = entry.getKey();
            JsonNode value = entry.getValue();
            if (value == null || value.isNull()) {
                target.remove(key);
                continue;
            }
            JsonNode existing = target.get(key);
            if (existing != null && existing.isObject() && value.isObject()) {
                applyPatch((ObjectNode) existing, value);
            } else {
                target.set(key, value.deepCopy());
            }
        }
    }
}
