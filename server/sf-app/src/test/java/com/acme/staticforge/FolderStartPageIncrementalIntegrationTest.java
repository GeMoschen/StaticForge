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
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.channel.OutputChannel;
import com.acme.staticforge.channel.UpdateChannelRequest;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.ImpactService;
import com.acme.staticforge.generate.RedirectFormat;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.generate.insight.PlanEntryRecord;
import com.acme.staticforge.generate.insight.RebuildEdgeKind;
import com.acme.staticforge.generate.insight.RebuildReason;
import com.acme.staticforge.generate.insight.RebuildRootKind;
import com.acme.staticforge.generate.insight.RebuildStep;
import com.acme.staticforge.generate.plan.BuildPlan;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.redirect.RedirectKind;
import com.acme.staticforge.redirect.RedirectService;
import com.acme.staticforge.redirect.RedirectState;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Folder start pages in incremental builds (M31.4): a change of a folder's effective start page — set, changed,
 * cleared, or the start page moved away — rebuilds exactly the pages whose output path it moves (the old and new start
 * page, the folder's {@code indexUid} page), their linkers and the pages rendering navigation to them, with the
 * {@code START_PAGE} edge in the reasons; the moved outputs get AUTO redirects, and an entry whose path the new start
 * page takes is {@code SHADOWED}.
 */
@SpringBootTest
@ActiveProfiles("test")
class FolderStartPageIncrementalIntegrationTest {

    private static final String CDL = "content { editor text title { label \"Title\" } }";

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-m31-incremental");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired AssetRepository assetRepository;
    @Autowired TemplateService templateService;
    @Autowired MediaService mediaService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired FolderService folderService;
    @Autowired ChannelService channelService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired ImpactService impactService;
    @Autowired RedirectService redirectService;
    @Autowired ReleaseFixtures releaseFixtures;

    private final ObjectMapper mapper = new ObjectMapper();
    private BuildInsightFixtures fixtures;

    @BeforeEach
    void setUp() {
        fixtures = new BuildInsightFixtures(userService, projectService, assetService, assetRepository, templateService,
                mediaService, pageReferenceService, targetRepository, generationService, releaseFixtures, outputRoot);
    }

    /**
     * At the site root: {@code home} (the channel's {@code indexUid}, so {@code index.html} while the root has no start
     * page), {@code homepage} and {@code welcome} (start page candidates), {@code linker} linking all three,
     * {@code navpage} rendering a navigation pointing at the two candidates, and the unrelated {@code legal}.
     */
    private record Site(
            Fixture fx, GenerationTarget target, UUID pagesRoot, UUID archive, UUID home, UUID homepage, UUID welcome,
            UUID linker, UUID navpage, UUID legal) {}

    private Site site(String prefix) {
        Fixture fx = fixtures.project(prefix);
        OutputChannel html = channelService.list(fx.projectId()).stream()
                .filter(channel -> channel.getKey().equals("html"))
                .findFirst()
                .orElseThrow();
        channelService.update("html", new UpdateChannelRequest(html.getName(), html.getFileExtension(), html.getMimeType(),
                html.getDefaultEscaping(), html.isEnabled(), html.isDefaultChannel(), html.getPosition(),
                mapper.createObjectNode().put("indexUid", "home")), fx.ctx());
        UUID pagesRoot = assetService.ensurePagesRootFolder(fx.projectId(), fx.ctx()).uuid();
        UUID archive = folderService.create(null, "Archive", FolderScope.PAGES, fx.ctx()).uuid();

        TemplateView plain = template(fx, "Plain", "<p>$CMS_VALUE(title)$</p>");
        UUID home = titled(fx, "Home", plain);
        UUID homepage = titled(fx, "Homepage", plain);
        UUID welcome = titled(fx, "Welcome", plain);
        TemplateView linking = template(fx, "Linking", "<a href=\"$CMS_REF(page:homepage)$\">h</a>"
                + "<a href=\"$CMS_REF(page:welcome)$\">w</a><a href=\"$CMS_REF(page:home)$\">i</a>");
        TemplateView navigating = template(fx, "Navigating", "<nav>$CMS_NAVIGATION(nav:root)$</nav>");
        UUID linker = fixtures.page(fx, "Linker", linking.uuid()).uuid();
        UUID navpage = fixtures.page(fx, "Navpage", navigating.uuid()).uuid();
        UUID legal = titled(fx, "Legal", plain);
        fixtures.pageReference(fx, "To homepage", fixtures.navigationRoot(fx), homepage);
        fixtures.pageReference(fx, "To welcome", fixtures.navigationRoot(fx), welcome);

        ObjectNode config = mapper.createObjectNode().put("baseUrl", "https://example.com");
        config.putArray(RedirectFormat.CONFIG_KEY).add(RedirectFormat.HTML_STUB.name()).add(RedirectFormat.JSON.name());
        GenerationTarget target = targetRepository.save(
                new GenerationTarget(fx.projectId(), "site", TargetType.FILESYSTEM, config, true));
        return new Site(fx, target, pagesRoot, archive, home, homepage, welcome, linker, navpage, legal);
    }

    @Test
    @DisplayName("set, change and clear the site's start page: old and new start page, the indexUid page, linkers and "
            + "navigation rebuild, nothing else; AUTO redirects follow and the old start page's index.html entry is "
            + "shadowed by the new one")
    void setChangeAndClear() {
        Site s = site("m31inc");
        Map<String, String> first = files(s, fixtures.succeeded(generate(s)));
        assertThat(first.get("index.html")).isEqualTo("<p>Home</p>");
        assertThat(first.get("homepage.html")).isEqualTo("<p>Homepage</p>");

        // Set: Homepage takes index.html from the indexUid page home.
        setStartPage(s, s.pagesRoot(), s.homepage());
        BuildPlan set = plan(s);
        assertThat(set.incremental()).isTrue();
        assertThat(plannedPages(set)).containsExactlyInAnyOrder(s.homepage(), s.home(), s.linker(), s.navpage());
        RebuildReason homepage = set.reasonFor(s.homepage());
        assertThat(homepage.rootKind()).isEqualTo(RebuildRootKind.ASSET_CHANGED);
        assertThat(homepage.rootUuid()).isEqualTo(s.pagesRoot());
        assertThat(homepage.steps()).singleElement().isEqualTo(
                new RebuildStep(s.homepage(), "PAGE", "homepage", RebuildEdgeKind.START_PAGE, null, "startPage"));
        assertThat(set.reasonFor(s.home()).steps()).singleElement().isEqualTo(
                new RebuildStep(s.home(), "PAGE", "home", RebuildEdgeKind.START_PAGE, null, "indexUid"));
        assertThat(set.reasonFor(s.navpage()).steps()).extracting(RebuildStep::edge)
                .containsExactly(RebuildEdgeKind.PAGE_TEMPLATE, RebuildEdgeKind.REFERENCE, RebuildEdgeKind.NAVIGATION,
                        RebuildEdgeKind.REFERENCE, RebuildEdgeKind.START_PAGE);

        GenerationRun afterSet = fixtures.succeeded(generate(s));
        Map<String, String> files = files(s, afterSet);
        assertThat(files.get("index.html")).isEqualTo("<p>Homepage</p>");
        assertThat(files.get("home.html")).isEqualTo("<p>Home</p>");
        assertThat(files.get("homepage.html")).contains("<meta http-equiv=\"refresh\" content=\"0; url=index.html\">");
        assertThat(files.get("linker.html")).isEqualTo(
                "<a href=\"index.html\">h</a><a href=\"welcome.html\">w</a><a href=\"home.html\">i</a>");
        // navpage renders again (its hrefs come from the URL registry, which M31.3 invalidates on a start page change).
        // The AUTO redirect homepage.html → Homepage is active; home's old index.html is Homepage's now.
        assertThat(redirects(s)).containsExactlyInAnyOrder(
                tuple("homepage.html", s.homepage(), RedirectKind.AUTO, RedirectState.ACTIVE),
                tuple("index.html", s.home(), RedirectKind.AUTO, RedirectState.SHADOWED));

        // An edit of the start page that doesn't move the index path doesn't reach the indexUid page or navigation:
        // the page and what references it (the linker's template), as for any page edit.
        fixtures.edit(s.fx(), s.homepage(), payload -> payload.withObject("content").put("title", "Homepage 2"));
        assertThat(plannedPages(plan(s))).containsExactlyInAnyOrder(s.homepage(), s.linker());
        fixtures.succeeded(generate(s));

        // Change: Welcome takes index.html, Homepage goes back to homepage.html; home keeps home.html.
        setStartPage(s, s.pagesRoot(), s.welcome());
        BuildPlan change = plan(s);
        assertThat(plannedPages(change))
                .containsExactlyInAnyOrder(s.homepage(), s.welcome(), s.home(), s.linker(), s.navpage());
        GenerationRun afterChange = fixtures.succeeded(generate(s));
        files = files(s, afterChange);
        assertThat(files.get("index.html")).isEqualTo("<p>Welcome</p>");
        assertThat(files.get("homepage.html")).isEqualTo("<p>Homepage 2</p>");
        assertThat(files.get("welcome.html")).contains("<meta http-equiv=\"refresh\" content=\"0; url=index.html\">");
        assertThat(files.get("linker.html")).isEqualTo(
                "<a href=\"homepage.html\">h</a><a href=\"index.html\">w</a><a href=\"home.html\">i</a>");
        // The old start page's index.html entry is shadowed by the new start page; the new one's entry is active.
        // Homepage is back at homepage.html, so its first entry now points at its own source: a LOOP, never emitted.
        assertThat(redirects(s)).containsExactlyInAnyOrder(
                tuple("homepage.html", s.homepage(), RedirectKind.AUTO, RedirectState.LOOP),
                tuple("index.html", s.homepage(), RedirectKind.AUTO, RedirectState.SHADOWED),
                tuple("welcome.html", s.welcome(), RedirectKind.AUTO, RedirectState.ACTIVE));

        // Clear: home takes index.html back; Homepage isn't involved.
        setStartPage(s, s.pagesRoot(), null);
        BuildPlan clear = plan(s);
        assertThat(plannedPages(clear)).containsExactlyInAnyOrder(s.welcome(), s.home(), s.linker(), s.navpage());
        files = files(s, fixtures.succeeded(generate(s)));
        assertThat(files.get("index.html")).isEqualTo("<p>Home</p>");
        assertThat(files.get("welcome.html")).isEqualTo("<p>Welcome</p>");
        assertThat(files.get("linker.html")).isEqualTo(
                "<a href=\"homepage.html\">h</a><a href=\"welcome.html\">w</a><a href=\"index.html\">i</a>");
        assertThat(plannedPages(plan(s))).as("nothing changed since").isEmpty();
        assertThat(files).containsKey("legal.html");
    }

    @Test
    @DisplayName("moving the start page out of its folder rebuilds the folder's indexUid page over the folder's "
            + "START_PAGE reference; an edit that keeps it in place doesn't")
    void movedAwayRebuildsTheIndexUidPage() {
        Site s = site("m31move");
        setStartPage(s, s.pagesRoot(), s.welcome());
        Map<String, String> first = files(s, fixtures.succeeded(generate(s)));
        assertThat(first.get("index.html")).isEqualTo("<p>Welcome</p>");
        assertThat(first.get("home.html")).isEqualTo("<p>Home</p>");

        assetService.move(s.welcome(), s.archive(), s.fx().ctx());
        BuildPlan plan = plan(s);

        assertThat(plannedPages(plan)).containsExactlyInAnyOrder(s.welcome(), s.home(), s.linker(), s.navpage());
        RebuildReason home = plan.reasonFor(s.home());
        assertThat(home.rootUuid()).isEqualTo(s.welcome());
        assertThat(home.steps()).containsExactly(
                new RebuildStep(s.home(), "PAGE", "home", RebuildEdgeKind.START_PAGE, null, "indexUid"),
                new RebuildStep(s.pagesRoot(), "FOLDER", "pages_root", RebuildEdgeKind.REFERENCE, "START_PAGE", "startPage"));
        GenerationRun run = generate(s);
        // The pointer is stale now: the folder falls back to the indexUid rule with a warning.
        assertThat(run.getStatus()).isEqualTo(RunStatus.PARTIAL);
        assertThat(run.getDiagnostics().toString()).contains("SF-GEN-0112");
        Map<String, String> files = files(s, run);
        assertThat(files.get("index.html")).isEqualTo("<p>Home</p>");
        assertThat(files.get("archive/welcome.html")).isEqualTo("<p>Welcome</p>");
        assertThat(files.get("linker.html")).isEqualTo(
                "<a href=\"homepage.html\">h</a><a href=\"archive/welcome.html\">w</a><a href=\"index.html\">i</a>");
    }

    @Test
    @DisplayName("a page linking a folder by $CMS_REF(folder:…) rebuilds when the folder's start page is set or cleared, "
            + "and not for an unrelated edit")
    void folderLinkersRebuild() {
        Site s = site("m31flink");
        UUID products = folderService.create(null, "Products", FolderScope.PAGES, s.fx().ctx()).uuid();
        TemplateView plain = template(s.fx(), "Product", "<p>$CMS_VALUE(title)$</p>");
        UUID overview = titled(s.fx(), "Overview", plain);
        assetService.move(overview, products, s.fx().ctx());
        UUID hammer = titled(s.fx(), "Hammer", plain);
        assetService.move(hammer, products, s.fx().ctx());
        TemplateView folderLinking = template(s.fx(), "Folder linking", "<a href=\"$CMS_REF(folder:products)$\">p</a>");
        UUID folderLinker = fixtures.page(s.fx(), "Folder linker", folderLinking.uuid()).uuid();
        fixtures.succeeded(generate(s));

        setStartPage(s, products, overview);
        BuildPlan set = plan(s);
        assertThat(plannedPages(set)).containsExactlyInAnyOrder(overview, folderLinker);
        assertThat(set.reasonFor(overview).steps()).singleElement().isEqualTo(
                new RebuildStep(overview, "PAGE", "overview", RebuildEdgeKind.START_PAGE, null, "startPage"));
        RebuildReason linker = set.reasonFor(folderLinker);
        assertThat(linker.rootUuid()).isEqualTo(products);
        assertThat(linker.steps()).extracting(RebuildStep::edge)
                .containsExactly(RebuildEdgeKind.PAGE_TEMPLATE, RebuildEdgeKind.REFERENCE);
        Map<String, String> files = files(s, fixtures.succeeded(generate(s)));
        assertThat(files.get("products/index.html")).isEqualTo("<p>Overview</p>");

        // An edit that doesn't touch the folder's index doesn't reach the folder's linkers.
        fixtures.edit(s.fx(), hammer, payload -> payload.withObject("content").put("title", "Hammer 2"));
        assertThat(plannedPages(plan(s))).containsExactly(hammer);
        fixtures.succeeded(generate(s));

        setStartPage(s, products, null);
        assertThat(plannedPages(plan(s))).containsExactlyInAnyOrder(overview, folderLinker);
    }

    @Test
    @DisplayName("impact of a pages folder: its start page and indexUid page over START_PAGE, and what links them")
    void impactOfTheFolder() {
        Site s = site("m31impact");
        setStartPage(s, s.pagesRoot(), s.homepage());
        releaseFixtures.releaseAll(s.fx().project().getKey());

        ImpactService.Impact impact = impactService.impact(s.fx().project().getKey(), s.pagesRoot(), "html");

        assertThat(impact.entries()).extracting(PlanEntryRecord::assetUuid)
                .containsExactlyInAnyOrder(s.homepage(), s.home(), s.linker(), s.navpage());
        assertThat(impact.byFirstEdge()).containsEntry(RebuildEdgeKind.START_PAGE.name(), 2);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private TemplateView template(Fixture fx, String name, String html) {
        // No outputPath: the default {folder}{uid}.{ext}, so the indexUid rule applies.
        return templateService.create(new CreateTemplateCommand(
                fx.projectId(), AssetType.PAGE_TEMPLATE, name, CDL, Map.of("html", html), null, false, Map.of()), fx.ctx());
    }

    private UUID titled(Fixture fx, String name, TemplateView template) {
        return fixtures.page(fx, name, template.uuid(), payload -> payload.withObject("content").put("title", name)).uuid();
    }

    private void setStartPage(Site s, UUID folder, UUID page) {
        AssetVersionView current = assetService.requireCurrent(s.fx().projectId(), folder);
        folderService.updateStartPage(folder, page, current.validFromRevision(), s.fx().ctx());
    }

    private GenerationRequest request(Site s) {
        return new GenerationRequest(GenerationMode.INCREMENTAL, null, List.of("html"), s.target().getId(), null, null,
                null, null);
    }

    /** Releases everything and plans an incremental build. */
    private BuildPlan plan(Site s) {
        releaseFixtures.releaseAll(s.fx().project().getKey());
        return generationService.planFor(s.fx().project().getKey(), request(s)).plan();
    }

    /** Releases everything and builds incrementally (the first build falls back to a full one). */
    private GenerationRun generate(Site s) {
        return fixtures.generate(s.fx(), request(s));
    }

    private Map<String, String> files(Site s, GenerationRun run) {
        return fixtures.files(s.fx(), s.target(), run);
    }

    private static List<UUID> plannedPages(BuildPlan plan) {
        return plan.entries().stream().map(PlanEntry::pageUuid).distinct().toList();
    }

    /** Every redirect of the project with its state against the default target's current build. */
    private List<org.assertj.core.groups.Tuple> redirects(Site s) {
        long projectId = s.fx().projectId();
        return redirectService.rows(projectId, redirectService.all(projectId)).stream()
                .map(row -> tuple(row.entry().getFromPath(), row.entry().getToAssetUuid(), row.entry().getKind(), row.state()))
                .toList();
    }
}
