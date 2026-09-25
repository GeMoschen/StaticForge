package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.BuildInsightFixtures.Fixture;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.security.JwtService;
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
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The M22 journey through the REST API (M22.5.1), the backend twin of {@code ui/e2e/m22-journeys.spec.ts}: a section
 * template on 3 of 5 pages changes, the incremental preview explains 3 rebuilds, the run stores the same plan and
 * publishes all 5 pages with a complete sitemap, the media file's impact is its 1 page, and a target without builds
 * previews a fallback to a full build.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class M22BuildInsightJourneyIntegrationTest {

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-m22-journey-test");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired MockMvc mvc;
    @Autowired JwtService jwtService;
    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired AssetRepository assetRepository;
    @Autowired TemplateService templateService;
    @Autowired MediaService mediaService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired ReleaseFixtures releaseFixtures;

    private BuildInsightFixtures fixtures;

    @BeforeEach
    void setUp() {
        fixtures = new BuildInsightFixtures(userService, projectService, assetService, assetRepository, templateService,
                mediaService, pageReferenceService, targetRepository, generationService, releaseFixtures, outputRoot);
    }

    private JsonNode call(org.springframework.test.web.servlet.RequestBuilder request) throws Exception {
        return fixtures.json(mvc.perform(request).andExpect(status().is2xxSuccessful()).andReturn().getResponse().getContentAsString());
    }

    @Test
    void whyIsThisRebuilding() throws Exception {
        // 1. Seed.
        Fixture fx = fixtures.project("m22journey");
        String token = "Bearer " + jwtService.issueAccessToken(fx.user());
        String base = "/api/v1/projects/" + fx.project().getKey();
        GenerationTarget site = fixtures.target(fx, "Site", TargetType.FILESYSTEM);
        GenerationTarget staging = fixtures.target(fx, "Staging", TargetType.FILESYSTEM);
        AssetVersionView hero = fixtures.media(fx, "hero.txt", "HERO");
        TemplateView teaser = fixtures.sectionTemplate(fx, "Teaser", "", "<p>teaser v1</p>");
        TemplateView article = fixtures.pageTemplate(fx, "Article",
                "bodies { body main { label \"Main\" allow [\"*\"] } }", "<main>$CMS_BODY(main)$</main>");
        for (String name : List.of("One", "Two", "Three")) {
            fixtures.page(fx, name, article.uuid(), payload -> fixtures.section(payload, "main", teaser.uuid()));
        }
        TemplateView withHero = fixtures.pageTemplate(
                fx, "With hero", "content { editor media hero { label \"Hero\" } }", "<img src=\"$CMS_REF(hero)$\">");
        fixtures.page(fx, "About", withHero.uuid(), p -> p.withObject("content").set("hero", fixtures.mediaRef(hero.uuid())));
        fixtures.page(fx, "Legal", article.uuid());

        // 2. Baseline.
        fixtures.succeeded(fixtures.generate(fx, site, GenerationMode.FULL));

        // 3. The teaser changes; the incremental preview explains three rebuilds.
        fixtures.updateTemplate(fx, teaser.uuid(), "<p>teaser v2</p>", null);
        String incremental = "{\"mode\":\"INCREMENTAL\",\"channels\":[\"html\"],\"targetId\":" + site.getId() + "}";
        JsonNode preview = call(post(base + "/generations/plan").header("Authorization", token)
                .contentType(MediaType.APPLICATION_JSON).content(incremental));
        assertThat(preview.path("summary").path("entryCount").asInt()).isEqualTo(3);
        assertThat(preview.path("summary").path("via").get(0).path("uid").asText()).isEqualTo(teaser.uid());
        JsonNode previewEntries = preview.path("entries").path("content");
        assertThat(StreamSupport.stream(previewEntries.spliterator(), false).map(e -> e.path("outputPath").asText()))
                .containsExactly("one.html", "three.html", "two.html");
        assertThat(previewEntries).allSatisfy(entry -> {
            assertThat(entry.path("reason").path("rootAsset").path("uid").asText()).isEqualTo(teaser.uid());
            assertThat(entry.path("reason").path("steps")).singleElement()
                    .satisfies(step -> assertThat(step.path("edge").asText()).isEqualTo("SECTION_TEMPLATE"));
        });

        // 4. The run plans the same entries and stores them.
        JsonNode started = call(post(base + "/generations").header("Authorization", token)
                .contentType(MediaType.APPLICATION_JSON).content(incremental));
        GenerationRun run = fixtures.succeeded(fixtures.await(fx, started.path("id").asLong()));
        JsonNode stored = call(get(base + "/generations/" + run.getId() + "/plan").header("Authorization", token));
        assertThat(stored.path("entries").path("content")).isEqualTo(previewEntries);

        // 5. The published build is complete.
        Map<String, String> files = fixtures.files(fx, site, run);
        assertThat(files).containsKeys("one.html", "two.html", "three.html", "about.html", "legal.html", "assets/media/hero_txt.txt");
        assertThat(files.get("one.html")).contains("teaser v2");
        assertThat(files.get("sitemap.xml")).contains(
                "https://example.com/one.html", "https://example.com/two.html", "https://example.com/three.html",
                "https://example.com/about.html", "https://example.com/legal.html");

        // 6. The media file's impact is its one page.
        JsonNode impact = call(get(base + "/assets/" + hero.uuid() + "/impact").header("Authorization", token));
        assertThat(impact.path("pageCount").asInt()).isEqualTo(1);
        assertThat(impact.path("entries").path("content").get(0).path("reason").path("steps").get(0).path("referenceKind").asText())
                .isEqualTo("MEDIA_REF");

        // 7. A target without builds previews a fallback to a full build.
        JsonNode fallback = call(post(base + "/generations/plan").header("Authorization", token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"mode\":\"INCREMENTAL\",\"channels\":[\"html\"],\"targetId\":" + staging.getId() + "}"));
        assertThat(fallback.path("summary").path("fallbackCause").asText()).isEqualTo("NO_COMPLETE_BUILD_FOR_TARGET");
        assertThat(fallback.path("summary").path("entryCount").asInt()).isEqualTo(5);
    }
}
