package com.acme.staticforge.revision;

import com.acme.staticforge.common.L10nValues;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * The languages whose content differs between two payloads: walks both side by side and, at every language-dependent
 * value ({@link L10nValues}), collects the locales whose stored value changed, appeared or disappeared.
 */
final class ChangedLocales {

    private ChangedLocales() {}

    /** Locales that changed from {@code before} to {@code after} (either may be {@code null}), in first-seen order. */
    static List<String> between(JsonNode before, JsonNode after) {
        Set<String> changed = new LinkedHashSet<>();
        walk(before, after, changed);
        return List.copyOf(changed);
    }

    private static void walk(JsonNode a, JsonNode b, Set<String> changed) {
        if (Objects.equals(a, b)) {
            return;
        }
        if (L10nValues.isL10n(a) || L10nValues.isL10n(b)) {
            Set<String> locales = new LinkedHashSet<>(L10nValues.locales(a));
            locales.addAll(L10nValues.locales(b));
            for (String locale : locales) {
                if (!Objects.equals(L10nValues.get(a, locale), L10nValues.get(b, locale))) {
                    changed.add(locale);
                }
            }
            return;
        }
        if (isContainer(a) || isContainer(b)) {
            Set<String> keys = new LinkedHashSet<>();
            keysOf(a, keys);
            keysOf(b, keys);
            for (String key : keys) {
                walk(child(a, key), child(b, key), changed);
            }
        }
    }

    private static boolean isContainer(JsonNode node) {
        return node != null && (node.isObject() || node.isArray());
    }

    private static void keysOf(JsonNode node, Set<String> keys) {
        if (node == null) {
            return;
        }
        if (node.isObject()) {
            node.fieldNames().forEachRemaining(keys::add);
        } else if (node.isArray()) {
            for (int i = 0; i < node.size(); i++) {
                keys.add(Integer.toString(i));
            }
        }
    }

    private static JsonNode child(JsonNode node, String key) {
        if (node == null) {
            return null;
        }
        if (node.isObject()) {
            return node.get(key);
        }
        return node.isArray() ? node.get(Integer.parseInt(key)) : null;
    }
}
