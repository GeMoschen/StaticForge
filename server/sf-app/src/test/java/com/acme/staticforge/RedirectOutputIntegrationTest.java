package com.acme.staticforge;

import com.acme.staticforge.urlregistry.UrlRegistryService;
import com.acme.staticforge.urlregistry.UrlArea;
import com.acme.staticforge.urlregistry.ResetScope;
import com.acme.staticforge.generate.quality.QualitySeverity;

import com.acme.staticforge.generate.quality.rules.links.RedirectedTargetRule;
import com.acme.staticforge.generate.quality.rules.links.MissingLinkTargetRule;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import com.acme.staticforge.BuildInsightFixtures.Fixture;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RedirectFormat;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.HtmlFacts;
import com.acme.staticforge.generate.quality.IndexedOutput;
import com.acme.staticforge.generate.quality.LinkRef;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.QualityRuleConfigService;
import com.acme.staticforge.generate.quality.RuleContext;
import com.acme.staticforge.generate.quality.RunFindingStore;
import com.acme.staticforge.generate.quality.RunFindingStore.StoredFinding;
import com.acme.staticforge.generate.quality.SiteIndex;
import com.acme.staticforge.generate.quality.SiteRule;
import com.acme.staticforge.generate.target.BuildManifest;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.redirect.RedirectEntry;
import com.acme.staticforge.redirect.RedirectKind;
import com.acme.staticforge.redirect.RedirectService;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Redirect output in real builds (M30.5.1, epic decision 18): each target writes its own {@code redirectFormats}; stubs
 * are {@code SITE} outputs that go when their redirect goes (FULL and INCREMENTAL), are listed in neither the sitemap
 * nor the search index and never replace a real output; the build's own {@code .htaccess} gets the block appended, once;
 * and the check stage sees where the build serves redirects ({@link SiteIndex#redirectSources()}, the input of
 * {@code SF-CHK-0109}) — observed here through a test rule, before and after the hold-back.
 */
@SpringBootTest
@ActiveProfiles("test")
@Import(RedirectOutputIntegrationTest.RedirectSourceRules.class)
class RedirectOutputIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    /** Test rule: every internal link to a redirect source, before the hold-back. */
    static final String TO_REDIRECT = "SF-CHK-0196";

    /** The same, after the hold-back. */
    static final String TO_REDIRECT_AFTER = "SF-CHK-0197";

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-m30-redirect-output");
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
    @Autowired UrlRegistryService urlRegistryService;
    @Autowired ReleaseFixtures releaseFixtures;
    @Autowired RedirectService redirectService;
    @Autowired QualityRuleConfigService configService;
    @Autowired RunFindingStore findingStore;

    private final ObjectMapper mapper = new ObjectMapper();
    private BuildInsightFixtures build;
    private QualityBuildFixtures quality;

    @BeforeEach
    void setUp() {
        build = new BuildInsightFixtures(userService, projectService, assetService, assetRepository, templateService,
                mediaService, pageReferenceService, targetRepository, generationService, releaseFixtures, outputRoot);
        quality = new QualityBuildFixtures(build, configService, findingStore, outputRoot);
    }

    /**
     * {@code home} links {@code docs/about.html} literally (a link nobody updates), {@code about} lives in {@code docs}
     * — {@link #move} puts it into {@code guides}, so {@code docs/about.html} becomes a redirect source.
     */
    private record Site(Fixture fx, TemplateView template, UUID about, UUID guides) {}

    private Site site(String prefix) {
        Fixture fx = build.project(prefix + SEQ.incrementAndGet());
        TemplateView page = template(fx, "Page", QualityBuildFixtures.document("Page", "<p>page</p>"), "{folder}{uid}.{ext}");
        TemplateView linker = template(fx, "Linker",
                QualityBuildFixtures.document("Home", "<a href=\"docs/about.html\">about</a>"), "{folder}{uid}.{ext}");
        UUID docs = folderService.create(null, "docs", FolderScope.PAGES, fx.ctx()).uuid();
        UUID guides = folderService.create(null, "guides", FolderScope.PAGES, fx.ctx()).uuid();
        pageService.create(new CreatePageCommand("home", null, linker.uuid()), fx.ctx());
        UUID about = pageService.create(new CreatePageCommand("about", docs, page.uuid()), fx.ctx()).uuid();
        return new Site(fx, page, about, guides);
    }

    /** Moves the page and resets its URL, which is what moves its output (M32). */
    private void move(Site site) {
        assetService.move(site.about(), site.guides(), site.fx().ctx());
        resetUrl(site);
    }

    private void resetUrl(Site site) {
        urlRegistryService.reset(site.fx().projectId(), ResetScope.asset(site.about(), UrlArea.GENERATED), site.fx().ctx());
    }

    // ------------------------------------------------------------------
    // Formats per target
    // ------------------------------------------------------------------

    @Test
    @DisplayName("two targets of one project with different redirectFormats get different site files")
    void formatsPerTarget() {
        Site site = site("rofmt");
        GenerationTarget stubs = target(site.fx(), "stubs", "https://example.com", null);
        GenerationTarget apache = target(site.fx(), "apache", "https://example.com/site/", List.of("HTACCESS", "JSON"));
        GenerationTarget none = target(site.fx(), "none", "", List.of());
        for (GenerationTarget target : List.of(stubs, apache, none)) {
            build.succeeded(build.generate(site.fx(), target, GenerationMode.FULL));
        }
        move(site);

        GenerationRun stubRun = build.succeeded(build.generate(site.fx(), stubs, GenerationMode.FULL));
        GenerationRun apacheRun = build.succeeded(build.generate(site.fx(), apache, GenerationMode.INCREMENTAL));
        GenerationRun noneRun = build.succeeded(build.generate(site.fx(), none, GenerationMode.FULL));

        Map<String, String> stubFiles = build.files(site.fx(), stubs, stubRun);
        assertThat(stubFiles.get("docs/about.html"))
                .contains("<meta http-equiv=\"refresh\" content=\"0; url=../guides/about.html\">")
                .contains("<link rel=\"canonical\" href=\"https://example.com/guides/about.html\">");
        assertThat(stubFiles).doesNotContainKeys(".htaccess", "redirects.json");
        assertThat(stubFiles.get("sitemap.xml")).contains("guides/about.html").doesNotContain("docs/about.html");
        assertThat(stubFiles.get("search-index.json")).contains("guides/about.html").doesNotContain("docs/about.html");
        assertThat(output(site, stubs, stubRun, "docs/about.html").kind()).isEqualTo(BuildManifest.Kind.SITE);

        Map<String, String> apacheFiles = build.files(site.fx(), apache, apacheRun);
        assertThat(apacheFiles).doesNotContainKey("docs/about.html");
        assertThat(apacheFiles.get(".htaccess")).isEqualTo("# BEGIN StaticForge redirects\n"
                + "RedirectMatch 301 \"^/site/docs/about\\.html$\" \"/site/guides/about.html\"\n"
                + "# END StaticForge redirects\n");
        assertThat(build.json(apacheFiles.get("redirects.json")))
                .extracting(entry -> entry.path("from").asText(), entry -> entry.path("to").asText(),
                        entry -> entry.path("status").asInt())
                .containsExactly(tuple("docs/about.html", "guides/about.html", 301));
        assertThat(output(site, apache, apacheRun, ".htaccess").kind()).isEqualTo(BuildManifest.Kind.SITE);

        Map<String, String> noneFiles = build.files(site.fx(), none, noneRun);
        assertThat(noneFiles).doesNotContainKeys("docs/about.html", ".htaccess", "redirects.json");
        assertThat(noneRun.getPlanSummary().path("redirectsActive").asInt()).isZero();
        assertThat(stubRun.getPlanSummary().path("redirectsActive").asInt()).isEqualTo(1);
    }

    /**
     * Epic exit criterion 6 end to end: a page moved twice leaves two AUTO entries, and every format the target writes
     * sends both old URLs straight to the newest one — one hop, never old → older → new.
     */
    @Test
    @DisplayName("a page moved twice: stubs, .htaccess and redirects.json send both old URLs to the new one in one hop")
    void aPageMovedTwiceIsOneHopInEveryFormat() {
        Site site = site("rohop");
        UUID manuals = folderService.create(null, "manuals", FolderScope.PAGES, site.fx().ctx()).uuid();
        GenerationTarget target = target(site.fx(), "all", "https://example.com",
                List.of("HTML_STUB", "HTACCESS", "JSON"));
        build.succeeded(build.generate(site.fx(), target, GenerationMode.FULL));
        move(site);
        build.succeeded(build.generate(site.fx(), target, GenerationMode.INCREMENTAL));
        assetService.move(site.about(), manuals, site.fx().ctx());
        resetUrl(site);

        GenerationRun run = build.succeeded(build.generate(site.fx(), target, GenerationMode.INCREMENTAL));

        assertThat(redirectService.all(site.fx().projectId()))
                .extracting(RedirectEntry::getFromPath, RedirectEntry::getKind, RedirectEntry::getToAssetUuid)
                .containsExactlyInAnyOrder(
                        tuple("docs/about.html", RedirectKind.AUTO, site.about()),
                        tuple("guides/about.html", RedirectKind.AUTO, site.about()));
        Map<String, String> files = build.files(site.fx(), target, run);
        for (String from : List.of("docs/about.html", "guides/about.html")) {
            assertThat(files.get(from)).as(from)
                    .contains("<meta http-equiv=\"refresh\" content=\"0; url=../manuals/about.html\">")
                    .contains("<link rel=\"canonical\" href=\"https://example.com/manuals/about.html\">");
        }
        assertThat(files.get(".htaccess")).isEqualTo("# BEGIN StaticForge redirects\n"
                + "RedirectMatch 301 \"^/docs/about\\.html$\" \"/manuals/about.html\"\n"
                + "RedirectMatch 301 \"^/guides/about\\.html$\" \"/manuals/about.html\"\n"
                + "# END StaticForge redirects\n");
        assertThat(build.json(files.get("redirects.json")))
                .extracting(entry -> entry.path("from").asText(), entry -> entry.path("to").asText())
                .containsExactlyInAnyOrder(
                        tuple("docs/about.html", "manuals/about.html"), tuple("guides/about.html", "manuals/about.html"));
        assertThat(run.getPlanSummary().path("redirectsActive").asInt()).isEqualTo(2);
    }

    // ------------------------------------------------------------------
    // Lifecycle of a stub
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a stub leaves the published build when its redirect is deleted (INCREMENTAL and FULL)")
    void aStubGoesWithItsRedirect() {
        for (GenerationMode mode : GenerationMode.values()) {
            Site site = site("rodel");
            GenerationTarget target = target(site.fx(), "site", "https://example.com", null);
            build.succeeded(build.generate(site.fx(), target, GenerationMode.FULL));
            move(site);
            GenerationRun withStub = build.succeeded(build.generate(site.fx(), target, GenerationMode.INCREMENTAL));
            assertThat(build.files(site.fx(), target, withStub)).containsKey("docs/about.html");
            RedirectEntry entry = redirectService.all(site.fx().projectId()).get(0);

            redirectService.delete(site.fx().projectId(), entry.getId(), null, site.fx().user().getId());
            GenerationRun without = build.succeeded(build.generate(site.fx(), target, mode));

            assertThat(build.files(site.fx(), target, without)).as("mode %s", mode)
                    .doesNotContainKey("docs/about.html")
                    .containsKey("guides/about.html");
            assertThat(manifest(site, target, without).outputs()).extracting(BuildManifest.Output::path)
                    .doesNotContain("docs/about.html");
        }
    }

    @Test
    @DisplayName("a page published at a redirect's source replaces the stub; the build has no path collision")
    void aPageAtTheSourceReplacesTheStub() {
        Site site = site("roshadow");
        GenerationTarget target = target(site.fx(), "site", "", null);
        build.succeeded(build.generate(site.fx(), target, GenerationMode.FULL));
        move(site);
        build.succeeded(build.generate(site.fx(), target, GenerationMode.INCREMENTAL));
        // A new page whose template writes it at the old path.
        TemplateView other = template(site.fx(), "Other", QualityBuildFixtures.document("New", "<p>new about</p>"),
                "docs/about.{ext}");
        pageService.create(new CreatePageCommand("newcomer", null, other.uuid()), site.fx().ctx());

        GenerationRun run = build.succeeded(build.generate(site.fx(), target, GenerationMode.INCREMENTAL));

        assertThat(build.files(site.fx(), target, run).get("docs/about.html")).contains("new about").doesNotContain("refresh");
        assertThat(output(site, target, run, "docs/about.html").kind()).isEqualTo(BuildManifest.Kind.PAGE);
        assertThat(run.getDiagnostics().toString()).doesNotContain("SF-GEN-0110");
        assertThat(quality.findings(site.fx(), run, TO_REDIRECT)).isEmpty();
    }

    @Test
    @DisplayName("the build's own .htaccess gets the block appended once, also when it is carried")
    void theBuildsOwnHtaccessGetsTheBlock() {
        Site site = site("rohta");
        GenerationTarget target = target(site.fx(), "site", "", List.of("HTACCESS"));
        TemplateView apache = template(site.fx(), "Apache", "Options -Indexes\n", ".htaccess");
        pageService.create(new CreatePageCommand("apache", null, apache.uuid()), site.fx().ctx());
        GenerationRun first = build.succeeded(build.generate(site.fx(), target, GenerationMode.FULL));
        assertThat(build.files(site.fx(), target, first).get(".htaccess"))
                .isEqualTo("Options -Indexes\n# BEGIN StaticForge redirects\n# END StaticForge redirects\n");
        move(site);

        GenerationRun moved = build.succeeded(build.generate(site.fx(), target, GenerationMode.INCREMENTAL));
        GenerationRun again = build.succeeded(build.generate(site.fx(), target, GenerationMode.INCREMENTAL));

        String expected = "Options -Indexes\n# BEGIN StaticForge redirects\n"
                + "RedirectMatch 301 \"^/docs/about\\.html$\" \"/guides/about.html\"\n# END StaticForge redirects\n";
        assertThat(build.files(site.fx(), target, moved).get(".htaccess")).isEqualTo(expected);
        assertThat(build.files(site.fx(), target, again).get(".htaccess")).isEqualTo(expected);
        assertThat(output(site, target, again, ".htaccess").kind()).as("the page's output stays a page output")
                .isEqualTo(BuildManifest.Kind.PAGE);
    }

    // ------------------------------------------------------------------
    // SiteIndex.redirectSources (the input of SF-CHK-0109)
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the check stage sees the build's stub paths as redirect sources, before and after the hold-back")
    void redirectSourcesAreTheEmittedStubPaths() {
        Site site = site("rosrc");
        GenerationTarget target = target(site.fx(), "site", "https://example.com", null);
        GenerationTarget silent = target(site.fx(), "silent", "", List.of());
        GenerationRun before = build.succeeded(build.generate(site.fx(), target, GenerationMode.FULL));
        build.succeeded(build.generate(site.fx(), silent, GenerationMode.FULL));
        assertThat(quality.findings(site.fx(), before, TO_REDIRECT)).isEmpty();
        move(site);

        GenerationRun run = build.succeeded(build.generate(site.fx(), target, GenerationMode.INCREMENTAL));
        GenerationRun silentRun = build.succeeded(build.generate(site.fx(), silent, GenerationMode.INCREMENTAL));

        Map<String, String> files = build.files(site.fx(), target, run);
        List<String> stubs = manifest(site, target, run).outputs().stream()
                .filter(output -> output.kind() == BuildManifest.Kind.SITE && files.get(output.path()).contains("http-equiv"))
                .map(BuildManifest.Output::path)
                .toList();
        assertThat(stubs).containsExactly("docs/about.html");
        for (String code : List.of(TO_REDIRECT, TO_REDIRECT_AFTER)) {
            assertThat(quality.findings(site.fx(), run, code))
                    .extracting(StoredFinding::outputPath, StoredFinding::message)
                    .containsExactly(tuple("home.html", "Redirect: docs/about.html"));
        }
        assertThat(quality.findings(site.fx(), silentRun, TO_REDIRECT)).as("a target without redirect output").isEmpty();
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    @Test
    @DisplayName("SF-CHK-0109: a link to an emitted redirect stub is a hop, not a broken link; without a stub it is 0101")
    void theLinkRuleReportsALinkToARedirectStub() {
        Site site = site("ro0109");
        GenerationTarget target = target(site.fx(), "site", "https://example.com", null);
        GenerationTarget silent = target(site.fx(), "silent", "", List.of());
        build.succeeded(build.generate(site.fx(), target, GenerationMode.FULL));
        build.succeeded(build.generate(site.fx(), silent, GenerationMode.FULL));
        move(site);

        GenerationRun run = build.succeeded(build.generate(site.fx(), target, GenerationMode.INCREMENTAL));
        GenerationRun silentRun = build.succeeded(build.generate(site.fx(), silent, GenerationMode.INCREMENTAL));

        assertThat(quality.findings(site.fx(), run, RedirectedTargetRule.CODE))
                .extracting(StoredFinding::outputPath, StoredFinding::severity)
                .containsExactly(tuple("home.html", QualitySeverity.WARNING));
        assertThat(quality.findings(site.fx(), run, MissingLinkTargetRule.CODE)).isEmpty();
        // No redirect output on this target: the old path is simply gone.
        assertThat(quality.findings(site.fx(), silentRun, RedirectedTargetRule.CODE)).isEmpty();
        assertThat(quality.findings(site.fx(), silentRun, MissingLinkTargetRule.CODE))
                .extracting(StoredFinding::outputPath)
                .containsExactly("home.html");
    }

    private TemplateView template(Fixture fx, String name, String html, String outputPath) {
        return templateService.create(new CreateTemplateCommand(fx.projectId(), AssetType.PAGE_TEMPLATE,
                name + " " + SEQ.incrementAndGet(), "", Map.of("html", html), null, false, Map.of("html", outputPath)),
                fx.ctx());
    }

    /** A filesystem target; {@code formats} {@code null} leaves {@code redirectFormats} out of the config. */
    private GenerationTarget target(Fixture fx, String name, String baseUrl, List<String> formats) {
        ObjectNode config = mapper.createObjectNode().put("path", name);
        if (!baseUrl.isEmpty()) {
            config.put("baseUrl", baseUrl);
        }
        if (formats != null) {
            formats.forEach(config.putArray(RedirectFormat.CONFIG_KEY)::add);
        }
        return targetRepository.save(new GenerationTarget(fx.projectId(), name, TargetType.FILESYSTEM, config, false));
    }

    private BuildManifest manifest(Site site, GenerationTarget target, GenerationRun run) {
        Path file = build.targetDir(site.fx(), target).resolve("builds").resolve(run.getId() + ".manifest.json");
        try {
            return BuildManifest.parse(Files.readAllBytes(file)).orElseThrow();
        } catch (IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
    }

    private BuildManifest.Output output(Site site, GenerationTarget target, GenerationRun run, String path) {
        return manifest(site, target, run).outputs().stream()
                .filter(output -> output.path().equals(path))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no output " + path));
    }

    /** Test rules reporting every internal link to a redirect source, before and after the hold-back. */
    @TestConfiguration(proxyBeanMethods = false)
    static class RedirectSourceRules {

        @Bean
        LinkToRedirectRule redirectOutputTestLinkRule() {
            return new LinkToRedirectRule(TO_REDIRECT, false);
        }

        @Bean
        LinkToRedirectRule redirectOutputTestLinkRuleAfterHoldBack() {
            return new LinkToRedirectRule(TO_REDIRECT_AFTER, true);
        }
    }

    /** Reports {@code "Redirect: <path>"} for every internal link to a path the build serves a redirect at. */
    static final class LinkToRedirectRule implements SiteRule {

        private final String code;
        private final boolean afterHoldBack;

        LinkToRedirectRule(String code, boolean afterHoldBack) {
            this.code = code;
            this.afterHoldBack = afterHoldBack;
        }

        @Override
        public String code() {
            return code;
        }

        @Override
        public QualityCategory category() {
            return QualityCategory.LINKS;
        }

        @Override
        public String name() {
            return "Test: link to a redirect";
        }

        @Override
        public String description() {
            return "Reports links to the source path of a redirect of the build (test rule).";
        }

        @Override
        public boolean afterHoldBack() {
            return afterHoldBack;
        }

        @Override
        public List<Finding> check(SiteIndex site, RuleContext context) {
            List<Finding> findings = new ArrayList<>();
            for (Map.Entry<String, HtmlFacts> entry : site.facts().entrySet()) {
                IndexedOutput source = site.output(entry.getKey()).orElse(null);
                if (source == null) {
                    continue;
                }
                for (LinkRef link : entry.getValue().links()) {
                    if (link.internal() && site.isRedirectSource(link.resolvedPath())) {
                        findings.add(context.finding(source.key(), link.selector(), "Redirect: " + link.resolvedPath()));
                    }
                }
            }
            return findings;
        }
    }
}
