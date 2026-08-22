package com.acme.staticforge.generate.render;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** {@link OutputPathResolver} against the §18.3 worked examples. */
class OutputPathResolverTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final UUID PAGE = UUID.randomUUID();
    private static final UUID PAGE_B = UUID.randomUUID();
    private static final UUID TEMPLATE = UUID.randomUUID();

    @Test
    void defaultExpressionIsFolderUidExt() {
        SnapshotAsset page = page(PAGE, "hammer", "hammer", "/products/", "{}", null);
        OutputPathResolver resolver = resolver(snapshot(page), "index", false, "RELATIVE");

        assertThat(resolver.resolvePagePath(PAGE, "html")).isEqualTo("products/hammer.html");
        assertThat(resolver.resolvePagePath(PAGE, "markdown")).isEqualTo("products/hammer.md");
    }

    @Test
    void pathOverrideWinsOverTemplate() {
        SnapshotAsset template = template("{\"outputPath\":{\"html\":\"{folder}{uid}.html\"}}");
        SnapshotAsset page = page(
                PAGE, "hammer", "hammer", "/products/", "{\"output\":{\"pathOverride\":{\"html\":\"custom/landing.html\"}}}", TEMPLATE);
        OutputPathResolver resolver = resolver(snapshot(page, template), "index", false, "RELATIVE");

        assertThat(resolver.resolvePagePath(PAGE, "html")).isEqualTo("custom/landing.html");
    }

    @Test
    void prettyTrailingSlashMovesIndexIntoDirectory() {
        SnapshotAsset page = page(PAGE, "hammer", "hammer", "/products/", "{}", null);
        OutputPathResolver resolver = resolver(snapshot(page), "index", true, "PRETTY");

        assertThat(resolver.resolvePagePath(PAGE, "html")).isEqualTo("products/hammer/index.html");
        assertThat(resolver.resolvePageUrl(PAGE, "html")).isEqualTo("products/hammer/");
    }

    @Test
    void indexPageStaysAtFolderRootEvenWithPretty() {
        SnapshotAsset page = page(PAGE, "index", "index", "/", "{}", null);
        OutputPathResolver resolver = resolver(snapshot(page), "index", true, "PRETTY");

        assertThat(resolver.resolvePagePath(PAGE, "html")).isEqualTo("index.html");
    }

    @Test
    void expandsPlaceholders() {
        SnapshotAsset template = template("{\"outputPath\":{\"html\":\"{folder}{displayNameSlug}-{year}-{month}-{day}.{ext}\"}}");
        SnapshotAsset page = page(
                PAGE, "hammer", "Hammer Drill", "/products/", "{\"nav\":{\"date\":\"2026-08-20\"}}", TEMPLATE);
        OutputPathResolver resolver = resolver(snapshot(page, template), "index", false, "RELATIVE");

        assertThat(resolver.resolvePagePath(PAGE, "html")).isEqualTo("products/hammer-drill-2026-08-20.html");
    }

    @Test
    void collisionListsBothAssetUids() {
        SnapshotAsset pageA = page(PAGE, "a", "a", "/", "{\"output\":{\"pathOverride\":{\"html\":\"dupe.html\"}}}", null);
        SnapshotAsset pageB = page(PAGE_B, "b", "b", "/", "{\"output\":{\"pathOverride\":{\"html\":\"dupe.html\"}}}", null);
        OutputPathResolver resolver = resolver(snapshot(pageA, pageB), "index", false, "RELATIVE");

        List<OutputPathResolver.Collision> collisions = resolver.findCollisions(List.of(
                new PlanEntry(PAGE, "html", "dupe.html"),
                new PlanEntry(PAGE_B, "html", "dupe.html")));

        assertThat(collisions).containsExactly(new OutputPathResolver.Collision("dupe.html", "a", "b"));
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private static OutputPathResolver resolver(Snapshot snapshot, String indexUid, boolean trailingSlash, String strategy) {
        return OutputPathResolver.forSnapshot(snapshot, indexUid, trailingSlash, strategy);
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

    private static SnapshotAsset template(String payloadJson) {
        return new SnapshotAsset(
                TEMPLATE, 9001L, AssetType.PAGE_TEMPLATE, "", "", "/", parse(payloadJson), false);
    }

    private static SnapshotAsset page(
            UUID uuid, String uid, String displayName, String folderPath, String payloadJson, UUID templateUuid) {
        JsonNode payload = parse(payloadJson);
        if (templateUuid != null) {
            ((ObjectNode) payload).put("templateRef", templateUuid.toString());
        }
        return new SnapshotAsset(uuid, Math.abs((long) uuid.hashCode()), AssetType.PAGE, uid, displayName, folderPath, payload, false);
    }

    private static JsonNode parse(String json) {
        try {
            return MAPPER.readTree(json);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
