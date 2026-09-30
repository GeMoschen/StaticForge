package com.acme.staticforge.asset.content;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetType;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

/** `M16.2.2`: the root value object per asset type shared by generation and preview. */
class AssetValueProjectionTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void pageExposesEditorValuesAndMetaButNoInternalPayload() throws Exception {
        JsonNode payload = MAPPER.readTree(
                "{\"templateRef\":\"x\",\"content\":{\"headline\":\"Hi\",\"links\":[{\"label\":\"A\"}]},"
                        + "\"bodies\":{\"main\":[]},\"nav\":{},\"output\":{},\"meta\":{}}");

        JsonNode root = AssetValueProjection.project(AssetType.PAGE, "about", "About", payload, false);

        assertThat(root.path("headline").asText()).isEqualTo("Hi");
        assertThat(root.path("links").path(0).path("label").asText()).isEqualTo("A");
        assertThat(root.path("_meta").path("uid").asText()).isEqualTo("about");
        assertThat(root.path("_meta").path("displayName").asText()).isEqualTo("About");
        assertThat(root.has("bodies") || root.has("templateRef") || root.has("nav") || root.has("output")).isFalse();
        assertThat(payload.path("content").has("_meta")).as("the stored payload is never mutated").isFalse();
    }

    @Test
    void mediaIsAFlatObjectOfDescriptiveFields() throws Exception {
        JsonNode payload = MAPPER.readTree(
                "{\"blobSha256\":\"abc\",\"fileName\":\"logo.png\",\"mimeType\":\"image/png\",\"sizeBytes\":42,"
                        + "\"image\":{\"width\":320,\"height\":200,\"orientation\":1},"
                        + "\"altText\":\"Logo\",\"caption\":\"c\",\"copyright\":\"(c)\",\"focalPoint\":{\"x\":0.5,\"y\":0.5},"
                        + "\"variants\":[{\"name\":\"w400\"}]}");

        JsonNode root = AssetValueProjection.project(AssetType.MEDIA, "logo", "Logo", payload, false);

        assertThat(root.path("altText").asText()).isEqualTo("Logo");
        assertThat(root.path("width").asInt()).isEqualTo(320);
        assertThat(root.path("height").asInt()).isEqualTo(200);
        assertThat(root.path("fileName").asText()).isEqualTo("logo.png");
        assertThat(root.path("mimeType").asText()).isEqualTo("image/png");
        assertThat(root.has("blobSha256") || root.has("variants") || root.has("image")).isFalse();
    }

    @Test
    void pageReferenceExposesLabelAndTemplatesAndFoldersOnlyMeta() throws Exception {
        JsonNode reference = AssetValueProjection.project(
                AssetType.PAGE_REFERENCE, "ref", "Ref",
                MAPPER.readTree("{\"label\":\"Go\",\"target\":{\"kind\":\"PAGE\"}}"), false);
        assertThat(reference.path("label").asText()).isEqualTo("Go");
        assertThat(reference.has("target")).isFalse();

        JsonNode template = AssetValueProjection.project(
                AssetType.SECTION_TEMPLATE, "teaser", "Teaser", MAPPER.readTree("{\"contentCdl\":\"x\"}"), false);
        assertThat(template.fieldNames()).toIterable().containsExactly("_meta");
        assertThat(AssetValueProjection.project(AssetType.FOLDER, "f", "F", null, false).fieldNames())
                .toIterable().containsExactly("_meta");
    }

    /**
     * {@code M17.3.1}: a property set exposes its values just like a page, and nothing else — a
     * template reads {@code CMS_GLOBAL.site.title}, never the set's own CDL.
     */
    @Test
    void globalSetExposesItsValuesButNeverItsSchema() throws Exception {
        JsonNode payload = MAPPER.readTree(
                "{\"contentCdl\":\"editor text title { label \\\"T\\\" }\","
                        + "\"compiledDefinition\":{\"editors\":[]},"
                        + "\"content\":{\"title\":\"Acme Outdoor\",\"showBanner\":true}}");

        JsonNode root = AssetValueProjection.project(AssetType.GLOBAL_SET, "site", "Site", payload, false);

        assertThat(root.path("title").asText()).isEqualTo("Acme Outdoor");
        assertThat(root.path("showBanner").asBoolean()).isTrue();
        assertThat(root.path("_meta").path("uid").asText()).isEqualTo("site");
        assertThat(root.has("contentCdl") || root.has("compiledDefinition")).isFalse();
    }

    @Test
    void deletedAssetIsMissing() {
        assertThat(AssetValueProjection.project(AssetType.PAGE, "gone", "Gone", MAPPER.createObjectNode(), true).isMissingNode())
                .isTrue();
    }
}
