package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.BuildInsightFixtures.Fixture;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.quality.QualityRuleConfigService;
import com.acme.staticforge.generate.quality.RunFindingStore;
import com.acme.staticforge.generate.quality.RunFindingStore.StoredFinding;
import com.acme.staticforge.preview.PageRenderService;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * {@code nav.noIndex} end to end (M30.2.2, epic decision 12): the page service defaults and validates it, templates read
 * it as {@code $CMS_META(noIndex)$} and {@code CMS_META.noIndex}, the sitemap leaves out every output of such a page (all
 * page numbers, all languages), {@code SF-CHK-0212} reports one without a robots {@code noindex}, and an incremental
 * run picks up a change.
 */
@SpringBootTest
@ActiveProfiles("test")
class NoIndexIntegrationTest {

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-m30-noindex");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    /** A listing editor, so one template serves paginated and plain pages. */
    private static final String CDL = """
            content {
              editor pagination posts { label "Posts" sources ["nav"] pageSize 1 maxPageSize 20 sort ["navigation"] }
            }
            """;

    /** The robots meta only for a noIndex page, and the raw value for the golden render. */
    private static final String HTML = "<!doctype html><html lang=\"$CMS_META(language)$\"><head>"
            + "<title>$CMS_META(displayName)$</title>"
            + "$CMS_IF(CMS_META.noIndex)$<meta name=\"robots\" content=\"noindex\">$CMS_END_IF$"
            + "</head><body><h1>$CMS_META(displayName)$</h1><p>noIndex=$CMS_META(noIndex)$</p></body></html>";

    /** A template that forgets the robots meta. */
    private static final String BARE_HTML = "<!doctype html><html lang=\"$CMS_META(language)$\"><head>"
            + "<title>$CMS_META(displayName)$</title></head><body><h1>Bare</h1></body></html>";

    private static final String PATTERN = "{locale}/{displayNameSlug}.{ext}";

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired AssetRepository assetRepository;
    @Autowired TemplateService templateService;
    @Autowired MediaService mediaService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired PageService pageService;
    @Autowired PageRenderService pageRenderService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired ReleaseFixtures releaseFixtures;
    @Autowired QualityRuleConfigService configService;
    @Autowired RunFindingStore findingStore;

    private BuildInsightFixtures build;
    private QualityBuildFixtures q;

    @BeforeEach
    void setUp() {
        build = new BuildInsightFixtures(userService, projectService, assetService, assetRepository, templateService,
                mediaService, pageReferenceService, targetRepository, generationService, releaseFixtures, outputRoot);
        q = new QualityBuildFixtures(build, configService, findingStore, outputRoot);
    }

    /** de and en; "News" lists three posts one per page and is hidden, "Secret" is hidden on a bare template. */
    private record Site(Fixture fx, GenerationTarget target, AssetVersionView about, AssetVersionView news) {}

