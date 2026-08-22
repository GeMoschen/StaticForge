package com.acme.staticforge.generate.nav;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class NavRendererTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final UUID HOME = UUID.randomUUID();
    private static final UUID PRODUCTS = UUID.randomUUID();
    private static final UUID STRUCTURE = UUID.randomUUID();

    private final NavigationBuilder navigationBuilder = new NavigationBuilder();

    @Test
    void rendersNavigationWithActiveMarkingAndRecursion() {
        SnapshotAsset home = page(HOME, "home", "Home", "/", "{}");
        SnapshotAsset products = page(PRODUCTS, "products", "Products", "/products/", "{}");
        SnapshotAsset structure = structure(STRUCTURE, "main_nav", sourceText(), template());
        Snapshot snapshot = snapshot(home, products, structure);

        NavRenderer renderer = new NavRenderer(null, navigationBuilder);
        NavRenderer.NavRenderResult result = renderer.renderNav(snapshot, STRUCTURE, "main_nav", PRODUCTS, "html", null);

        assertThat(result.output()).describedAs("diagnostics=%s", result.diagnostics()).isEqualTo("[Home||R:[Products|A|]|]");
        assertThat(result.dependencies()).contains(STRUCTURE, HOME, PRODUCTS);
        assertThat(result.diagnostics()).isEmpty();
    }

    @Test
    void missingChannelTemplateRendersEmptyWithWarning() {
        SnapshotAsset structure = structure(STRUCTURE, "main_nav", sourceText(), template());
        Snapshot snapshot = snapshot(structure);

        NavRenderer renderer = new NavRenderer(null, navigationBuilder);
        NavRenderer.NavRenderResult result = renderer.renderNav(snapshot, STRUCTURE, "main_nav", PRODUCTS, "markdown", null);

        assertThat(result.output()).isEmpty();
        assertThat(result.diagnostics()).extracting(d -> d.code()).contains("SF-GEN-0210");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private static String sourceText() {
        return "navigation { source { root folder:/  depth 3  expand all } }";
    }

    private static String template() {
        return "$CMS_FOR(node : nodes)$"
                + "[$CMS_VALUE(node.label)$|"
                + "$CMS_IF(node.active)$A$CMS_END_IF$|"
                + "$CMS_IF(node.children | size > 0)$R:$CMS_NAV_RECURSE(node)$|$CMS_END_IF$]"
                + "$CMS_END_FOR$";
    }

    private static SnapshotAsset structure(UUID uuid, String uid, String sourceText, String channelTemplate) {
        ObjectNode payload = MAPPER.createObjectNode();
        payload.put("kind", "NAVIGATION");
        payload.put("sourceText", sourceText);
        ObjectNode channelTemplates = payload.putObject("channelTemplates");
        channelTemplates.withObject("html").put("source", channelTemplate);
        return new SnapshotAsset(uuid, Math.abs((long) uuid.hashCode()), AssetType.STRUCTURE, uid, uid, "/", payload, false);
    }

    private static SnapshotAsset page(UUID uuid, String uid, String displayName, String folderPath, String payloadJson) {
        return new SnapshotAsset(
                uuid,
                Math.abs((long) uuid.hashCode()),
                AssetType.PAGE,
                uid,
                displayName,
                folderPath,
                parse(payloadJson),
                false);
    }

    private static Snapshot snapshot(SnapshotAsset... assets) {
        Map<UUID, SnapshotAsset> byUuid = new HashMap<>();
        Map<Long, SnapshotAsset> byId = new HashMap<>();
        for (SnapshotAsset asset : assets) {
            byUuid.put(asset.uuid(), asset);
            byId.put(asset.assetId(), asset);
        }
        return new Snapshot(1L, 1L, byUuid, byId);
    }

    private static JsonNode parse(String json) {
        try {
            return MAPPER.readTree(json);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
