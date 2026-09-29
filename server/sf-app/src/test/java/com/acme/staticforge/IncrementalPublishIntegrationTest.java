package com.acme.staticforge;

import com.acme.staticforge.urlregistry.UrlRegistryService;
import com.acme.staticforge.urlregistry.UrlArea;
import com.acme.staticforge.urlregistry.ResetScope;
import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.BuildInsightFixtures.Fixture;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.asset.template.UpdateTemplateCommand;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.stream.StreamSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Incremental runs publish the complete site (M22.4.1): the base build's unchanged outputs are carried forward, what
 * went away is removed, the sitemap and search index cover every page, and the baseline is the target's current,
 * complete build.
 */
@SpringBootTest
@ActiveProfiles("test")
class IncrementalPublishIntegrationTest {

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-m22-publish-test");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired AssetRepository assetRepository;
    @Autowired TemplateService templateService;
    @Autowired MediaService mediaService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired UrlRegistryService urlRegistryService;
    @Autowired ReleaseFixtures releaseFixtures;

    private BuildInsightFixtures fixtures;

    @BeforeEach
    void setUp() {
        fixtures = new BuildInsightFixtures(userService, projectService, assetService, assetRepository, templateService,
                mediaService, pageReferenceService, targetRepository, generationService, releaseFixtures, outputRoot);
    }

    private record Site(Fixture fx, TemplateView shared, TemplateView about, Map<String, AssetVersionView> pages) {}

    /** Five pages; four share a template that links a media file, one has a template of its own. */
    private Site site(String prefix) {
        Fixture fx = fixtures.project(prefix);
        fixtures.media(fx, "logo.txt", "LOGO");
        TemplateView shared = fixtures.pageTemplate(fx, "Shared", "", "<p>shared <a href=\"$CMS_REF(media:logo_txt)$\">logo</a></p>");
        TemplateView about = fixtures.pageTemplate(fx, "About Template", "", "<p>about v1</p>");
        Map<String, AssetVersionView> pages = Map.of(
                "home", fixtures.page(fx, "Home", shared.uuid()),
                "news", fixtures.page(fx, "News", shared.uuid()),
                "legal", fixtures.page(fx, "Legal", shared.uuid()),
                "old", fixtures.page(fx, "Old", shared.uuid()),
                "about", fixtures.page(fx, "About", about.uuid()));
        return new Site(fx, shared, about, pages);
    }

    private void changeTemplate(Fixture fx, TemplateView template, String html) {
        TemplateView now = templateService.get(fx.projectId(), template.uuid());
        templateService.update(template.uuid(), new UpdateTemplateCommand(now.displayName(), "", Map.of("html", html), null,
                false, Map.of("html", "{displayNameSlug}.{ext}"), false, Map.of()), now.validFromRevision(), fx.ctx());
    }

    @ParameterizedTest
    @EnumSource(TargetType.class)
    void anIncrementalRunPublishesWhatAFullRunAtTheSameRevisionPublishes(TargetType type) {
        Site site = site("m22pub" + type.name().toLowerCase());
        Fixture fx = site.fx();
        GenerationTarget incremental = fixtures.target(fx, "incremental", type);
        fixtures.succeeded(fixtures.generate(fx, incremental, GenerationMode.FULL));

        changeTemplate(fx, site.about(), "<p>about v2</p>");
        fixtures.rename(fx, site.pages().get("news").uuid(), "News Room");
        // A rename keeps the page's URL until it is reset (M32): the reset moves it to its new computed path.
        urlRegistryService.reset(fx.projectId(), ResetScope.asset(site.pages().get("news").uuid(), UrlArea.GENERATED), fx.ctx());
        assetService.softDelete(site.pages().get("old").uuid(), true, fx.ctx());

        GenerationRun run = fixtures.succeeded(fixtures.generate(fx, incremental, GenerationMode.INCREMENTAL));
        assertThat(run.getPlanSummary().path("incremental").asBoolean()).isTrue();
        assertThat(run.getPlanSummary().path("pageCount").asInt()).as("about and the renamed news page").isEqualTo(2);

        GenerationTarget fresh = fixtures.target(fx, "fresh", type);
        GenerationRun full = fixtures.succeeded(fixtures.generate(fx, fresh, GenerationMode.FULL));

        Map<String, String> published = fixtures.files(fx, incremental, run);
        assertThat(published).isEqualTo(fixtures.files(fx, fresh, full));
        assertThat(published).containsKeys("home.html", "legal.html", "news-room.html", "about.html", "assets/media/logo_txt.txt")
                .doesNotContainKey("old.html");
        // The renamed page's old path redirects (M30.4.2, M30.5.1) — in the fresh target's build too: the registry is the
        // project's.
        assertThat(published.get("news.html")).contains("<meta http-equiv=\"refresh\" content=\"0; url=news-room.html\">");
        assertThat(published.get("about.html")).isEqualTo("<p>about v2</p>");
        assertThat(published.get("sitemap.xml")).contains("home.html", "legal.html", "news-room.html", "about.html")
                .doesNotContain("old.html");
        JsonNode index = fixtures.json(published.get("search-index.json"));
        assertThat(StreamSupport.stream(index.spliterator(), false).map(e -> e.path("path").asText()))
                .containsExactly("about.html", "home.html", "legal.html", "news-room.html");
        assertThat(index.get(1).path("text").asText()).as("carried text").isEqualTo("shared logo");
    }

