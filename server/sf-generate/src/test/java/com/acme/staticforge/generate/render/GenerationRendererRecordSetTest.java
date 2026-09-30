package com.acme.staticforge.generate.render;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.generate.pipeline.RenderedFile;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;

/**
 * {@code M25.2.2}: record sets in generation, from the build snapshot — {@code $CMS_VALUE(recordset:uid)$} through
 * the dataset's record template, set loops, a {@code reference} editor pointing at a set, sets rendered inside a
 * section, the broken-query and missing-template warnings, and the set view built in the snapshot index's single
 * pass.
 */
class GenerationRendererRecordSetTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final UUID TEMPLATE = UUID.fromString("00000000-0000-0000-0000-000000000100");
    private static final UUID SECTION = UUID.fromString("00000000-0000-0000-0000-000000000101");
    private static final UUID TEAM = UUID.fromString("00000000-0000-0000-0000-000000000200");
    private static final UUID LEADS = UUID.fromString("00000000-0000-0000-0000-000000000301");
    private static final UUID STAFF = UUID.fromString("00000000-0000-0000-0000-000000000302");
    private static final UUID BROKEN = UUID.fromString("00000000-0000-0000-0000-000000000303");
    private static final UUID GONE = UUID.fromString("00000000-0000-0000-0000-000000000304");

    private static final String TEAM_CDL =
            "content { editor text name { label \"Name\" } editor text role { label \"Role\" } }";

    @Test
    void aSetRendersThroughItsDatasetsRecordTemplateFromTheSnapshot() {
        GenerationRenderer renderer = renderer(
                "<ul>$CMS_VALUE(recordset:leads)$</ul>[$CMS_VALUE(recordset:leads._count)$]"
                        + "[$CMS_FOR(m : recordset:staff, where=\"m.role == 'dev'\")$$CMS_VALUE(m.name)$;$CMS_END_FOR$]"
                        + "[$CMS_VALUE(featured)$]",
                "<li>$CMS_VALUE(_index)$ $CMS_VALUE(name)$</li>");

        RenderedFile file = renderer.render(new PlanEntry(page(1), "html", "p1.html"));

        // Gone (soft-deleted) is in leads but never renders.
        assertThat(text(file)).isEqualTo("<ul><li>0 Ada</li><li>1 Dee</li></ul>[2][Bob;Cy;][<li>0 Ada</li><li>1 Dee</li>]");
        assertThat(file.dependencies()).contains(LEADS, STAFF, TEAM);
        assertThat(file.diagnostics()).isEmpty();
    }

    @Test
    void aSetWhoseStoredQueryNoLongerValidatesRendersEmptyWithSfGen0240() {
        GenerationRenderer renderer = renderer("[$CMS_VALUE(recordset:broken)$]", "<li>$CMS_VALUE(name)$</li>");

        RenderedFile file = renderer.render(new PlanEntry(page(1), "html", "p1.html"));

        assertThat(text(file)).isEqualTo("[]");
        assertThat(file.diagnostics()).singleElement().satisfies(d -> {
            assertThat(d.code()).isEqualTo(DiagnosticCodes.GEN_RECORD_SET_QUERY_INVALID);
            assertThat(d.message()).contains("broken").contains("removed");
        });
    }

    @Test
    void missingTemplateAndDeletedSetWarn() {
        GenerationRenderer renderer = renderer("[$CMS_VALUE(recordset:leads)$][$CMS_VALUE(recordset:gone)$]", null);

        RenderedFile file = renderer.render(new PlanEntry(page(1), "html", "p1.html"));

        assertThat(text(file)).isEqualTo("[][]");
        assertThat(file.diagnostics()).extracting(Diagnostic::code).containsExactlyInAnyOrder(
                DiagnosticCodes.GEN_RECORD_TEMPLATE_MISSING, DiagnosticCodes.OCTL_MISSING_VALUE_TARGET);
    }

    @Test
    void aSetInsideASectionRendersInThePagesLanguage() {
        GenerationRenderer renderer = renderer(
                "$CMS_BODY(main)$", "<li>$CMS_VALUE(name)$ ($CMS_VALUE(role)$)</li>")
                .withLocales(LocaleConfig.of(
                        List.of(new ProjectLocale("en", "English"), new ProjectLocale("de", "Deutsch")),
                        "en",
                        Map.of("de", List.of("en")),
                        true));

        RenderedFile german = renderer.render(new PlanEntry(page(1), "html", "de/p1.html", null, "de"));
        RenderedFile english = renderer.render(new PlanEntry(page(1), "html", "p1.html", null, "en"));

        assertThat(text(german)).isEqualTo("<section><li>Ada (Leitung)</li></section>");
        assertThat(text(english)).isEqualTo("<section><li>Ada (Lead)</li></section>");
    }

    @Test
    void setsShareTheRecordIndexBuiltOncePerSnapshotAcrossConcurrentRenders() throws Exception {
        GenerationRenderer renderer = renderer(
                "$CMS_VALUE(recordset:leads)$$CMS_FOR(m : dataset:team, sort=\"name\")$,$CMS_VALUE(m.name)$$CMS_END_FOR$",
                "$CMS_VALUE(name)$");

        try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<RenderedFile>> renders = new ArrayList<>();
            for (int i = 1; i <= 30; i++) {
                PlanEntry entry = new PlanEntry(page(i), "html", "p" + i + ".html");
                renders.add(pool.submit(() -> renderer.render(entry)));
            }
            for (Future<RenderedFile> render : renders) {
                assertThat(text(render.get())).isEqualTo("AdaDee,Ada,Bob,Cy,Dee,Fay");
            }
        }

        assertThat(renderer.recordIndexBuilds()).isEqualTo(1);
    }

    // ------------------------------------------------------------------
    // Snapshot
    // ------------------------------------------------------------------

    /**
     * Pages 1..30 of a template with {@code source}; dataset {@code team} with an html record template (none when
     * {@code recordTemplate} is {@code null}) and sets {@code leads} (by name), {@code staff},
     * {@code broken} (a query on a removed field) and the soft-deleted {@code gone}. Page 1's body {@code main} holds
     * a section rendering {@code leads} (Ada's role is language-dependent there).
     */
    private GenerationRenderer renderer(String source, String recordTemplate) {
        Map<UUID, SnapshotAsset> byUuid = new HashMap<>();
        put(byUuid, asset(TEMPLATE, AssetType.PAGE_TEMPLATE, "tpl", "/",
                "{\"contentCdl\":\"editor reference featured { label \\\"F\\\" }\",\"bodiesCdl\":\"body main { }\","
                        + "\"channelTemplates\":{\"html\":{\"source\":" + MAPPER.valueToTree(source) + "}}}"));
        put(byUuid, asset(SECTION, AssetType.SECTION_TEMPLATE, "sec", "/",
                "{\"channelTemplates\":{\"html\":{\"source\":\"<section>$CMS_VALUE(recordset:leads)$</section>\"}}}"));
        ObjectNode team = MAPPER.createObjectNode();
        CdlSources.split(TEAM_CDL).writeTo(team);
        if (recordTemplate != null) {
            team.putObject("channelTemplates").putObject("html").put("source", recordTemplate);
        }
        put(byUuid, asset(TEAM, AssetType.DATASET, "team", "/templates_root/datasets/", team.toString()));
        put(byUuid, set(LEADS, "leads", "{\"sort\":\"name\"}", false));
        put(byUuid, set(STAFF, "staff", "{}", false));
        put(byUuid, set(BROKEN, "broken", "{\"where\":\"removed == 1\"}", false));
        put(byUuid, set(GONE, "gone", "{}", true));
        boolean localized = source.contains("$CMS_BODY");
        String adaRole = localized ? "{\"type\":\"L10N\",\"values\":{\"de\":\"Leitung\",\"en\":\"Lead\"}}" : "\"lead\"";
        put(byUuid, record(new UUID(0, 401), "ada", LEADS, "{\"name\":\"Ada\",\"role\":" + adaRole + "}", false));
        put(byUuid, record(new UUID(0, 402), "dee", LEADS, "{\"name\":\"Dee\",\"role\":\"lead\"}", localized));
        put(byUuid, record(new UUID(0, 403), "gone", LEADS, "{\"name\":\"Gone\",\"role\":\"lead\"}", true));
        put(byUuid, record(new UUID(0, 404), "bob", STAFF, "{\"name\":\"Bob\",\"role\":\"dev\"}", false));
        put(byUuid, record(new UUID(0, 405), "cy", STAFF, "{\"name\":\"Cy\",\"role\":\"dev\"}", false));
        put(byUuid, record(new UUID(0, 406), "fay", BROKEN, "{\"name\":\"Fay\",\"role\":\"lead\"}", false));
        for (int i = 1; i <= 30; i++) {
            put(byUuid, asset(page(i), AssetType.PAGE, "p" + i, "/pages_root/",
                    "{\"templateRef\":\"" + TEMPLATE + "\",\"content\":{\"featured\":{\"type\":\"ASSET_REF\",\"uuid\":\""
                            + LEADS + "\",\"assetType\":\"RECORD_SET\"}},\"bodies\":{\"main\":[{\"instanceId\":\"i1\","
                            + "\"templateRef\":\"" + SECTION + "\",\"content\":{}}]}}"));
        }
        Map<Long, SnapshotAsset> byId = new HashMap<>();
        byUuid.values().forEach(a -> byId.put(a.assetId(), a));
        Snapshot snapshot = new Snapshot(1L, 1L, byUuid, byId);
        return new GenerationRenderer(snapshot, OutputPathResolver.forSnapshot(snapshot, Map.of()), "proj", null);
    }

    private static UUID page(int i) {
        return new UUID(0, 1000 + i);
    }

    private static SnapshotAsset asset(UUID uuid, AssetType type, String uid, String folder, String json) {
        return new SnapshotAsset(uuid, uuid.getLeastSignificantBits(), type, uid, uid, folder, parse(json), false);
    }

    private static SnapshotAsset set(UUID uuid, String uid, String query, boolean deleted) {
        return new SnapshotAsset(uuid, uuid.getLeastSignificantBits(), AssetType.RECORD_SET, uid, uid, "/content_root/",
                parse("{\"datasetRef\":\"" + TEAM + "\",\"query\":" + query + "}"), deleted);
    }

    /** A record in the record set {@code set}, which the snapshot holds by its asset id. */
    private static SnapshotAsset record(UUID uuid, String uid, UUID set, String content, boolean deleted) {
        return new SnapshotAsset(uuid, uuid.getLeastSignificantBits(), AssetType.RECORD, uid, uid, "/content_root/",
                parse("{\"datasetRef\":\"" + TEAM + "\",\"content\":" + content + "}"), deleted, Instant.EPOCH,
                set.getLeastSignificantBits());
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
