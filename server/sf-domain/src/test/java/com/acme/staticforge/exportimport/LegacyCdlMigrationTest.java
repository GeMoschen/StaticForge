package com.acme.staticforge.exportimport;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.common.JsonUtil;
import com.acme.staticforge.template.cdl.CdlSources;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import org.junit.jupiter.api.Test;

/** An archive written before M34 keeps the whole CDL in {@code contentDefinition}; the import splits it (M34 follow-up). */
class LegacyCdlMigrationTest {

    private static final String OLD_CDL = """
            content {
              editor text title { label "Title" required }
            }
            bodies {
              body main { allow [hero] }
            }
            rules {
              rule "one-hero" on page { level error assert "true" }
            }
            """;

    private static JsonNode payload(String json) {
        return JsonUtil.parse(json);
    }

    private static JsonNode old(String cdl) {
        com.fasterxml.jackson.databind.node.ObjectNode node = com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode();
        node.put("contentDefinition", cdl);
        node.put("category", "Blog");
        return node;
    }

    @Test
    void splitsAnOldPageTemplateIntoItsThreeSections() {
        JsonNode migrated = LegacyCdlMigration.migrate(old(OLD_CDL));

        assertThat(migrated.has("contentDefinition")).isFalse();
        CdlSources sources = CdlSources.of(migrated);
        assertThat(sources.content()).contains("editor text title").doesNotContain("bodies");
        assertThat(sources.bodies()).contains("body main");
        assertThat(sources.rules()).contains("rule \"one-hero\"");
        assertThat(migrated.path("category").asText()).isEqualTo("Blog");
    }

    @Test
    void keepsOnlyTheSectionsAnOldSectionTemplateOrDatasetHas() {
        JsonNode migrated = LegacyCdlMigration.migrate(old("content {\n  editor text name { label \"Name\" }\n}\n"));

        CdlSources sources = CdlSources.of(migrated);
        assertThat(sources.content()).contains("editor text name");
        assertThat(sources.bodies()).isEmpty();
        assertThat(sources.rules()).isEmpty();
    }

    @Test
    void anEmptyOldDefinitionBecomesEmptySections() {
        JsonNode migrated = LegacyCdlMigration.migrate(old(""));

        assertThat(CdlSources.presentIn(migrated)).isTrue();
        assertThat(CdlSources.of(migrated)).isEqualTo(CdlSources.EMPTY);
    }

    @Test
    void leavesAPayloadOfTheCurrentShapeAlone() {
        JsonNode current = payload("{\"contentCdl\":\"editor text a { }\",\"bodiesCdl\":\"\",\"rulesCdl\":\"\"}");

        assertThat(LegacyCdlMigration.migrate(current)).isSameAs(current);
    }

    @Test
    void leavesAssetsWithoutCdlAlone() {
        JsonNode media = payload("{\"mimeType\":\"image/png\"}");

        assertThat(LegacyCdlMigration.migrate(media)).isSameAs(media);
        assertThat(LegacyCdlMigration.migrate((JsonNode) null)).isNull();
    }

    @Test
    void migratesTheCurrentPayloadAndEveryReleasePayloadOfAnAsset() {
        ExportedRelease released = new ExportedRelease(
                "", ExportedRelease.State.PAYLOAD, null, old("content {\n  editor text old { }\n}\n"), null, null, null, null, null, null);
        ExportedRelease same = new ExportedRelease("de", ExportedRelease.State.DRAFT_EQUALS, null, null, null, null, null, null, null, null);
        ExportedAsset asset = new ExportedAsset(
                "u1", "PAGE_TEMPLATE", "article", "Article", null, "/templates/", null, old(OLD_CDL), null, null, true,
                List.of(released, same), false);

        ExportedAsset migrated = LegacyCdlMigration.migrate(asset);

        assertThat(CdlSources.of(migrated.payload()).bodies()).contains("body main");
        assertThat(migrated.release().get(0).payload().has("contentDefinition")).isFalse();
        assertThat(CdlSources.of(migrated.release().get(0).payload()).content()).contains("editor text old");
        assertThat(migrated.release().get(1)).isSameAs(same);
        assertThat(migrated.uuid()).isEqualTo("u1");
    }

    @Test
    void anAssetNeedingNoMigrationIsReturnedAsIs() {
        ExportedAsset asset = new ExportedAsset(
                "u2", "MEDIA", "hero", "Hero", null, "/media/", null, payload("{\"mimeType\":\"image/png\"}"), null, null, true,
                List.of(), false);

        assertThat(LegacyCdlMigration.migrate(asset)).isSameAs(asset);
    }
}
