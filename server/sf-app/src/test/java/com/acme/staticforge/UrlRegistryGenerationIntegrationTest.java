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
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.exportimport.ConflictReport;
import com.acme.staticforge.exportimport.ConflictType;
import com.acme.staticforge.exportimport.ImportConflict;
import com.acme.staticforge.exportimport.ImportOptions;
import com.acme.staticforge.exportimport.ImportResult;
import com.acme.staticforge.exportimport.ProjectExportImportService;
import com.acme.staticforge.exportimport.ReleaseMode;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.generate.insight.PlanEntryRecord;
import com.acme.staticforge.generate.insight.RebuildRootKind;
import com.acme.staticforge.preview.PageRenderService;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.redirect.RedirectEntry;
import com.acme.staticforge.redirect.RedirectService;
import com.acme.staticforge.release.ContentView;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.urlregistry.ResetScope;
import com.acme.staticforge.urlregistry.UrlArea;
import com.acme.staticforge.urlregistry.UrlRegistryEntry;
import com.acme.staticforge.urlregistry.UrlRegistryService;
import com.acme.staticforge.urlregistry.UrlTarget;
import com.acme.staticforge.urlregistry.UrlTargetType;
import com.acme.staticforge.user.UserService;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.Pageable;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * The complete URL registry in real builds (M32.3, M32.5, M32.6): every page, media file and index-less folder gets a
 * {@code GENERATED} row; the registered URL decides where the file is written and what every link says; a move keeps the
 * URL until a reset; an override or a reset moves the output with the next incremental build, re-renders its linkers
 * ({@code URL_CHANGED}) and adds an AUTO redirect; a taken URL fails the build ({@code SF-GEN-0110}); outputs that left
 * the site lose their computed rows; the dry run registers nothing; archives carry the rows; previews register per
 * language.
 */
