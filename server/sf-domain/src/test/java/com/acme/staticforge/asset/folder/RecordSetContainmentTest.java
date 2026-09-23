package com.acme.staticforge.asset.folder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.template.query.RecordSetQuery;
import com.acme.staticforge.common.SfException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** The pure record set containment rules (M25) that every write path and import share. */
class RecordSetContainmentTest {

    private static final UUID TEAM = UUID.randomUUID();
    private static final UUID PRODUCTS = UUID.randomUUID();

    @Test
    void aRecordBelongsInALiveSetOfItsOwnDataset() {
        assertThat(RecordSetContainment.violation(AssetType.RECORD, of(TEAM), AssetType.RECORD_SET, of(TEAM), false)).isEmpty();
        assertThat(RecordSetContainment.violation(
                        AssetType.RECORD, of(TEAM), AssetType.RECORD_SET, of(TEAM.toString().toUpperCase()), false))
                .as("uuids compare case-insensitively")
                .isEmpty();

        assertThat(RecordSetContainment.violation(AssetType.RECORD, of(TEAM), AssetType.RECORD_SET, of(PRODUCTS), false))
                .hasValueSatisfying(message -> assertThat(message).contains("another dataset"));
        assertThat(RecordSetContainment.violation(AssetType.RECORD, of(TEAM), AssetType.RECORD_SET, of(TEAM), true))
                .hasValueSatisfying(message -> assertThat(message).contains("deleted"));
        assertThat(RecordSetContainment.violation(AssetType.RECORD, of(TEAM), AssetType.FOLDER, null, false))
                .as("the store root or a folder")
                .hasValueSatisfying(message -> assertThat(message).contains("always lives in a record set"));
        assertThat(RecordSetContainment.violation(AssetType.RECORD, null, AssetType.RECORD_SET, of(TEAM), false))
                .as("a record without a dataset fits no set")
                .isPresent();
    }

    @Test
    void aSetLivesInAFolderAndHoldsRecordsOnly() {
        assertThat(RecordSetContainment.violation(AssetType.RECORD_SET, of(TEAM), AssetType.FOLDER, null, false)).isEmpty();
        assertThat(RecordSetContainment.violation(AssetType.RECORD_SET, of(TEAM), AssetType.RECORD_SET, of(TEAM), false))
                .hasValueSatisfying(message -> assertThat(message).contains("inside another record set"));
        for (AssetType other : AssetType.values()) {
            if (other != AssetType.RECORD && other != AssetType.RECORD_SET) {
                assertThat(RecordSetContainment.violation(other, null, AssetType.RECORD_SET, of(TEAM), false))
                        .as(other.name())
                        .hasValueSatisfying(message -> assertThat(message).contains("records only"));
                assertThat(RecordSetContainment.violation(other, null, AssetType.FOLDER, null, false))
                        .as(other.name())
                        .isEmpty();
            }
        }
    }

    @Test
    void aViolationIsA422WithItsOwnCode() {
        assertThatThrownBy(() -> RecordSetContainment.require(AssetType.RECORD, of(TEAM), AssetType.FOLDER, null, false))
                .isInstanceOfSatisfying(SfException.class, ex -> {
                    assertThat(ex.getStatus()).isEqualTo(422);
                    assertThat(ex.getProblem().getTitle()).isEqualTo("Validation Failed");
                    assertThat(ex.getProblem().getExtensions()).containsEntry("code", RecordSetContainment.CODE);
                });
        assertThat(RecordSetContainment.notEmpty(3).getProblem().getExtensions())
                .containsEntry("code", "SF-DOM-0110")
                .containsEntry("recordCount", 3L);
    }

    @Test
    void aStoredQueryKeepsOnlyTheGivenParts() {
        RecordSetQuery query = new RecordSetQuery(" role == 'lead' ", "", 3, null);
        JsonNode json = query.toJson();

        assertThat(json.toString()).isEqualTo("{\"where\":\"role == 'lead'\",\"limit\":3}");
        assertThat(RecordSetQuery.fromJson(json)).isEqualTo(new RecordSetQuery("role == 'lead'", null, 3, null));
        assertThat(RecordSetQuery.fromJson(null)).isEqualTo(RecordSetQuery.ALL);
        assertThat(RecordSetQuery.ALL.toJson().isEmpty()).isTrue();
        assertThat(RecordSetQuery.orAll(null)).isSameAs(RecordSetQuery.ALL);
    }

    private static JsonNode of(Object datasetRef) {
        return JsonNodeFactory.instance.objectNode().put("datasetRef", datasetRef.toString());
    }
}
