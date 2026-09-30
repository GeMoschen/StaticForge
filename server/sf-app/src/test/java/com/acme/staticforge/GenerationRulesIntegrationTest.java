package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.BuildInsightFixtures.Fixture;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.globals.CreateGlobalSetCommand;
import com.acme.staticforge.asset.globals.GlobalSetService;
import com.acme.staticforge.asset.globals.GlobalSetView;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.generate.GenerationDiagnosticCodes;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.generate.insight.RebuildEdgeKind;
import com.acme.staticforge.generate.insight.RebuildReason;
import com.acme.staticforge.generate.insight.RebuildStep;
import com.acme.staticforge.generate.plan.BuildPlan;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
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
 * The generation scope of editor rules (M33.7): {@code onGeneration holdBack} holds a page back (PARTIAL,
 * {@code SF-GEN-0120}); {@code onGeneration fail} fails the run after validating every page ({@code SF-GEN-0121}),
 * publishing nothing; warnings and infos are run diagnostics ({@code SF-GEN-0122}), only warnings counted; a template
 * whose rules read a property set rebuilds its pages when the set changes ({@code RULE_REFERENCE}).
 */
@SpringBootTest
@ActiveProfiles("test")
class GenerationRulesIntegrationTest {

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-m33-generation-rules");
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
    @Autowired FolderService folderService;
    @Autowired GlobalSetService globalSetService;

    private final ObjectMapper mapper = new ObjectMapper();
    private BuildInsightFixtures fixtures;

    @BeforeEach
    void setUp() {
        fixtures = new BuildInsightFixtures(userService, projectService, assetService, assetRepository, templateService,
                mediaService, pageReferenceService, targetRepository, generationService, releaseFixtures, outputRoot);
    }

    private static String rules(String level, String onGeneration) {
        return """
                content { editor text title { } }
                rules {
                  rule "no-tbd" on title {
                    level %s  scope [generation]%s
                    assert "value != 'TBD'"
                    message { en "Replace the placeholder title" }
                  }
                }
                """.formatted(level, onGeneration == null ? "" : "  onGeneration " + onGeneration);
    }

    @Test
    void holdBackHoldsBackThePageAndTheRunIsPartial() {
        Fixture fx = fixtures.project("m33hold");
        TemplateView template = fixtures.pageTemplate(fx, "Article", rules("error", "holdBack"), "<h1>$CMS_VALUE(title)$</h1>");
        AssetVersionView ok = fixtures.page(fx, "Ok", template.uuid(), p -> p.withObject("content").put("title", "Fine"));
        AssetVersionView tbd = fixtures.page(fx, "Tbd", template.uuid(), p -> p.withObject("content").put("title", "TBD"));
        GenerationTarget site = fixtures.target(fx, "site", TargetType.FILESYSTEM);

        GenerationRun run = fixtures.generate(fx, site, GenerationMode.FULL);

        assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isEqualTo(RunStatus.PARTIAL);
        String errors = run.getDiagnostics().path("errors").toString();
        assertThat(errors).contains(GenerationDiagnosticCodes.GEN_CONTENT_INCOMPLETE).contains(tbd.uid())
                .contains("Replace the placeholder title");
        Map<String, String> files = fixtures.files(fx, site, run);
        assertThat(files).containsKey("ok.html").doesNotContainKey("tbd.html");
        assertThat(ok.uid()).isNotNull();
    }

    @Test
    void failFailsTheRunReportingEveryFailingPageAndPublishesNothing() throws IOException {
        Fixture fx = fixtures.project("m33fail");
        TemplateView template = fixtures.pageTemplate(fx, "Article", rules("error", "fail"), "<h1>$CMS_VALUE(title)$</h1>");
        fixtures.page(fx, "Ok", template.uuid(), p -> p.withObject("content").put("title", "Fine"));
        AssetVersionView one = fixtures.page(fx, "One", template.uuid(), p -> p.withObject("content").put("title", "TBD"));
        AssetVersionView two = fixtures.page(fx, "Two", template.uuid(), p -> p.withObject("content").put("title", "TBD"));
        GenerationTarget site = fixtures.target(fx, "site", TargetType.FILESYSTEM);

        GenerationRun run = fixtures.generate(fx, site, GenerationMode.FULL);

        assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isEqualTo(RunStatus.FAILED);
        String errors = run.getDiagnostics().path("errors").toString();
        assertThat(errors).contains(GenerationDiagnosticCodes.GEN_RULE_FAILED).contains(one.uid()).contains(two.uid())
                .contains("no-tbd");
        assertThat(run.getErrorCount()).isEqualTo(2);
        Path current = fixtures.targetDir(fx, site).resolve("current");
        assertThat(Files.exists(current)).as("nothing published").isFalse();
    }

