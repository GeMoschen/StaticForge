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
import com.acme.staticforge.preview.PageRenderService;
import com.acme.staticforge.preview.PreviewTokenService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.ContentView;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.urlregistry.UrlArea;
import com.acme.staticforge.urlregistry.UrlRegistryEntry;
import com.acme.staticforge.urlregistry.UrlRegistryRepository;
import com.acme.staticforge.urlregistry.UrlRegistryService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Consumers follow folder start pages (M31.3): {@code $CMS_REF(folder:…)} links the folder's index page (start page,
 * else the channel's {@code indexUid} page) or else its directory without the {@code pages_root/} segment; preview folder
 * links open the index page; navigation folder references resolve to it; and a start-page change drops the computed
 * URL-registry rows it makes stale while manual overrides survive.
 */
@SpringBootTest
@ActiveProfiles("test")
class FolderStartPageConsumersIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final String CDL = "content { editor text title { label \"Title\" } }";
    private static final String API = "http://localhost/api/v1";

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-start-page-consumers");
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
    @Autowired PageRenderService pageRenderService;
    @Autowired PreviewTokenService previewTokenService;
    @Autowired UrlRegistryService urlRegistryService;
    @Autowired UrlRegistryRepository urlRegistryRepository;

    private final ObjectMapper mapper = new ObjectMapper();

    private record Fixture(Project project, AppUser user, RevisionContext ctx, GenerationTarget target, UUID pagesRoot) {
        long id() {
            return project.getId();
        }
    }

    // ------------------------------------------------------------------
    // $CMS_REF(folder:…)
    // ------------------------------------------------------------------

    @Test
    @DisplayName("$CMS_REF(folder:…) links the start page of pages_root and of a subfolder, else the folder's directory "
            + "without pages_root/, relative to the linking page")
    void folderReferencesLinkTheStartPage() throws Exception {
        Fixture fx = fixture("spc-ref");
        TemplateView landing = template(fx, "Landing", "<h1>$CMS_VALUE(title)$</h1>", Map.of("html", "landing/{uid}.{ext}"));
        UUID homepage = page(fx, landing, "Homepage", null, "Welcome");
        AssetVersionView products = folderService.create(null, "Products", FolderScope.PAGES, fx.ctx());
        UUID overview = page(fx, landing, "Overview", products.uuid(), "All products");
        AssetVersionView tools = folderService.create(products.uuid(), "Tools", FolderScope.PAGES, fx.ctx());
        TemplateView linker = template(fx, "Linker", folderLinks(fx, products, tools), Map.of());
        page(fx, linker, "Links", tools.uuid(), null);
        setStartPage(fx, fx.pagesRoot(), homepage);
        setStartPage(fx, products.uuid(), overview);

        GenerationRun run = build(fx);

        assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        Map<String, String> files = pageFiles(fx, run);
        String links = files.get("products/tools/links.html");
        assertThat(hrefFor(links, "root")).isEqualTo("../../index.html");
        assertThat(hrefFor(links, "products")).isEqualTo("../index.html");
        assertThat(hrefFor(links, "tools")).as("no index page: the directory").isEqualTo("./");
        assertThat(files.values()).noneMatch(html -> html.contains("pages_root"));
    }

    @Test
    @DisplayName("pretty URLs: folder links name the index page's directory; without a start page the indexUid page is "
            + "the index page")
    void prettyFolderReferencesAndTheIndexUidFallback() throws Exception {
        Fixture fx = fixture("spc-pretty");
        updateHtmlSettings(fx, mapper.createObjectNode()
                .put("urlStrategy", "PRETTY").put("trailingSlash", true).put("indexUid", "home"));
        TemplateView landing = template(fx, "Landing", "<h1>$CMS_VALUE(title)$</h1>", Map.of("html", "landing/{uid}.{ext}"));
        TemplateView plain = template(fx, "Plain", "<p>$CMS_VALUE(title)$</p>", Map.of());
        UUID homepage = page(fx, landing, "Homepage", null, "Welcome");
        AssetVersionView products = folderService.create(null, "Products", FolderScope.PAGES, fx.ctx());
        page(fx, plain, "Alpha", products.uuid(), "Alpha");
        page(fx, plain, "Home", products.uuid(), "Products home");
        AssetVersionView tools = folderService.create(null, "Tools", FolderScope.PAGES, fx.ctx());
        page(fx, plain, "Hammer", tools.uuid(), "Hammer");
        TemplateView linker = template(fx, "Linker", folderLinks(fx, products, tools), Map.of());
        page(fx, linker, "About", null, null);
        setStartPage(fx, fx.pagesRoot(), homepage);

        GenerationRun run = build(fx);

        assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        Map<String, String> files = pageFiles(fx, run);
        assertThat(files).containsKeys("index.html", "products/index.html", "about/index.html");
        String about = files.get("about/index.html");
        assertThat(hrefFor(about, "root")).isEqualTo("../");
        assertThat(hrefFor(about, "products")).as("the indexUid page 'home'").isEqualTo("../products/");
        assertThat(hrefFor(about, "tools")).as("no index page: the directory").isEqualTo("../tools/");
        assertThat(files.values()).noneMatch(html -> html.contains("pages_root"));
    }

    @Test
    @DisplayName("languages: a folder link resolves in the render language — the start page, or where it isn't released, "
            + "the indexUid page; directory links carry the language segment")
    void localizedFolderReferences() throws Exception {
        Fixture fx = localizedFixture("spc-l10n");
        TemplateView landing = template(fx, "Landing", "<h1>$CMS_VALUE(title)$</h1>",
                Map.of("html", "{locale}/landing/{uid}.{ext}"));
        TemplateView plain = template(fx, "Plain", "<p>$CMS_VALUE(title)$</p>", Map.of("html", "{locale}/{folder}{uid}.{ext}"));
        AssetVersionView products = folderService.create(null, "Products", FolderScope.PAGES, fx.ctx());
        UUID overview = page(fx, landing, "Overview", products.uuid(), "All products");
        page(fx, plain, "Home", products.uuid(), "Products home");
        AssetVersionView tools = folderService.create(null, "Tools", FolderScope.PAGES, fx.ctx());
        page(fx, plain, "Hammer", tools.uuid(), "Hammer");
        TemplateView linker = template(fx, "Linker", folderLinks(fx, products, tools), Map.of("html", "{locale}/{uid}.{ext}"));
        page(fx, linker, "Links", null, null);
        setStartPage(fx, products.uuid(), overview);
        releaseFixtures.releaseAll(fx.id());
        releaseService.unpublish(List.of(ReleaseItem.of(overview, "en")), fx.ctx());

        GenerationRun run = generate(fx);

        assertThat(run.getStatus()).as("SF-GEN-0112 for en: %s", run.getDiagnostics()).isEqualTo(RunStatus.PARTIAL);
        Map<String, String> files = pageFiles(fx, run);
        assertThat(files.get("de/products/index.html")).isEqualTo("<h1>All products</h1>");
        assertThat(files.get("en/products/index.html")).isEqualTo("<p>Products home</p>");
        for (String locale : List.of("de", "en")) {
            String links = files.get(locale + "/links.html");
            assertThat(hrefFor(links, "products")).as(locale).isEqualTo("products/index.html");
            assertThat(hrefFor(links, "tools")).as(locale).isEqualTo("tools/");
            assertThat(hrefFor(links, "root")).as(locale).isEqualTo("./");
        }
    }

    // ------------------------------------------------------------------
    // Preview
    // ------------------------------------------------------------------

    @Test
    @DisplayName("preview: a folder link is the index page's share link (draft and published views, per language); "
            + "a folder without one links nothing")
    void previewFolderLinksOpenTheIndexPage() throws Exception {
        Fixture fx = localizedFixture("spc-preview");
        TemplateView plain = template(fx, "Plain", "<p>$CMS_VALUE(title)$</p>", Map.of("html", "{locale}/{folder}{uid}.{ext}"));
        UUID homepage = page(fx, plain, "Homepage", null, "Welcome");
        AssetVersionView products = folderService.create(null, "Products", FolderScope.PAGES, fx.ctx());
        page(fx, plain, "Alpha", products.uuid(), "Alpha");
        UUID overview = page(fx, plain, "Overview", products.uuid(), "All products");
        UUID home = page(fx, plain, "Home", products.uuid(), "Products home");
        AssetVersionView tools = folderService.create(null, "Tools", FolderScope.PAGES, fx.ctx());
        page(fx, plain, "Hammer", tools.uuid(), "Hammer");
        TemplateView linker = template(fx, "Linker", folderLinks(fx, products, tools), Map.of("html", "{locale}/{uid}.{ext}"));
        UUID links = page(fx, linker, "Links", null, null);
        setStartPage(fx, fx.pagesRoot(), homepage);
        setStartPage(fx, products.uuid(), overview);
        releaseFixtures.releaseAll(fx.id());
        releaseService.unpublish(List.of(ReleaseItem.of(overview, "en")), fx.ctx());

        String draft = preview(fx, links, "en", ContentView.Kind.DRAFT);
        assertThat(sharedPage(hrefFor(draft, "root"))).isEqualTo(homepage);
        assertThat(sharedPage(hrefFor(draft, "products"))).isEqualTo(overview);
        assertThat(hrefFor(draft, "tools")).as("no index page").isEmpty();

        String publishedDe = preview(fx, links, "de", ContentView.Kind.PUBLISHED);
        assertThat(sharedPage(hrefFor(publishedDe, "products"))).isEqualTo(overview);
        String publishedEn = preview(fx, links, "en", ContentView.Kind.PUBLISHED);
        assertThat(sharedPage(hrefFor(publishedEn, "products")))
                .as("the start page isn't released in en: the indexUid page")
                .isEqualTo(home);
    }

    // ------------------------------------------------------------------
    // Navigation and the URL registry
    // ------------------------------------------------------------------

    @Test
    @DisplayName("navigation: folder references resolve to the start page; a start-page change drops the stale computed "
            + "registry rows (GENERATED and PREVIEW), keeps unrelated ones and manual overrides")
    void startPageChangesInvalidateRegistryRows() throws Exception {
        Fixture fx = fixture("spc-nav");
        TemplateView plain = template(fx, "Plain", "<p>$CMS_VALUE(title)$</p>", Map.of());
        AssetVersionView catalog = folderService.create(null, "Catalog", FolderScope.PAGES, fx.ctx());
        AssetVersionView products = folderService.create(catalog.uuid(), "Products", FolderScope.PAGES, fx.ctx());
        UUID alpha = page(fx, plain, "Alpha", products.uuid(), "Alpha");
        UUID overview = page(fx, plain, "Overview", products.uuid(), "All products");
        UUID contact = page(fx, plain, "Contact", null, "Contact");
        AssetVersionView nav = folderService.create(null, "Main nav " + SEQ.incrementAndGet(), FolderScope.NAVIGATION, fx.ctx());
        UUID catalogRef = reference(fx, nav, "a-catalog", PageReferenceTargetKind.FOLDER, catalog.uuid(), "Catalog");
        UUID productsRef = reference(fx, nav, "b-products", PageReferenceTargetKind.FOLDER, products.uuid(), "Products");
        UUID overviewRef = reference(fx, nav, "c-overview", PageReferenceTargetKind.PAGE, overview, "Overview");
        UUID alphaRef = reference(fx, nav, "d-alpha", PageReferenceTargetKind.PAGE, alpha, "Alpha");
        UUID contactRef = reference(fx, nav, "e-contact", PageReferenceTargetKind.PAGE, contact, "Contact");
        navigationPage(fx, nav);

        Map<String, String> before = navHrefs(fx, build(fx));
        assertThat(before).containsEntry("Catalog", "catalog/products/alpha.html")
                .containsEntry("Products", "catalog/products/alpha.html")
                .containsEntry("Overview", "catalog/products/overview.html")
                .containsEntry("Alpha", "catalog/products/alpha.html")
                .containsEntry("Contact", "contact.html");
        for (UUID ref : List.of(catalogRef, productsRef, overviewRef, alphaRef, contactRef)) {
            urlRegistryService.resolve(ref, "html", UrlArea.PREVIEW, fx.ctx());
        }
        urlRegistryService.override(overviewRef, "html", UrlArea.GENERATED, "custom/overview.html", fx.ctx());

        setStartPage(fx, products.uuid(), overview);

        assertThat(row(fx, catalogRef, UrlArea.GENERATED)).as("an ancestor reference walking into the folder").isEmpty();
        assertThat(row(fx, productsRef, UrlArea.GENERATED)).isEmpty();
        assertThat(row(fx, productsRef, UrlArea.PREVIEW)).isEmpty();
        assertThat(row(fx, overviewRef, UrlArea.PREVIEW)).as("the new start page's own reference").isEmpty();
        assertThat(row(fx, overviewRef, UrlArea.GENERATED)).as("a manual override survives")
                .map(UrlRegistryEntry::getUrl).contains("custom/overview.html");
        assertThat(row(fx, alphaRef, UrlArea.GENERATED)).map(UrlRegistryEntry::getUrl).contains("catalog/products/alpha.html");
        assertThat(row(fx, contactRef, UrlArea.PREVIEW)).map(UrlRegistryEntry::getUrl).contains("contact.html");
        assertThat(urlRegistryService.resolve(productsRef, "html", UrlArea.PREVIEW, fx.ctx()))
                .isEqualTo("catalog/products/index.html");

        Map<String, String> after = navHrefs(fx, build(fx));
        assertThat(after).containsEntry("Catalog", "catalog/products/index.html")
                .containsEntry("Products", "catalog/products/index.html")
                .containsEntry("Overview", "custom/overview.html")
                .containsEntry("Alpha", "catalog/products/alpha.html")
                .containsEntry("Contact", "contact.html");

        // Moving the start page to Alpha: the old one's computed rows go too, the override still stays.
        setStartPage(fx, products.uuid(), alpha);
        assertThat(row(fx, alphaRef, UrlArea.GENERATED)).isEmpty();
        assertThat(row(fx, overviewRef, UrlArea.GENERATED)).map(UrlRegistryEntry::getUrl).contains("custom/overview.html");
        assertThat(navHrefs(fx, build(fx))).containsEntry("Products", "catalog/products/index.html")
                .containsEntry("Alpha", "catalog/products/index.html")
                .containsEntry("Overview", "custom/overview.html");

        // Clearing it: the folder falls back to its first navigable page.
        setStartPage(fx, products.uuid(), null);
        assertThat(navHrefs(fx, build(fx))).containsEntry("Products", "catalog/products/alpha.html")
                .containsEntry("Alpha", "catalog/products/alpha.html");
    }

    @Test
    @DisplayName("release: a build before the folder's release keeps the released start page; releasing the folder drops "
            + "the rows that build assigned")
    void releasingAFoldersStartPageInvalidatesToo() throws Exception {
        Fixture fx = fixture("spc-release");
        TemplateView plain = template(fx, "Plain", "<p>$CMS_VALUE(title)$</p>", Map.of());
        AssetVersionView products = folderService.create(null, "Products", FolderScope.PAGES, fx.ctx());
        page(fx, plain, "Alpha", products.uuid(), "Alpha");
        UUID overview = page(fx, plain, "Overview", products.uuid(), "All products");
        AssetVersionView nav = folderService.create(null, "Main nav " + SEQ.incrementAndGet(), FolderScope.NAVIGATION, fx.ctx());
        UUID productsRef = reference(fx, nav, "products", PageReferenceTargetKind.FOLDER, products.uuid(), "Products");
        navigationPage(fx, nav);
        assertThat(navHrefs(fx, build(fx))).containsEntry("Products", "products/alpha.html");

        setStartPage(fx, products.uuid(), overview);
        assertThat(navHrefs(fx, generate(fx))).as("the draft start page isn't released yet")
                .containsEntry("Products", "products/alpha.html");
        assertThat(row(fx, productsRef, UrlArea.GENERATED)).map(UrlRegistryEntry::getUrl).contains("products/alpha.html");

        releaseService.release(List.of(ReleaseItem.of(products.uuid())), fx.ctx());

        assertThat(row(fx, productsRef, UrlArea.GENERATED)).isEmpty();
        assertThat(navHrefs(fx, generate(fx))).containsEntry("Products", "products/index.html");
    }

    @Test
    @DisplayName("languages: navigation folder references prefer the index page in every language, the registry rows of "
            + "every language follow a start-page change")
    void localizedNavigation() throws Exception {
        Fixture fx = localizedFixture("spc-l10n-nav");
        TemplateView plain = template(fx, "Plain", "<p>$CMS_VALUE(title)$</p>", Map.of("html", "{locale}/{folder}{uid}.{ext}"));
        AssetVersionView products = folderService.create(null, "Products", FolderScope.PAGES, fx.ctx());
        page(fx, plain, "Alpha", products.uuid(), "Alpha");
        UUID overview = page(fx, plain, "Overview", products.uuid(), "All products");
        page(fx, plain, "Home", products.uuid(), "Products home");
        AssetVersionView nav = folderService.create(null, "Main nav " + SEQ.incrementAndGet(), FolderScope.NAVIGATION, fx.ctx());
        UUID productsRef = reference(fx, nav, "products", PageReferenceTargetKind.FOLDER, products.uuid(), "Products");
        TemplateView navTemplate = template(fx, "Nav", "$CMS_NAVIGATION(nav:" + nav.uid() + ")$", Map.of("html", "{locale}/nav.{ext}"));
        page(fx, navTemplate, "Navigation", null, null);

        // No start page: the indexUid page "home" is each language's index page.
        GenerationRun first = build(fx);
        assertThat(first.getStatus()).as("diagnostics: %s", first.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        Map<String, String> files = pageFiles(fx, first);
        assertThat(files.get("de/products/index.html")).isEqualTo("<p>Products home</p>");
        assertThat(hrefFor(files.get("de/nav.html"), "Products")).isEqualTo("products/index.html");
        assertThat(hrefFor(files.get("en/nav.html"), "Products")).isEqualTo("products/index.html");
        assertThat(row(fx, productsRef, UrlArea.GENERATED, "de")).isPresent();
        assertThat(row(fx, productsRef, UrlArea.GENERATED, "en")).isPresent();

        setStartPage(fx, products.uuid(), overview);
        assertThat(row(fx, productsRef, UrlArea.GENERATED, "de")).isEmpty();
        assertThat(row(fx, productsRef, UrlArea.GENERATED, "en")).isEmpty();
        releaseFixtures.releaseAll(fx.id());
        releaseService.unpublish(List.of(ReleaseItem.of(overview, "en")), fx.ctx());

        GenerationRun second = generate(fx);
        Map<String, String> after = pageFiles(fx, second);
        assertThat(after.get("de/products/index.html")).isEqualTo("<p>All products</p>");
        assertThat(after.get("en/products/index.html")).isEqualTo("<p>Products home</p>");
        assertThat(hrefFor(after.get("de/nav.html"), "Products")).isEqualTo("products/index.html");
        assertThat(hrefFor(after.get("en/nav.html"), "Products")).isEqualTo("products/index.html");
        assertThat(after).containsKey("de/products/home.html").doesNotContainKey("en/products/home.html");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private Fixture fixture(String prefix) throws IOException {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(prefix + n, prefix + n + "@example.com", "Start page consumers", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest(prefix.replace("-", "") + n, prefix + n, null, "start page consumers"), user.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), user.getId(), "start page consumers");
        GenerationTarget target = targetRepository.save(new GenerationTarget(
                project.getId(), "default", TargetType.FILESYSTEM, mapper.readTree("{}"), true));
        UUID pagesRoot = assetService.ensurePagesRootFolder(project.getId(), ctx).uuid();
        return new Fixture(project, user, ctx, target, pagesRoot);
    }

    /** German and English, both under their own prefix, with {@code indexUid} "home". */
    private Fixture localizedFixture(String prefix) throws IOException {
        Fixture fx = fixture(prefix);
        projectService.updateLocales(fx.project().getKey(), LocaleConfig.of(
                List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English")), "de", Map.of(), false),
                true, fx.ctx());
        updateHtmlSettings(fx, mapper.createObjectNode().put("indexUid", "home"));
        return fx;
    }

    /** Links labeled "root", "products" and "tools" to those folders. */
    private String folderLinks(Fixture fx, AssetVersionView products, AssetVersionView tools) {
        String root = assetService.requireCurrent(fx.id(), fx.pagesRoot()).uid();
        return "<a href=\"$CMS_REF(folder:" + root + ")$\">root</a>"
                + "<a href=\"$CMS_REF(folder:" + products.uid() + ")$\">products</a>"
                + "<a href=\"$CMS_REF(folder:" + tools.uid() + ")$\">tools</a>";
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

    private UUID reference(
            Fixture fx, AssetVersionView nav, String name, PageReferenceTargetKind kind, UUID target, String label) {
        return pageReferenceService.create(new CreatePageReferenceCommand(name, nav.uuid(), kind, target, label), fx.ctx())
                .uuid();
    }

    /** A page at {@code nav.html} rendering the navigation folder. */
    private void navigationPage(Fixture fx, AssetVersionView nav) {
        TemplateView template = template(fx, "Nav", "$CMS_NAVIGATION(nav:" + nav.uid() + ")$", Map.of("html", "nav.{ext}"));
        page(fx, template, "Navigation", null, null);
    }

    private void setStartPage(Fixture fx, UUID folder, UUID page) {
        folderService.updateStartPage(folder, page, assetService.requireCurrent(fx.id(), folder).validFromRevision(), fx.ctx());
    }

    private void updateHtmlSettings(Fixture fx, ObjectNode settings) {
        OutputChannel html = channelService.list(fx.id()).stream().filter(c -> c.getKey().equals("html")).findFirst().orElseThrow();
        channelService.update("html", new UpdateChannelRequest(html.getName(), html.getFileExtension(), html.getMimeType(),
                html.getDefaultEscaping(), html.isEnabled(), html.isDefaultChannel(), html.getPosition(), settings), fx.ctx());
    }

    private Optional<UrlRegistryEntry> row(Fixture fx, UUID reference, UrlArea area) {
        return row(fx, reference, area, "");
    }

    private Optional<UrlRegistryEntry> row(Fixture fx, UUID reference, UrlArea area, String localeKey) {
        return urlRegistryRepository.findByProjectIdAndChannelKeyAndPageReferenceUuidAndAreaAndLocaleKey(
                fx.id(), "html", reference, area, localeKey);
    }

    private String preview(Fixture fx, UUID page, String locale, ContentView.Kind view) {
        return pageRenderService.renderPage(fx.id(), page, null, "html", true, API, null, locale, view).html();
    }

    /** The page a preview share link opens. */
    private UUID sharedPage(String href) {
        Matcher token = Pattern.compile("/preview/share\\?t=([^\"&]+)").matcher(href);
        assertThat(token.find()).as("a share link: %s", href).isTrue();
        return previewTokenService.verifyShareToken(token.group(1)).pageUuid();
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

    /** The hrefs of {@code nav.html} by link label; the build must succeed. */
    private Map<String, String> navHrefs(Fixture fx, GenerationRun run) throws IOException {
        assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        String html = pageFiles(fx, run).get("nav.html");
        Map<String, String> hrefs = new TreeMap<>();
        Matcher link = Pattern.compile("<a href=\"([^\"]*)\">([^<]*)</a>").matcher(html);
        while (link.find()) {
            hrefs.put(link.group(2), link.group(1));
        }
        return hrefs;
    }

    private static String hrefFor(String html, String label) {
        Matcher matcher = Pattern.compile("<a href=\"([^\"]*)\">" + Pattern.quote(label) + "</a>").matcher(html);
        assertThat(matcher.find()).as("a link labeled '%s' in %s", label, html).isTrue();
        return matcher.group(1);
    }

    /** The build's {@code .html} page files (no redirect stubs), by path. */
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
