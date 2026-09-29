package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

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
import com.acme.staticforge.urlregistry.UrlTarget;
import com.acme.staticforge.urlregistry.UrlRegistryService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * End-to-end proof (`M8.2.3`) that {@code $CMS_NAVIGATION}'s {@code PAGE_REFERENCE} hrefs are
 * spliced through {@code UrlRegistryService} at both render swap points —
 * {@code GenerationRenderer.navHref} (area {@code GENERATED}) and
 * {@code PageRenderService.navHref} (area {@code PREVIEW}):
 *
 * <ul>
 *   <li>{@code GENERATED}-area URL stability across two full generation runs with an intervening
 *       content edit (a target page rename, which changes its slug/URL) — this was NOT true
 *       before this task, since {@code GenerationRenderer} used to call
 *       {@code paths.resolvePageUrl} fresh on every render;
 *   <li>{@code PREVIEW} and {@code GENERATED} areas are resolved and cached independently — an
 *       {@code override} visible in one area does not leak into the other.
 * </ul>
 *
 * Complements {@code UrlRegistryServiceIntegrationTest} (which proves the same read-through-cache
 * contract directly against {@code UrlRegistryService}, without a render pipeline around it) and
 * {@code GenerationRendererNavigationTest} (sf-generate, which proves the routing/area wiring at
 * the unit level with a fake registry).
 */
