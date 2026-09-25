package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

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
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.urlregistry.UrlArea;
import com.acme.staticforge.urlregistry.UrlRegistryEntry;
import com.acme.staticforge.urlregistry.UrlRegistryService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.Pageable;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * `M16.4.1` — a channel's own output settings drive generation paths and hrefs, the URL registry
 * and preview. The fixture site has pages at three depths plus a navigation store, and two
 * "linker" pages (site root and {@code pf/pf1/}) whose template emits {@code $CMS_NAVIGATION} (hrefs
 * from the URL registry) and {@code $CMS_REF(page:…)} (hrefs from the output-path resolver) for
 * the same targets. Every generated href is checked by resolving it against its own page's path
 * on disk ({@code tasks/lessons.md}: links are relative to the current page).
 */
@SpringBootTest
@ActiveProfiles("test")
class ChannelOutputSettingsIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final Pattern HREF = Pattern.compile("href=\"([^\"]*)\"");

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-channel-settings-test");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired FolderService folderService;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired ChannelService channelService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired ReleaseFixtures releaseFixtures;
    @Autowired UrlRegistryService urlRegistryService;
    @Autowired PageRenderService pageRenderService;

    private final ObjectMapper mapper = new ObjectMapper();

    /** The seeded html channel (RELATIVE, no trailing slash) produces exactly the pre-`M16.4.1` output. */
    @Test
    void defaultChannelKeepsFileUrls() throws Exception {
        Site site = newSite();

        long runId = generate(site, GenerationMode.FULL);
        Map<String, String> pages = pageFiles(site, runId);

        assertThat(pages.keySet()).containsExactly(
                "about.html", "home.html", "pf/p2.html", "pf/pf1/deep.html", "pf/pf1/p3.html");
        // Nav hrefs (about, home, p2, p3), then $CMS_REF hrefs (about, p3) — relative to each page.
        assertThat(hrefs(pages.get("home.html"))).containsExactly(
                "about.html", "home.html", "pf/p2.html", "pf/pf1/p3.html", "about.html", "pf/pf1/p3.html");
        assertThat(hrefs(pages.get("pf/pf1/deep.html"))).containsExactly(
                "../../about.html", "../../home.html", "../p2.html", "p3.html", "../../about.html", "p3.html");
        assertLinksResolve(site, runId, pages, "index.html");
    }

    @Test
    void prettyTrailingSlashChannelWritesDirectoriesAndLinksToThem() throws Exception {
        Site site = newSite();
        long projectId = site.project().getId();

        // A first (default) run assigns registry URLs; one of them is then overridden manually.
        generate(site, GenerationMode.FULL);
        urlRegistryService.override(site.p2Ref(), "html", UrlArea.GENERATED, "/manual/p2.html", site.ctx());
        assertThat(registry(projectId)).hasSize(4);

        updateHtmlChannel(site, "html", settings("PRETTY", true));

        // Computed entries are dropped (they hold the old paths); the manual override survives.
        assertThat(registry(projectId))
                .singleElement()
                .satisfies(e -> {
                    assertThat(e.getPageReferenceUuid()).isEqualTo(site.p2Ref());
                    assertThat(e.isOverridden()).isTrue();
                });

        long runId = generate(site, GenerationMode.FULL);
        Map<String, String> pages = pageFiles(site, runId);

        assertThat(pages.keySet()).containsExactly(
                "about/index.html", "index.html", "pf/p2/index.html", "pf/pf1/deep/index.html", "pf/pf1/p3/index.html");
        // "home" is the channel's indexUid, so it is the site-root index and links as "./" from the root.
        // p2's href is the manual override, emitted unchanged.
        assertThat(hrefs(pages.get("index.html"))).containsExactly(
                "about/", "./", "/manual/p2.html", "pf/pf1/p3/", "about/", "pf/pf1/p3/");
        assertThat(hrefs(pages.get("pf/pf1/deep/index.html"))).containsExactly(
                "../../../about/", "../../../", "/manual/p2.html", "../p3/", "../../../about/", "../p3/");
        assertLinksResolve(site, runId, pages, "index.html");

        // No drift: the registry URL (site path) is what generation relativized, and preview uses the same URL.
        String aboutUrl = urlRegistryService.resolve(site.aboutRef(), "html", UrlArea.GENERATED, site.ctx());
        String p3Url = urlRegistryService.resolve(site.p3Ref(), "html", UrlArea.GENERATED, site.ctx());
        assertThat(aboutUrl).isEqualTo("about/");
        assertThat(p3Url).isEqualTo("pf/pf1/p3/");
        String preview = pageRenderService.renderPage(projectId, site.rootLinker(), null, "html", false);
        assertThat(hrefs(preview)).startsWith(aboutUrl);
        assertThat(urlRegistryService.resolve(site.aboutRef(), "html", UrlArea.PREVIEW, site.ctx())).isEqualTo(aboutUrl);
    }

    @Test
    void customFileExtensionAndIndexFileName() throws Exception {
        Site site = newSite();
        ObjectNode settings = settings("PRETTY", true).put("indexFileName", "default.htm").put("prettyPrint", true);

        OutputChannel updated = updateHtmlChannel(site, "htm", settings);
        assertThat(updated.getSettings().path("prettyPrint").asBoolean()).as("unknown keys are kept").isTrue();

        long runId = generate(site, GenerationMode.FULL);
        List<String> files = files(site, runId).stream().filter(p -> p.endsWith(".htm")).toList();

        assertThat(files).containsExactlyInAnyOrder(
                "about/default.htm", "default.htm", "pf/p2/default.htm", "pf/pf1/deep/default.htm", "pf/pf1/p3/default.htm");
        Map<String, String> pages = new TreeMap<>();
        for (String file : files) {
            pages.put(file, read(site, runId, file));
        }
        assertLinksResolve(site, runId, pages, "default.htm");
    }

    @Test
    void incrementalRunAfterAChannelSettingsChangeBuildsEveryPage() throws Exception {
        Site site = newSite();
        generate(site, GenerationMode.FULL);

        updateHtmlChannel(site, "html", settings("PRETTY", true));
        long runId = generate(site, GenerationMode.INCREMENTAL);

        // No page asset changed, yet every page moved: the run must have fallen back to FULL.
        assertThat(pageFiles(site, runId).keySet()).containsExactly(
                "about/index.html", "index.html", "pf/p2/index.html", "pf/pf1/deep/index.html", "pf/pf1/p3/index.html");
    }

    // ------------------------------------------------------------------
    // Link checker
    // ------------------------------------------------------------------

    /**
     * Resolves every relative href of every page against that page's own location in the build
     * directory; a directory href must contain the channel's index file. Absolute hrefs (a manual
     * registry override) are out of the site's control and skipped.
     */
    private void assertLinksResolve(Site site, long runId, Map<String, String> pages, String indexFileName) {
        Path build = buildDir(site, runId);
        List<String> broken = new ArrayList<>();
        int checked = 0;
        for (Map.Entry<String, String> page : pages.entrySet()) {
            Path pageDir = build.resolve(page.getKey()).getParent();
            for (String href : hrefs(page.getValue())) {
                if (href.startsWith("/") || href.contains(":")) {
                    continue;
                }
                assertThat(href).as("href on %s", page.getKey()).isNotBlank();
                Path target = pageDir.resolve(href).normalize();
                if (href.endsWith("/")) {
                    target = target.resolve(indexFileName);
                }
                checked++;
                if (!target.startsWith(build) || !Files.isRegularFile(target)) {
                    broken.add(page.getKey() + " -> " + href);
                }
            }
        }
        assertThat(checked).isPositive();
        assertThat(broken).as("broken links").isEmpty();
    }

    private static List<String> hrefs(String html) {
        List<String> hrefs = new ArrayList<>();
        Matcher matcher = HREF.matcher(html);
        while (matcher.find()) {
            hrefs.add(matcher.group(1));
        }
        return hrefs;
    }

    // ------------------------------------------------------------------
    // Generation helpers
    // ------------------------------------------------------------------

    private long generate(Site site, GenerationMode mode) throws InterruptedException {
        releaseFixtures.releaseAll(site.project().getKey());
        GenerationRun run = generationService.start(
                site.project().getKey(),
                new GenerationRequest(mode, null, List.of("html"), site.target().getId(), null, null, null, null),
                site.user().getId());
        long deadline = System.currentTimeMillis() + 60_000;
        while (System.currentTimeMillis() < deadline) {
            GenerationRun current = generationService.status(site.project().getKey(), run.getId());
            RunStatus status = current.getStatus();
            if (status == RunStatus.SUCCESS || status == RunStatus.PARTIAL || status == RunStatus.FAILED
                    || status == RunStatus.CANCELLED) {
                assertThat(status).as("diagnostics: %s", current.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
                return run.getId();
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Generation did not reach a terminal state within 60s");
    }

    private Path buildDir(Site site, long runId) {
        return TargetLocations.resolve(outputRoot, site.project().getKey(), site.target())
                .resolve("builds")
                .resolve(String.valueOf(runId));
    }

    private List<String> files(Site site, long runId) throws IOException {
        Path build = buildDir(site, runId);
        try (Stream<Path> stream = Files.walk(build)) {
            return stream.filter(Files::isRegularFile)
                    .map(p -> build.relativize(p).toString().replace('\\', '/'))
                    .sorted()
                    .toList();
        }
    }

    /** Output path → content of every generated {@code .html} page. */
    private Map<String, String> pageFiles(Site site, long runId) throws IOException {
        Map<String, String> pages = new TreeMap<>();
        for (String file : files(site, runId)) {
            if (file.endsWith(".html")) {
                pages.put(file, read(site, runId, file));
            }
        }
        return pages;
    }

    private String read(Site site, long runId, String file) throws IOException {
        return Files.readString(buildDir(site, runId).resolve(file), StandardCharsets.UTF_8);
    }

    private List<UrlRegistryEntry> registry(long projectId) {
        return urlRegistryService.search(projectId, "html", null, Pageable.unpaged()).getContent();
    }

    private OutputChannel updateHtmlChannel(Site site, String fileExtension, ObjectNode settings) {
        OutputChannel html = channelService.list(site.project().getId()).stream()
                .filter(c -> c.getKey().equals("html"))
                .findFirst()
                .orElseThrow();
        return channelService.update(
                "html",
                new UpdateChannelRequest(html.getName(), fileExtension, html.getMimeType(), html.getDefaultEscaping(),
                        html.isEnabled(), html.isDefaultChannel(), html.getPosition(), settings),
                site.ctx());
    }

    private ObjectNode settings(String urlStrategy, boolean trailingSlash) {
        return mapper.createObjectNode()
                .put("indexUid", "home")
                .put("indexFileName", "index.html")
                .put("urlStrategy", urlStrategy)
                .put("trailingSlash", trailingSlash);
    }

    // ------------------------------------------------------------------
    // Fixture site
    // ------------------------------------------------------------------

    /**
     * The linker {@code home} and {@code about} at the root, {@code p2} in {@code pf/}, {@code p3} and
     * the nested linker {@code deep} in {@code pf/pf1/}; a navigation folder referencing about, p2,
     * p3 and home. The non-default settings used below make {@code home} the {@code indexUid}.
     */
    private Site newSite() throws IOException {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(
                "chset-user-" + n, "chset-user-" + n + "@example.com", "Channel Settings User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("chset_" + n, "Channel Settings " + n, null, null), user.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), user.getId(), "test");

        TemplateView plain = template(project, ctx, "Plain", "<p>content</p>");
        AssetVersionView pf = folderService.create(null, "pf", FolderScope.PAGES, ctx);
        AssetVersionView pf1 = folderService.create(pf.uuid(), "pf1", FolderScope.PAGES, ctx);
        AssetVersionView about = pageService.create(new CreatePageCommand("about", null, plain.uuid()), ctx);
        AssetVersionView p2 = pageService.create(new CreatePageCommand("p2", pf.uuid(), plain.uuid()), ctx);
        AssetVersionView p3 = pageService.create(new CreatePageCommand("p3", pf1.uuid(), plain.uuid()), ctx);

        AssetVersionView nav = folderService.create(null, "Main Nav " + n, FolderScope.NAVIGATION, ctx);
        AssetVersionView aboutRef = pageReference(ctx, nav, "about-ref", about, "About");
        AssetVersionView p2Ref = pageReference(ctx, nav, "p2-ref", p2, "P2");
        AssetVersionView p3Ref = pageReference(ctx, nav, "p3-ref", p3, "P3");

        TemplateView linker = template(project, ctx, "Linker",
                "<nav>$CMS_NAVIGATION(nav:" + nav.uid() + ")$</nav>"
                        + "<a href=\"$CMS_REF(page:" + about.uid() + ")$\">about</a>"
                        + "<a href=\"$CMS_REF(page:" + p3.uid() + ")$\">p3</a>");
        AssetVersionView home = pageService.create(new CreatePageCommand("home", null, linker.uuid()), ctx);
        pageService.create(new CreatePageCommand("deep", pf1.uuid(), linker.uuid()), ctx);
        pageReference(ctx, nav, "home-ref", home, "Home");
        assertThat(List.of(home.uid(), about.uid(), p2.uid(), p3.uid())).containsExactly("home", "about", "p2", "p3");

        GenerationTarget target = targetRepository.save(
                new GenerationTarget(project.getId(), "default", TargetType.FILESYSTEM, mapper.createObjectNode(), true));
        return new Site(project, user, target, home.uuid(), aboutRef.uuid(), p2Ref.uuid(), p3Ref.uuid());
    }

    private TemplateView template(Project project, RevisionContext ctx, String name, String source) {
        return templateService.create(
                new CreateTemplateCommand(project.getId(), AssetType.PAGE_TEMPLATE, name, "",
                        Map.of("html", source), null, false, null, null),
                ctx);
    }

    private AssetVersionView pageReference(
            RevisionContext ctx, AssetVersionView nav, String name, AssetVersionView target, String label) {
        return pageReferenceService.create(
                new CreatePageReferenceCommand(name, nav.uuid(), PageReferenceTargetKind.PAGE, target.uuid(), label), ctx);
    }

    private record Site(
            Project project,
            AppUser user,
            GenerationTarget target,
            java.util.UUID rootLinker,
            java.util.UUID aboutRef,
            java.util.UUID p2Ref,
            java.util.UUID p3Ref) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }
}
