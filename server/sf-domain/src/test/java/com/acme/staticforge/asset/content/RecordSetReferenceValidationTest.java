package com.acme.staticforge.asset.content;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.common.JsonUtil;
import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.expression.ExpressionEvaluator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** {@code M25.2.2}: a {@code reference} editor restricted with {@code dataset "uid"} that may pick record sets. */
class RecordSetReferenceValidationTest {

    private static final UUID TEAM_SET = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID FAQ_SET = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID TEAM_RECORD = UUID.fromString("00000000-0000-0000-0000-000000000003");

    /** The lookup answers for records and sets alike: the dataset their payload names. */
    private final ContentValidator validator = new ContentValidator(new ExpressionEvaluator(), uuid -> Optional.ofNullable(
            Map.of(TEAM_SET, "team", FAQ_SET, "faq", TEAM_RECORD, "team").get(uuid)));

    @Test
    void aSetOfTheDeclaredDatasetIsAccepted() {
        assertThat(validate("assetTypes [RECORD_SET] dataset \"team\"", TEAM_SET, "RECORD_SET")).isEmpty();
        assertThat(validate("assetTypes [RECORD, RECORD_SET] dataset \"team\"", TEAM_RECORD, "RECORD")).isEmpty();
    }

    @Test
    void aSetOfAnotherDatasetIsAStructuralDatasetFinding() {
        assertThat(validate("assetTypes [RECORD_SET] dataset \"team\"", FAQ_SET, "RECORD_SET")).singleElement().satisfies(issue -> {
            assertThat(issue.path()).isEqualTo("featured");
            assertThat(issue.code()).isEqualTo("dataset");
            assertThat(issue.severity()).isEqualTo(Severity.ERROR);
            assertThat(issue.message()).contains("a record set of dataset 'team'");
        });
    }

    @Test
    void theAssetTypesDecideWhetherRecordsOrSetsMayBePicked() {
        assertThat(validate("assetTypes [RECORD_SET] dataset \"team\"", TEAM_RECORD, "RECORD"))
                .extracting(ContentIssue::code).containsExactly("dataset");
        // Without assetTypes a dataset restriction means records, as before record sets existed.
        assertThat(validate("dataset \"team\"", TEAM_SET, "RECORD_SET")).extracting(ContentIssue::code).containsExactly("dataset");
        assertThat(validate("dataset \"team\"", TEAM_RECORD, "RECORD")).isEmpty();
    }

    private List<ContentIssue> validate(String attributes, UUID target, String assetType) {
        ContentDefinition definition = new CdlCompiler()
                .compile("content { editor reference featured { label \"Featured\" " + attributes + " } }")
                .definition();
        return validator.validate(definition, JsonUtil.parse(
                "{\"featured\":{\"type\":\"ASSET_REF\",\"uuid\":\"" + target + "\",\"assetType\":\"" + assetType + "\"}}"));
    }
}
