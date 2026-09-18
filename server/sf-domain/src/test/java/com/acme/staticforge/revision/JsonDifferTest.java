package com.acme.staticforge.revision;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for the field-path differ (spec §7.6), focused on the rich-text block-level diff:
 * a {@code {"format":"html","value":"…"}} field must diff per block rather than as one opaque
 * leaf, while non-richtext fields keep the structural equality behavior.
 */
class JsonDifferTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void nonRichtextFieldsKeepStructuralDiff() {
        JsonNode before = json("{\"content\":{\"title\":\"One\",\"count\":1}}");
        JsonNode after = json("{\"content\":{\"title\":\"Two\",\"count\":1}}");

        List<FieldChange> changes = JsonDiffer.diff(before, after);

        assertThat(changes).hasSize(1);
        FieldChange change = changes.get(0);
        assertThat(change.path()).isEqualTo("content.title");
        assertThat(change.before().asText()).isEqualTo("One");
        assertThat(change.after().asText()).isEqualTo("Two");
        assertThat(change.blocks()).isNull();
    }

    @Test
    void localizedValuesDiffPerLocale() {
        // M24.2.1: an L10N wrapper needs no special handling — the generic path walk already
        // reports one change per locale, which is the path shape the diff UI labels.
        JsonNode before = json(
                "{\"content\":{\"headline\":{\"type\":\"L10N\",\"values\":{\"de\":\"Eins\",\"en\":\"One\"}}}}");
        JsonNode after = json(
                "{\"content\":{\"headline\":{\"type\":\"L10N\",\"values\":{\"de\":\"Eins\",\"en\":\"Two\"}}}}");

        List<FieldChange> changes = JsonDiffer.diff(before, after);

        assertThat(changes).hasSize(1);
        assertThat(changes.get(0).path()).isEqualTo("content.headline.values.en");
        assertThat(changes.get(0).before().asText()).isEqualTo("One");
        assertThat(changes.get(0).after().asText()).isEqualTo("Two");
    }

    @Test
    void richtextAppendedBlockIsReportedAsBlockAddition() {
        JsonNode before = json("{\"content\":{\"body\":{\"format\":\"html\",\"value\":\"<p>one</p>\"}}}");
        JsonNode after = json("{\"content\":{\"body\":{\"format\":\"html\",\"value\":\"<p>one</p><h2>two</h2>\"}}}");

        List<FieldChange> changes = JsonDiffer.diff(before, after);

        assertThat(changes).hasSize(1);
        FieldChange change = changes.get(0);
        assertThat(change.path()).isEqualTo("content.body");
        assertThat(change.blocks()).containsExactly(
                new BlockChange(1, BlockChange.ADD, null, "<h2>two</h2>"));
    }

    @Test
    void richtextRemovedBlockIsReportedAsBlockRemoval() {
        JsonNode before = json("{\"body\":{\"format\":\"html\",\"value\":\"<p>one</p><p>two</p>\"}}}");
        JsonNode after = json("{\"body\":{\"format\":\"html\",\"value\":\"<p>one</p>\"}}}");

        List<FieldChange> changes = JsonDiffer.diff(before, after);

        assertThat(changes).isNotNull().hasSize(1);
        FieldChange change = changes.get(0);
        assertThat(change.path()).isEqualTo("body");
        assertThat(change.blocks()).containsExactly(
                new BlockChange(1, BlockChange.REMOVE, "<p>two</p>", null));
    }

    @Test
    void richtextEditedBlockIsReportedAsInPlaceUpdate() {
        JsonNode before = json("{\"body\":{\"format\":\"html\",\"value\":\"<p>before</p>\"}}}");
        JsonNode after = json("{\"body\":{\"format\":\"html\",\"value\":\"<p>after</p>\"}}}");

        List<FieldChange> changes = JsonDiffer.diff(before, after);

        assertThat(changes).hasSize(1);
        assertThat(changes.get(0).blocks()).containsExactly(
                new BlockChange(0, BlockChange.UPDATE, "<p>before</p>", "<p>after</p>"));
    }

    @Test
    void identicalRichtextProducesNoChange() {
        JsonNode before = json("{\"body\":{\"format\":\"html\",\"value\":\"<p>one</p><h2>two</h2>\"}}}");
        JsonNode after = json("{\"body\":{\"format\":\"html\",\"value\":\"<p>one</p><h2>two</h2>\"}}}");

        assertThat(JsonDiffer.diff(before, after)).isEmpty();
    }

    @Test
    void nestedBlocksAreNotSplitIndividually() {
        JsonNode inner = json("\"<ul><li>a</li><li>b</li></ul>\"");
        List<String> blocks = HtmlBlockSplitter.splitBlocks(inner.asText());
        assertThat(blocks).containsExactly("<ul><li>a</li><li>b</li></ul>");
    }

    private JsonNode json(String raw) {
        try {
            return mapper.readTree(raw);
        } catch (Exception e) {
            throw new AssertionError(e);
        }
    }
}