@SpringBootTest
@ActiveProfiles("test")
class UrlRegistryGenerationIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final Pattern HREF = Pattern.compile("<a id=\"(\\w+)\" href=\"([^\"]*)\"");
    private static final String DEFAULT_PATH = "{folder}{uid}.{ext}";

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-m32-url-registry");
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
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired ReleaseFixtures releaseFixtures;
    @Autowired RedirectService redirectService;
    @Autowired UrlRegistryService urlRegistryService;
    @Autowired ProjectExportImportService exportImportService;
    @Autowired PageRenderService pageRenderService;

    private BuildInsightFixtures build;

    @BeforeEach
    void setUp() {
        build = new BuildInsightFixtures(userService, projectService, assetService, assetRepository, templateService,
                mediaService, pageReferenceService, targetRepository, generationService, releaseFixtures, outputRoot);
    }

    /**
     * {@code home} (at the root) links {@code about} (in {@code docs}), the media file {@code logo} and the pages folder
     * {@code empty}, which has no index page.
     */
    private record Site(Fixture fx, GenerationTarget target, TemplateView plain, UUID docs, UUID empty, UUID home,
            UUID about, UUID logo) {}

    private Site site(String prefix) {
        Fixture fx = build.project(prefix + SEQ.incrementAndGet());
        TemplateView plain = template(fx, "Plain", "<p>plain</p>");
        UUID docs = folderService.create(null, "docs", FolderScope.PAGES, fx.ctx()).uuid();
        UUID empty = folderService.create(null, "empty", FolderScope.PAGES, fx.ctx()).uuid();
        AssetVersionView logo = build.media(fx, "logo.txt", "logo");
        UUID about = pageService.create(new CreatePageCommand("about", docs, plain.uuid()), fx.ctx()).uuid();
        TemplateView linker = template(fx, "Linker",
                "<a id=\"about\" href=\"$CMS_REF(page:about)$\">about</a>"
                        + "<a id=\"logo\" href=\"$CMS_REF(media:" + logo.uid() + ")$\">logo</a>"
                        + "<a id=\"empty\" href=\"$CMS_REF(folder:empty)$\">empty</a>");
        UUID home = pageService.create(new CreatePageCommand("home", null, linker.uuid()), fx.ctx()).uuid();
        GenerationTarget target = build.target(fx, "site", TargetType.FILESYSTEM);
        return new Site(fx, target, plain, docs, empty, home, about, logo.uuid());
    }

    // ------------------------------------------------------------------
    // Every output registered, files at their URLs
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a full build registers every page, media file and index-less folder, and writes the files there")
    void aFullBuildRegistersEveryOutput() {
        Site site = site("ugfull");

        GenerationRun run = build.succeeded(generate(site, GenerationMode.FULL));

        assertThat(rows(site)).extracting(e -> e.getTargetType(), e -> e.getTargetUuid(), e -> e.getChannelKey(), e -> e.getUrl())
                .containsExactlyInAnyOrder(
                        tuple(UrlTargetType.PAGE, site.home(), "html", "home.html"),
                        tuple(UrlTargetType.PAGE, site.about(), "html", "docs/about.html"),
                        tuple(UrlTargetType.MEDIA, site.logo(), "", "assets/media/logo_txt.txt"),
                        tuple(UrlTargetType.FOLDER, site.empty(), "html", "empty/"));
        Map<String, String> files = build.files(site.fx(), site.target(), run);
        assertThat(files).containsKeys("home.html", "docs/about.html", "assets/media/logo_txt.txt");
        assertThat(hrefs(files.get("home.html")))
                .containsEntry("about", "docs/about.html")
                .containsEntry("logo", "assets/media/logo_txt.txt")
                .containsEntry("empty", "empty/");
    }

    @Test
    @DisplayName("the dry run plans with the registry but registers nothing")
    void theDryRunRegistersNothing() {
        Site site = site("ugdry");
        releaseFixtures.releaseAll(site.fx().projectId());

        generationService.dryRun(site.fx().project().getKey(), request(site, GenerationMode.FULL), true);

        assertThat(rows(site)).isEmpty();
    }

    @Test
    @DisplayName("a build renders only released pages, so a project that never released registers no URLs until it does")
    void unreleasedPagesRegisterNothing() {
        Site site = site("ugunreleased");

        // No release yet: nothing is published, nothing is registered (M27.2.1) — the registry is not "empty by fault".
        GenerationRun idle = build.await(site.fx(), generationService.start(
                site.fx().project().getKey(), request(site, GenerationMode.FULL), site.fx().user().getId()).getId());
        assertThat(build.files(site.fx(), site.target(), idle)).doesNotContainKey("home.html");
        assertThat(rows(site)).isEmpty();

        // Released pages are registered by the next build.
        build.succeeded(generate(site, GenerationMode.FULL));
        assertThat(rows(site)).isNotEmpty();
    }

    // ------------------------------------------------------------------
    // Frozen URLs, overrides and resets
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a moved page keeps its URL until reset; the reset moves the file, re-renders its linkers, adds a redirect")
    void aMoveTakesEffectOnReset() {
        Site site = site("ugmove");
        build.succeeded(generate(site, GenerationMode.FULL));
        UUID guides = folderService.create(null, "guides", FolderScope.PAGES, site.fx().ctx()).uuid();
        assetService.move(site.about(), guides, site.fx().ctx());

        GenerationRun kept = build.succeeded(generate(site, GenerationMode.INCREMENTAL));
        assertThat(build.files(site.fx(), site.target(), kept)).containsKey("docs/about.html").doesNotContainKey("guides/about.html");
        assertThat(redirectService.all(site.fx().projectId())).isEmpty();

        urlRegistryService.reset(site.fx().projectId(), ResetScope.asset(site.about(), UrlArea.GENERATED), site.fx().ctx());
        GenerationRun moved = build.succeeded(generate(site, GenerationMode.INCREMENTAL));

        Map<String, String> files = build.files(site.fx(), site.target(), moved);
        assertThat(files).containsKey("guides/about.html");
        assertThat(hrefs(files.get("home.html"))).containsEntry("about", "guides/about.html");
        assertThat(rootKinds(site, moved))
                .containsEntry(site.about(), RebuildRootKind.URL_CHANGED)
                .containsEntry(site.home(), RebuildRootKind.URL_CHANGED);
        assertThat(redirectService.all(site.fx().projectId()))
                .extracting(RedirectEntry::getFromPath, RedirectEntry::getToAssetUuid)
                .containsExactly(tuple("docs/about.html", site.about()));
    }

    @Test
    @DisplayName("overriding a page's URL moves its file and every link with the next incremental build")
    void aPageOverrideMovesTheOutput() {
        Site site = site("ugpage");
        build.succeeded(generate(site, GenerationMode.FULL));

        urlRegistryService.override(
                UrlTarget.page(site.about()), "html", UrlArea.GENERATED, "", "company/about-us.html", site.fx().ctx());
        GenerationRun run = build.succeeded(generate(site, GenerationMode.INCREMENTAL));

        Map<String, String> files = build.files(site.fx(), site.target(), run);
        assertThat(files).containsKey("company/about-us.html");
        // The old URL is a redirect stub now (M30.5.1).
        assertThat(files.get("docs/about.html")).contains("url=../company/about-us.html");
        assertThat(hrefs(files.get("home.html"))).containsEntry("about", "company/about-us.html");
        assertThat(rootKinds(site, run)).containsOnlyKeys(site.about(), site.home());
    }

    @Test
    @DisplayName("overriding a media file's URL copies it there and re-renders the pages linking it")
    void aMediaOverrideMovesTheFile() {
        Site site = site("ugmedia");
        build.succeeded(generate(site, GenerationMode.FULL));

        urlRegistryService.override(
                UrlTarget.media(site.logo(), null), null, UrlArea.GENERATED, "", "files/brand.txt", site.fx().ctx());
        GenerationRun run = build.succeeded(generate(site, GenerationMode.INCREMENTAL));

        Map<String, String> files = build.files(site.fx(), site.target(), run);
        assertThat(files).containsEntry("files/brand.txt", "logo");
        assertThat(hrefs(files.get("home.html"))).containsEntry("logo", "files/brand.txt");
    }

    @Test
    @DisplayName("overriding a folder's URL re-renders the pages linking it")
    void aFolderOverrideReRendersItsLinkers() {
        Site site = site("ugfolder");
        build.succeeded(generate(site, GenerationMode.FULL));

        urlRegistryService.override(UrlTarget.folder(site.empty()), "html", UrlArea.GENERATED, "", "docs/", site.fx().ctx());
        GenerationRun run = build.succeeded(generate(site, GenerationMode.INCREMENTAL));

        assertThat(hrefs(build.files(site.fx(), site.target(), run).get("home.html"))).containsEntry("empty", "docs/");
        assertThat(rootKinds(site, run)).containsEntry(site.home(), RebuildRootKind.URL_CHANGED);
    }

    @Test
    @DisplayName("a new page computing a URL another page holds fails the build with SF-GEN-0110")
    void aTakenUrlFailsTheBuild() {
        Site site = site("ugcollide");
        build.succeeded(generate(site, GenerationMode.FULL));
        urlRegistryService.override(UrlTarget.page(site.about()), "html", UrlArea.GENERATED, "", "team.html", site.fx().ctx());
        pageService.create(new CreatePageCommand("team", null, site.plain().uuid()), site.fx().ctx());

        GenerationRun run = generate(site, GenerationMode.FULL);

        assertThat(run.getStatus()).isEqualTo(RunStatus.FAILED);
        assertThat(run.getDiagnostics().toString()).contains("SF-GEN-0110").contains("team.html");
    }

    @Test
    @DisplayName("a page that left the site loses its computed rows; a manual URL stays for when it comes back")
    void removedOutputsLoseTheirComputedRows() {
        Site site = site("ugremove");
        UUID kept = pageService.create(new CreatePageCommand("kept", null, site.plain().uuid()), site.fx().ctx()).uuid();
        build.succeeded(generate(site, GenerationMode.FULL));
        urlRegistryService.override(UrlTarget.page(kept), "html", UrlArea.GENERATED, "", "keep/me.html", site.fx().ctx());

        assetService.softDelete(site.about(), true, site.fx().ctx());
        assetService.softDelete(kept, true, site.fx().ctx());
        // home still links the deleted page, which renders empty (a warning): the run is PARTIAL.
        assertThat(generate(site, GenerationMode.FULL).getStatus()).isEqualTo(RunStatus.PARTIAL);

        assertThat(rows(site)).extracting(UrlRegistryEntry::getTargetUuid).doesNotContain(site.about()).contains(kept);
    }

    @Test
    @DisplayName("every page of a paginated page is registered next to page 1")
    void paginatedPagesAreRegistered() {
        Fixture fx = build.project("ugpaged" + SEQ.incrementAndGet());
        GenerationTarget target = build.target(fx, "site", TargetType.FILESYSTEM);
        TemplateView post = template(fx, "Post", "<p>post</p>");
        UUID nav = folderService.create(null, "Blog Nav " + SEQ.incrementAndGet(), FolderScope.NAVIGATION, fx.ctx()).uuid();
        List<UUID> references = new java.util.ArrayList<>();
        for (int i = 1; i <= 3; i++) {
            UUID page = pageService.create(new CreatePageCommand("post" + i, null, post.uuid()), fx.ctx()).uuid();
            references.add(build.pageReference(fx, "0" + i + " post", nav, page).uuid());
        }
        TemplateView blogTemplate = templateService.create(new CreateTemplateCommand(fx.projectId(), AssetType.PAGE_TEMPLATE,
                "Blog", CdlSources.split("content { editor pagination posts { label \"Posts\" sources [\"nav\"] pageSize 1 } }"),
                Map.of("html", "<h1>$CMS_META(pageNumber)$</h1>"), null, false, Map.of("html", DEFAULT_PATH)), fx.ctx());
        UUID news = folderService.create(null, "news", FolderScope.PAGES, fx.ctx()).uuid();
        AssetVersionView blog = pageService.create(new CreatePageCommand("blog", news, blogTemplate.uuid()), fx.ctx());
        build.edit(fx, blog.uuid(), payload -> {
            var posts = payload.withObject("content").putObject("posts").put("type", "PAGINATION");
            posts.putObject("source").put("kind", "NAV").put("uuid", nav.toString());
            posts.put("pageSize", 1);
            posts.putObject("sort").put("key", "navigation").put("direction", "ASC");
        });

        build.succeeded(build.generate(fx, target, GenerationMode.FULL));

        assertThat(urlRegistryService.search(fx.projectId(),
                        new UrlRegistryService.Filter(null, null, null, null, blog.uuid(), null), Pageable.unpaged()))
                .extracting(UrlRegistryEntry::getPageNumber, UrlRegistryEntry::getUrl)
                .containsExactlyInAnyOrder(tuple(1, "news/blog.html"), tuple(2, "news/blog-2.html"), tuple(3, "news/blog-3.html"));

        // One post fewer: page 3 is no output any more, and its computed row goes with the next full build.
        assetService.softDelete(references.get(2), true, fx.ctx());
        build.succeeded(build.generate(fx, target, GenerationMode.FULL));

        assertThat(urlRegistryService.search(fx.projectId(),
                        new UrlRegistryService.Filter(null, null, null, null, blog.uuid(), null), Pageable.unpaged()))
                .extracting(UrlRegistryEntry::getPageNumber)
                .containsExactlyInAnyOrder(1, 2);
    }

    // ------------------------------------------------------------------
    // Export and import
    // ------------------------------------------------------------------

    @Test
    @DisplayName("an archive carries the built URLs; the import modes decide what happens to the target's own")
    void exportImportCarriesTheUrls() {
        Site site = site("ugexport");
        build.succeeded(generate(site, GenerationMode.FULL));
        urlRegistryService.override(
                UrlTarget.page(site.about()), "html", UrlArea.GENERATED, "", "company/about.html", site.fx().ctx());
        byte[] archive = exportImportService.exportProject(site.fx().projectId());

        Fixture copy = build.project("ugimport" + SEQ.incrementAndGet());
        ImportResult result = exportImportService.importProject(copy.projectId(), archive, copy.ctx(), ImportOptions.DEFAULT);

        assertThat(result.importedUrlCount()).isEqualTo(4);
        assertThat(urlRegistryService.all(copy.projectId(), UrlArea.GENERATED))
                .extracting(UrlRegistryEntry::getTargetUuid, UrlRegistryEntry::getUrl, UrlRegistryEntry::isOverridden)
                .contains(tuple(site.about(), "company/about.html", true), tuple(site.home(), "home.html", false));

        // The copy sets its own URL for about; ARCHIVE_WINS keeps it (reported), REPLACE_ALL takes the archive's.
        urlRegistryService.override(UrlTarget.page(site.about()), "html", UrlArea.GENERATED, "", "mine.html", copy.ctx());
        ConflictReport report = exportImportService.analyzeImport(copy.projectId(), archive, ImportOptions.DEFAULT);
        assertThat(report.urlCount()).isEqualTo(4);
        assertThat(report.conflicts()).extracting(ImportConflict::type).contains(ConflictType.URL_OVERRIDE_KEPT);
        exportImportService.importProject(copy.projectId(), archive, copy.ctx(), ImportOptions.DEFAULT);
        assertThat(url(copy, site.about())).isEqualTo("mine.html");

        exportImportService.importProject(copy.projectId(), archive, copy.ctx(),
                new ImportOptions(false, ReleaseMode.KEEP, true, UrlRegistryService.ImportMode.REPLACE_ALL));
        assertThat(url(copy, site.about())).isEqualTo("company/about.html");
    }

    // ------------------------------------------------------------------
    // Preview
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a preview without link rewriting links pages, media and folders at their PREVIEW URLs")
    void previewLinksEveryKindThroughTheRegistry() {
        Site site = site("ugprevlinks");
        urlRegistryService.override(
                UrlTarget.media(site.logo(), null), null, UrlArea.PREVIEW, "", "brand/logo.txt", site.fx().ctx());

        String html = pageRenderService.renderPage(site.fx().projectId(), site.home(), null, "html", false);

        assertThat(hrefs(html))
                .containsEntry("about", "docs/about.html")
                .containsEntry("logo", "brand/logo.txt")
                .containsEntry("empty", "empty/");
        assertThat(urlRegistryService.all(site.fx().projectId(), UrlArea.PREVIEW))
                .extracting(UrlRegistryEntry::getTargetType, UrlRegistryEntry::getTargetUuid)
                .containsExactlyInAnyOrder(
                        tuple(UrlTargetType.PAGE, site.home()), tuple(UrlTargetType.PAGE, site.about()),
                        tuple(UrlTargetType.MEDIA, site.logo()), tuple(UrlTargetType.FOLDER, site.empty()));
        assertThat(rows(site)).as("GENERATED is untouched").isEmpty();
    }

    @Test
    @DisplayName("a preview registers its page and its links in the PREVIEW area, per language")
    void previewRegistersPerLanguage() {
        Fixture fx = build.project("ugpreview" + SEQ.incrementAndGet());
        projectService.updateLocales(fx.project().getKey(), LocaleConfig.of(
                List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English")), "de", Map.of(), false),
                true, fx.ctx());
        TemplateView plain = templateService.create(new CreateTemplateCommand(fx.projectId(), AssetType.PAGE_TEMPLATE,
                "Plain", CdlSources.split(""), Map.of("html", "<p>plain</p>"), null, false, Map.of("html", "{locale}/" + DEFAULT_PATH)), fx.ctx());
        UUID about = pageService.create(new CreatePageCommand("about", null, plain.uuid()), fx.ctx()).uuid();
        TemplateView linker = templateService.create(new CreateTemplateCommand(fx.projectId(), AssetType.PAGE_TEMPLATE,
                "Linker", CdlSources.split(""), Map.of("html", "<a id=\"about\" href=\"$CMS_REF(page:about)$\">about</a>"), null, false,
                Map.of("html", "{locale}/" + DEFAULT_PATH)), fx.ctx());
        UUID home = pageService.create(new CreatePageCommand("home", null, linker.uuid()), fx.ctx()).uuid();

        String en = pageRenderService.renderPage(fx.projectId(), home, null, "html", false, null, null, "en",
                ContentView.Kind.DRAFT).html();
        pageRenderService.renderPage(fx.projectId(), home, null, "html", false, null, null, "de", ContentView.Kind.DRAFT);

        assertThat(hrefs(en)).containsEntry("about", "en/about.html");
        assertThat(urlRegistryService.all(fx.projectId(), UrlArea.PREVIEW))
                .extracting(UrlRegistryEntry::getTargetUuid, UrlRegistryEntry::getLocaleKey, UrlRegistryEntry::getUrl)
                .containsExactlyInAnyOrder(
                        tuple(home, "en", "en/home.html"), tuple(about, "en", "en/about.html"),
                        tuple(home, "de", "de/home.html"), tuple(about, "de", "de/about.html"));
        assertThat(urlRegistryService.all(fx.projectId(), UrlArea.GENERATED)).isEmpty();
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private TemplateView template(Fixture fx, String name, String html) {
        return templateService.create(new CreateTemplateCommand(fx.projectId(), AssetType.PAGE_TEMPLATE,
                name + " " + SEQ.incrementAndGet(), CdlSources.split(""), Map.of("html", html), null, false, Map.of("html", DEFAULT_PATH)),
                fx.ctx());
    }

    private GenerationRequest request(Site site, GenerationMode mode) {
        return new GenerationRequest(mode, null, List.of("html"), site.target().getId(), null, null, null, null);
    }

    private GenerationRun generate(Site site, GenerationMode mode) {
        return build.generate(site.fx(), site.target(), mode);
    }

    private List<UrlRegistryEntry> rows(Site site) {
        return urlRegistryService.all(site.fx().projectId(), UrlArea.GENERATED);
    }

    private String url(Fixture fx, UUID page) {
        return urlRegistryService.all(fx.projectId(), UrlArea.GENERATED).stream()
                .filter(e -> e.getTargetUuid().equals(page))
                .map(UrlRegistryEntry::getUrl)
                .findFirst()
                .orElseThrow();
    }

    /** The root kind of each planned asset's rebuild reason in {@code run}. */
    private Map<UUID, RebuildRootKind> rootKinds(Site site, GenerationRun run) {
        Map<UUID, RebuildRootKind> kinds = new java.util.HashMap<>();
        generationService.storedPlan(site.fx().project().getKey(), run.getId(), PlanEntryRecord.Filter.NONE, Pageable.unpaged())
                .entries()
                .forEach(entry -> kinds.put(entry.assetUuid(), entry.reason().rootKind()));
        return kinds;
    }

    /** id → href of every {@code <a id="…" href="…">} in {@code html}. */
    private static Map<String, String> hrefs(String html) {
        Map<String, String> hrefs = new java.util.HashMap<>();
        Matcher matcher = HREF.matcher(html == null ? "" : html);
        while (matcher.find()) {
            hrefs.put(matcher.group(1), matcher.group(2));
        }
        return hrefs;
    }
}
