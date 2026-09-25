package com.acme.staticforge.release;

import com.acme.staticforge.common.L10nValues;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Discarding the changes of one locale while other locales keep theirs (M27.1.2, epic decision 11): the draft
 * payload with the locale's translation of every L10N value taken from the released payload, everything else — the
 * shared, non-localizable values and the structure — left as drafted.
 *
 * <p>Values are matched by field name and, in arrays, by {@code instanceId} where both sides have one (sections and
 * catalog cards), else by position. A translation the released version doesn't have is removed; a released plain
 * value (the shape before the M24 localizable toggle) is taken as the locale's value. Pure.
 */
public final class LocaleDiscard {

    private static final String INSTANCE_ID = "instanceId";

    private LocaleDiscard() {}

    /** The draft {@code payload} with {@code locale}'s translations restored from {@code released}. */
    public static JsonNode merge(JsonNode draft, JsonNode released, String locale) {
        if (draft == null) {
            return null;
        }
        return mergeNode(draft.deepCopy(), released, locale);
    }

    private static JsonNode mergeNode(JsonNode draft, JsonNode released, String locale) {
        if (L10nValues.isL10n(draft)) {
            JsonNode value = released == null || released.isMissingNode() || released.isNull()
                    ? null
                    : L10nValues.isL10n(released) ? L10nValues.get(released, locale) : released;
            return L10nValues.with(draft, locale, value);
        }
        if (draft instanceof ObjectNode object) {
            List<String> names = new ArrayList<>();
            object.fieldNames().forEachRemaining(names::add);
            for (String name : names) {
                JsonNode counterpart = released == null ? null : released.get(name);
                object.set(name, mergeNode(object.get(name), counterpart, locale));
            }
            return object;
        }
        if (draft instanceof ArrayNode array) {
            Map<String, JsonNode> releasedById = new HashMap<>();
            if (released != null && released.isArray()) {
                released.forEach(element -> {
                    String id = element.path(INSTANCE_ID).asText(null);
                    if (id != null) {
                        releasedById.put(id, element);
                    }
                });
            }
            for (int i = 0; i < array.size(); i++) {
                JsonNode element = array.get(i);
                String id = element.path(INSTANCE_ID).asText(null);
                JsonNode counterpart = id != null
                        ? releasedById.get(id)
                        : released != null && released.isArray() && i < released.size() ? released.get(i) : null;
                array.set(i, mergeNode(element, counterpart, locale));
            }
            return array;
        }
        return draft;
    }
}
