package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
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
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetLocations;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.urlregistry.LiveOutputPathResolver;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Folder start pages in real builds (M31.2): a folder's start page renders at the folder's index path whatever its
 * template's {@code outputPath} says — directory form, languages and pagination included — a {@code pathOverride} still
 * wins, a stale pointer falls back to the {@code indexUid} rule with {@code SF-GEN-0112}, and a page that claims the
 * index path by its UID later collides ({@code SF-GEN-0110}).
 */
@SpringBootTest
@ActiveProfiles("test")
class FolderStartPageGenerationIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final String CDL = "content { editor text title { label \"Title\" } }";
    private static final String START_PAGE_UNAVAILABLE = "SF-GEN-0112";

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-start-pages");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired FolderService folderService;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired ChannelService channelService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired ReleaseService releaseService;
    @Autowired ReleaseFixtures releaseFixtures;
    @Autowired LiveOutputPathResolver livePaths;

    private final ObjectMapper mapper = new ObjectMapper();

    private record Fixture(Project project, AppUser user, RevisionContext ctx, GenerationTarget target, UUID pagesRoot) {
        long id() {
            return project.getId();
        }
    }

    @Test
    @DisplayName("\"Homepage\" with its template's own outputPath renders as the site's index.html; subfolders too; "
            + "a pathOverride still wins; the live (preview) URL agrees")
    void startPagesRenderAtTheirFoldersIndexPath() throws Exception {
        Fixture fx = fixture("spg-root");
        TemplateView landing = template(fx, "Landing", "<h1>$CMS_VALUE(title)$</h1>", Map.of("html", "landing/{uid}.{ext}"));
        TemplateView plain = template(fx, "Plain", "<p>$CMS_VALUE(title)$</p>", Map.of());
        UUID homepage = page(fx, landing, "Homepage", null, "Welcome");
        page(fx, plain, "About", null, "About us");
        AssetVersionView products = folderService.create(null, "Products", FolderScope.PAGES, fx.ctx());
        UUID overview = page(fx, landing, "Overview", products.uuid(), "All products");
        page(fx, plain, "Hammer", products.uuid(), "Hammer");
        AssetVersionView special = folderService.create(null, "Special", FolderScope.PAGES, fx.ctx());
        UUID offer = page(fx, landing, "Offer", special.uuid(), "Offer");
        pathOverride(fx, offer, "welcome.{ext}");
        setStartPage(fx, fx.pagesRoot(), homepage);
        setStartPage(fx, products.uuid(), overview);
        setStartPage(fx, special.uuid(), offer);

        GenerationRun run = build(fx);

        assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        Map<String, String> files = pageFiles(fx, run);
        assertThat(files.keySet()).containsExactlyInAnyOrder(
                "index.html", "about.html", "products/index.html", "products/hammer.html", "welcome.html");
        assertThat(files.get("index.html")).isEqualTo("<h1>Welcome</h1>");
        assertThat(files.get("products/index.html")).isEqualTo("<h1>All products</h1>");
        assertThat(files.get("welcome.html")).isEqualTo("<h1>Offer</h1>");
        assertThat(livePaths.resolveUrl(fx.id(), homepage, "html", channelService.outputSettings(fx.id(), "html")))
                .contains("index.html");
        assertThat(livePaths.resolveUrl(fx.id(), overview, "html", channelService.outputSettings(fx.id(), "html")))
                .contains("products/index.html");
        assertThat(livePaths.startPageOf(fx.id(), products.uuid())).isEqualTo(overview);
    }

    @Test
    @DisplayName("pretty URLs: start pages are directory indexes and links to them name the directory")
    void prettyDirectoryForm() throws Exception {
        Fixture fx = fixture("spg-pretty");
        updateHtmlSettings(fx, mapper.createObjectNode().put("urlStrategy", "PRETTY").put("trailingSlash", true));
        TemplateView landing = template(fx, "Landing", "<h1>$CMS_VALUE(title)$</h1>", Map.of("html", "landing/{uid}.{ext}"));
        UUID homepage = page(fx, landing, "Homepage", null, "Welcome");
        AssetVersionView products = folderService.create(null, "Products", FolderScope.PAGES, fx.ctx());
        UUID overview = page(fx, landing, "Overview", products.uuid(), "All products");
        TemplateView linker = template(fx, "Linker",
                "<a href=\"$CMS_REF(page:homepage)$\">home</a><a href=\"$CMS_REF(page:overview)$\">products</a>", Map.of());
        page(fx, linker, "About", null, null);
        setStartPage(fx, fx.pagesRoot(), homepage);
        setStartPage(fx, products.uuid(), overview);

        GenerationRun run = build(fx);

        assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        Map<String, String> files = pageFiles(fx, run);
        assertThat(files.keySet()).containsExactlyInAnyOrder("index.html", "products/index.html", "about/index.html");
        assertThat(files.get("about/index.html")).isEqualTo("<a href=\"../\">home</a><a href=\"../products/\">products</a>");
    }

    @Test
    @DisplayName("languages: the start page renders as each language's index; not released in one language, the folder "
            + "falls back to the indexUid page there with SF-GEN-0112")
    void localizedAndUnreleasedInOneLanguage() throws Exception {
        Fixture fx = fixture("spg-l10n");
        projectService.updateLocales(fx.project().getKey(), LocaleConfig.of(
                List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English")), "de", Map.of(), false),
                true, fx.ctx());
        updateHtmlSettings(fx, mapper.createObjectNode().put("indexUid", "home"));
        TemplateView landing = template(fx, "Landing", "<h1>$CMS_VALUE(title)$</h1>",
                Map.of("html", "{locale}/landing/{uid}.{ext}"));
        TemplateView plain = template(fx, "Plain", "<p>$CMS_VALUE(title)$</p>", Map.of("html", "{locale}/{folder}{uid}.{ext}"));
        UUID homepage = page(fx, landing, "Homepage", null, "Welcome");
        AssetVersionView products = folderService.create(null, "Products", FolderScope.PAGES, fx.ctx());
        UUID overview = page(fx, landing, "Overview", products.uuid(), "All products");
        page(fx, plain, "Home", products.uuid(), "Products home");
        setStartPage(fx, fx.pagesRoot(), homepage);
        setStartPage(fx, products.uuid(), overview);

        GenerationRun full = build(fx);
        assertThat(full.getStatus()).as("diagnostics: %s", full.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        Map<String, String> files = pageFiles(fx, full);
        assertThat(files.keySet()).containsExactlyInAnyOrder(
                "de/index.html", "en/index.html", "de/products/index.html", "en/products/index.html",
                "de/products/home.html", "en/products/home.html");
        assertThat(files.get("en/products/index.html")).isEqualTo("<h1>All products</h1>");

        // The start page goes offline in English only: English falls back to the indexUid page "home".
        releaseService.unpublish(List.of(ReleaseItem.of(overview, "en")), fx.ctx());
        GenerationRun partial = generate(fx);

        assertThat(partial.getStatus()).as("diagnostics: %s", partial.getDiagnostics()).isEqualTo(RunStatus.PARTIAL);
        Map<String, String> after = pageFiles(fx, partial);
        assertThat(after.get("en/products/index.html")).isEqualTo("<p>Products home</p>");
        assertThat(after).doesNotContainKey("en/products/home.html");
        assertThat(after.get("de/products/index.html")).isEqualTo("<h1>All products</h1>");
        assertThat(after.get("de/products/home.html")).isEqualTo("<p>Products home</p>");
        assertThat(warnings(partial)).containsExactly(
                START_PAGE_UNAVAILABLE + " Start page of folder 'products' is not available in en; "
                        + "the folder falls back to the index UID rule.");
    }

    @Test
    @DisplayName("a start page moved to another folder no longer is one: the old folder falls back with SF-GEN-0112")
    void movedAwayFallsBack() throws Exception {
        Fixture fx = fixture("spg-moved");
        updateHtmlSettings(fx, mapper.createObjectNode().put("indexUid", "home"));
        TemplateView plain = template(fx, "Plain", "<p>$CMS_VALUE(title)$</p>", Map.of());
        AssetVersionView products = folderService.create(null, "Products", FolderScope.PAGES, fx.ctx());
        AssetVersionView archive = folderService.create(null, "Archive", FolderScope.PAGES, fx.ctx());
        UUID overview = page(fx, plain, "Overview", products.uuid(), "All products");
        page(fx, plain, "Home", products.uuid(), "Products home");
        setStartPage(fx, products.uuid(), overview);
        assertThat(pageFiles(fx, build(fx)).get("products/index.html")).isEqualTo("<p>All products</p>");

        assetService.move(overview, archive.uuid(), fx.ctx());
        GenerationRun run = build(fx);

        assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isEqualTo(RunStatus.PARTIAL);
        Map<String, String> files = pageFiles(fx, run);
        assertThat(files.get("products/index.html")).isEqualTo("<p>Products home</p>");
        assertThat(files.get("archive/overview.html")).isEqualTo("<p>All products</p>");
        assertThat(warnings(run)).containsExactly(START_PAGE_UNAVAILABLE
                + " Start page of folder 'products' is not available; the folder falls back to the index UID rule.");
    }

    @Test
    @DisplayName("a paginated start page writes index.html, index-2.html, …")
    void paginatedStartPage() throws Exception {
        Fixture fx = fixture("spg-pages");
        TemplateView post = template(fx, "Post", "<p>$CMS_VALUE(title)$</p>", Map.of());
        AssetVersionView postsFolder = folderService.create(null, "Posts", FolderScope.PAGES, fx.ctx());
        AssetVersionView nav = folderService.create(null, "Blog nav", FolderScope.NAVIGATION, fx.ctx());
        for (int i = 1; i <= 3; i++) {
            UUID p = page(fx, post, "Post " + i, postsFolder.uuid(), "Post " + i);
            pageReferenceService.create(
                    new CreatePageReferenceCommand("0" + i, nav.uuid(), PageReferenceTargetKind.PAGE, p, null), fx.ctx());
        }
        TemplateView listing = templateService.create(new CreateTemplateCommand(fx.id(), AssetType.PAGE_TEMPLATE, "Listing",
                "content { editor pagination posts { label \"Posts\" sources [\"nav\"] pageSize 1 } }",
                Map.of("html", "<p>$CMS_META(pageNumber)$/$CMS_META(totalPages)$</p>"), null, false,
                Map.of("html", "{folder}{displayNameSlug}.{ext}")), fx.ctx());
        AssetVersionView news = folderService.create(null, "News", FolderScope.PAGES, fx.ctx());
        AssetVersionView blog = pageService.create(new CreatePageCommand("Blog", news.uuid(), listing.uuid()), fx.ctx());
        ObjectNode payload = blog.payload().deepCopy();
        ObjectNode value = payload.withObject("content").putObject("posts").put("type", "PAGINATION");
        value.putObject("source").put("kind", "NAV").put("uuid", nav.uuid().toString());
        value.put("pageSize", 1);
        pageService.update(blog.uuid(), payload, blog.validFromRevision(), fx.ctx());
        setStartPage(fx, news.uuid(), blog.uuid());

        GenerationRun run = build(fx);

        assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        Map<String, String> files = pageFiles(fx, run);
        assertThat(files.get("news/index.html")).isEqualTo("<p>1/3</p>");
        assertThat(files.get("news/index-2.html")).isEqualTo("<p>2/3</p>");
        assertThat(files.get("news/index-3.html")).isEqualTo("<p>3/3</p>");
        assertThat(files).doesNotContainKeys("news/blog.html", "news/blog-2.html");
    }

    @Test
    @DisplayName("backstop: a page that claims the index path by its UID after the start page was set collides (SF-GEN-0110)")
    void aLaterIndexClaimCollides() throws Exception {
        Fixture fx = fixture("spg-claim");
        // "index" is a reserved UID; with index file "start.html" a page can claim the index path by its UID.
        updateHtmlSettings(fx, mapper.createObjectNode().put("indexFileName", "start.html"));
        TemplateView plain = template(fx, "Plain", "<p>$CMS_VALUE(title)$</p>", Map.of());
        UUID homepage = page(fx, plain, "Homepage", null, "Welcome");
        setStartPage(fx, fx.pagesRoot(), homepage);
        assertThat(pageFiles(fx, build(fx))).containsKey("start.html");

        page(fx, plain, "Start", null, "Squatter");
        GenerationRun run = build(fx);

        assertThat(run.getStatus()).isEqualTo(RunStatus.FAILED);
        assertThat(run.getDiagnostics().toString()).contains("SF-GEN-0110").contains("start.html")
                .contains("homepage").contains("start");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private Fixture fixture(String prefix) throws IOException {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(prefix + n, prefix + n + "@example.com", "Start pages", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest(prefix.replace("-", "") + n, prefix + n, null, "start pages"), user.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), user.getId(), "start pages");
        GenerationTarget target = targetRepository.save(new GenerationTarget(
                project.getId(), "default", TargetType.FILESYSTEM, mapper.readTree("{}"), true));
        UUID pagesRoot = assetService.ensurePagesRootFolder(project.getId(), ctx).uuid();
        return new Fixture(project, user, ctx, target, pagesRoot);
    }

    private TemplateView template(Fixture fx, String name, String html, Map<String, String> outputPath) {
        return templateService.create(new CreateTemplateCommand(
                fx.id(), AssetType.PAGE_TEMPLATE, name, CDL, Map.of("html", html), null, false, outputPath), fx.ctx());
    }

    private UUID page(Fixture fx, TemplateView template, String name, UUID folder, String title) {
        AssetVersionView page = pageService.create(new CreatePageCommand(name, folder, template.uuid()), fx.ctx());
        if (title == null) {
            return page.uuid();
        }
        ObjectNode payload = page.payload().deepCopy();
        payload.withObject("content").put("title", title);
        return pageService.update(page.uuid(), payload, page.validFromRevision(), fx.ctx()).uuid();
    }

    private void pathOverride(Fixture fx, UUID page, String expression) {
        AssetVersionView current = assetService.requireCurrent(fx.id(), page);
        ObjectNode payload = current.payload().deepCopy();
        payload.withObject("output").withObject("pathOverride").put("html", expression);
        pageService.update(page, payload, current.validFromRevision(), fx.ctx());
    }

    private void setStartPage(Fixture fx, UUID folder, UUID page) {
        folderService.updateStartPage(folder, page, assetService.requireCurrent(fx.id(), folder).validFromRevision(), fx.ctx());
    }

    private void updateHtmlSettings(Fixture fx, ObjectNode settings) {
        OutputChannel html = channelService.list(fx.id()).stream().filter(c -> c.getKey().equals("html")).findFirst().orElseThrow();
        channelService.update("html", new UpdateChannelRequest(html.getName(), html.getFileExtension(), html.getMimeType(),
                html.getDefaultEscaping(), html.isEnabled(), html.isDefaultChannel(), html.getPosition(), settings), fx.ctx());
    }

    /** Releases everything, then builds. */
    private GenerationRun build(Fixture fx) throws InterruptedException {
        releaseFixtures.releaseAll(fx.id());
        return generate(fx);
    }

    /** A full build of the html channel, without releasing anything first. */
    private GenerationRun generate(Fixture fx) throws InterruptedException {
        GenerationRun started = generationService.start(
                fx.project().getKey(),
                new GenerationRequest(GenerationMode.FULL, null, List.of("html"), fx.target().getId(), null, null, null, null),
                fx.user().getId());
        long deadline = System.currentTimeMillis() + 60_000;
        while (System.currentTimeMillis() < deadline) {
            GenerationRun run = generationService.status(fx.project().getKey(), started.getId());
            if (run.getStatus().isTerminal()) {
                return run;
            }
            Thread.sleep(50);
        }
        throw new AssertionError("Generation did not finish within 60s");
    }

    /** {@code code message} of every run warning (the run stores them grouped by code). */
    private static List<String> warnings(GenerationRun run) {
        List<String> out = new ArrayList<>();
        for (JsonNode group : run.getDiagnostics().path("warnings")) {
            for (JsonNode message : group.path("messages")) {
                out.add(group.path("code").asText() + " " + message.asText());
            }
        }
        return out;
    }

    /** The build's {@code .html} page files (no redirect stubs, sitemap or search index), by path. */
    private Map<String, String> pageFiles(Fixture fx, GenerationRun run) throws IOException {
        Path dir = TargetLocations.resolve(outputRoot, fx.project().getKey(), fx.target())
                .resolve("builds")
                .resolve(String.valueOf(run.getId()));
        Map<String, String> files = new TreeMap<>();
        try (Stream<Path> stream = Files.walk(dir)) {
            for (Path file : stream.filter(Files::isRegularFile).toList()) {
                String path = dir.relativize(file).toString().replace('\\', '/');
                String content = Files.readString(file);
                if (path.endsWith(".html") && !content.contains("http-equiv=\"refresh\"")) {
                    files.put(path, content);
                }
            }
        }
        return files;
    }
}