    @Test
    void theCarriedBuildLeavesItsBaseUntouched() throws IOException {
        Site site = site("m22base");
        Fixture fx = site.fx();
        GenerationTarget target = fixtures.target(fx, "fs", TargetType.FILESYSTEM);
        GenerationRun first = fixtures.succeeded(fixtures.generate(fx, target, GenerationMode.FULL));
        Map<String, String> before = fixtures.files(fx, target, first);

        changeTemplate(fx, site.shared(), "<p>shared v2</p>");
        fixtures.succeeded(fixtures.generate(fx, target, GenerationMode.INCREMENTAL));

        assertThat(fixtures.files(fx, target, first)).as("hard links are never written through").isEqualTo(before);
    }

    @Test
    void theBaselineIsTheTargetsCurrentCompleteBuild() throws IOException {
        Site site = site("m22baseline");
        Fixture fx = site.fx();
        GenerationTarget a = fixtures.target(fx, "a", TargetType.FILESYSTEM);
        GenerationTarget b = fixtures.target(fx, "b", TargetType.FILESYSTEM);
        GenerationRun first = fixtures.succeeded(fixtures.generate(fx, a, GenerationMode.FULL));

        JsonNode onB = fixtures.succeeded(fixtures.generate(fx, b, GenerationMode.INCREMENTAL)).getPlanSummary();
        assertThat(onB.path("incremental").asBoolean()).as("a build of target A is no baseline for B").isFalse();
        assertThat(onB.path("fallbackCause").asText()).isEqualTo("NO_COMPLETE_BUILD_FOR_TARGET");

        changeTemplate(fx, site.about(), "<p>about v2</p>");
        GenerationRun second = fixtures.succeeded(fixtures.generate(fx, a, GenerationMode.INCREMENTAL));
        assertThat(second.getPlanSummary().path("baselineRevision").asLong()).isEqualTo(first.getRevisionId());

        // A scoped run publishes on top of the current build but never advances the baseline.
        changeTemplate(fx, site.about(), "<p>about v3</p>");
        GenerationRun scoped = fixtures.succeeded(fixtures.generate(fx, new GenerationRequest(GenerationMode.FULL, null,
                List.of("html"), a.getId(), null, List.of(site.pages().get("about").uuid()), null, null)));
        assertThat(scoped.getPlanSummary().path("pageCount").asInt()).isEqualTo(1);
        Map<String, String> scopedFiles = fixtures.files(fx, a, scoped);
        assertThat(scopedFiles).containsKeys("home.html", "news.html", "legal.html", "old.html");
        assertThat(scopedFiles.get("about.html")).isEqualTo("<p>about v3</p>");
        assertThat(scopedFiles.get("sitemap.xml")).contains("home.html", "about.html");
        GenerationRun afterScoped = fixtures.succeeded(fixtures.generate(fx, a, GenerationMode.INCREMENTAL));
        assertThat(afterScoped.getPlanSummary().path("baselineRevision").asLong()).isEqualTo(second.getRevisionId());

        // Promote: the baseline is the promoted build.
        generationService.promote(fx.project().getKey(), first.getId(), null);
        GenerationRun afterPromote = fixtures.succeeded(fixtures.generate(fx, a, GenerationMode.INCREMENTAL));
        assertThat(afterPromote.getPlanSummary().path("baselineRevision").asLong()).isEqualTo(first.getRevisionId());
        assertThat(fixtures.files(fx, a, afterPromote).get("about.html")).isEqualTo("<p>about v3</p>");

        // A build without its manifest can't be carried forward.
        Files.delete(fixtures.targetDir(fx, a).resolve("builds").resolve(afterPromote.getId() + ".manifest.json"));
        JsonNode missing = fixtures.succeeded(fixtures.generate(fx, a, GenerationMode.INCREMENTAL)).getPlanSummary();
        assertThat(missing.path("fallbackCause").asText()).isEqualTo("BASE_BUILD_MISSING");
    }
}
