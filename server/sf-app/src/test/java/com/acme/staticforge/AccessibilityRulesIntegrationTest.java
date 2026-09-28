package com.acme.staticforge;

import static com.acme.staticforge.QualityBuildFixtures.document;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import com.acme.staticforge.BuildInsightFixtures.Fixture;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.QualityRuleConfigService;
import com.acme.staticforge.generate.quality.QualitySeverity;
import com.acme.staticforge.generate.quality.RunFindingStore;
import com.acme.staticforge.generate.quality.RunFindingStore.StoredFinding;
import com.acme.staticforge.generate.quality.rules.a11y.MissingAltRule;
import com.acme.staticforge.generate.quality.rules.a11y.MissingDocumentLangRule;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.user.UserService;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * The accessibility rules in a real build (M30.2.3): they are registered, run on every HTML output at their default
 * severity, and {@code SF-CHK-0301} names the media asset a {@code $CMS_REF(media:…)$} image shows by its uid.
 */
@SpringBootTest
@ActiveProfiles("test")
class AccessibilityRulesIntegrationTest {

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-m30-a11y");
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
    @Autowired ReleaseFixtures releaseFixtures;
    @Autowired QualityRuleConfigService configService;
    @Autowired RunFindingStore findingStore;

    private QualityBuildFixtures q;

    @BeforeEach
    void setUp() {
        BuildInsightFixtures build = new BuildInsightFixtures(userService, projectService, assetService, assetRepository,
                templateService, mediaService, pageReferenceService, targetRepository, generationService, releaseFixtures,
                outputRoot);
        q = new QualityBuildFixtures(build, configService, findingStore, outputRoot);
    }

    @Test
    void anImageWithoutAltNamesTheMediaUidAndADecorativeImagePasses() {
        Fixture fx = q.project("a11yalt");
        AssetVersionView logo = q.build.media(fx, "logo.txt", "LOGO");
        q.htmlPage(fx, "Home", document("Home",
                "<p><img src=\"$CMS_REF(media:" + logo.uid() + ")$\"></p>"
                        + "<p><img src=\"$CMS_REF(media:" + logo.uid() + ")$\" alt=\"\"></p>"));
        q.htmlPage(fx, "Plain", "<!doctype html><html><head><title>Plain</title></head><body><h1>Plain</h1></body></html>");
        GenerationTarget target = q.target(fx, "t");

        GenerationRun run = q.generate(fx, target, GenerationMode.FULL);

        assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        assertThat(q.findings(fx, run))
                .filteredOn(finding -> finding.category() == QualityCategory.ACCESSIBILITY)
                .extracting(StoredFinding::outputPath, StoredFinding::code, StoredFinding::message)
                .containsExactly(
                        tuple("home.html", MissingAltRule.CODE, "Image without alt attribute: media \"" + logo.uid()
                                + "\" (" + mediaPath(fx, target, run, logo) + ")."),
                        tuple("plain.html", MissingDocumentLangRule.CODE, "<html> has no lang attribute."));
        assertThat(run.getFindingCounts().path("accessibility").asInt()).isEqualTo(2);
    }

    @Test
    void anErrorConfiguredAccessibilityRuleHoldsThePageBack() {
        Fixture fx = q.project("a11yerr");
        q.htmlPage(fx, "Home", document("Home", "<p><iframe src=\"https://maps.example.org/embed\"></iframe></p>"));
        q.htmlPage(fx, "About", document("About", "<p>About</p>"));
        q.configure(fx, Map.of("SF-CHK-0307", QualitySeverity.ERROR));
        GenerationTarget target = q.target(fx, "t");

        GenerationRun run = q.generate(fx, target, GenerationMode.FULL);

        assertThat(run.getStatus()).isEqualTo(RunStatus.PARTIAL);
        assertThat(q.files(fx, target, run)).containsKey("about.html").doesNotContainKey("home.html");
        assertThat(q.findings(fx, run, "SF-CHK-0307")).extracting(StoredFinding::severity, StoredFinding::message)
                .containsExactly(tuple(QualitySeverity.ERROR, "iframe without title: https://maps.example.org/embed."));
    }

    /**
     * Epic exit criterion 2 with a production rule in real builds: at its default a finding leaves the run
     * {@code SUCCESS}; switched {@code OFF} the same page reports nothing and its bytes don't change.
     */
    @Test
    void aRuleSwitchedOffReportsNothingAndAWarningLeavesTheRunSuccessful() {
        Fixture fx = q.project("a11yoff");
        q.htmlPage(fx, "Home", document("Home", "<p><iframe src=\"https://maps.example.org/embed\"></iframe></p>"));
        GenerationTarget target = q.target(fx, "t");

        GenerationRun warned = q.generate(fx, target, GenerationMode.FULL);
        assertThat(warned.getStatus()).as("diagnostics: %s", warned.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        assertThat(q.findings(fx, warned, "SF-CHK-0307")).extracting(StoredFinding::severity)
                .containsExactly(QualitySeverity.WARNING);

        q.configure(fx, Map.of("SF-CHK-0307", QualitySeverity.OFF));
        GenerationRun silent = q.generate(fx, target, GenerationMode.FULL);

        assertThat(silent.getStatus()).isEqualTo(RunStatus.SUCCESS);
        assertThat(q.findings(fx, silent)).extracting(StoredFinding::code)
                .as("the other rules still report").isNotEmpty().doesNotContain("SF-CHK-0307");
        assertThat(q.files(fx, target, silent).get("home.html")).isEqualTo(q.files(fx, target, warned).get("home.html"));
    }

    /** The media's output path as the page links it (the page sits at the site root). */
    private String mediaPath(Fixture fx, GenerationTarget target, GenerationRun run, AssetVersionView media) {
        return q.manifest(fx, target, run).orElseThrow().outputs().stream()
                .filter(output -> media.uuid().equals(output.asset()))
                .map(output -> output.path())
                .findFirst()
                .orElseThrow();
    }
}
