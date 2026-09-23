package com.acme.staticforge.generate.render;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.generate.pipeline.RenderedFile;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;

/** `M19.3.2`: dataset loops, record values and dereferencing in generation, from the build snapshot. */
class GenerationRendererDatasetTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final UUID TEMPLATE = UUID.fromString("00000000-0000-0000-0000-000000000100");
    private static final UUID TEAM = UUID.fromString("00000000-0000-0000-0000-000000000200");
    private static final UUID ADA = UUID.fromString("00000000-0000-0000-0000-000000000201");
    private static final UUID BOB = UUID.fromString("00000000-0000-0000-0000-000000000202");
    private static final UUID GONE = UUID.fromString("00000000-0000-0000-0000-000000000203");
    private static final UUID OTHER = UUID.fromString("00000000-0000-0000-0000-000000000204");
    private static final UUID LEADS = UUID.fromString("00000000-0000-0000-0000-000000000301");
    private static final UUID MEMBERS = UUID.fromString("00000000-0000-0000-0000-000000000302");

    @Test
    void loopsRecordValuesAndDereferencesReadTheSnapshot() {
        GenerationRenderer renderer = renderer(
                "[$CMS_FOR(m : dataset:team, sort=\"-name\")$$CMS_VALUE(m.name)$@$CMS_VALUE(m._folderPath)$"
                        + "/$CMS_VALUE(m._recordSet)$;$CMS_END_FOR$]"
                        + "[$CMS_VALUE(record:ada.name)$][$CMS_VALUE(boss.name)$][$CMS_VALUE(record:gone.name)$]");

        RenderedFile file = renderer.render(new PlanEntry(page(1), "html", "p1.html"));

        assertThat(text(file)).isEqualTo("[Bob@/team//members;Ada@/team/leads//leads;][Ada][Bob][]");
        assertThat(file.dependencies()).contains(TEAM, ADA, BOB);
    }

    @Test
    void theRecordIndexIsBuiltOncePerSnapshotAcrossConcurrentRenders() throws Exception {
        GenerationRenderer renderer = renderer("$CMS_FOR(m : dataset:team)$$CMS_VALUE(m.name)$$CMS_END_FOR$");

        try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor()) {
            java.util.List<Future<RenderedFile>> renders = new java.util.ArrayList<>();
            for (int i = 1; i <= 50; i++) {
                PlanEntry entry = new PlanEntry(page(i), "html", "p" + i + ".html");
                renders.add(pool.submit(() -> renderer.render(entry)));
            }
            for (Future<RenderedFile> render : renders) {
                assertThat(text(render.get())).isEqualTo("AdaBob");
            }
        }

        assertThat(renderer.recordIndexBuilds()).isEqualTo(1);
    }

    private GenerationRenderer renderer(String source) {
        Map<UUID, SnapshotAsset> byUuid = new HashMap<>();
        put(byUuid, asset(TEMPLATE, AssetType.PAGE_TEMPLATE, "tpl", "/",
                "{\"channelTemplates\":{\"html\":{\"source\":" + MAPPER.valueToTree(source) + "}}}", false));
        put(byUuid, asset(TEAM, AssetType.DATASET, "team", "/templates_root/datasets/", "{}", false));
        put(byUuid, asset(LEADS, AssetType.RECORD_SET, "leads", "/content_root/team/leads/", "{\"datasetRef\":\"" + TEAM + "\"}", false));
        put(byUuid, asset(MEMBERS, AssetType.RECORD_SET, "members", "/content_root/team/", "{\"datasetRef\":\"" + TEAM + "\"}", false));
        put(byUuid, record(ADA, "ada", "/content_root/team/leads/", LEADS, "{\"name\":\"Ada\"}", TEAM, false));
        put(byUuid, record(BOB, "bob", "/content_root/team/", MEMBERS, "{\"name\":\"Bob\"}", TEAM, false));
        put(byUuid, record(GONE, "gone", "/content_root/team/", MEMBERS, "{\"name\":\"Gone\"}", TEAM, true));
        put(byUuid, record(OTHER, "other", "/content_root/", null, "{\"name\":\"Other\"}", UUID.randomUUID(), false));
        for (int i = 1; i <= 50; i++) {
            put(byUuid, asset(page(i), AssetType.PAGE, "p" + i, "/pages_root/",
                    "{\"templateRef\":\"" + TEMPLATE + "\",\"content\":{\"boss\":{\"type\":\"ASSET_REF\",\"uuid\":\""
                            + BOB + "\",\"assetType\":\"RECORD\"}}}",
                    false));
        }
        Map<Long, SnapshotAsset> byId = new HashMap<>();
        byUuid.values().forEach(a -> byId.put(a.assetId(), a));
        Snapshot snapshot = new Snapshot(1L, 1L, byUuid, byId);
        return new GenerationRenderer(snapshot, OutputPathResolver.forSnapshot(snapshot, Map.of()), "proj", null);
    }

    private static UUID page(int i) {
        return new UUID(0, 1000 + i);
    }

    private static SnapshotAsset asset(UUID uuid, AssetType type, String uid, String folder, String json, boolean deleted) {
        return new SnapshotAsset(uuid, uuid.getLeastSignificantBits(), type, uid, uid, folder, parse(json), deleted);
    }

    /** A record in the record set {@code set} (M25), which the snapshot holds by its asset id. */
    private static SnapshotAsset record(
            UUID uuid, String uid, String folder, UUID set, String content, UUID dataset, boolean deleted) {
        return new SnapshotAsset(uuid, uuid.getLeastSignificantBits(), AssetType.RECORD, uid, uid, folder,
                parse("{\"datasetRef\":\"" + dataset + "\",\"content\":" + content + "}"), deleted, Instant.EPOCH,
                set == null ? null : set.getLeastSignificantBits());
    }

    private static void put(Map<UUID, SnapshotAsset> byUuid, SnapshotAsset asset) {
        byUuid.put(asset.uuid(), asset);
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
