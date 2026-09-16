package com.acme.staticforge.generate.render;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.generate.pipeline.RenderedFile;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** `M16.2.2`: cross-asset values in generation, read from the build snapshot in pages and sections. */
class GenerationRendererCrossAssetValueTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final UUID PAGE_TEMPLATE = UUID.fromString("00000000-0000-0000-0000-000000000100");
    private static final UUID SECTION = UUID.fromString("00000000-0000-0000-0000-000000000101");
    private static final UUID PAGE_A = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID PAGE_B = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID LOGO = UUID.fromString("00000000-0000-0000-0000-000000000003");
    private static final UUID GONE = UUID.fromString("00000000-0000-0000-0000-000000000004");

    @Test
    void pageAndSectionTemplatesRenderOtherAssetsValues() {
        RenderedFile file = renderer(false).render(new PlanEntry(PAGE_A, "html", "a.html"));

        assertThat(text(file)).isEqualTo(
                "[B NEWS|Page B|one,two,|flag|<img alt=\"Our logo\" width=\"320\">|<p>B news</p>]");
        assertThat(file.dependencies()).contains(PAGE_B, LOGO);
        assertThat(file.diagnostics()).isEmpty();
    }

    @Test
    void softDeletedTargetRendersEmptyWithAWarning() {
        RenderedFile file = renderer(true).render(new PlanEntry(PAGE_A, "html", "a.html"));

        assertThat(text(file)).isEqualTo("[gone:]");
        assertThat(file.dependencies()).contains(GONE);
        assertThat(file.diagnostics()).extracting(Diagnostic::code).containsExactly(DiagnosticCodes.OCTL_MISSING_VALUE_TARGET);
    }

    private GenerationRenderer renderer(boolean deletedCase) {
        Map<UUID, SnapshotAsset> byUuid = new HashMap<>();
        String pageSource = deletedCase
                ? "[gone:$CMS_VALUE(page:gone.headline)$]"
                : "[$CMS_VALUE(page:b.headline | upper)$|$CMS_VALUE(page:b._meta.displayName)$"
                        + "|$CMS_FOR(l : page:b.links)$$CMS_VALUE(l.label)$,$CMS_END_FOR$"
                        + "|$CMS_IF(page:b.flag)$flag$CMS_END_IF$"
                        + "|<img alt=\"$CMS_VALUE(media:logo.altText)$\" width=\"$CMS_VALUE(media:logo.width)$\">"
                        + "|$CMS_INCLUDE(section_template:teaser)$]";
        put(byUuid, template(PAGE_TEMPLATE, AssetType.PAGE_TEMPLATE, "tpl", pageSource));
        put(byUuid, template(SECTION, AssetType.SECTION_TEMPLATE, "teaser", "<p>$CMS_VALUE(page:b.headline)$</p>"));
        put(byUuid, asset(PAGE_A, AssetType.PAGE, "a", "Page A",
                "{\"templateRef\":\"" + PAGE_TEMPLATE + "\",\"content\":{}}", false));
        put(byUuid, asset(PAGE_B, AssetType.PAGE, "b", "Page B",
                "{\"templateRef\":\"" + PAGE_TEMPLATE + "\",\"content\":{\"headline\":\"B news\",\"flag\":true,"
                        + "\"links\":[{\"label\":\"one\"},{\"label\":\"two\"}]}}", false));
        put(byUuid, asset(LOGO, AssetType.MEDIA, "logo", "Logo",
                "{\"altText\":\"Our logo\",\"mimeType\":\"image/png\",\"image\":{\"width\":320,\"height\":100}}", false));
        put(byUuid, asset(GONE, AssetType.PAGE, "gone", "Gone",
                "{\"templateRef\":\"" + PAGE_TEMPLATE + "\",\"content\":{\"headline\":\"old\"}}", true));
        Map<Long, SnapshotAsset> byId = new HashMap<>();
        byUuid.values().forEach(a -> byId.put(a.assetId(), a));
        Snapshot snapshot = new Snapshot(1L, 1L, byUuid, byId);
        return new GenerationRenderer(snapshot, OutputPathResolver.forSnapshot(snapshot, Map.of()), "proj", null);
    }

    private static void put(Map<UUID, SnapshotAsset> byUuid, SnapshotAsset asset) {
        byUuid.put(asset.uuid(), asset);
    }

    private static SnapshotAsset template(UUID uuid, AssetType type, String uid, String html) {
        return asset(uuid, type, uid, uid,
                "{\"channelTemplates\":{\"html\":{\"source\":" + MAPPER.valueToTree(html) + "}}}", false);
    }

    private static SnapshotAsset asset(UUID uuid, AssetType type, String uid, String name, String json, boolean deleted) {
        return new SnapshotAsset(uuid, uuid.getLeastSignificantBits(), type, uid, name, "/", parse(json), deleted);
    }

    private static JsonNode parse(String json) {
        try {
            return MAPPER.readTree(json);
        } catch (Exception e) {
            throw new IllegalArgumentException(e);
        }
    }

    private static String text(RenderedFile file) {
        return new String(file.bytes(), StandardCharsets.UTF_8);
    }
}
