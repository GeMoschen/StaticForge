package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.reference.ReferenceEdge;
import com.acme.staticforge.asset.reference.ReferenceMaterializer;
import com.acme.staticforge.audit.AuditLog;
import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationRunRepository;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.target.BuildManifest;
import com.acme.staticforge.generate.target.TargetWriter;
import com.acme.staticforge.generate.target.TargetWriterSelector;
import com.acme.staticforge.housekeeping.JobOutcome;
import com.acme.staticforge.housekeeping.JobTrigger;
import com.acme.staticforge.housekeeping.SystemJobRun;
import com.acme.staticforge.housekeeping.SystemJobRunRepository;
import com.acme.staticforge.housekeeping.SystemJobRunner;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.AssetReleaseRepository;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.compaction.CompactionPolicyService;
import com.acme.staticforge.revision.compaction.CompactionResult;
import com.acme.staticforge.revision.compaction.RevisionCompactor;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Revision compaction (M29.4.2, epic decision 13) on the real schema: the five-versions-on-a-day fixture, every kind of
 * protected version, the open-version rule, references and blobs, and the {@code revision-compaction} job (dry run ==
 * real run, idempotent, audited, reported, estimated). History is back-dated through {@code revision.created_at}.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class RevisionCompactionIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final Instant DAY_1 = CompactionFixtures.DAY_1;
    private static final Instant DAY_2 = DAY_1.plus(Duration.ofDays(1));
    private static final Instant CUTOFF = DAY_1.plus(Duration.ofDays(60));

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-compaction");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService users;
    @Autowired ProjectService projects;
    @Autowired AssetService assets;
    @Autowired MediaService media;
    @Autowired ReleaseService releases;
    @Autowired AssetReleaseRepository releaseRows;
    @Autowired ReferenceMaterializer materializer;
    @Autowired RevisionCompactor compactor;
    @Autowired CompactionPolicyService policies;
    @Autowired CompactionFixtures history;
    @Autowired SchedulerFixtures schedules;
    @Autowired GenerationTargetRepository targets;
    @Autowired GenerationRunRepository runs;
    @Autowired TargetWriterSelector writers;
    @Autowired SystemJobRunner runner;
    @Autowired SystemJobRunRepository jobRuns;
    @Autowired AuditService audit;
    @Autowired JwtService jwt;
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;

    private final ObjectMapper mapper = new ObjectMapper();

    private record Fx(Project project, AppUser user) {
        long id() {
            return project.getId();
        }

        String key() {
            return project.getKey();
        }

        RevisionContext ctx() {
            return RevisionContext.of(project.getId(), user.getId(), "compaction");
        }
    }

    // ------------------------------------------------------------------
    // The unit fixture
    // ------------------------------------------------------------------

    @Test
    @DisplayName("5 versions on day D, the 2nd released (closed row), the 5th last: 1 → 2, 3 and 4 → 5; reads and marks")
    void fiveVersionsOnOneDay() {
        Fx fx = fixture("cmpfive");
        UUID page = page(fx, "v1");
        long r1 = history.head(fx.id());
        long r2 = edit(fx, page, "v2");
        long released = release(fx, page);
        long r3 = edit(fx, page, "v3");
        long r4 = edit(fx, page, "v4");
        long r5 = edit(fx, page, "v5");
        long dayEnd = history.head(fx.id());
        long r6 = edit(fx, page, "v6");
        release(fx, page); // closes v2's release row
        long head = history.head(fx.id());
        history.backdate(fx.id(), 1, dayEnd, DAY_1);
        history.backdate(fx.id(), dayEnd + 1, head, DAY_2);
        long assetId = history.assetId(fx.id(), page);
        List<AssetVersion> before = history.versions(assetId);
        assertThat(releaseRows.findByProjectIdOrderByAssetIdAscLocaleKeyAscValidFromRevisionAsc(fx.id()))
                .anySatisfy(row -> {
                    assertThat(row.getReleasedVersionId()).isEqualTo(before.get(1).getId());
                    assertThat(row.getValidToRevision()).isNotNull();
                });

        CompactionResult result = compactor.compact(fx.id(), CUTOFF, false, null);

        assertThat(result.versionsRemoved()).isEqualTo(3);
        assertThat(result.assetsTouched()).isEqualTo(1);
        List<AssetVersion> after = history.versions(assetId);
        assertThat(after).extracting(AssetVersion::getId)
                .containsExactly(before.get(1).getId(), before.get(4).getId(), before.get(5).getId());
        assertThat(after.get(0).getValidFromRevision()).isEqualTo(r1);
        assertThat(after.get(0).getOriginalValidFrom()).isEqualTo(r2);
        assertThat(after.get(1).getValidFromRevision()).isEqualTo(r3);
        assertThat(after.get(1).getOriginalValidFrom()).isEqualTo(r5);
        assertThat(after.get(2).getValidFromRevision()).isEqualTo(r6);
        assertThat(after.get(2).getOriginalValidFrom()).isNull();

        // Reads at each original revision return the expected survivor.
        Map<Long, String> expected = Map.of(r1, "v2", r2, "v2", released, "v2", r3, "v5", r4, "v5", r5, "v5", r6, "v6");
        expected.forEach((r, name) -> assertThat(assets.findAt(fx.id(), page, r).orElseThrow().displayName())
                .as("read at r%s", r)
                .isEqualTo(name));
        history.assertGapless(assetId, head);

        // The revisions whose own changes were absorbed are marked; the survivors' own are not.
        assertThat(history.compacted(fx.id(), r1)).isTrue();
        assertThat(history.compacted(fx.id(), r3)).isTrue();
        assertThat(history.compacted(fx.id(), r4)).isTrue();
        assertThat(history.compacted(fx.id(), r2)).isFalse();
        assertThat(history.compacted(fx.id(), r5)).isFalse();
        assertThat(history.compacted(fx.id(), released)).isFalse();
        assertThat(result.revisionsMarked()).isEqualTo(3);
        assertThat(history.compactedThrough(fx.id())).isEqualTo(head);
    }

    // ------------------------------------------------------------------
    // Protected versions
    // ------------------------------------------------------------------

    @Test
    @DisplayName("released (open and closed rows, per locale), retained-build, running-build and pinned versions survive")
    void protectedVersionsSurvive() throws IOException {
        Fx fx = fixture("cmpprot");
        projects.updateLocales(fx.key(), LocaleConfig.of(
                List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English")), "de", Map.of(), false),
                true, fx.ctx());
        UUID a = page(fx, "a1");
        UUID c = page(fx, "c1");
        UUID d = page(fx, "d1");

        // A: a2 released in de (row closed later), a3 in en (row open), a4 in de (row open, also the last of the day).
        edit(fx, a, "a2");
        releases.release(List.of(ReleaseItem.of(a, "de")), fx.ctx());
        edit(fx, a, "a3");
        releases.release(List.of(ReleaseItem.of(a, "en")), fx.ctx());
        edit(fx, a, "a4");
        releases.release(List.of(ReleaseItem.of(a, "de")), fx.ctx());
        // C: c2 pinned by a pending scheduled release.
        long c2 = edit(fx, c, "c2");
        long c2Id = history.versions(history.assetId(fx.id(), c)).get(1).getId();
        edit(fx, c, "c3");
        edit(fx, c, "c4");
        // D: d2 is the revision of a queued build (every version valid there is kept; a4 and c4 are anyway).
        long d2 = edit(fx, d, "d2");
        edit(fx, d, "d3");
        edit(fx, d, "d4");
        long dayEnd = history.head(fx.id());
        for (UUID uuid : List.of(a, c, d)) {
            edit(fx, uuid, "next day");
        }
        long head = history.head(fx.id());
        history.backdate(fx.id(), 1, dayEnd, DAY_1);
        history.backdate(fx.id(), dayEnd + 1, head, DAY_2);

        // B, in a project of its own (a build protects every version valid at its revisions): a retained build with
        // revision b3 and consistent revision b1.
        Fx fb = fixture("cmpbuild");
        UUID b = page(fb, "b1");
        long b1 = history.head(fb.id());
        edit(fb, b, "b2");
        long b3 = edit(fb, b, "b3");
        edit(fb, b, "b4");
        edit(fb, b, "b5");
        long bDayEnd = history.head(fb.id());
        edit(fb, b, "next day");
        long bHead = history.head(fb.id());
        history.backdate(fb.id(), 1, bDayEnd, DAY_1);
        history.backdate(fb.id(), bDayEnd + 1, bHead, DAY_2);

        GenerationTarget target = target(fx);
        GenerationTarget bTarget = target(fb);
        GenerationRun build = runs.save(run(fb, b3, bTarget, RunStatus.SUCCESS));
        TargetWriter writer = writers.forTarget(fb.key(), bTarget);
        writer.stage(build.getId(), List.of(new OutputFile("index.html", "<p>b3</p>".getBytes(StandardCharsets.UTF_8))));
        writer.writeManifest(build.getId(), new BuildManifest(BuildManifest.VERSION, build.getId(), b3, b1, Set.of("html"), List.of()));
        GenerationRun queued = runs.save(run(fx, d2, target, RunStatus.QUEUED));
        ObjectNode params = mapper.createObjectNode();
        params.putArray("items").addObject().put("assetUuid", c.toString()).put("locale", "").put("pinnedVersionId", c2Id);
        var pinned = schedules.oneOff(fx.id(), "RELEASE", params, Instant.parse("2099-01-01T00:00:00Z"), fx.user().getId());

        try {
            compactor.compact(fx.id(), CUTOFF, false, null);
            compactor.compact(fb.id(), CUTOFF, false, null);
        } finally {
            schedules.retire(fx.id());
            jdbc.update("UPDATE generation_run SET status = 'FAILED' WHERE id = ?", queued.getId());
        }

        assertThat(names(fx, a)).containsExactly("a2", "a3", "a4", "next day");
        assertThat(names(fb, b)).containsExactly("b1", "b3", "b5", "next day");
        assertThat(names(fx, c)).containsExactly("c2", "c4", "next day");
        assertThat(names(fx, d)).containsExactly("d2", "d4", "next day");
        // The versions valid at the protected revisions are still exactly those.
        assertThat(assets.findAt(fb.id(), b, b1).orElseThrow().displayName()).isEqualTo("b1");
        assertThat(assets.findAt(fb.id(), b, b3).orElseThrow().displayName()).isEqualTo("b3");
        assertThat(assets.findAt(fx.id(), d, d2).orElseThrow().displayName()).isEqualTo("d2");
        assertThat(assets.findAt(fx.id(), c, c2).orElseThrow().displayName()).isEqualTo("c2");
        assertThat(pinned.getId()).isNotNull();
        // FK integrity: every release row still points at a version.
        assertThat(jdbc.queryForObject("""
                SELECT COUNT(*) FROM asset_release r LEFT JOIN asset_version v ON v.id = r.released_version_id
                WHERE r.project_id = ? AND v.id IS NULL
                """, Long.class, fx.id())).isZero();
        for (UUID uuid : List.of(a, c, d)) {
            history.assertGapless(history.assetId(fx.id(), uuid), head);
        }
        history.assertGapless(history.assetId(fb.id(), b), bHead);
    }

    // ------------------------------------------------------------------
    // The open version, references and blobs
    // ------------------------------------------------------------------

    @Test
    @DisplayName("versions whose next survivor is the open version stay until a later save closes it")
    void openVersionIsNeverAbsorbed() {
        Fx fx = fixture("cmpopen");
        UUID page = page(fx, "o1");
        edit(fx, page, "o2");
        edit(fx, page, "o3");
        long head = history.head(fx.id());
        history.backdate(fx.id(), 1, head, DAY_1);
        long assetId = history.assetId(fx.id(), page);

        assertThat(compactor.compact(fx.id(), CUTOFF, false, null).versionsRemoved()).isZero();
        assertThat(history.versions(assetId)).hasSize(3);

        edit(fx, page, "today"); // closes o3 — its day is still DAY_1
        CompactionResult result = compactor.compact(fx.id(), CUTOFF, false, null);

        assertThat(result.versionsRemoved()).isEqualTo(2);
        assertThat(names(fx, page)).containsExactly("o3", "today");
        history.assertGapless(assetId, history.head(fx.id()));
    }

    @Test
    @DisplayName("references at every revision equal the version valid there; bytes of removed media versions are released to the sweep")
    void referencesAndBlobs() {
        Fx fx = fixture("cmpref");
        AssetVersionView m1 = media.upload(fx.id(), null, "one.txt", null, "first".getBytes(StandardCharsets.UTF_8), fx.ctx());
        AssetVersionView m2 = media.upload(fx.id(), null, "two.txt", null, "second".getBytes(StandardCharsets.UTF_8), fx.ctx());
        String firstBlob = m1.payload().path("blobSha256").asText();
        media.replace(m1.uuid(), "one.txt", null, "first, edited".getBytes(StandardCharsets.UTF_8), fx.ctx());
        media.replace(m1.uuid(), "one.txt", null, "first, final".getBytes(StandardCharsets.UTF_8), fx.ctx());
        UUID page = page(fx, "p0");
        for (String name : List.of("h", "g", "hg", "none", "h2", "g2")) {
            edit(fx, page, name, refs(name, m1.uuid(), m2.uuid()));
        }
        long dayEnd = history.head(fx.id());
        edit(fx, page, "next", refs("hg", m1.uuid(), m2.uuid()));
        media.replace(m1.uuid(), "one.txt", null, "next day".getBytes(StandardCharsets.UTF_8), fx.ctx());
        long head = history.head(fx.id());
        history.backdate(fx.id(), 1, dayEnd, DAY_1);
        history.backdate(fx.id(), dayEnd + 1, head, DAY_2);
        long pageId = history.assetId(fx.id(), page);
        assertThat(referencedBy(firstBlob)).isPositive();

        CompactionResult result = compactor.compact(fx.id(), CUTOFF, false, null);

        assertThat(result.versionsRemoved()).isGreaterThanOrEqualTo(6);
        assertThat(result.referencesRewritten()).isPositive();
        Map<Long, Set<ReferenceEdge>> edges = history.edgesAt(pageId, head);
        history.versionAt(pageId, head).forEach((r, v) -> assertThat(edges.get(r))
                .as("edges at r%s", r)
                .isEqualTo(v.isDeleted() ? Set.of() : materializer.extract(fx.id(), AssetType.PAGE, v.getPayload())));
        // The first upload's bytes are referenced by no version any more: the next blob-sweep may collect them (after
        // its grace period); compaction itself deletes no blob.
        assertThat(referencedBy(firstBlob)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM blob WHERE sha256 = ?", Long.class, firstBlob)).isOne();
        assertThat(result.bytesFreed()).isPositive();
    }

    // ------------------------------------------------------------------
    // The job
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the job: dry run changes nothing and reports what the real run does; a second run removes nothing; audit, report, estimate")
    void jobDryRunRealRunAndIdempotence() throws Exception {
        Fx fx = fixture("cmpjob");
        UUID page = page(fx, "j1");
        for (int i = 2; i <= 6; i++) {
            edit(fx, page, "j" + i);
        }
        UUID other = page(fx, "k1");
        edit(fx, other, "k2");
        long dayEnd = history.head(fx.id());
        edit(fx, page, "tomorrow");
        edit(fx, other, "tomorrow");
        long head = history.head(fx.id());
        history.backdate(fx.id(), 1, dayEnd, DAY_1);
        history.backdate(fx.id(), dayEnd + 1, head, DAY_2);
        policies.update(fx.key(), true, 30, fx.key(), fx.user().getId());
        String token = jwt.issueAccessToken(users.findById(fx.user().getId()).orElseThrow());
        Map<Long, JsonNode> readsBefore = history.readsAt(history.assetId(fx.id(), page), head);

        mvc.perform(get("/api/v1/projects/{key}/compaction/estimate?olderThanDays=30", fx.key())
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.versionsRemoved").value(6))
                .andExpect(jsonPath("$.assetsTouched").value(2))
                .andExpect(jsonPath("$.olderThanDays").value(30));

        SystemJobRun dry = runJob(true);
        JsonNode dryEntry = entry(dry, fx);
        assertThat(dry.getOutcome()).isEqualTo(JobOutcome.SUCCEEDED);
        assertThat(dryEntry.path("versionsRemoved").asLong()).isEqualTo(6); // j1–j5 and k1
        assertThat(history.versions(history.assetId(fx.id(), page))).hasSize(7);
        assertThat(history.readsAt(history.assetId(fx.id(), page), head)).isEqualTo(readsBefore);
        assertThat(history.compactedThrough(fx.id())).isNull();
        assertThat(actions(fx)).doesNotContain("REVISIONS_COMPACTED");

        SystemJobRun real = runJob(false);
        JsonNode realEntry = entry(real, fx);
        for (String field : List.of("versionsInWindow", "assetsTouched", "versionsRemoved", "referencesRewritten",
                "revisionsMarked", "bytesFreed")) {
            assertThat(realEntry.path(field).asLong()).as(field).isEqualTo(dryEntry.path(field).asLong());
        }
        assertThat(names(fx, page)).containsExactly("j6", "tomorrow");
        assertThat(names(fx, other)).containsExactly("k2", "tomorrow");
        assertThat(history.compactedThrough(fx.id())).isEqualTo(head);
        List<AuditLog> compacted = audit.findRecent(fx.id(), PageRequest.of(0, 50)).stream()
                .filter(e -> e.getAction().equals("REVISIONS_COMPACTED"))
                .toList();
        assertThat(compacted).singleElement().satisfies(e -> {
            assertThat(e.getDetail().path("versionsRemoved").asLong()).isEqualTo(6);
            assertThat(e.getDetail().path("jobRunId").asLong()).isEqualTo(real.getId());
        });

        SystemJobRun again = runJob(false);
        assertThat(entry(again, fx).path("versionsRemoved").asLong()).isZero();
        assertThat(entry(again, fx).path("revisionsMarked").asLong()).isZero();
        assertThat(names(fx, page)).containsExactly("j6", "tomorrow");
        assertThat(audit.findRecent(fx.id(), PageRequest.of(0, 50)).stream()
                        .filter(e -> e.getAction().equals("REVISIONS_COMPACTED")))
                .hasSize(1);

        // GET /compaction shows the newest run for the project.
        mvc.perform(get("/api/v1/projects/{key}/compaction", fx.key()).header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.compactedThrough").value(head))
                .andExpect(jsonPath("$.lastRun.runId").value(again.getId()))
                .andExpect(jsonPath("$.lastRun.dryRun").value(false))
                .andExpect(jsonPath("$.lastRun.outcome").value("SUCCEEDED"))
                .andExpect(jsonPath("$.lastRun.versionsRemoved").value(0));
    }

    @Test
    @DisplayName("the job skips projects without a policy, disabled ones and archived ones")
    void jobSkipsProjectsThatDidNotOptIn() {
        Fx off = fixture("cmpoff");
        Fx disabled = fixture("cmpdis");
        Fx archived = fixture("cmparc");
        for (Fx fx : List.of(off, disabled, archived)) {
            UUID page = page(fx, "x1");
            edit(fx, page, "x2");
            edit(fx, page, "x3");
            edit(fx, page, "x4");
            history.backdate(fx.id(), 1, history.head(fx.id()) - 1, DAY_1);
        }
        policies.update(disabled.key(), true, 30, disabled.key(), disabled.user().getId());
        policies.update(disabled.key(), false, null, null, disabled.user().getId());
        policies.update(archived.key(), true, 30, archived.key(), archived.user().getId());
        projects.archive(archived.key(), archived.ctx());
        try {
            SystemJobRun run = runJob(false);
            for (Fx fx : List.of(off, disabled, archived)) {
                assertThat(run.getReport().path("projects").findValues("projectId").stream().map(JsonNode::asLong))
                        .doesNotContain(fx.id());
            }
        } finally {
            projects.unarchive(archived.key(), archived.ctx());
        }
        for (Fx fx : List.of(off, disabled, archived)) {
            assertThat(history.compactedThrough(fx.id())).isNull();
        }
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private SystemJobRun runJob(boolean dryRun) {
        SystemJobRunner.Started started = runner.start(CompactionPolicyService.JOB_KEY, JobTrigger.MANUAL, dryRun, null)
                .orElseThrow();
        started.done().join();
        return jobRuns.findById(started.run().getId()).orElseThrow();
    }

    private static JsonNode entry(SystemJobRun run, Fx fx) {
        for (JsonNode entry : run.getReport().path("projects")) {
            if (entry.path("projectId").asLong() == fx.id()) {
                assertThat(entry.has("error")).as("error: %s", entry.path("error")).isFalse();
                return entry;
            }
        }
        throw new AssertionError("run " + run.getId() + " has no entry for project " + fx.key() + ": " + run.getReport());
    }

    private List<String> actions(Fx fx) {
        return audit.findRecent(fx.id(), PageRequest.of(0, 50)).stream().map(AuditLog::getAction).toList();
    }

    private long referencedBy(String sha) {
        Long n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM asset_version WHERE CAST(payload AS VARCHAR) LIKE ?", Long.class, "%" + sha + "%");
        return n == null ? 0 : n;
    }

    private GenerationRun run(Fx fx, long revision, GenerationTarget target, RunStatus status) {
        Instant now = Instant.now();
        return new GenerationRun(fx.id(), revision, GenerationMode.FULL, "html", target.getId(), status, now,
                status.isTerminal() ? now : null, fx.user().getId(), 0, 0, 0, 0, 0, null, null);
    }

    private GenerationTarget target(Fx fx) throws IOException {
        return targets.save(new GenerationTarget(
                fx.id(), "default", TargetType.FILESYSTEM, mapper.readTree("{\"baseUrl\":\"https://example.com\"}"), true));
    }

    private List<String> names(Fx fx, UUID uuid) {
        return history.versions(history.assetId(fx.id(), uuid)).stream().map(AssetVersion::getDisplayName).toList();
    }

    private Fx fixture(String prefix) {
        int n = SEQ.incrementAndGet();
        AppUser user = users.create(prefix + n, prefix + n + "@example.com", "Compaction", "secret-password");
        Project project = projects.create(new CreateProjectRequest(prefix + n, prefix + n, null, "compaction"), user.getId());
        return new Fx(project, user);
    }

    private UUID page(Fx fx, String name) {
        return assets.create(
                        new CreateAssetCommand(fx.id(), AssetType.PAGE, name, null, mapper.createObjectNode().put("name", name), null),
                        fx.ctx())
                .uuid();
    }

    /** Saves a new version of {@code uuid}; its revision. */
    private long edit(Fx fx, UUID uuid, String name) {
        return edit(fx, uuid, name, mapper.createObjectNode().put("name", name));
    }

    private long edit(Fx fx, UUID uuid, String name, ObjectNode payload) {
        long expected = assets.requireCurrent(fx.id(), uuid).validFromRevision();
        return assets.update(uuid, new UpdateAssetCommand(name, payload), expected, fx.ctx()).validFromRevision();
    }

    private long release(Fx fx, UUID uuid) {
        Long revision = releases.release(List.of(ReleaseItem.of(uuid)), fx.ctx()).revision();
        assertThat(revision).isNotNull();
        return revision;
    }

    /** A page payload referencing media {@code h} at {@code content.hero} and/or {@code g} in a gallery. */
    private ObjectNode refs(String name, UUID h, UUID g) {
        ObjectNode payload = mapper.createObjectNode().put("name", name);
        ObjectNode content = payload.putObject("content");
        if (name.startsWith("h")) {
            content.putObject("hero").put("type", "MEDIA_REF").put("uuid", h.toString());
        }
        if (name.contains("g")) {
            content.putArray("gallery").addObject().put("type", "MEDIA_REF").put("uuid", g.toString());
        }
        return payload;
    }
}
