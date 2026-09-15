package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.folder.StartNode;
import com.acme.staticforge.asset.folder.StartNodeKind;
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
import com.acme.staticforge.urlregistry.ResetScope;
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
 * {@code M8.3.1} — the epic's closing end-to-end journey: one coherent scenario that builds a
 * navigation tree with both a {@code PageReference} kinds ({@code PAGE} and {@code FOLDER}), a
 * {@code startNode}-configured grouping folder, renders it through {@code $CMS_NAVIGATION}, and
 * exercises the full URL-registry lifecycle (assign, stability across a rename, reset,
 * reassignment, PREVIEW/GENERATED independence) against a real generation pipeline.
 *
 * <p>This does not duplicate the piecemeal coverage already proving each mechanic in isolation —
 * {@code NavigationUrlRegistryIntegrationTest} (flat {@code PAGE}-kind reference only),
 * {@code GenerationRendererNavigationTest} (fake registry, snapshot-only), {@code
 * NavigationHtmlGoldenTest} (rendering shape only) — it is the one journey that combines a
 * {@code FOLDER}-kind reference resolving into a 3-page folder, a folder's own {@code startNode}
 * pointing at that same reference, and the registry lifecycle, all in a single render/generate
 * pass, the way a real project would actually use the feature.
 *
 * <p>Honest scope note: a genuine browser-driven Playwright run was not feasible in this
 * environment — {@code ui/e2e/README.md} records that the demo seed the gated specs need is
 * still deferred and no interactive browser is available here, exactly the situation M5/M6/M7
 * already documented for their own journeys. This test is the substitute the task file's Goals
 * section explicitly sanctions for that case: a real {@code @SpringBootTest} exercising the full
 * flow via service calls end-to-end, in the same style as {@code NavigationUrlRegistryIntegrationTest}.
 */