    @Test
    void warningsAndInfosAreRunDiagnosticsOnlyWarningsCount() {
        Fixture fx = fixtures.project("m33warn");
        TemplateView template = fixtures.pageTemplate(fx, "Article", """
                content { editor text title { } editor text teaser { } }
                rules {
                  rule "short" on title {
                    level warning  scope [generation]
                    assert "length(value) <= 5"
                    message { en "Long title" }
                  }
                  rule "teaser" on teaser {
                    level info  scope [generation]
                    assert "!isEmpty(value)"
                    message { en "No teaser" }
                  }
                }
                """, "<h1>$CMS_VALUE(title)$</h1>");
        fixtures.page(fx, "Home", template.uuid(), p -> p.withObject("content").put("title", "A long title"));
        GenerationTarget site = fixtures.target(fx, "site", TargetType.FILESYSTEM);

        GenerationRun run = fixtures.generate(fx, site, GenerationMode.FULL);

        // A warning is a build warning like any other: the run is PARTIAL, the page still published.
        assertThat(run.getStatus()).isEqualTo(RunStatus.PARTIAL);
        String diagnostics = run.getDiagnostics().toString();
        assertThat(diagnostics).contains(GenerationDiagnosticCodes.GEN_RULE_FINDING).contains("Long title")
                .contains("No teaser");
        assertThat(run.getWarningCount()).isEqualTo(1);
        assertThat(fixtures.files(fx, site, run)).containsKey("home.html");
    }

    @Test
    void aPropertySetTheRulesReadRebuildsTheTemplatesPages() {
        Fixture fx = fixtures.project("m33ref");
        AssetVersionView folder = folderService.create(null, "Branding", FolderScope.GLOBALS, fx.ctx());
        GlobalSetView site = globalSetService.create(new CreateGlobalSetCommand(
                fx.projectId(), folder.uuid(), "Site", "content { editor text title { } }"), fx.ctx());
        globalSetService.updateValues(site.uuid(), mapper.createObjectNode().put("title", "Acme"), site.revision(), fx.ctx());
        TemplateView template = fixtures.pageTemplate(fx, "Article", """
                content { editor text title { } }
                rules {
                  rule "site-title" on page {
                    level warning  scope [generation]
                    assert "!isEmpty(global:%s.title)"
                    message { en "The site has no title" }
                  }
                }
                """.formatted(site.uid()), "<h1>$CMS_VALUE(title)$</h1>");
        TemplateView plain = fixtures.pageTemplate(fx, "Plain", "", "<p>plain</p>");
        AssetVersionView home = fixtures.page(fx, "Home", template.uuid(), p -> p.withObject("content").put("title", "Hi"));
        AssetVersionView other = fixtures.page(fx, "Other", plain.uuid());
        GenerationTarget target = fixtures.target(fx, "site", TargetType.FILESYSTEM);
        GenerationRun first = fixtures.succeeded(fixtures.generate(fx, target, GenerationMode.FULL));
        assertThat(first.getWarningCount()).isZero();

        GlobalSetView current = globalSetService.find(fx.projectId(), site.uuid(), null).orElseThrow();
        globalSetService.updateValues(site.uuid(), mapper.createObjectNode().put("title", ""), current.revision(), fx.ctx());
        releaseFixtures.releaseAll(fx.project().getKey());
        BuildPlan plan = generationService.planFor(fx.project().getKey(), new GenerationRequest(
                GenerationMode.INCREMENTAL, null, List.of("html"), target.getId(), null, null, null, null)).plan();

        List<UUID> planned = plan.entries().stream().map(PlanEntry::pageUuid).distinct().toList();
        assertThat(planned).contains(home.uuid()).doesNotContain(other.uuid());
        RebuildReason reason = plan.reasonFor(home.uuid());
        assertThat(reason.rootUuid()).isEqualTo(site.uuid());
        assertThat(reason.steps()).extracting(RebuildStep::edge)
                .containsExactly(RebuildEdgeKind.PAGE_TEMPLATE, RebuildEdgeKind.RULE_REFERENCE);

        GenerationRun second = fixtures.generate(fx, target, GenerationMode.INCREMENTAL);
        assertThat(second.getStatus()).isEqualTo(RunStatus.PARTIAL);
        assertThat(second.getDiagnostics().toString()).contains("The site has no title");
    }

    @Test
    void anInfoAloneLeavesTheRunSuccessful() {
        Fixture fx = fixtures.project("m33info");
        TemplateView template = fixtures.pageTemplate(fx, "Article", rules("info", null), "<h1>$CMS_VALUE(title)$</h1>");
        fixtures.page(fx, "Home", template.uuid(), p -> p.withObject("content").put("title", "TBD"));
        GenerationTarget site = fixtures.target(fx, "site", TargetType.FILESYSTEM);

        GenerationRun run = fixtures.succeeded(fixtures.generate(fx, site, GenerationMode.FULL));
        assertThat(run.getWarningCount()).isZero();
        assertThat(run.getDiagnostics().toString()).contains("Replace the placeholder title");
    }
}
