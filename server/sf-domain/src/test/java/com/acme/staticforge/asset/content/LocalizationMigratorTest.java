package com.acme.staticforge.asset.content;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.common.JsonUtil;
import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.cdl.CdlResult;
import com.acme.staticforge.template.content.ContentDefinition;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** The {@code localizable} wrap/unwrap migration (M24.2.2). */
class LocalizationMigratorTest {

    private static final LocalizationContext DE_EN = new LocalizationContext(true, "de", List.of("de", "en"));

    private static ContentDefinition definition(String cdl) {
        CdlResult result = new CdlCompiler().compile(cdl);
        assertThat(result.diagnostics()).isEmpty();
        return result.definition();
    }

    private static final ContentDefinition LOCALIZED = definition(
            """
            content {
              editor text headline { label "Headline" localizable }
              editor text sku { label "SKU" }
            }
            """);

    private static final ContentDefinition PLAIN = definition(
            """
            content {
              editor text headline { label "Headline" }
              editor text sku { label "SKU" }
            }
            """);

    private static ObjectNode content(String json) {
        return (ObjectNode) JsonUtil.parse(json);
    }

    @Test
    @DisplayName("off -> on wraps the bare value under the default locale")
    void wrapsOnEnable() {
        ObjectNode node = content("{\"headline\":\"Die Parka\",\"sku\":\"A-1\"}");

        LocalizationMigrator.Plan plan = LocalizationMigrator.normalize(node, LOCALIZED, DE_EN, true);

        assertThat(plan.changed()).isTrue();
        assertThat(plan.requiresConfirmation()).isFalse();
        assertThat(node.toString())
                .isEqualTo("{\"headline\":{\"type\":\"L10N\",\"values\":{\"de\":\"Die Parka\"}},\"sku\":\"A-1\"}");
    }

    @Test
    @DisplayName("wrapping is idempotent")
    void wrapIsIdempotent() {
        ObjectNode node = content("{\"headline\":{\"type\":\"L10N\",\"values\":{\"de\":\"Die Parka\"}}}");

        LocalizationMigrator.Plan plan = LocalizationMigrator.normalize(node, LOCALIZED, DE_EN, true);

        assertThat(plan.changed()).isFalse();
        assertThat(node.toString()).isEqualTo("{\"headline\":{\"type\":\"L10N\",\"values\":{\"de\":\"Die Parka\"}}}");
    }

    @Test
    @DisplayName("an absent value is not given empty scaffolding")
    void absentValueUntouched() {
        ObjectNode node = content("{\"sku\":\"A-1\"}");

        assertThat(LocalizationMigrator.normalize(node, LOCALIZED, DE_EN, true).changed()).isFalse();
        assertThat(node.has("headline")).isFalse();
    }

    @Test
    @DisplayName("on -> off keeps the default locale and reports the discarded translations")
    void unwrapReportsDiscards() {
        String json = "{\"headline\":{\"type\":\"L10N\",\"values\":{\"de\":\"Die Parka\",\"en\":\"The parka\"}}}";

        // Dry run reports without touching the content.
        ObjectNode preview = content(json);
        LocalizationMigrator.Plan plan = LocalizationMigrator.preview(preview, PLAIN, DE_EN);
        assertThat(plan.changed()).isTrue();
        assertThat(plan.requiresConfirmation()).isTrue();
        assertThat(plan.discards()).containsExactly(new LocalizationMigrator.Discard("headline", List.of("en")));
        assertThat(preview.toString()).isEqualTo(json);

        // Confirmed run unwraps to the default locale.
        ObjectNode applied = content(json);
        LocalizationMigrator.normalize(applied, PLAIN, DE_EN, true);
        assertThat(applied.toString()).isEqualTo("{\"headline\":\"Die Parka\"}");
    }