@SpringBootTest
@ActiveProfiles("test")
class M8NavigationJourneyIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-m8-journey-test");
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
    @Autowired PageRenderService pageRenderService;
    @Autowired UrlRegistryService urlRegistryService;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void fullNavigationAndUrlRegistryJourney() throws Exception {
        Fixture fx = newFixture();

        // ------------------------------------------------------------------
        // 1. Page store: a "Catalog" folder with 3 pages (alphabetically-first "Page A" is the
        //    deterministic first-navigable-page), plus a standalone "Contact Page".
        // ------------------------------------------------------------------
        // Pages/media stores have no explicit auto-created root asset (unlike NAVIGATION) --
        // `null` parentFolderUuid means the implicit root, same as `CreatePageCommand`'s own
        // `folderUuid` null case.
        AssetVersionView catalogFolder = folderService.create(null, "Catalog", FolderScope.PAGES, fx.ctx());
        AssetVersionView pageA = createPage(fx, catalogFolder.uuid(), "Page A");
        createPage(fx, catalogFolder.uuid(), "Page B");
        createPage(fx, catalogFolder.uuid(), "Page C");
        AssetVersionView contactPage = createPage(fx, null, "Contact Page");

        // ------------------------------------------------------------------
        // 2. Navigation store: root -> "Products" folder (initially no startNode) -> a
        //    FOLDER-kind PageReference targeting the Catalog folder, plus a top-level PAGE-kind
        //    PageReference targeting Contact Page directly.
        // ------------------------------------------------------------------
        AssetVersionView navRoot = navRootFolder(fx);
        AssetVersionView products =
                folderService.create(navRoot.uuid(), "Products", FolderScope.NAVIGATION, fx.ctx());
        AssetVersionView catalogRef = pageReferenceService.create(
                new CreatePageReferenceCommand(
                        "catalog-ref", products.uuid(), PageReferenceTargetKind.FOLDER, catalogFolder.uuid(), "Browse Catalog"),
                fx.ctx());
        AssetVersionView contactRef = pageReferenceService.create(
                new CreatePageReferenceCommand(
                        "contact-ref", navRoot.uuid(), PageReferenceTargetKind.PAGE, contactPage.uuid(), "Contact"),
                fx.ctx());

        // 2b. Set "Products"' startNode to the folder-targeted reference, so the folder itself
        // becomes clickable and resolves through the same chain.
        products = folderService.updateStartNode(
                products.uuid(),
                new StartNode(StartNodeKind.PAGE_REFERENCE, catalogRef.uuid()),
                products.validFromRevision(),
                fx.ctx());

        // ------------------------------------------------------------------
        // 3-4. A home page whose template renders $CMS_NAVIGATION(nav:root)$; generate the HTML
        // channel and verify the rendered hrefs.
        // ------------------------------------------------------------------
        AssetVersionView homePage = createHomePage(fx, navRoot);
        GenerationTarget target = createTarget(fx);

        long runId1 = runGenerationToSuccess(fx, target);
        String html1 = navHtmlFromOutput(fx, target, runId1);

        String contactHref1 = hrefFor(html1, "Contact");
        String productsHref1 = hrefFor(html1, "Products");
        String catalogRefHref1 = hrefFor(html1, "Browse Catalog");

        assertThat(contactHref1)
                .as("top-level PAGE-kind reference resolves through the registry, keyed on its own uuid")
                .isEqualTo(urlRegistryService.resolve(contactRef.uuid(), "html", UrlArea.GENERATED, fx.ctx()));
        // "Products" (the folder's own link, via its startNode) and the nested "Browse Catalog"
        // reference both resolve to Page A -- the first navigable page of the Catalog folder --
        // so they must point at the exact same URL.
        assertThat(productsHref1).isEqualTo(catalogRefHref1);
        assertThat(catalogRefHref1)
                .as("catalog reference URL is registry-assigned for its own PageReference uuid")
                .isEqualTo(urlRegistryService.resolve(catalogRef.uuid(), "html", UrlArea.GENERATED, fx.ctx()));

        // ------------------------------------------------------------------
        // 5. Rename the target page (Page A); regenerate; the registry-backed reference href
        // (Browse Catalog) must be UNCHANGED (stability), even though a fresh computation would
        // now produce a different slug-derived URL.
        // ------------------------------------------------------------------
        assetService.update(
                pageA.uuid(), new UpdateAssetCommand("Page A Renamed", pageA.payload()), pageA.validFromRevision(), fx.ctx());

        long runId2 = runGenerationToSuccess(fx, target);
        String html2 = navHtmlFromOutput(fx, target, runId2);
        String catalogRefHref2 = hrefFor(html2, "Browse Catalog");

        assertThat(catalogRefHref2)
                .as("registry-backed URL is stable across a rename of the resolved target page")
                .isEqualTo(catalogRefHref1);
        assertThat(urlRegistryService.resolve(catalogRef.uuid(), "html", UrlArea.GENERATED, fx.ctx()))
                .isEqualTo(catalogRefHref1);

        // ------------------------------------------------------------------
        // 6. Reset the registry for the "html" channel; regenerate; the URL must now reflect the
        // rename.
        // ------------------------------------------------------------------
        urlRegistryService.reset(fx.project().getId(), ResetScope.channel("html"), fx.ctx());

        long runId3 = runGenerationToSuccess(fx, target);
        String html3 = navHtmlFromOutput(fx, target, runId3);
        String catalogRefHref3 = hrefFor(html3, "Browse Catalog");

        assertThat(catalogRefHref3)
                .as("URL is reassigned to reflect the rename after an explicit channel reset")
                .isNotEqualTo(catalogRefHref1);
        assertThat(urlRegistryService.resolve(catalogRef.uuid(), "html", UrlArea.GENERATED, fx.ctx()))
                .isEqualTo(catalogRefHref3);

        // ------------------------------------------------------------------
        // 7. PREVIEW-area URLs are independent of GENERATED-area ones: rendering the home page
        // live starts PREVIEW off equal to the current GENERATED value (same algorithm, first
        // access), but a PREVIEW-only override must never leak into GENERATED nor be affected by
        // a later GENERATED-only reset/regeneration.
        // ------------------------------------------------------------------
        String previewHtmlBefore = pageRenderService.renderPage(fx.project().getId(), homePage.uuid(), null, "html", false);
        String previewHrefBefore = hrefFor(previewHtmlBefore, "Browse Catalog");
        assertThat(previewHrefBefore).isEqualTo(catalogRefHref3);

        urlRegistryService.override(catalogRef.uuid(), "html", UrlArea.PREVIEW, "preview-only/catalog.html", fx.ctx());

        String previewHtmlAfter = pageRenderService.renderPage(fx.project().getId(), homePage.uuid(), null, "html", false);
        assertThat(hrefFor(previewHtmlAfter, "Browse Catalog")).isEqualTo("preview-only/catalog.html");

        long runId4 = runGenerationToSuccess(fx, target);
        String html4 = navHtmlFromOutput(fx, target, runId4);
        assertThat(hrefFor(html4, "Browse Catalog"))
                .as("PREVIEW override never leaks into GENERATED")
                .isEqualTo(catalogRefHref3);
        assertThat(urlRegistryService.resolve(catalogRef.uuid(), "html", UrlArea.GENERATED, fx.ctx()))
                .isEqualTo(catalogRefHref3);
    }

    // ------------------------------------------------------------------
    // Generation run helpers
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

    private String navHtmlFromOutput(Fixture fx, GenerationTarget target, long runId) throws IOException {
        Path homeFile = TargetLocations.resolve(outputRoot, fx.project().getKey(), target).resolve("builds").resolve(String.valueOf(runId)).resolve("index.html");
        assertThat(Files.isRegularFile(homeFile)).as("home output file exists").isTrue();
        return Files.readString(homeFile);
    }

    private static String hrefFor(String html, String label) {
        Pattern pattern = Pattern.compile("<a href=\"([^\"]*)\">" + Pattern.quote(label) + "</a>");
        Matcher matcher = pattern.matcher(html);
        assertThat(matcher.find()).as("html contains a link labeled '%s': %s", label, html).isTrue();
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

    /** The home page: {@code $CMS_NAVIGATION(nav:<navRootUid>)$}, output to a fixed {@code index.html}. */
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

    /** A page whose output URL is slug-derived, so a rename changes it if recomputed. */
    private AssetVersionView createPage(Fixture fx, java.util.UUID folderUuid, String displayName) {
        ObjectNode payload = mapper.createObjectNode();
        payload.with("channelTemplates").with("html").put("source", "<p>" + displayName + "</p>");
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
        return pageService.create(new CreatePageCommand(displayName, folderUuid, pageTemplate.uuid()), fx.ctx());
    }

    /** A fresh top-level `NAVIGATION` folder — nothing is pre-provisioned any more, so each test
     * that needs one creates its own. */
    private AssetVersionView navRootFolder(Fixture fx) {
        return folderService.create(null, "Nav Root " + SEQ.incrementAndGet(), FolderScope.NAVIGATION, fx.ctx());
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create("m8journey-user-" + n, "m8journey-user-" + n + "@example.com", "M8 Journey User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("m8journeyp_" + n, "M8 Journey Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }
}
