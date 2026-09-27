package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import com.acme.staticforge.BuildInsightFixtures.Fixture;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.navigation.CreatePageReferenceCommand;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.navigation.PageReferenceTargetKind;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.channel.OutputChannel;
import com.acme.staticforge.channel.UpdateChannelRequest;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationRunProbe;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.PlanInsight;
import com.acme.staticforge.generate.RedirectFormat;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.target.BuildManifest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.redirect.RedirectEntry;
import com.acme.staticforge.redirect.RedirectKind;
import com.acme.staticforge.redirect.RedirectService;
import com.acme.staticforge.redirect.RedirectService.AutoCandidate;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.util.FileSystemUtils;

/**
 * Redirect detection in real builds (M30.4.2, epic decisions 15, 16) on a filesystem target: every way a page's output
 * path changes — a move to another folder, a UID change, a folder rename, a template {@code outputPath} change, a channel
 * {@code urlStrategy} change — adds {@code AUTO} redirects on the next FULL and INCREMENTAL build; a failed or cancelled
 * build adds none; chains, shadowing, languages, pagination, a promote and the dry run.
 */
@SpringBootTest
@ActiveProfiles("test")
class RedirectDetectionIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final String DEFAULT_PATH = "{folder}{uid}.{ext}";

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-m30-redirect-detection");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired AssetRepository assetRepository;
    @Autowired TemplateService templateService;
    @Autowired MediaService mediaService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired PageService pageService;
    @Autowired FolderService folderService;
    @Autowired ChannelService channelService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired ReleaseFixtures releaseFixtures;
    @Autowired ReleaseService releaseService;
    @Autowired RedirectService redirectService;
    @Autowired RunLatches latches;

    private final ObjectMapper mapper = new ObjectMapper();
    private BuildInsightFixtures build;

    @BeforeEach
    void setUp() {
        build = new BuildInsightFixtures(userService, projectService, assetService, assetRepository, templateService,
                mediaService, pageReferenceService, targetRepository, generationService, releaseFixtures, outputRoot);
    }

    /** {@code home} at the root and {@code about} in folder {@code docs}, both on {@code template}. */
    private record Site(Fixture fx, GenerationTarget target, TemplateView template, UUID docs, UUID home, UUID about) {}

    private Site site(String prefix) {
        return site(prefix, false);
    }

    private Site site(String prefix, boolean localized) {
        Fixture fx = build.project(prefix + SEQ.incrementAndGet());
        String path = DEFAULT_PATH;
        if (localized) {
            projectService.updateLocales(fx.project().getKey(), LocaleConfig.of(
                    List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English")), "de", Map.of(), false),
                    true, fx.ctx());
            path = "{locale}/" + path;
        }
        TemplateView template = template(fx, "Page", "<p>page</p>", path);
        UUID docs = folderService.create(null, "docs", FolderScope.PAGES, fx.ctx()).uuid();
        UUID home = pageService.create(new CreatePageCommand("home", null, template.uuid()), fx.ctx()).uuid();
        UUID about = pageService.create(new CreatePageCommand("about", docs, template.uuid()), fx.ctx()).uuid();
        return new Site(fx, target(fx), template, docs, home, about);
    }

    // ------------------------------------------------------------------
    // Every kind of path change, FULL and INCREMENTAL
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a page moved to another folder adds an AUTO redirect (FULL and INCREMENTAL)")
    void movedToAnotherFolder() {
        for (GenerationMode mode : GenerationMode.values()) {
            Site site = site("rdmove");
            UUID guides = folderService.create(null, "guides", FolderScope.PAGES, site.fx().ctx()).uuid();
            List<RedirectEntry> added = detects(site, mode, s -> assetService.move(s.about(), guides, s.fx().ctx()));
            assertThat(added).extracting(RedirectEntry::getFromPath).containsExactly("docs/about.html");
        }
    }

    @Test
    @DisplayName("a UID change adds an AUTO redirect (FULL and INCREMENTAL)")
    void uidChange() {
        for (GenerationMode mode : GenerationMode.values()) {
            Site site = site("rduid");
            List<RedirectEntry> added = detects(site, mode, s -> assetService.changeUid(s.about(), "about_us", s.fx().ctx()));
            assertThat(added).extracting(RedirectEntry::getFromPath).containsExactly("docs/about.html");
        }
    }

    /**
     * A folder's path segment is its UID as materialized when it was placed ({@code folder_path}); what changes the folder
     * part of its pages' output paths is placing it elsewhere — its path and every descendant's are rewritten.
     */
    @Test
    @DisplayName("a folder moved (its path renamed) adds an AUTO redirect for every page in it (FULL and INCREMENTAL)")
    void folderPathChange() {
        for (GenerationMode mode : GenerationMode.values()) {
            Site site = site("rdfolder");
            UUID archive = folderService.create(null, "archive", FolderScope.PAGES, site.fx().ctx()).uuid();
            List<RedirectEntry> added = detects(site, mode, s -> folderService.move(s.docs(), archive, s.fx().ctx()));
            assertThat(added).extracting(RedirectEntry::getFromPath).containsExactly("docs/about.html");
        }
    }

    @Test
    @DisplayName("a template outputPath change adds an AUTO redirect for each of its pages (FULL and INCREMENTAL)")
    void templateOutputPathChange() {
        for (GenerationMode mode : GenerationMode.values()) {
            Site site = site("rdtpl");
            List<RedirectEntry> added = detects(site, mode,
                    s -> build.updateTemplate(s.fx(), s.template().uuid(), "<p>page</p>", "{folder}{uid}-page.{ext}"));
            assertThat(added).extracting(RedirectEntry::getFromPath).containsExactlyInAnyOrder("home.html", "docs/about.html");
        }
    }

    @Test
    @DisplayName("a channel urlStrategy change adds an AUTO redirect for every page (FULL and INCREMENTAL)")
    void channelUrlStrategyChange() {
        for (GenerationMode mode : GenerationMode.values()) {
            Site site = site("rdchan");
            List<RedirectEntry> added = detects(site, mode, s -> prettyUrls(s.fx()));
            assertThat(added).extracting(RedirectEntry::getFromPath).containsExactlyInAnyOrder("home.html", "docs/about.html");
        }
    }

    /**
     * Builds {@code site} FULL, applies {@code change}, builds with {@code mode}, and checks that the second build added
     * exactly one {@code AUTO} redirect per page output whose path differs between the two builds' manifests — from the
     * old path to the page — stored with the run, counted in its plan summary and emitted to the new path.
     *
     * @return the redirects the second build added
     */
    private List<RedirectEntry> detects(Site site, GenerationMode mode, Consumer<Site> change) {
        GenerationRun first = build.succeeded(generate(site, GenerationMode.FULL));
        assertThat(redirects(site)).isEmpty();
        assertThat(summary(site.fx(), first).path(PlanInsight.REDIRECTS_ADDED).asInt(-1)).isZero();
        change.accept(site);

        GenerationRun second = build.succeeded(generate(site, mode));

        Map<String, String> moved = moved(manifest(site, first), manifest(site, second));
        assertThat(moved).as("mode %s", mode).isNotEmpty();
        List<RedirectEntry> entries = redirects(site);
        assertThat(entries).as("mode %s", mode)
                .extracting(RedirectEntry::getKind, RedirectEntry::getSourceRunId, RedirectEntry::getFromPath)
                .containsExactlyInAnyOrderElementsOf(moved.keySet().stream()
                        .map(from -> tuple(RedirectKind.AUTO, second.getId(), from))
                        .toList());
        assertThat(entries).allSatisfy(entry -> assertThat(entry.getToAssetUuid()).isNotNull());
        assertThat(summary(site.fx(), second).path(PlanInsight.REDIRECTS_ADDED).asInt()).isEqualTo(moved.size());
        assertThat(summary(site.fx(), second).path(PlanInsight.REDIRECTS_ACTIVE).asInt()).isEqualTo(moved.size());
        assertThat(emitted(site, second)).containsExactlyInAnyOrderEntriesOf(moved);
        return entries;
    }

    // ------------------------------------------------------------------
    // Failed and cancelled builds
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a build whose publish fails adds no redirect")
    void aFailedBuildAddsNone() throws Exception {
        Site site = site("rdfail");
        build.succeeded(generate(site, GenerationMode.FULL));
        assetService.changeUid(site.about(), "about_us", site.fx().ctx());
        releaseFixtures.releaseAll(site.fx().projectId());

        RunLatches.Gate gate = latches.arm(site.fx().projectId(), GenerationRunProbe.PUBLISH);
        try {
            GenerationRun started = generationService.start(site.fx().project().getKey(), request(site, GenerationMode.FULL),
                    site.fx().user().getId());
            long runId = gate.awaitArrival();
            // The staged build vanishes: publishing it fails inside the run's final transaction.
            FileSystemUtils.deleteRecursively(build.targetDir(site.fx(), site.target()).resolve("builds").resolve(
                    String.valueOf(runId)));
            gate.release();
            GenerationRun failed = build.await(site.fx(), started.getId());
            assertThat(failed.getStatus()).isEqualTo(RunStatus.FAILED);
        } finally {
            latches.disarm(site.fx().projectId(), GenerationRunProbe.PUBLISH);
        }
        assertThat(redirects(site)).isEmpty();
    }

    @Test
    @DisplayName("a cancelled build adds no redirect")
    void aCancelledBuildAddsNone() throws Exception {
        Site site = site("rdcancel");
        build.succeeded(generate(site, GenerationMode.FULL));
        assetService.changeUid(site.about(), "about_us", site.fx().ctx());
        releaseFixtures.releaseAll(site.fx().projectId());

        RunLatches.Gate gate = latches.arm(site.fx().projectId(), GenerationRunProbe.PUBLISH);
        try {
            GenerationRun started = generationService.start(site.fx().project().getKey(), request(site, GenerationMode.FULL),
                    site.fx().user().getId());
            gate.awaitArrival();
            generationService.cancel(site.fx().project().getKey(), started.getId(), site.fx().user().getId());
            gate.release();
            assertThat(build.await(site.fx(), started.getId()).getStatus()).isEqualTo(RunStatus.CANCELLED);
        } finally {
            latches.disarm(site.fx().projectId(), GenerationRunProbe.PUBLISH);
        }
        assertThat(redirects(site)).isEmpty();
    }

    // ------------------------------------------------------------------
    // Chains, shadowing, promote
    // ------------------------------------------------------------------

    @Test
    @DisplayName("A → B, then B → C: two AUTO entries, both emitted to C in one hop")
    void chainsCollapse() {
        Site site = site("rdchain");
        build.succeeded(generate(site, GenerationMode.FULL));
        assetService.changeUid(site.about(), "about_b", site.fx().ctx());
        GenerationRun second = build.succeeded(generate(site, GenerationMode.INCREMENTAL));
        assetService.changeUid(site.about(), "about_c", site.fx().ctx());
        GenerationRun third = build.succeeded(generate(site, GenerationMode.INCREMENTAL));

        assertThat(redirects(site))
                .extracting(RedirectEntry::getFromPath, RedirectEntry::getToAssetUuid, RedirectEntry::getSourceRunId)
                .containsExactly(
                        tuple("docs/about.html", site.about(), second.getId()),
                        tuple("docs/about_b.html", site.about(), third.getId()));
        assertThat(emitted(site, third)).containsExactlyInAnyOrderEntriesOf(Map.of(
                "docs/about.html", "docs/about_c.html", "docs/about_b.html", "docs/about_c.html"));
        assertThat(summary(site.fx(), third).path(PlanInsight.REDIRECTS_ADDED).asInt()).isEqualTo(1);
        assertThat(summary(site.fx(), third).path(PlanInsight.REDIRECTS_ACTIVE).asInt()).isEqualTo(2);
    }

    @Test
    @DisplayName("a new page published at the old path shadows the redirect; unpublishing it makes it active again")
    void aNewPageAtTheOldPathShadowsTheRedirect() {
        Site site = site("rdshadow");
        build.succeeded(generate(site, GenerationMode.FULL));
        assetService.changeUid(site.about(), "about_us", site.fx().ctx());
        build.succeeded(generate(site, GenerationMode.FULL));
        assertThat(redirects(site)).extracting(RedirectEntry::getFromPath).containsExactly("docs/about.html");

        UUID newcomer = pageService.create(new CreatePageCommand("about", site.docs(), site.template().uuid()), site.fx().ctx())
                .uuid();
        GenerationRun shadowed = build.succeeded(generate(site, GenerationMode.INCREMENTAL));
        assertThat(build.files(site.fx(), site.target(), shadowed)).containsKey("docs/about.html");
        assertThat(emitted(site, shadowed)).isEmpty();
        assertThat(summary(site.fx(), shadowed).path(PlanInsight.REDIRECTS_ACTIVE).asInt()).isZero();
        assertThat(redirects(site)).hasSize(1);

        releaseService.unpublish(List.of(ReleaseItem.of(newcomer)), RevisionContext.of(site.fx().projectId(), null, "test"));
        GenerationRun active = build.succeeded(run(site, GenerationMode.INCREMENTAL));
        assertThat(emitted(site, active)).containsExactlyEntriesOf(Map.of("docs/about.html", "docs/about_us.html"));
        assertThat(summary(site.fx(), active).path(PlanInsight.REDIRECTS_ACTIVE).asInt()).isEqualTo(1);
    }

    @Test
    @DisplayName("detection compares with the build the target serves: after a promote, with the promoted build")
    void comparesWithThePromotedBuild() {
        Site site = site("rdpromote");
        GenerationRun first = build.succeeded(generate(site, GenerationMode.FULL));
        assetService.changeUid(site.about(), "about_b", site.fx().ctx());
        build.succeeded(generate(site, GenerationMode.FULL));
        generationService.promote(site.fx().project().getKey(), first.getId(), site.fx().user().getId());
        assetService.changeUid(site.about(), "about_c", site.fx().ctx());

        GenerationRun third = build.succeeded(generate(site, GenerationMode.FULL));

        // The target served the promoted first build (about.html): about_b.html was never seen by it.
        assertThat(redirects(site))
                .extracting(RedirectEntry::getFromPath, RedirectEntry::getSourceRunId)
                .containsExactly(tuple("docs/about.html", third.getId()));
        assertThat(summary(site.fx(), third).path(PlanInsight.REDIRECTS_ADDED).asInt()).isEqualTo(1);
    }

    // ------------------------------------------------------------------
    // Languages and pagination
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a move released in en only adds an en redirect only")
    void aMoveInOneLanguage() {
        Site site = site("rdl10n", true);
        GenerationRun first = build.succeeded(generate(site, GenerationMode.FULL));
        assertThat(manifest(site, first).outputs()).extracting(BuildManifest.Output::path)
                .contains("de/docs/about.html", "en/docs/about.html");
        UUID guides = folderService.create(null, "guides", FolderScope.PAGES, site.fx().ctx()).uuid();
        assetService.move(site.about(), guides, site.fx().ctx());
        releaseService.release(List.of(ReleaseItem.of(guides), ReleaseItem.of(site.about(), "en")),
                RevisionContext.of(site.fx().projectId(), null, "release en"));

        GenerationRun second = build.succeeded(run(site, GenerationMode.INCREMENTAL));

        assertThat(build.files(site.fx(), site.target(), second)).containsKeys("en/guides/about.html", "de/docs/about.html");
        assertThat(redirects(site))
                .extracting(RedirectEntry::getLocaleKey, RedirectEntry::getFromPath)
                .containsExactly(tuple("en", "en/docs/about.html"));
        assertThat(emitted(site, second)).containsExactlyEntriesOf(Map.of("en/docs/about.html", "en/guides/about.html"));
    }

    @Test
    @DisplayName("a moved paginated page adds one redirect per page number")
    void aMovedPaginatedPage() {
        Fixture fx = build.project("rdpage" + SEQ.incrementAndGet());
        GenerationTarget target = target(fx);
        TemplateView post = template(fx, "Post", "<p>post</p>", DEFAULT_PATH);
        UUID nav = folderService.create(null, "Blog Nav " + SEQ.incrementAndGet(), FolderScope.NAVIGATION, fx.ctx()).uuid();
        for (int i = 1; i <= 3; i++) {
            UUID page = pageService.create(new CreatePageCommand("post" + i, null, post.uuid()), fx.ctx()).uuid();
            pageReferenceService.create(
                    new CreatePageReferenceCommand("0" + i + " post", nav, PageReferenceTargetKind.PAGE, page, null), fx.ctx());
        }
        TemplateView blogTemplate = templateService.create(new CreateTemplateCommand(fx.projectId(), AssetType.PAGE_TEMPLATE,
                "Blog", "content { editor pagination posts { label \"Posts\" sources [\"nav\"] pageSize 1 } }",
                Map.of("html", "<h1>$CMS_META(pageNumber)$</h1>"), null, false, Map.of("html", DEFAULT_PATH)), fx.ctx());
        UUID news = folderService.create(null, "news", FolderScope.PAGES, fx.ctx()).uuid();
        AssetVersionView blog = pageService.create(new CreatePageCommand("blog", news, blogTemplate.uuid()), fx.ctx());
        ObjectNode payload = blog.payload().deepCopy();
        ObjectNode posts = payload.withObject("content").putObject("posts").put("type", "PAGINATION");
        posts.putObject("source").put("kind", "NAV").put("uuid", nav.toString());
        posts.put("pageSize", 1);
        posts.putObject("sort").put("key", "navigation").put("direction", "ASC");
        pageService.update(blog.uuid(), payload, blog.validFromRevision(), fx.ctx());
        build.succeeded(build.generate(fx, target, GenerationMode.FULL));
        UUID archive = folderService.create(null, "archive", FolderScope.PAGES, fx.ctx()).uuid();
        assetService.move(blog.uuid(), archive, fx.ctx());

        GenerationRun second = build.succeeded(build.generate(fx, target, GenerationMode.INCREMENTAL));

        assertThat(redirectService.all(fx.projectId()))
                .extracting(RedirectEntry::getFromPath, RedirectEntry::getToAssetUuid, RedirectEntry::getToPageNumber)
                .containsExactly(
                        tuple("news/blog-2.html", blog.uuid(), 2),
                        tuple("news/blog-3.html", blog.uuid(), 3),
                        tuple("news/blog.html", blog.uuid(), 1));
        assertThat(summary(fx, second).path(PlanInsight.REDIRECTS_ACTIVE).asInt()).isEqualTo(3);
    }

    // ------------------------------------------------------------------
    // Dry run
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the dry run names the redirects a run would add, without storing them")
    void theDryRunReportsCandidates() {
        Site site = site("rddry");
        build.succeeded(generate(site, GenerationMode.FULL));
        assetService.changeUid(site.about(), "about_us", site.fx().ctx());
        releaseFixtures.releaseAll(site.fx().projectId());

        GenerationService.DryRun dryRun =
                generationService.dryRun(site.fx().project().getKey(), request(site, GenerationMode.INCREMENTAL), false);

        assertThat(dryRun.redirectCandidates()).containsExactly(new GenerationService.PlannedRedirect(
                new AutoCandidate("html", "", "docs/about.html", site.about(), 1), "docs/about_us.html"));
        assertThat(dryRun.summary().path(PlanInsight.REDIRECTS_ADDED).asInt()).isEqualTo(1);
        assertThat(dryRun.summary().has(PlanInsight.REDIRECTS_ACTIVE)).isFalse();
        assertThat(redirects(site)).isEmpty();
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private TemplateView template(Fixture fx, String name, String html, String outputPath) {
        return templateService.create(new CreateTemplateCommand(fx.projectId(), AssetType.PAGE_TEMPLATE,
                name + " " + SEQ.incrementAndGet(), "", Map.of("html", html), null, false, Map.of("html", outputPath)),
                fx.ctx());
    }

    /** A filesystem target writing HTML stubs and {@code redirects.json}, which these tests read the redirects from. */
    private GenerationTarget target(Fixture fx) {
        GenerationTarget target = build.target(fx, "site", com.acme.staticforge.generate.TargetType.FILESYSTEM);
        ObjectNode config = mapper.createObjectNode().put("baseUrl", "https://example.com");
        config.putArray(RedirectFormat.CONFIG_KEY).add(RedirectFormat.HTML_STUB.name()).add(RedirectFormat.JSON.name());
        target.setConfig(config);
        return targetRepository.save(target);
    }

    private void prettyUrls(Fixture fx) {
        OutputChannel html = channelService.list(fx.projectId()).stream()
                .filter(channel -> channel.getKey().equals("html"))
                .findFirst()
                .orElseThrow();
        ObjectNode settings = mapper.createObjectNode().put("urlStrategy", "PRETTY").put("trailingSlash", true);
        channelService.update("html", new UpdateChannelRequest(html.getName(), html.getFileExtension(), html.getMimeType(),
                html.getDefaultEscaping(), html.isEnabled(), html.isDefaultChannel(), html.getPosition(), settings), fx.ctx());
    }

    private GenerationRequest request(Site site, GenerationMode mode) {
        return new GenerationRequest(mode, null, List.of("html"), site.target().getId(), null, null, null, null);
    }

    /** Releases everything and builds. */
    private GenerationRun generate(Site site, GenerationMode mode) {
        return build.generate(site.fx(), site.target(), mode);
    }

    /** Builds the release state as it is. */
    private GenerationRun run(Site site, GenerationMode mode) {
        GenerationRun started = generationService.start(
                site.fx().project().getKey(), request(site, mode), site.fx().user().getId());
        return build.await(site.fx(), started.getId());
    }

    private List<RedirectEntry> redirects(Site site) {
        return redirectService.all(site.fx().projectId());
    }

    /** The stored plan summary of {@code run}, as the run view reads it. */
    private JsonNode summary(Fixture fx, GenerationRun run) {
        return generationService.status(fx.project().getKey(), run.getId()).getPlanSummary();
    }

    private BuildManifest manifest(Site site, GenerationRun run) {
        Path file = build.targetDir(site.fx(), site.target()).resolve("builds").resolve(run.getId() + ".manifest.json");
        try {
            return BuildManifest.parse(Files.readAllBytes(file)).orElseThrow();
        } catch (IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
    }

    /** Old path → new path of every page output (asset, channel, locale, page number) whose path differs. */
    private static Map<String, String> moved(BuildManifest before, BuildManifest after) {
        Map<List<Object>, String> now = new HashMap<>();
        for (BuildManifest.Output output : after.outputs()) {
            if (output.kind() == BuildManifest.Kind.PAGE) {
                now.put(List.of(output.asset(), output.channel(), String.valueOf(output.locale()), output.number()),
                        output.path());
            }
        }
        Map<String, String> moved = new HashMap<>();
        for (BuildManifest.Output output : before.outputs()) {
            if (output.kind() != BuildManifest.Kind.PAGE) {
                continue;
            }
            String path = now.get(List.of(output.asset(), output.channel(), String.valueOf(output.locale()), output.number()));
            if (path != null && !path.equals(output.path())) {
                moved.put(output.path(), path);
            }
        }
        return moved;
    }

    /** The redirects {@code run} emitted ({@code redirects.json}): source → target. */
    private Map<String, String> emitted(Site site, GenerationRun run) {
        String json = build.files(site.fx(), site.target(), run).get("redirects.json");
        Map<String, String> emitted = new HashMap<>();
        if (json != null) {
            build.json(json).forEach(entry -> emitted.put(entry.path("from").asText(), entry.path("to").asText()));
        }
        return emitted;
    }
}
