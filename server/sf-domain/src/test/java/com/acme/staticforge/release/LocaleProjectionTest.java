package com.acme.staticforge.release;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.common.L10nValues;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.ProjectLocale;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

/** The per-locale projection a release status compares (M27.1.1, epic decision 6). */
class LocaleProjectionTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** de, en and de-CH, where de-CH falls back to de (and every chain ends at the default, de). */
    private static final LocaleConfig LOCALES = LocaleConfig.of(
            List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English"), new ProjectLocale("de-CH", "Schweiz")),
            "de",
            Map.of("de-CH", List.of("de")),
            false);

    private static final String BASE = """
            {"content": {
               "headline": {"type": "L10N", "values": {"de": "Parka", "en": "The parka", "de-CH": "Parka CH"}},
               "teaser":   {"type": "L10N", "values": {"de": "Warm", "en": "Warm and dry"}},
               "sku": "A-1"},
             "bodies": {"main": [{"instanceId": "s1"}, {"instanceId": "s2"}]}}
            """;

    static Stream<Arguments> edits() {
        return Stream.of(
                Arguments.of("an English-only value", "/content/headline/values/en", "\"The new parka\"",
                        Map.of("de", false, "en", true, "de-CH", false)),
                Arguments.of("a shared (non-localizable) value", "/content/sku", "\"A-2\"",
                        Map.of("de", true, "en", true, "de-CH", true)),
                Arguments.of("the German value de-CH only inherits", "/content/teaser/values/de", "\"Sehr warm\"",
                        Map.of("de", true, "en", false, "de-CH", true)),
                Arguments.of("the Swiss value only de-CH shows", "/content/headline/values/de-CH", "\"Parka Schweiz\"",
                        Map.of("de", false, "en", false, "de-CH", true)),
                Arguments.of("the section order", "/bodies/main", "[{\"instanceId\": \"s2\"}, {\"instanceId\": \"s1\"}]",
                        Map.of("de", true, "en", true, "de-CH", true)));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("edits")
    @DisplayName("an edit changes exactly the locales that see it")
    void editChangesTheLocalesThatSeeIt(String what, String pointer, String value, Map<String, Boolean> changed) throws Exception {
        JsonNode before = MAPPER.readTree(BASE);
        JsonNode after = set(before, pointer, MAPPER.readTree(value));

        for (Map.Entry<String, Boolean> expected : changed.entrySet()) {
            String locale = expected.getKey();
            boolean differs = !project(before, "about", "/", locale).equals(project(after, "about", "/", locale));
            assertThat(differs).as("%s changes %s", what, locale).isEqualTo(expected.getValue());
        }
    }

    @Test
    @DisplayName("a rename, a move and a delete change every locale")
    void structureChangesEveryLocale() throws Exception {
        JsonNode payload = MAPPER.readTree(BASE);
        for (String locale : LOCALES.codes()) {
            JsonNode base = project(payload, "about", "/", locale);
            assertThat(project(payload, "about-us", "/", locale)).as("rename, %s", locale).isNotEqualTo(base);
            assertThat(project(payload, "about", "/company/", locale)).as("move, %s", locale).isNotEqualTo(base);
            JsonNode deleted = LocaleProjection.project(
                    new LocaleProjection.Input("about", "About", "/", 7L, true, null, payload), locale, LOCALES);
            assertThat(deleted).as("delete, %s", locale).isNotEqualTo(base);
        }
    }

    @Test
    @DisplayName("a plain value and the L10N wrapper the localizable toggle made of it project identically")
    void tolerantOfBothShapes() throws Exception {
        JsonNode plain = MAPPER.readTree("{\"content\": {\"headline\": \"Parka\"}}");
        ObjectNode wrapped = plain.deepCopy();
        ((ObjectNode) wrapped.get("content")).set("headline", L10nValues.wrap(JsonNodeFactory.instance.textNode("Parka"), "de"));

        for (String locale : LOCALES.codes()) {
            assertThat(project(wrapped, "about", "/", locale)).as(locale).isEqualTo(project(plain, "about", "/", locale));
        }
    }

    @Test
    @DisplayName("the all-locales key compares the whole payload, every translation included")
    void allKeyComparesEverything() throws Exception {
        JsonNode before = MAPPER.readTree(BASE);
        JsonNode after = set(before, "/content/headline/values/en", MAPPER.readTree("\"The new parka\""));

        assertThat(project(after, "about", "/", ReleaseLocales.ALL)).isNotEqualTo(project(before, "about", "/", ReleaseLocales.ALL));
    }

    @Test
    @DisplayName("a project without locales projects the payload as it is")
    void unlocalizedProject() throws Exception {
        JsonNode payload = MAPPER.readTree("{\"content\": {\"headline\": \"Parka\"}}");

        JsonNode projection = LocaleProjection.project(
                new LocaleProjection.Input("about", "About", "/", null, false, null, payload), ReleaseLocales.ALL, LocaleConfig.EMPTY);

        assertThat(projection.get("payload")).isEqualTo(payload);
        assertThat(projection.get("uid").asText()).isEqualTo("about");
    }

    @Test
    @DisplayName("locale keys: one per locale, one shared key without locales and for non-localized media")
    void localeKeys() throws Exception {
        assertThat(ReleaseLocales.keysFor(LOCALES, AssetType.PAGE, null)).containsExactly("de", "en", "de-CH");
        assertThat(ReleaseLocales.keysFor(LocaleConfig.EMPTY, AssetType.PAGE, null)).containsExactly(ReleaseLocales.ALL);
        assertThat(ReleaseLocales.keysFor(LOCALES, AssetType.MEDIA, MAPPER.readTree("{}"))).containsExactly(ReleaseLocales.ALL);
        assertThat(ReleaseLocales.keysFor(LOCALES, AssetType.MEDIA, MAPPER.readTree("{\"localized\": true}")))
                .containsExactly("de", "en", "de-CH");
    }

    private static JsonNode project(JsonNode payload, String uid, String folderPath, String locale) {
        return LocaleProjection.project(
                new LocaleProjection.Input(uid, "About", folderPath, 7L, false, null, payload), locale, LOCALES);
    }

    private static JsonNode set(JsonNode root, String pointer, JsonNode value) {
        ObjectNode copy = root.deepCopy();
        int slash = pointer.lastIndexOf('/');
        ((ObjectNode) copy.at(pointer.substring(0, slash))).set(pointer.substring(slash + 1), value);
        return copy;
    }
}