    @Test
    @DisplayName("unwrapping without a default-locale value falls back and discards the rest")
    void unwrapFallsBack() {
        ObjectNode node = content("{\"headline\":{\"type\":\"L10N\",\"values\":{\"en\":\"The parka\",\"fr\":\"Le parka\"}}}");

        LocalizationMigrator.Plan plan = LocalizationMigrator.normalize(node, PLAIN, DE_EN, true);

        assertThat(node.toString()).isEqualTo("{\"headline\":\"The parka\"}");
        assertThat(plan.discards()).containsExactly(new LocalizationMigrator.Discard("headline", List.of("fr")));
    }

    @Test
    @DisplayName("an empty wrapper unwraps to nothing without a discard report")
    void unwrapEmptyWrapper() {
        ObjectNode node = content("{\"headline\":{\"type\":\"L10N\",\"values\":{}}}");

        LocalizationMigrator.Plan plan = LocalizationMigrator.normalize(node, PLAIN, DE_EN, true);

        assertThat(plan.changed()).isTrue();
        assertThat(plan.requiresConfirmation()).isFalse();
        assertThat(node.has("headline")).isFalse();
    }

    @Test
    @DisplayName("a project losing its locales unwraps every localizable editor")
    void projectLosingLocales() {
        ObjectNode node = content("{\"headline\":{\"type\":\"L10N\",\"values\":{\"de\":\"Die Parka\",\"en\":\"The parka\"}}}");

        LocalizationMigrator.Plan plan =
                LocalizationMigrator.normalize(node, LOCALIZED, LocalizationContext.NONE, true);

        assertThat(plan.requiresConfirmation()).isTrue();
        assertThat(node.toString()).isEqualTo("{\"headline\":\"Die Parka\"}");
    }

    @Test
    @DisplayName("leaves inside groups and list items migrate too")
    void nestedLeaves() {
        ContentDefinition def = definition(
                """
                content {
                  group "Meta" {
                    editor text title { label "Title" localizable }
                  }
                  editor list links {
                    label "Links"
                    item {
                      editor text caption { label "Caption" localizable }
                      editor link target { label "Target" }
                    }
                  }
                }
                """);
        ObjectNode node = content(
                "{\"title\":\"Titel\",\"links\":[{\"caption\":\"Eins\"},{\"caption\":\"Zwei\"}]}");

        assertThat(LocalizationMigrator.normalize(node, def, DE_EN, true).changed()).isTrue();

        assertThat(node.at("/title/values/de").asText()).isEqualTo("Titel");
        assertThat(node.at("/links/0/caption/values/de").asText()).isEqualTo("Eins");
        assertThat(node.at("/links/1/caption/values/de").asText()).isEqualTo("Zwei");
    }

    @Test
    @DisplayName("a discard inside a list item is reported with its indexed path")
    void nestedDiscardPath() {
        ContentDefinition def = definition(
                """
                content {
                  editor list links {
                    label "Links"
                    item { editor text caption { label "Caption" } }
                  }
                }
                """);
        ObjectNode node = content(
                "{\"links\":[{\"caption\":{\"type\":\"L10N\",\"values\":{\"de\":\"Eins\",\"en\":\"One\"}}}]}");

        LocalizationMigrator.Plan plan = LocalizationMigrator.preview(node, def, DE_EN);

        assertThat(plan.discards()).containsExactly(new LocalizationMigrator.Discard("links[0].caption", List.of("en")));
    }

    @Test
    @DisplayName("catalog cards are left to their own section template's migration")
    void catalogCardsUntouched() {
        ContentDefinition def = definition(
                """
                content {
                  editor catalog cards { label "Cards" }
                }
                """);
        String json = "{\"cards\":{\"type\":\"CATALOG\",\"cards\":[{\"instanceId\":\"i1\",\"templateRef\":\"t1\","
                + "\"content\":{\"headline\":{\"type\":\"L10N\",\"values\":{\"de\":\"a\",\"en\":\"b\"}}}}]}}";
        ObjectNode node = content(json);

        assertThat(LocalizationMigrator.normalize(node, def, DE_EN, true).changed()).isFalse();
        assertThat(node.toString()).isEqualTo(json);
    }
}
