package com.acme.staticforge.template.query;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.text.Collator;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Dataset queries over language-dependent record fields (M24.3.3). */
class LocalizedDatasetQueryTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static JsonNode json(String raw) {
        try {
            return MAPPER.readTree(raw);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static RecordView record(String uid, String de, String en) {
        String content = """
                {"title":{"type":"L10N","values":{"de":"%s","en":"%s"}},"sku":"%s"}"""
                .formatted(de, en, uid);
        return new RecordView(UUID.randomUUID(), uid, uid, "/", Instant.parse("2026-01-01T00:00:00Z"), json(content));
    }

    @Test
    @DisplayName("resolvedFor gives where and sort the language being rendered")
    void resolvesForTheRenderLanguage() {
        RecordView original = record("a", "Äpfel", "Apples");

        assertThat(original.field("title").path("values").path("de").asText()).isEqualTo("Äpfel");
        assertThat(original.resolvedFor(List.of("de")).field("title").asText()).isEqualTo("Äpfel");
        assertThat(original.resolvedFor(List.of("en")).field("title").asText()).isEqualTo("Apples");
    }

    @Test
    @DisplayName("a language with no value falls back through the chain")
    void fallsBackThroughTheChain() {
        RecordView record = new RecordView(
                UUID.randomUUID(),
                "a",
                "A",
                "/",
                Instant.parse("2026-01-01T00:00:00Z"),
                json("{\"title\":{\"type\":\"L10N\",\"values\":{\"de\":\"Äpfel\"}}}"));

        assertThat(record.resolvedFor(List.of("en", "de")).field("title").asText()).isEqualTo("Äpfel");
    }

    @Test
    @DisplayName("a record without language-dependent fields is returned unchanged")
    void plainRecordIsUntouched() {
        RecordView record = new RecordView(
                UUID.randomUUID(), "a", "A", "/", Instant.parse("2026-01-01T00:00:00Z"), json("{\"title\":\"Plain\"}"));

        assertThat(record.resolvedFor(List.of("de"))).isSameAs(record);
        assertThat(record.resolvedFor(List.of())).isSameAs(record);
    }

    @Test
    @DisplayName("German collation sorts Äpfel with the A's, not after Z")
    void germanCollationSortsUmlautsWithTheirBaseLetter() {
        List<RecordView> records = List.of(record("b", "Birnen", "Pears"), record("z", "Zwetschge", "Plum"), record("a", "Äpfel", "Apples"))
                .stream()
                .map(record -> record.resolvedFor(List.of("de")))
                .toList();
        List<SortKey> keys = List.of(SortKey.asc("title"));

        List<String> german = DatasetQueryEvaluator.sort(records, keys, Collator.getInstance(Locale.GERMAN)).stream()
                .map(record -> record.field("title").asText())
                .toList();

        assertThat(german).containsExactly("Äpfel", "Birnen", "Zwetschge");
    }

    @Test
    @DisplayName("without a collator the fixed, language-independent order is unchanged")
    void withoutACollatorTheOrderIsTheOldOne() {
        List<RecordView> records = List.of(record("b", "Birnen", "Pears"), record("a", "Äpfel", "Apples")).stream()
                .map(record -> record.resolvedFor(List.of("de")))
                .toList();

        List<String> order = DatasetQueryEvaluator.sort(records, List.of(SortKey.asc("title"))).stream()
                .map(record -> record.field("title").asText())
                .toList();

        // Code-point order puts "Ä" (U+00C4) after "B", which is exactly why a language needs a collator.
        assertThat(order).containsExactly("Birnen", "Äpfel");
    }

    @Test
    @DisplayName("the two languages sort into different orders")
    void differentLanguagesSortDifferently() {
        List<RecordView> source = List.of(record("a", "Zitrone", "Apple"), record("b", "Apfel", "Zucchini"));
        List<SortKey> keys = List.of(SortKey.asc("title"));

        List<String> german = DatasetQueryEvaluator
                .sort(source.stream().map(r -> r.resolvedFor(List.of("de"))).toList(), keys, Collator.getInstance(Locale.GERMAN))
                .stream()
                .map(record -> record.uid())
                .toList();
        List<String> english = DatasetQueryEvaluator
                .sort(source.stream().map(r -> r.resolvedFor(List.of("en"))).toList(), keys, Collator.getInstance(Locale.ENGLISH))
                .stream()
                .map(record -> record.uid())
                .toList();

        assertThat(german).containsExactly("b", "a");
        assertThat(english).containsExactly("a", "b");
    }
}
