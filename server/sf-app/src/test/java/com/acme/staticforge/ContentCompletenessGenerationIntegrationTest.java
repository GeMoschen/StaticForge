package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
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
import com.acme.staticforge.generate.TargetLocations;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
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
 * Publish blocks per page on incomplete content (spec §10.5, M16.5.2): a page whose required
 * editor is empty saves fine, but generation fails just that page with {@code SF-GEN-0120}, the run
 * is PARTIAL, and every other page is still written.
 */
@SpringBootTest
@ActiveProfiles("test")
class ContentCompletenessGenerationIntegrationTest {

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-gen-completeness");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void pageWithEmptyRequiredEditorFailsWithContentIncompleteWhileOtherPagesPublish() throws Exception {
        AppUser user = userService.create("gen-cc-user", "gen-cc-user@example.com", "Gen CC", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("gencompleteness", "Gen Completeness", null, null), user.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), user.getId(), "completeness test");

        TemplateView template = templateService.create(new CreateTemplateCommand(
                project.getId(), AssetType.PAGE_TEMPLATE, "Article", "content { editor text title { required } }",
                Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"), null, false, null), ctx);
        AssetVersionView complete = pageService.create(new CreatePageCommand("Complete", null, template.uuid()), ctx);
        ObjectNode completePayload = (ObjectNode) complete.payload().deepCopy();
        completePayload.putObject("content").put("title", "Done");
        pageService.update(complete.uuid(), completePayload, complete.validFromRevision(), ctx);
        AssetVersionView incomplete = pageService.create(new CreatePageCommand("Draft", null, template.uuid()), ctx);

        GenerationTarget target = targetRepository.save(new GenerationTarget(
                project.getId(), "default", TargetType.FILESYSTEM, mapper.createObjectNode(), true));
        GenerationRun run = generationService.start(
                project.getKey(),
                new GenerationRequest(GenerationMode.FULL, null, List.of("html"), target.getId(), null, null, null, null),
                user.getId());
        GenerationRun finished = awaitTerminal(project.getKey(), run.getId());

        assertThat(finished.getStatus()).as("diagnostics: %s", finished.getDiagnostics()).isEqualTo(RunStatus.PARTIAL);
        assertThat(finished.getErrorCount()).isEqualTo(1);
        JsonNode errors = finished.getDiagnostics().path("errors");
        assertThat(errors).hasSize(1);
        assertThat(errors.get(0).path("code").asText()).isEqualTo(GenerationDiagnosticCodes.GEN_CONTENT_INCOMPLETE);
        List<String> messages = StreamSupport.stream(errors.get(0).path("messages").spliterator(), false)
                .map(JsonNode::asText)
                .toList();
        assertThat(messages).singleElement().satisfies(message -> {
            assertThat(message).contains(incomplete.uid()).contains("content.title");
        });

        Path buildDir = TargetLocations.resolve(outputRoot, project.getKey(), target)
                .resolve("builds").resolve(String.valueOf(run.getId()));
        List<String> html;
        try (var stream = Files.walk(buildDir)) {
            html = stream.filter(Files::isRegularFile)
                    .map(p -> buildDir.relativize(p).toString().replace('\\', '/'))
                    .filter(p -> p.endsWith(".html"))
                    .toList();
        }
        assertThat(html).anyMatch(p -> p.contains(complete.uid()));
        assertThat(html).noneMatch(p -> p.contains(incomplete.uid()));
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
