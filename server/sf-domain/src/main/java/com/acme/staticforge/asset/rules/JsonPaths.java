package com.acme.staticforge.asset.rules;

import com.acme.staticforge.common.L10nValues;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reads and writes a value by the path a finding or field state names (M33.4): {@code content.title},
 * {@code content.gallery[2].caption}, {@code bodies.main[0].content.headline}, relative to a JSON root; with a
 * {@code locale}, the value of that language inside an L10N wrapper.
 */
final class JsonPaths {

    private static final Pattern SEGMENT = Pattern.compile("([^.\\[\\]]+)((?:\\[\\d+])*)");
    private static final Pattern INDEX = Pattern.compile("\\[(\\d+)]");

    private JsonPaths() {}

    /** One step: a field name, then the list indexes after it. */
    private record Step(String field, List<Integer> indexes) {}

    private static List<Step> steps(String path) {
        List<Step> steps = new ArrayList<>();
        if (path == null || path.isEmpty()) {
            return steps;
        }
        for (String part : path.split("\\.")) {
            Matcher m = SEGMENT.matcher(part);
            if (!m.matches()) {
                return null;
            }
            List<Integer> indexes = new ArrayList<>();
            Matcher ix = INDEX.matcher(m.group(2));
            while (ix.find()) {
                indexes.add(Integer.parseInt(ix.group(1)));
            }
            steps.add(new Step(m.group(1), indexes));
        }
        return steps;
    }

    /** The value at {@code path} ({@code locale}'s value of a wrapper when set), or {@code null} when absent. */
    static JsonNode get(JsonNode root, String path, String locale) {
        List<Step> steps = steps(path);
        if (steps == null) {
            return null;
        }
        JsonNode node = root;
        for (Step step : steps) {
            node = node == null ? null : node.get(step.field());
            for (int index : step.indexes()) {
                node = node == null || !node.isArray() ? null : node.get(index);
            }
        }
        return locale == null || node == null ? node : L10nValues.get(node, locale);
    }

    /**
     * Sets the value at {@code path} ({@code locale}'s value inside a wrapper when set). Returns {@code false} when the
     * path doesn't exist in {@code root} (a removed row), changing nothing.
     */
    static boolean set(JsonNode root, String path, String locale, JsonNode value) {
        List<Step> steps = steps(path);
        if (steps == null || steps.isEmpty()) {
            return false;
        }
        JsonNode node = root;
        for (int i = 0; i < steps.size(); i++) {
            Step step = steps.get(i);
            boolean last = i == steps.size() - 1;
            if (!(node instanceof ObjectNode object)) {
                return false;
            }
            if (last && step.indexes().isEmpty()) {
                if (locale != null) {
                    object.set(step.field(), L10nValues.with(object.get(step.field()), locale, value));
                } else if (value == null) {
                    object.remove(step.field());
                } else {
                    object.set(step.field(), value);
                }
                return true;
            }
            node = object.get(step.field());
            for (int j = 0; j < step.indexes().size(); j++) {
                int index = step.indexes().get(j);
                if (!(node instanceof ArrayNode array) || index >= array.size()) {
                    return false;
                }
                if (last && j == step.indexes().size() - 1) {
                    array.set(index, locale != null ? L10nValues.with(array.get(index), locale, value) : value);
                    return true;
                }
                node = array.get(index);
            }
        }
        return false;
    }
}
