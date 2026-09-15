package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetReferenceRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.ReferenceKind;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.UsageView;
import com.acme.staticforge.asset.reference.ReferenceBackfill;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.generate.plan.BuildPlan;
import com.acme.staticforge.generate.plan.BuildPlanner;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.render.OutputPathResolver;
import com.acme.staticforge.generate.snapshot.SnapshotService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Readers of {@code asset_reference} are revision-aware (spec §5.4, §18.2, {@code M16.3.3}): the
 * delete guard and usages see open edges (or edges valid at a revision), incremental planning walks
 * edges valid at the snapshot, and generation no longer inserts rows.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class RevisionAwareReferencesIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        String outputRoot = Files.createTempDirectory("sf-refs-test").toString();
        registry.add("sf.generate.output-root", () -> outputRoot);
    }

    @Autowired MockMvc mvc;
    @Autowired JwtService jwtService;
    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired AssetReferenceRepository referenceRepository;
    @Autowired GenerationService generationService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired SnapshotService snapshotService;
    @Autowired BuildPlanner buildPlanner;
    @Autowired ReferenceBackfill referenceBackfill;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void deleteGuardOnlyCountsOpenEdgesFromLiveAssets() {
        Fixture fx = newFixture();
        AssetVersionView media = create(fx, AssetType.MEDIA, "Hero", mapper.createObjectNode());
        AssetVersionView page = create(fx, AssetType.PAGE, "Home", pagePayload(template(fx, "Layout", "x").uuid()));
        AssetVersionView linked = update(fx, page, withMedia(page, media.uuid()));

        assertThatThrownBy(() -> assetService.softDelete(media.uuid(), false, fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, e -> assertThat(e.getStatus()).isEqualTo(409));

        update(fx, linked, pagePayload(UUID.fromString(linked.payload().path("templateRef").asText())));

        assetService.softDelete(media.uuid(), false, fx.ctx());
        assertThat(assetService.requireCurrent(fx.project().getId(), media.uuid()).deleted()).isTrue();
    }

    @Test
    void usagesAreTheOpenEdgesWithoutGenerationDuplicatesAndTimeTravelByRevision() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView media = create(fx, AssetType.MEDIA, "Hero", mapper.createObjectNode());
        AssetVersionView page = create(fx, AssetType.PAGE, "Home", pagePayload(template(fx, "Layout", "Hello").uuid()));
        AssetVersionView linked = update(fx, page, withMedia(page, media.uuid()));
        GenerationTarget target = targetRepository.save(new GenerationTarget(
                fx.project().getId(), "default", TargetType.FILESYSTEM, mapper.createObjectNode(), true));

        long rowsBefore = referenceRepository.count();
        generate(fx, target, GenerationMode.FULL);
        generate(fx, target, GenerationMode.FULL);
        assertThat(referenceRepository.count()).as("generation inserts no reference rows").isEqualTo(rowsBefore);

        List<UsageView> usages = assetService.usages(fx.project().getId(), media.uuid());
        assertThat(usages).singleElement().satisfies(usage -> {
            assertThat(usage.fromUuid()).isEqualTo(page.uuid());
            assertThat(usage.kind()).isEqualTo(ReferenceKind.MEDIA_REF);
            assertThat(usage.sourcePath()).isEqualTo("content.hero");
        });

        AssetVersionView unlinked = update(fx, linked, pagePayload(UUID.fromString(linked.payload().path("templateRef").asText())));
        assertThat(assetService.usages(fx.project().getId(), media.uuid())).isEmpty();
        assertThat(assetService.usagesAt(fx.project().getId(), media.uuid(), linked.validFromRevision())).hasSize(1);
        assertThat(assetService.usagesAt(fx.project().getId(), media.uuid(), unlinked.validFromRevision())).isEmpty();
        assertThat(assetService.usagesAt(fx.project().getId(), media.uuid(), page.validFromRevision())).isEmpty();

        String url = "/api/v1/projects/" + fx.project().getKey() + "/assets/" + media.uuid() + "/usages";
        mvc.perform(get(url).header("Authorization", "Bearer " + fx.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
        mvc.perform(get(url).param("revision", String.valueOf(linked.validFromRevision()))
                        .header("Authorization", "Bearer " + fx.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].sourcePath").value("content.hero"));
    }

    /**
     * Incremental matrix. P1 = T2 + section S + media M; P2 = T1, which reads
     * {@code $CMS_VALUE(page:about.title)$}; P3 = T2 + an internal link to About; About = T2.
     */
    @Test
    void incrementalPlanningRebuildsExactlyTheDependentPages() {
        Fixture fx = newFixture();
        AssetVersionView media = create(fx, AssetType.MEDIA, "Hero", mapper.createObjectNode());
        AssetVersionView section = create(fx, AssetType.SECTION_TEMPLATE, "Teaser", mapper.createObjectNode());
        AssetVersionView t2 = template(fx, "Plain", "plain");
        AssetVersionView about = create(fx, AssetType.PAGE, "About", pagePayload(t2.uuid()));
        AssetVersionView t1 = template(fx, "Reader", "$CMS_VALUE(page:" + about.uid() + ".title)$");

        ObjectNode p1Payload = withMedia(pagePayload(t2.uuid()), media.uuid());
        ObjectNode sectionNode = p1Payload.putObject("bodies").putArray("main").addObject();
        sectionNode.put("instanceId", UUID.randomUUID().toString());
        sectionNode.put("templateRef", section.uuid().toString());
        sectionNode.putObject("content");
        AssetVersionView p1 = create(fx, AssetType.PAGE, "P1", p1Payload);
        AssetVersionView p2 = create(fx, AssetType.PAGE, "P2", pagePayload(t1.uuid()));
        ObjectNode p3Payload = pagePayload(t2.uuid());
        p3Payload.withObject("content").putObject("link").put("kind", "INTERNAL").put("uuid", about.uuid().toString());
        AssetVersionView p3 = create(fx, AssetType.PAGE, "P3", p3Payload);

        assertThat(rebuiltBy(fx, media)).containsExactlyInAnyOrder(p1.uuid());
        assertThat(rebuiltBy(fx, section)).containsExactlyInAnyOrder(p1.uuid());
        assertThat(rebuiltBy(fx, t2)).containsExactlyInAnyOrder(p1.uuid(), p3.uuid(), about.uuid());
        assertThat(rebuiltBy(fx, t1)).containsExactlyInAnyOrder(p2.uuid());
        assertThat(rebuiltBy(fx, about))
                .as("value reader via its template's OCTL_VALUE edge, link editor via CONTENT_REF")
                .containsExactlyInAnyOrder(about.uuid(), p2.uuid(), p3.uuid());

        // P3 drops its link; after a build at that revision, editing About no longer rebuilds P3.
        AssetVersionView p3Current = assetService.requireCurrent(fx.project().getId(), p3.uuid());
        AssetVersionView unlinked = update(fx, p3Current, pagePayload(t2.uuid()));
        assertThat(rebuiltBy(fx, about, unlinked.validFromRevision()))
                .containsExactlyInAnyOrder(about.uuid(), p2.uuid());
    }

    /**
     * The 015 cleanup drops every row; {@link ReferenceBackfill} (run by {@code ReferenceBackfillRunner}
     * when the table is empty) must rebuild exactly the rows the write path had produced,
     * intervals included, and running it again must change nothing.
     */
    @Test
    void backfillAfterCleanupRebuildsTheWritePathRowsIdempotently() {
        Fixture fx = newFixture();
        AssetVersionView media = create(fx, AssetType.MEDIA, "Hero", mapper.createObjectNode());
        AssetVersionView about = create(fx, AssetType.PAGE, "About", pagePayload(template(fx, "Plain", "plain").uuid()));
        AssetVersionView reader = template(fx, "Reader", "$CMS_REF(page:" + about.uid() + ")$");
        AssetVersionView page = create(fx, AssetType.PAGE, "Home", pagePayload(reader.uuid()));
        AssetVersionView linked = update(fx, page, withMedia(page, media.uuid()));
        update(fx, linked, pagePayload(reader.uuid()));
        assetService.softDelete(about.uuid(), true, fx.ctx());

        Set<List<Object>> written = allRows();
        assertThat(written).isNotEmpty();

        referenceRepository.deleteAllInBatch();
        assertThat(referenceBackfill.isNeeded()).isTrue();

        referenceBackfill.rebuildAll();
        assertThat(allRows()).isEqualTo(written);
        assertThat(referenceBackfill.isNeeded()).isFalse();

        referenceBackfill.rebuildAll();
        assertThat(allRows()).isEqualTo(written);
    }

    // ------------------------------------------------------------------

    private Set<List<Object>> allRows() {
        return referenceRepository.findAll().stream()
                .map(r -> java.util.Arrays.<Object>asList(r.getFromAssetId(), r.getToAssetId(), r.getKind(),
                        r.getSourcePath(), r.getValidFromRevision(), r.getValidToRevision()))
                .collect(Collectors.toSet());
    }

    /** Touches {@code asset} and returns the pages an incremental plan since the previous revision renders. */
    private Set<UUID> rebuiltBy(Fixture fx, AssetVersionView asset) {
        return rebuiltBy(fx, asset, currentRevision(fx));
    }

    private Set<UUID> rebuiltBy(Fixture fx, AssetVersionView asset, long lastSuccessfulRevision) {
        AssetVersionView current = assetService.requireCurrent(fx.project().getId(), asset.uuid());
        ObjectNode touched = current.payload().deepCopy();
        touched.put("touch", UUID.randomUUID().toString());
        AssetVersionView edited = update(fx, current, touched);

        var snapshot = snapshotService.snapshot(fx.project().getId(), edited.validFromRevision());
        OutputPathResolver paths = mock(OutputPathResolver.class);
        when(paths.resolvePagePath(any(), any())).thenAnswer(invocation -> invocation.getArgument(0).toString());
        BuildPlan plan = buildPlanner.plan(
                snapshot, GenerationMode.INCREMENTAL, lastSuccessfulRevision, Set.of("html"), null, null, paths);
        return plan.entries().stream().map(PlanEntry::pageUuid).collect(Collectors.toSet());
    }

    private long currentRevision(Fixture fx) {
        return snapshotService.snapshot(fx.project().getId(), null).revision();
    }

    private void generate(Fixture fx, GenerationTarget target, GenerationMode mode) throws InterruptedException {
        GenerationRun run = generationService.start(
                fx.project().getKey(),
                new GenerationRequest(mode, null, List.of("html"), target.getId(), null, null, null, null),
                fx.admin().getId());
        long deadline = System.currentTimeMillis() + 60_000;
        while (System.currentTimeMillis() < deadline) {
            RunStatus status = generationService.status(fx.project().getKey(), run.getId()).getStatus();
            if (status == RunStatus.SUCCESS || status == RunStatus.PARTIAL) {
                return;
            }
            assertThat(status).isNotIn(RunStatus.FAILED, RunStatus.CANCELLED);
            Thread.sleep(100);
        }
        throw new AssertionError("Generation did not finish within 60s");
    }

    private AssetVersionView template(Fixture fx, String name, String htmlSource) {
        ObjectNode payload = mapper.createObjectNode();
        payload.withObject("channelTemplates").withObject("html").put("source", htmlSource);
        return create(fx, AssetType.PAGE_TEMPLATE, name, payload);
    }

    private AssetVersionView create(Fixture fx, AssetType type, String name, ObjectNode payload) {
        return assetService.create(new CreateAssetCommand(fx.project().getId(), type, name, null, payload, null), fx.ctx());
    }

    private AssetVersionView update(Fixture fx, AssetVersionView current, ObjectNode payload) {
        return assetService.update(
                current.uuid(), new UpdateAssetCommand(current.displayName(), payload), current.validFromRevision(), fx.ctx());
    }

    private ObjectNode pagePayload(UUID templateUuid) {
        ObjectNode payload = mapper.createObjectNode();
        payload.put("templateRef", templateUuid.toString());
        payload.putObject("content");
        return payload;
    }

    private ObjectNode withMedia(AssetVersionView page, UUID mediaUuid) {
        return withMedia((ObjectNode) page.payload().deepCopy(), mediaUuid);
    }

    private static ObjectNode withMedia(ObjectNode payload, UUID mediaUuid) {
        payload.withObject("content").putObject("hero").put("type", "MEDIA_REF").put("uuid", mediaUuid.toString());
        return payload;
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser admin = userService.create("rar-user-" + n, "rar-user-" + n + "@example.com", "Refs User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("rarp_" + n, "Refs Project " + n, null, null), admin.getId());
        return new Fixture(project, admin, jwtService);
    }

    private record Fixture(Project project, AppUser admin, JwtService jwt) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), admin().getId(), "test");
        }

        String token() {
            return jwt.issueAccessToken(admin);
        }
    }
}
