package com.acme.staticforge.common;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * The stored shape of a language-dependent (M24 {@code localizable}) editor value, and the
 * only place that shape is read or written.
 *
 * <pre>{@code
 * "headline": { "type": "L10N", "values": { "de": "Die Parka", "en": "The parka" } }
 * }</pre>
 *
 * <p>A key missing from {@code values} means "not translated" and resolves through the
 * locale's fallback chain. A localizable editor's value is <em>always</em> the wrapper once
 * migrated, so readers never have to guess whether a bare value is German or English.
 */
public final class L10nValues {

    /** The {@code type} discriminator, alongside {@code ASSET_REF} and {@code CATALOG}. */
    public static final String TYPE = "L10N";

    private static final String TYPE_FIELD = "type";
    private static final String VALUES_FIELD = "values";

    private L10nValues() {}

    /** {@code true} when {@code node} is an L10N wrapper. */
    public static boolean isL10n(JsonNode node) {
        return node != null
                && node.isObject()
                && TYPE.equals(node.path(TYPE_FIELD).asText(null))
                && node.path(VALUES_FIELD).isObject();
    }

    /**
     * The value stored for exactly {@code locale}, without falling back. {@code null} when
     * {@code node} is not a wrapper or holds nothing for that locale. A stored JSON
     * {@code null} counts as "not translated" and yields {@code null}.
     */
    public static JsonNode get(JsonNode node, String locale) {
        if (!isL10n(node) || locale == null) {
            return null;
        }
        JsonNode value = node.get(VALUES_FIELD).get(locale);
        return value == null || value.isNull() ? null : value;
    }

    /**
     * Resolves {@code node} for a render locale.
     *
     * <p>A non-wrapper is returned unchanged — that is how a non-localized project, and a
     * non-localizable editor in a localized one, keep working. A wrapper yields the first
     * locale in {@code chain} that has a value, or {@code null} when none does.
     */
    public static JsonNode resolve(JsonNode node, List<String> chain) {
        if (!isL10n(node)) {
            return node;
        }
        if (chain != null) {
            for (String locale : chain) {
                JsonNode value = get(node, locale);
                if (value != null) {
                    return value;
                }
            }
        }
        return null;
    }

    /**
     * The locale whose value {@link #resolve} would return, or {@code null} when nothing in
     * {@code chain} has a value. Used to tell editors "inherited from de".
     */
    public static String resolvedLocale(JsonNode node, List<String> chain) {
        if (!isL10n(node) || chain == null) {
            return null;
        }
        for (String locale : chain) {
            if (get(node, locale) != null) {
                return locale;
            }
        }
        return null;
    }

    /** The locales this wrapper carries a value for, in stored order; empty for a non-wrapper. */
    public static List<String> locales(JsonNode node) {
        if (!isL10n(node)) {
            return List.of();
        }
        Set<String> names = new LinkedHashSet<>();
        node.get(VALUES_FIELD).fieldNames().forEachRemaining(name -> {
            if (!node.get(VALUES_FIELD).get(name).isNull()) {
                names.add(name);
            }
        });
        return List.copyOf(names);
    }

    /**
     * Returns a copy of {@code node} with {@code locale} set to {@code value}, leaving every
     * other locale untouched. A {@code null} or JSON-null {@code value} removes the
     * translation. {@code node} may be {@code null} or a bare value — a bare value is
     * discarded, because the caller that has a wrapper-shaped editor is authoritative.
     */
    public static ObjectNode with(JsonNode node, String locale, JsonNode value) {
        ObjectNode wrapper = isL10n(node)
                ? node.deepCopy()
                : JsonNodeFactory.instance.objectNode().put(TYPE_FIELD, TYPE);
        ObjectNode values = wrapper.has(VALUES_FIELD) && wrapper.get(VALUES_FIELD).isObject()
                ? (ObjectNode) wrapper.get(VALUES_FIELD)
                : wrapper.putObject(VALUES_FIELD);
        if (value == null || value.isNull()) {
            values.remove(locale);
        } else {
            values.set(locale, value);
        }
        return wrapper;
    }

    /**
     * Wraps a bare value as the {@code defaultLocale} translation — the off → on migration
     * step. An existing wrapper is returned unchanged, so re-running a migration after a
     * timeout can't double-wrap. A {@code null} or JSON-null value becomes an empty wrapper.
     */
    public static ObjectNode wrap(JsonNode value, String defaultLocale) {
        if (isL10n(value)) {
            return (ObjectNode) value;
        }
        ObjectNode wrapper = JsonNodeFactory.instance.objectNode().put(TYPE_FIELD, TYPE);
        ObjectNode values = wrapper.putObject(VALUES_FIELD);
        if (value != null && !value.isNull()) {
            values.set(defaultLocale, value);
        }
        return wrapper;
    }

    /**
     * Unwraps to the bare value for {@code chain} — the on → off migration step. A
     * non-wrapper is returned unchanged, so the migration is idempotent.
     */
    public static JsonNode unwrap(JsonNode node, List<String> chain) {
        return isL10n(node) ? resolve(node, chain) : node;
    }

    /** The locales in {@code node} that {@code declared} does not contain — orphaned translations. */
    public static List<String> orphanedLocales(JsonNode node, List<String> declared) {
        List<String> orphaned = new ArrayList<>();
        for (String locale : locales(node)) {
            if (declared == null || declared.stream().noneMatch(d -> d.equalsIgnoreCase(locale))) {
                orphaned.add(locale);
            }
        }
        return List.copyOf(orphaned);
    }

    /**
     * Resolves every L10N wrapper anywhere in {@code node} for {@code chain}, returning a tree
     * with bare values only. Used where a whole content object is handed to something that
     * must not see wrappers: the {@code json} filter, {@code visibleWhen} evaluation and search
     * extraction. A wrapper with nothing in the chain becomes a JSON null.
     */
    public static JsonNode resolveDeep(JsonNode node, List<String> chain) {
        if (node == null) {
            return null;
        }
        if (isL10n(node)) {
            JsonNode resolved = resolve(node, chain);
            return resolved == null ? JsonNodeFactory.instance.nullNode() : resolved;
        }
        if (node.isObject()) {
            ObjectNode copy = JsonNodeFactory.instance.objectNode();
            node.fields().forEachRemaining(e -> copy.set(e.getKey(), resolveDeep(e.getValue(), chain)));
            return copy;
        }
        if (node.isArray()) {
            com.fasterxml.jackson.databind.node.ArrayNode copy = JsonNodeFactory.instance.arrayNode();
            node.forEach(element -> copy.add(resolveDeep(element, chain)));
            return copy;
        }
        return node;
    }

    /** {@code true} when {@code node} contains an L10N wrapper anywhere. */
    public static boolean containsL10n(JsonNode node) {
        if (node == null) {
            return false;
        }
        if (isL10n(node)) {
            return true;
        }
        for (JsonNode child : node) {
            if (containsL10n(child)) {
                return true;
            }
        }
        return false;
    }

    /** An empty wrapper — a localizable editor with no translation yet. */
    public static ObjectNode empty() {
        ObjectNode wrapper = JsonNodeFactory.instance.objectNode().put(TYPE_FIELD, TYPE);
        wrapper.putObject(VALUES_FIELD);
        return wrapper;
    }
}