@SpringBootTest
@ActiveProfiles("test")
class NavigationUrlRegistryIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final Pattern HREF = Pattern.compile("href=\"([^\"]*)\"");

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-navreg-test");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired FolderService folderService;
    @Autowired PageService pageService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired ReleaseFixtures releaseFixtures;
    @Autowired PageRenderService pageRenderService;
    @Autowired UrlRegistryService urlRegistryService;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void generatedUrlIsStableAcrossTwoGenerationRunsWithAnInterveningPageRename() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView navRoot = navRoot(fx);
        AssetVersionView targetPage = createTargetPage(fx, "Original Title");
        AssetVersionView pageRef = createNavRef(fx, navRoot, targetPage, "Original Title Link");
        createHomePage(fx, navRoot);
        GenerationTarget target = createTarget(fx);

        long runId1 = runGenerationToSuccess(fx, target);
        String href1 = navHrefFromOutput(fx, target, runId1);

        // Rename the target page: its slug-derived URL would be different if the href were
        // recomputed fresh (as it was before `M8.2.3`).
        assetService.update(
                targetPage.uuid(),
                new UpdateAssetCommand("Renamed Title", targetPage.payload()),
                targetPage.validFromRevision(),
                fx.ctx());

        long runId2 = runGenerationToSuccess(fx, target);
        String href2 = navHrefFromOutput(fx, target, runId2);

        assertThat(href2).isEqualTo(href1);
        assertThat(urlRegistryService.resolvePageReference(pageRef.uuid(), "html", UrlArea.GENERATED, null, fx.ctx()))
                .isEqualTo(href1);
    }

    @Test
    void previewAndGeneratedAreasAreResolvedAndCachedIndependently() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView navRoot = navRoot(fx);
        AssetVersionView targetPage = createTargetPage(fx, "About Us");
        AssetVersionView pageRef = createNavRef(fx, navRoot, targetPage, "About Us Link");
        AssetVersionView homePage = createHomePage(fx, navRoot);
        GenerationTarget target = createTarget(fx);

        long runId = runGenerationToSuccess(fx, target);
        String generatedHref = navHrefFromOutput(fx, target, runId);

        String previewHtml = pageRenderService.renderPage(fx.project().getId(), homePage.uuid(), null, "html", false);
        String previewHref = firstHref(previewHtml);

        // Both areas compute via the exact same algorithm on first access (`M8.2.2`'s "net
        // effect" note), so they start out equal...
        assertThat(previewHref).isEqualTo(generatedHref);

        // ...but overriding PREVIEW only must not leak into GENERATED.
        urlRegistryService.override(
                UrlTarget.page(targetPage.uuid()), "html", UrlArea.PREVIEW, "", "custom/preview-only.html", fx.ctx());

        String previewHtmlAfterOverride =
                pageRenderService.renderPage(fx.project().getId(), homePage.uuid(), null, "html", false);
        assertThat(firstHref(previewHtmlAfterOverride)).isEqualTo("custom/preview-only.html");

        long runId2 = runGenerationToSuccess(fx, target);
        String generatedHrefAfterPreviewOverride = navHrefFromOutput(fx, target, runId2);
        assertThat(generatedHrefAfterPreviewOverride).isEqualTo(generatedHref);
        assertThat(urlRegistryService.resolvePageReference(pageRef.uuid(), "html", UrlArea.GENERATED, null, fx.ctx()))
                .isEqualTo(generatedHref);
    }

    // ------------------------------------------------------------------
    // Generation run helpers
    // ------------------------------------------------------------------

    private long runGenerationToSuccess(Fixture fx, GenerationTarget target) throws InterruptedException {
        releaseFixtures.releaseAll(fx.project().getKey());
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

    private String navHrefFromOutput(Fixture fx, GenerationTarget target, long runId) throws IOException {
        Path homeFile = TargetLocations.resolve(outputRoot, fx.project().getKey(), target).resolve("builds").resolve(String.valueOf(runId)).resolve("index.html");
        assertThat(Files.isRegularFile(homeFile)).as("home output file exists").isTrue();
        return firstHref(Files.readString(homeFile));
    }

    private static String firstHref(String html) {
        Matcher matcher = HREF.matcher(html);
        assertThat(matcher.find()).as("html contains an href: %s", html).isTrue();
        return matcher.group(1);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private GenerationTarget createTarget(Fixture fx) throws IOException {
        return targetRepository.save(new GenerationTarget(
                fx.project().getId(),
                "default",
                TargetType.FILESYSTEM,
                mapper.readTree("{\"baseUrl\":\"https://example.com\"}"),
                true));
    }

    /**
     * The home page: {@code $CMS_NAVIGATION(nav:<navRootUid>)$}, output to a fixed
     * {@code index.html}. Built via {@code assetService.create} directly (not
     * {@code TemplateService}, which compile-validates OCTL sources at save time through a
     * {@code ReferenceResolver} that predates `M8.1.4`'s {@code nav:} accessor kind and does not
     * yet resolve it — a pre-existing gap in {@code TemplateServiceImpl}, out of this task's
     * scope) so the fixture can use a real {@code $CMS_NAVIGATION} source.
     */
    private AssetVersionView createHomePage(Fixture fx, AssetVersionView navRoot) {
        ObjectNode payload = mapper.createObjectNode();
        payload.with("channelTemplates").with("html").put("source", "$CMS_NAVIGATION(nav:" + navRoot.uid() + ")$");
        payload.with("outputPath").put("html", "index.html");
        AssetVersionView homeTemplate = assetService.create(
                new CreateAssetCommand(
                        fx.project().getId(), AssetType.PAGE_TEMPLATE, "Home Template " + SEQ.incrementAndGet(), null, payload, null),
                fx.ctx());
        return pageService.create(new CreatePageCommand("Home", null, homeTemplate.uuid()), fx.ctx());
    }

    /** A target page whose output URL is slug-derived, so a rename changes it if recomputed. */
    private AssetVersionView createTargetPage(Fixture fx, String displayName) {
        ObjectNode payload = mapper.createObjectNode();
        payload.with("channelTemplates").with("html").put("source", "<p>target</p>");
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

    private AssetVersionView createNavRef(Fixture fx, AssetVersionView navRoot, AssetVersionView targetPage, String label) {
        return pageReferenceService.create(
                new CreatePageReferenceCommand(label, navRoot.uuid(), PageReferenceTargetKind.PAGE, targetPage.uuid(), null),
                fx.ctx());
    }

    /** A fresh top-level `NAVIGATION` folder — nothing is pre-provisioned any more, so each test
     * that needs one creates its own. */
    private AssetVersionView navRoot(Fixture fx) {
        return folderService.create(null, "Nav Root " + SEQ.incrementAndGet(), FolderScope.NAVIGATION, fx.ctx());
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create("navreg-user-" + n, "navreg-user-" + n + "@example.com", "NavReg User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("navregp_" + n, "NavReg Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }
}
