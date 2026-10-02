package com.acme.staticforge.revision;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class ChangedLocalesTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static JsonNode json(String text) {
        try {
            return JSON.readTree(text);
        } catch (Exception e) {
            throw new IllegalArgumentException(e);
        }
    }

    @Test
    void reportsOnlyTheLocalesWhoseValueChanged() {
        JsonNode before = json("{\"title\":{\"type\":\"L10N\",\"values\":{\"de\":\"Hallo\",\"en\":\"Hello\"}}}");
        JsonNode after = json("{\"title\":{\"type\":\"L10N\",\"values\":{\"de\":\"Hallo\",\"en\":\"Hi\"}}}");

        assertThat(ChangedLocales.between(before, after)).containsExactly("en");
    }

    @Test
    void anAddedOrRemovedTranslationCounts_andNestedSectionsAreWalked() {
        JsonNode before = json("{\"sections\":[{\"h\":{\"type\":\"L10N\",\"values\":{\"de\":\"A\"}}}]}");
        JsonNode after = json("{\"sections\":[{\"h\":{\"type\":\"L10N\",\"values\":{\"de\":\"A\",\"fr\":\"B\"}}},"
                + "{\"h\":{\"type\":\"L10N\",\"values\":{\"en\":\"C\"}}}]}");

        assertThat(ChangedLocales.between(before, after)).containsExactly("fr", "en");
    }

    @Test
    void aNewItemReportsEveryLanguageItHas_andNonLocalizedChangesReportNone() {
        JsonNode created = json("{\"t\":{\"type\":\"L10N\",\"values\":{\"de\":\"A\",\"en\":\"B\"}}}");
        assertThat(ChangedLocales.between(null, created)).containsExactly("de", "en");

        assertThat(ChangedLocales.between(json("{\"n\":1}"), json("{\"n\":2}"))).isEmpty();
        assertThat(ChangedLocales.between(created, created)).isEmpty();
    }
}
