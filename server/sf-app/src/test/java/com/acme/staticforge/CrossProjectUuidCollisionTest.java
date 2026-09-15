package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.navigation.CreatePageReferenceCommand;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.navigation.PageReferenceTargetKind;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetLocations;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.preview.PageRenderService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.urlregistry.UrlArea;
import com.acme.staticforge.urlregistry.UrlRegistryService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * End-to-end regression guard for `M9` (feature `caller-project-scoping`, `M9.2.2`): two
 * different projects can each hold a {@code PAGE} asset with the identical UUID with zero
 * cross-talk between them. Before `M9`, {@code asset.uuid} was unique server-wide, so this
 * scenario was physically impossible; the collision is forced directly at the repository level
 * (a raw {@code UPDATE} on the {@code asset} row, via {@link JdbcTemplate}) since normal asset
 * creation always mints a fresh, non-colliding UUIDv7 and natural cross-project import doesn't
 * exist until `M10`.
 *
 * <p>Exercises, independently for both projects and the one shared UUID: page lookup
 * ({@link PageService#find}), revision history ({@link AssetService#history}), template
 * resolution/rendering ({@link PageRenderService#renderPage}, the same {@code BlockResolver}/
 * {@code OctlRenderer} path generation uses), a full generation run, and the URL registry
 * ({@link UrlRegistryService}, already keyed by {@code (project_id, ..., uuid, area)} per
 * `M8.2.1` — this test confirms that holds under an actual collision, not just by inspection).
 *
 * <p>Like other generation-touching tests in this suite (e.g. {@code GenerationIntegrationTest}),
 * this can occasionally hit a pre-existing, unrelated race in
 * {@code GenerationService#start}/{@code #executeRun}: the submitted run can begin before the
 * outer {@code @Transactional} insert commits, so {@code executeRun}'s {@code findById} sees
 * nothing yet and returns without ever advancing the run past {@code QUEUED} — surfacing here as
 * {@code awaitTerminal}'s "did not reach a terminal state within 60s" failure. Not an M9
 * regression; rerunning in isolation passes.
 */
@SpringBootTest
@ActiveProfiles("test")
class CrossProjectUuidCollisionTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-uuid-collision-test");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired AssetRepository assetRepository;
    @Autowired FolderService folderService;
    @Autowired PageService pageService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired PageRenderService pageRenderService;
    @Autowired UrlRegistryService urlRegistryService;
    @Autowired JdbcTemplate jdbcTemplate;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void twoProjectsIndependentlyResolveAnAssetSharingTheIdenticalUuid() throws Exception {
        UUID sharedUuid = UUID.randomUUID();

        Fixture a = newFixture("A");
        Fixture b = newFixture("B");

        AssetVersionView targetPageA = createTargetPage(a, "Target A", "PROJECT_A_CONTENT");
        forceUuid(a, targetPageA, sharedUuid);
        AssetVersionView targetPageB = createTargetPage(b, "Target B", "PROJECT_B_CONTENT");
        forceUuid(b, targetPageB, sharedUuid);

        // Both projects now have a live PAGE asset at the exact same uuid, in different projects —
        // impossible before M9's (project_id, uuid) composite constraint.
        assertThat(assetRepository.findByProjectIdAndUuid(a.project().getId(), sharedUuid)).isPresent();
        assertThat(assetRepository.findByProjectIdAndUuid(b.project().getId(), sharedUuid)).isPresent();
        assertThat(
                        assetRepository.findByProjectIdAndUuid(a.project().getId(), sharedUuid).orElseThrow().getId())
                .isNotEqualTo(
                        assetRepository.findByProjectIdAndUuid(b.project().getId(), sharedUuid).orElseThrow().getId());

        // --- Page lookup resolves each project's own asset, not the other's. ---
        assertThat(pageService.find(a.project().getId(), sharedUuid).displayName()).isEqualTo("Target A");
        assertThat(pageService.find(b.project().getId(), sharedUuid).displayName()).isEqualTo("Target B");
        assertThat(assetService.requireCurrent(a.project().getId(), sharedUuid).displayName()).isEqualTo("Target A");
        assertThat(assetService.requireCurrent(b.project().getId(), sharedUuid).displayName()).isEqualTo("Target B");

        // --- Revision history is isolated: an edit in A must not appear in B's history for the
        // same uuid. ---
        List<AssetVersionView> historyBBefore = assetService.history(b.project().getId(), sharedUuid);
        assetService.update(
                sharedUuid,
                new UpdateAssetCommand("Target A Renamed", targetPageA.payload()),
                assetService.requireCurrent(a.project().getId(), sharedUuid).validFromRevision(),
                a.ctx());
        List<AssetVersionView> historyAAfter = assetService.history(a.project().getId(), sharedUuid);
        List<AssetVersionView> historyBAfter = assetService.history(b.project().getId(), sharedUuid);
        assertThat(historyAAfter).hasSizeGreaterThan(historyBAfter.size());
        assertThat(historyBAfter).hasSameSizeAs(historyBBefore);
        assertThat(assetService.requireCurrent(a.project().getId(), sharedUuid).displayName())
                .isEqualTo("Target A Renamed");
        assertThat(assetService.requireCurrent(b.project().getId(), sharedUuid).displayName()).isEqualTo("Target B");

        // --- Template resolution/preview rendering: each project renders its own content. ---
        String previewA = pageRenderService.renderPage(a.project().getId(), sharedUuid, null, "html", false);
        String previewB = pageRenderService.renderPage(b.project().getId(), sharedUuid, null, "html", false);
        assertThat(previewA).contains("PROJECT_A_CONTENT").doesNotContain("PROJECT_B_CONTENT");
        assertThat(previewB).contains("PROJECT_B_CONTENT").doesNotContain("PROJECT_A_CONTENT");

        // --- Navigation + URL registry: independent page references at each project's own
        // uuid, both pointing (in their own project) at the shared target uuid. ---
        AssetVersionView navRootA = navRoot(a);
        AssetVersionView navRootB = navRoot(b);
        AssetVersionView pageRefA = pageReferenceService.create(
                new CreatePageReferenceCommand("A Link", navRootA.uuid(), PageReferenceTargetKind.PAGE, sharedUuid, null),
                a.ctx());
        AssetVersionView pageRefB = pageReferenceService.create(
                new CreatePageReferenceCommand("B Link", navRootB.uuid(), PageReferenceTargetKind.PAGE, sharedUuid, null),
                b.ctx());

        String previewHrefA = urlRegistryService.resolve(pageRefA.uuid(), "html", UrlArea.PREVIEW, a.ctx());
        String previewHrefB = urlRegistryService.resolve(pageRefB.uuid(), "html", UrlArea.PREVIEW, b.ctx());
        assertThat(previewHrefA).isNotBlank();
        assertThat(previewHrefB).isNotBlank();
        assertThat(previewHrefA).isNotEqualTo(previewHrefB);

        // --- Generation: each project's run renders and outputs its own content only. ---
        AssetVersionView homePageA = createHomePage(a, navRootA);
        AssetVersionView homePageB = createHomePage(b, navRootB);
        GenerationTarget targetA = createTarget(a);
        GenerationTarget targetB = createTarget(b);

        long runIdA = runGenerationToSuccess(a, targetA);
        long runIdB = runGenerationToSuccess(b, targetB);

        // The home page (index.html) is a $CMS_NAVIGATION listing, not the target page's own
        // content — it must link to each project's own (differently-slugged) target output, with
        // no cross-talk between the two nav trees.
        String homeOutputA = Files.readString(buildDir(a, targetA, runIdA).resolve("index.html"));
        String homeOutputB = Files.readString(buildDir(b, targetB, runIdB).resolve("index.html"));

        String generatedHrefA = urlRegistryService.resolve(pageRefA.uuid(), "html", UrlArea.GENERATED, a.ctx());
        String generatedHrefB = urlRegistryService.resolve(pageRefB.uuid(), "html", UrlArea.GENERATED, b.ctx());
        assertThat(generatedHrefA).isNotBlank();
        assertThat(generatedHrefB).isNotBlank();
        assertThat(generatedHrefA).isNotEqualTo(generatedHrefB);
        assertThat(homeOutputA).contains(generatedHrefA).doesNotContain(generatedHrefB);
        assertThat(homeOutputB).contains(generatedHrefB).doesNotContain(generatedHrefA);

        // The target page's own generated output (found at its resolved href) carries its
        // project's own content, not the other project's.
        String targetOutputA = Files.readString(
                buildDir(a, targetA, runIdA).resolve(generatedHrefA));
        String targetOutputB = Files.readString(
                buildDir(b, targetB, runIdB).resolve(generatedHrefB));
        assertThat(targetOutputA).contains("PROJECT_A_CONTENT").doesNotContain("PROJECT_B_CONTENT");
        assertThat(targetOutputB).contains("PROJECT_B_CONTENT").doesNotContain("PROJECT_A_CONTENT");

        // Ensure homePages were actually used (silence unused-variable concerns while documenting
        // that the fixture is required for generation to have a build root to walk from).
        assertThat(homePageA.uuid()).isNotEqualTo(homePageB.uuid());
    }

    // ------------------------------------------------------------------
    // Collision forcing
    // ------------------------------------------------------------------

    /**
     * Forces {@code asset}'s uuid column to {@code newUuid} via a raw SQL update — the only way
     * to create a same-uuid collision today, since every real creation path
     * ({@link AssetService#create}) always mints a fresh, non-colliding {@code UUIDv7} and
     * `M10`'s cross-project import (the natural way a collision could arise) doesn't exist yet.
     */
    private void forceUuid(Fixture fx, AssetVersionView asset, UUID newUuid) {
        Asset row = assetRepository.findByProjectIdAndUuid(fx.project().getId(), asset.uuid()).orElseThrow();
        int updated = jdbcTemplate.update("update asset set uuid = ? where id = ?", newUuid, row.getId());
        assertThat(updated).isEqualTo(1);
    }

    // ------------------------------------------------------------------
    // Generation run helpers (mirrors NavigationUrlRegistryIntegrationTest)
    // ------------------------------------------------------------------

    private long runGenerationToSuccess(Fixture fx, GenerationTarget target) throws InterruptedException {
        GenerationRun run = generationService.start(
                fx.project().getKey(),
                new GenerationRequest(GenerationMode.FULL, null, List.of("html"), target.getId(), null, null, null, null),
                fx.user().getId());
        GenerationRun finished = awaitTerminal(fx, run.getId());
        assertThat(finished.getStatus()).isEqualTo(RunStatus.SUCCESS);
        return finished.getId();
    }

    private GenerationRun awaitTerminal(Fixture fx, long runId) throws InterruptedException {
        long deadline = System.currentTimeMillis() + 60_000;
        while (System.currentTimeMillis() < deadline) {
            GenerationRun run = generationService.status(fx.project().getKey(), runId);
            RunStatus status = run.getStatus();
            if (status == RunStatus.SUCCESS || status == RunStatus.PARTIAL || status == RunStatus.FAILED
                    || status == RunStatus.CANCELLED) {
                return run;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Generation did not reach a terminal state within 60s");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private static Path buildDir(Fixture fx, GenerationTarget target, long runId) {
        return TargetLocations.resolve(outputRoot, fx.project().getKey(), target)
                .resolve("builds")
                .resolve(String.valueOf(runId));
    }

    private GenerationTarget createTarget(Fixture fx) throws IOException {
        return targetRepository.save(new GenerationTarget(
                fx.project().getId(),
                "default",
                TargetType.FILESYSTEM,
                mapper.readTree("{\"baseUrl\":\"https://example.com\"}"),
                true));
    }

    /** The home page: {@code $CMS_NAVIGATION(nav:<navRootUid>)$}, output to a fixed {@code index.html}. */
    private AssetVersionView createHomePage(Fixture fx, AssetVersionView navRoot) {
        ObjectNode payload = mapper.createObjectNode();
        payload.with("channelTemplates").with("html").put("source", "$CMS_NAVIGATION(nav:" + navRoot.uid() + ")$");
        payload.with("outputPath").put("html", "index.html");
        AssetVersionView homeTemplate = assetService.create(
                new CreateAssetCommand(
                        fx.project().getId(), AssetType.PAGE_TEMPLATE, "Home Template " + SEQ.incrementAndGet(), null, payload, null),
                fx.ctx());
        return pageService.create(new CreatePageCommand("Home " + fx.label(), null, homeTemplate.uuid()), fx.ctx());
    }

    private AssetVersionView createTargetPage(Fixture fx, String displayName, String marker) {
        ObjectNode payload = mapper.createObjectNode();
        payload.with("channelTemplates").with("html").put("source", "<p>" + marker + "</p>");
        payload.with("outputPath").put("html", "{folder}{displayNameSlug}.{ext}");
        AssetVersionView pageTemplate = assetService.create(
                new CreateAssetCommand(
                        fx.project().getId(),
                        AssetType.PAGE_TEMPLATE,
                        displayName + " Template " + SEQ.incrementAndGet(),
                        null,
                        payload,
                        null),
                fx.ctx());
        return pageService.create(new CreatePageCommand(displayName, null, pageTemplate.uuid()), fx.ctx());
    }

    /** A fresh top-level `NAVIGATION` folder — nothing is pre-provisioned any more, so each test
     * that needs one creates its own. */
    private AssetVersionView navRoot(Fixture fx) {
        return folderService.create(null, "Nav Root " + SEQ.incrementAndGet(), FolderScope.NAVIGATION, fx.ctx());
    }

    private Fixture newFixture(String label) {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(
                "uuidcoll-user-" + n, "uuidcoll-user-" + n + "@example.com", "UuidColl User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("uuidcollp_" + n, "UuidColl Project " + n, null, null), user.getId());
        return new Fixture(project, user, label);
    }

    private record Fixture(Project project, AppUser user, String label) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }
}