    private Site site(String prefix) {
        Fixture fx = q.project(prefix);
        projectService.updateLocales(fx.project().getKey(), LocaleConfig.of(
                List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English")), "de", Map.of(), false),
                true, fx.ctx());
        TemplateView template = build.pageTemplate(fx, "Seo page", CDL, HTML);
        build.updateTemplate(fx, template.uuid(), HTML, PATTERN);
        TemplateView bare = build.pageTemplate(fx, "Bare page", "", BARE_HTML);
        build.updateTemplate(fx, bare.uuid(), BARE_HTML, PATTERN);

        UUID navRoot = build.navigationRoot(fx);
        for (int i = 1; i <= 3; i++) {
            AssetVersionView post = build.page(fx, "Post " + i, template.uuid());
            build.pageReference(fx, "0" + i + " post", navRoot, post.uuid());
        }
        AssetVersionView about = build.page(fx, "About", template.uuid());
        AssetVersionView news = build.page(fx, "News", template.uuid(), payload -> {
            ObjectNode posts = payload.withObject("content").putObject("posts").put("type", "PAGINATION");
            posts.putObject("source").put("kind", "NAV").put("uuid", navRoot.toString());
            posts.put("pageSize", 1);
            posts.putObject("sort").put("key", "navigation").put("direction", "ASC");
            payload.putObject("nav").put("visible", true).put("noIndex", true);
        });
        build.page(fx, "Secret", bare.uuid(), payload -> payload.putObject("nav").put("noIndex", true));
        return new Site(fx, q.target(fx, "t"), about, news);
    }

    @Test
    void aNoIndexPageIsLeftOutOfTheSitemapInEveryPageNumberAndLanguage() {
        Site site = site("noidx");

        GenerationRun run = build.succeeded(q.generate(site.fx(), site.target(), GenerationMode.FULL));
        Map<String, String> files = q.files(site.fx(), site.target(), run);

        assertThat(files).containsKeys("de/news.html", "de/news-2.html", "de/news-3.html", "en/news.html",
                "en/news-2.html", "en/news-3.html", "de/secret.html", "en/secret.html");
        String sitemap = files.get("sitemap.xml");
        assertThat(sitemap)
                .contains("https://example.com/de/about.html", "https://example.com/en/about.html",
                        "https://example.com/de/post-1.html", "https://example.com/en/post-3.html")
                .doesNotContain("news", "secret");
        // Site search is the site's own: hidden pages stay in the search index.
        assertThat(files.get("search-index.json")).contains("de/news-2.html", "en/secret.html");

        // Golden renders: the value, and the robots meta only on the hidden page (every page number).
        assertThat(files.get("de/about.html")).isEqualTo("<!doctype html><html lang=\"de\"><head><title>About</title>"
                + "</head><body><h1>About</h1><p>noIndex=false</p></body></html>");
        assertThat(files.get("en/news-2.html")).isEqualTo("<!doctype html><html lang=\"en\"><head><title>News</title>"
                + "<meta name=\"robots\" content=\"noindex\"></head><body><h1>News</h1><p>noIndex=true</p></body></html>");

        // SF-CHK-0212 on the hidden page whose template forgot the robots meta, in both languages; not on "News".
        assertThat(q.findings(site.fx(), run, "SF-CHK-0212"))
                .extracting(StoredFinding::outputPath)
                .containsExactly("de/secret.html", "en/secret.html");

        // A scoped run carries "News" forward outside its scope: the rewritten sitemap still leaves it out.
        GenerationRun scoped = build.succeeded(build.generate(site.fx(), new GenerationRequest(GenerationMode.FULL, null,
                List.of("html"), site.target().getId(), null, List.of(site.about().uuid()), null, null)));
        Map<String, String> scopedFiles = q.files(site.fx(), site.target(), scoped);
        assertThat(scopedFiles).containsKeys("de/news-3.html", "en/news.html");
        assertThat(scopedFiles.get("sitemap.xml"))
                .contains("https://example.com/de/about.html", "https://example.com/en/post-2.html")
                .doesNotContain("news", "secret");
    }

    @Test
    void anIncrementalRunPicksUpANoIndexChange() {
        Site site = site("noidxinc");
        Fixture fx = site.fx();
        build.succeeded(q.generate(fx, site.target(), GenerationMode.FULL));

        build.edit(fx, site.about().uuid(), payload -> payload.withObject("nav").put("noIndex", true));
        build.edit(fx, site.news().uuid(), payload -> payload.withObject("nav").put("noIndex", false));
        GenerationRun hidden = build.succeeded(q.generate(fx, site.target(), GenerationMode.INCREMENTAL));
        Map<String, String> files = q.files(fx, site.target(), hidden);

        assertThat(hidden.getMode()).isEqualTo(GenerationMode.INCREMENTAL);
        assertThat(files.get("sitemap.xml"))
                .doesNotContain("about")
                .contains("https://example.com/de/news.html", "https://example.com/de/news-3.html",
                        "https://example.com/en/news-2.html", "https://example.com/de/post-2.html");
        assertThat(files.get("de/about.html")).contains("<meta name=\"robots\" content=\"noindex\">", "noIndex=true");
        // Every page number of a paginated page names its other languages (M24 alternates, per page number).
        assertThat(files.get("sitemap.xml")).contains(
                "hreflang=\"en\" href=\"https://example.com/en/news-2.html\"",
                "hreflang=\"de\" href=\"https://example.com/de/news-3.html\"");
        assertThat(files.get("en/news-3.html")).doesNotContain("robots").contains("noIndex=false");
        assertThat(q.findings(fx, hidden, "SF-CHK-0212"))
                .extracting(StoredFinding::outputPath)
                .containsExactly("de/secret.html", "en/secret.html");
    }

    @Test
    void thePreviewRendersTheValueToo() {
        Site site = site("noidxprev");

        String html = pageRenderService.renderPage(site.fx().projectId(), site.news().uuid(), null, "html", false, "", 2)
                .html();

        assertThat(html).contains("<meta name=\"robots\" content=\"noindex\">", "noIndex=true");
    }

    @Test
    void thePageServiceDefaultsAndValidatesNoIndex() {
        Fixture fx = q.project("noidxsvc");
        TemplateView template = build.pageTemplate(fx, "Plain", "", "<h1>plain</h1>");

        AssetVersionView page = pageService.create(new CreatePageCommand("Fresh", null, template.uuid()), fx.ctx());
        assertThat(page.payload().path("nav").path("noIndex").isBoolean()).isTrue();
        assertThat(page.payload().path("nav").path("noIndex").booleanValue()).isFalse();

        ObjectNode wrong = page.payload().deepCopy();
        wrong.withObject("nav").put("noIndex", "yes");
        assertThatThrownBy(() -> pageService.update(page.uuid(), wrong, page.validFromRevision(), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(422);
                    assertThat(e.getProblem().getDetail()).isEqualTo("Page payload nav.noIndex must be true or false.");
                });
        ObjectNode notAnObject = page.payload().deepCopy();
        notAnObject.put("nav", "hidden");
        assertThatThrownBy(() -> pageService.update(page.uuid(), notAnObject, page.validFromRevision(), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, e -> assertThat(e.getStatus()).isEqualTo(422));

        ObjectNode hidden = page.payload().deepCopy();
        hidden.withObject("nav").put("noIndex", true);
        AssetVersionView saved = pageService.update(page.uuid(), hidden, page.validFromRevision(), fx.ctx());
        assertThat(saved.payload().path("nav").path("noIndex").booleanValue()).isTrue();
        assertThat(saved.payload().path("nav").path("visible").booleanValue()).isTrue();

        ObjectNode patch = com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode();
        patch.putObject("nav").put("noIndex", 1);
        assertThatThrownBy(() -> pageService.patchContent(page.uuid(), patch, saved.validFromRevision(), fx.ctx()))
                .isInstanceOf(SfException.class);
    }
}
