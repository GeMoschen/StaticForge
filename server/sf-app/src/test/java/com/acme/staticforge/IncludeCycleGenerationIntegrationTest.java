package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
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
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.stream.StreamSupport;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * `M16.5.1` / `M16.6.1` journey 4: an include cycle fails only the affected page in generation. The
 * run is PARTIAL (not FAILED), its {@code SF-TPL-0135} diagnostic names the cyclic page, and every
 * other page is still published.
 */
@SpringBootTest
@ActiveProfiles("test")
class IncludeCycleGenerationIntegrationTest {

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-gen-include-cycle");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired ReleaseFixtures releaseFixtures;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void includeCycleHoldsBackOnlyTheCyclicPageAndTheRunIsPartial() throws Exception {
        AppUser user = userService.create("gen-cycle-user", "gen-cycle-user@example.com", "Gen Cycle", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("gencycle", "Gen Cycle", null, null), user.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), user.getId(), "include cycle generation");

        // A cycle cannot be saved in one step (each include must resolve on save).
        TemplateView a = template(project, ctx, AssetType.SECTION_TEMPLATE, "Cycle A", "A");
        TemplateView b = template(project, ctx, AssetType.SECTION_TEMPLATE, "Cycle B",
                "B[$CMS_INCLUDE(section_template:" + a.uid() + ")$]");
        templateService.saveChannel(a.uuid(), "html", "A[$CMS_INCLUDE(section_template:" + b.uid() + ")$]",
                templateService.get(project.getId(), a.uuid()).validFromRevision(), ctx);
        TemplateView cycleTemplate = template(project, ctx, AssetType.PAGE_TEMPLATE, "Cycle Page",
                "<main>$CMS_INCLUDE(section_template:" + a.uid() + ")$</main>");
        TemplateView plain = template(project, ctx, AssetType.PAGE_TEMPLATE, "Plain", "<p>fine</p>");
        AssetVersionView cyclic = pageService.create(new CreatePageCommand("Cyclic", null, cycleTemplate.uuid()), ctx);
        AssetVersionView healthy = pageService.create(new CreatePageCommand("Healthy", null, plain.uuid()), ctx);

        GenerationTarget target = targetRepository.save(new GenerationTarget(
                project.getId(), "default", TargetType.FILESYSTEM, mapper.createObjectNode(), true));
        releaseFixtures.releaseAll(project.getKey());
        GenerationRun run = generationService.start(
                project.getKey(),
                new GenerationRequest(GenerationMode.FULL, null, List.of("html"), target.getId(), null, null, null, null),
                user.getId());
        GenerationRun finished = awaitTerminal(project.getKey(), run.getId());

        assertThat(finished.getStatus()).as("diagnostics: %s", finished.getDiagnostics()).isEqualTo(RunStatus.PARTIAL);
        assertThat(finished.getErrorCount()).isEqualTo(1);
        JsonNode errors = finished.getDiagnostics().path("errors");
        assertThat(errors).hasSize(1);
        assertThat(errors.get(0).path("code").asText()).isEqualTo(DiagnosticCodes.OCTL_INCLUDE_CYCLE);
        List<String> messages = StreamSupport.stream(errors.get(0).path("messages").spliterator(), false)
                .map(JsonNode::asText)
                .toList();
        assertThat(messages).containsExactly("Page '" + cyclic.uid() + "' (html): Include cycle: "
                + a.uid() + " → " + b.uid() + " → " + a.uid());

        Path buildDir = TargetLocations.resolve(outputRoot, project.getKey(), target)
                .resolve("builds").resolve(String.valueOf(run.getId()));
        List<String> html;
        try (var stream = Files.walk(buildDir)) {
            html = stream.filter(Files::isRegularFile)
                    .map(p -> buildDir.relativize(p).toString().replace('\\', '/'))
                    .filter(p -> p.endsWith(".html"))
                    .toList();
        }
        assertThat(html).containsExactly(healthy.uid() + ".html");
    }

    private TemplateView template(Project project, RevisionContext ctx, AssetType type, String name, String html) {
        return templateService.create(
                new CreateTemplateCommand(project.getId(), type, name, CdlSources.split(""), Map.of("html", html), null, false, null, null),
                ctx);
    }

    private GenerationRun awaitTerminal(String projectKey, long runId) throws InterruptedException {
        long deadline = System.currentTimeMillis() + 60_000;
        while (System.currentTimeMillis() < deadline) {
            GenerationRun run = generationService.status(projectKey, runId);
            RunStatus status = run.getStatus();
            if (status == RunStatus.SUCCESS || status == RunStatus.PARTIAL || status == RunStatus.FAILED
                    || status == RunStatus.CANCELLED) {
                return run;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Generation did not reach a terminal state within 60s");
    }
}
