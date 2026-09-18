package com.acme.staticforge.common;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Unit tests for the L10N stored-value helper (M24.2.1). */
class L10nValuesTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static JsonNode json(String raw) {
        try {
            return MAPPER.readTree(raw);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static JsonNode text(String value) {
        return JsonNodeFactory.instance.textNode(value);
    }

    @Test
    @DisplayName("isL10n only accepts the full wrapper shape")
    void isL10n() {
        assertThat(L10nValues.isL10n(json("{\"type\":\"L10N\",\"values\":{\"de\":\"x\"}}"))).isTrue();
        assertThat(L10nValues.isL10n(json("{\"type\":\"L10N\"}"))).isFalse();
        assertThat(L10nValues.isL10n(json("{\"type\":\"ASSET_REF\",\"values\":{}}"))).isFalse();
        assertThat(L10nValues.isL10n(text("plain"))).isFalse();
        assertThat(L10nValues.isL10n(null)).isFalse();
    }

    @Test
    @DisplayName("resolve walks the chain and stops at the first translated locale")
    void resolveWalksChain() {
        JsonNode node = json("{\"type\":\"L10N\",\"values\":{\"de\":\"Strasse\",\"en\":\"Street\"}}");

        assertThat(L10nValues.resolve(node, List.of("de-CH", "de", "en")).asText()).isEqualTo("Strasse");
        assertThat(L10nValues.resolve(node, List.of("en")).asText()).isEqualTo("Street");
        assertThat(L10nValues.resolvedLocale(node, List.of("de-CH", "de", "en"))).isEqualTo("de");
    }

    @Test
    @DisplayName("resolve returns null when no locale in the chain has a value")
    void resolveMissing() {
        JsonNode node = json("{\"type\":\"L10N\",\"values\":{\"en\":\"Street\"}}");

        assertThat(L10nValues.resolve(node, List.of("de"))).isNull();
        assertThat(L10nValues.resolve(node, List.of())).isNull();
        assertThat(L10nValues.resolvedLocale(node, List.of("de"))).isNull();
    }

    @Test
    @DisplayName("a JSON null counts as not translated")
    void jsonNullIsUntranslated() {
        JsonNode node = json("{\"type\":\"L10N\",\"values\":{\"de\":null,\"en\":\"Street\"}}");

        assertThat(L10nValues.get(node, "de")).isNull();
        assertThat(L10nValues.resolve(node, List.of("de", "en")).asText()).isEqualTo("Street");
        assertThat(L10nValues.locales(node)).containsExactly("en");
    }

    @Test
    @DisplayName("a non-wrapper passes through resolve unchanged")
    void nonWrapperPassesThrough() {
        JsonNode bare = text("plain");

        assertThat(L10nValues.resolve(bare, List.of("de"))).isSameAs(bare);
        assertThat(L10nValues.resolve(bare, List.of())).isSameAs(bare);
        assertThat(L10nValues.unwrap(bare, List.of("de"))).isSameAs(bare);
    }

    @Test
    @DisplayName("with() writes one locale and leaves the others untouched")
    void withKeepsOtherLocales() {
        JsonNode node = json("{\"type\":\"L10N\",\"values\":{\"de\":\"Die Parka\"}}");

        ObjectNode updated = L10nValues.with(node, "en", text("The parka"));

        assertThat(L10nValues.get(updated, "de").asText()).isEqualTo("Die Parka");
        assertThat(L10nValues.get(updated, "en").asText()).isEqualTo("The parka");
        // The input is not mutated.
        assertThat(L10nValues.get(node, "en")).isNull();
    }

    @Test
    @DisplayName("with(null) removes a translation")
    void withNullRemoves() {
        JsonNode node = json("{\"type\":\"L10N\",\"values\":{\"de\":\"a\",\"en\":\"b\"}}");

        assertThat(L10nValues.locales(L10nValues.with(node, "en", null))).containsExactly("de");
    }

    @Test
    @DisplayName("wrap/unwrap round-trip and wrap is idempotent")
    void wrapUnwrapRoundTrip() {
        ObjectNode wrapped = L10nValues.wrap(text("Headline"), "de");

        assertThat(wrapped.get("type").asText()).isEqualTo("L10N");
        assertThat(L10nValues.get(wrapped, "de").asText()).isEqualTo("Headline");
        assertThat(L10nValues.unwrap(wrapped, List.of("de")).asText()).isEqualTo("Headline");
        assertThat(L10nValues.wrap(wrapped, "de")).isSameAs(wrapped);
    }

    @Test
    @DisplayName("wrapping an absent value yields an empty wrapper")
    void wrapNull() {
        assertThat(L10nValues.locales(L10nValues.wrap(null, "de"))).isEmpty();
        assertThat(L10nValues.locales(L10nValues.wrap(JsonNodeFactory.instance.nullNode(), "de"))).isEmpty();
        assertThat(L10nValues.locales(L10nValues.empty())).isEmpty();
    }

    @Test
    @DisplayName("orphanedLocales lists translations for locales the project no longer declares")
    void orphanedLocales() {
        JsonNode node = json("{\"type\":\"L10N\",\"values\":{\"de\":\"a\",\"en\":\"b\",\"fr\":\"c\"}}");

        assertThat(L10nValues.orphanedLocales(node, List.of("DE", "en"))).containsExactly("fr");
        assertThat(L10nValues.orphanedLocales(text("plain"), List.of("de"))).isEmpty();
    }
}
