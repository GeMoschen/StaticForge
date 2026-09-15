package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.common.SfException;
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
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Generation orchestration end-to-end (spec §18). Creates a project, a default FILESYSTEM target,
 * a page template + page, then runs a FULL generation and asserts the run reaches SUCCESS, output
 * files are written under the configured output root, and {@code current} points at the run.
 */
@SpringBootTest
@ActiveProfiles("test")
class GenerationIntegrationTest {

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-gen-test");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired TemplateService templateService;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void fullGenerationReachesSuccessAndPublishesOutput() throws Exception {
        AppUser user = userService.create("gen-user", "gen-user@example.com", "Gen User", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("genproj", "Gen Project", null, "generation test"), user.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), user.getId(), "generation test");

        ObjectNode templatePayload = mapper.createObjectNode();
        templatePayload.with("channelTemplates").with("html").put("source", "Hello, world");
        AssetVersionView template = assetService.create(
                new CreateAssetCommand(project.getId(), AssetType.PAGE_TEMPLATE, "Home Template", null, templatePayload, null),
                ctx);

        ObjectNode pagePayload = mapper.createObjectNode();
        pagePayload.put("templateRef", template.uuid().toString());
        pagePayload.set("content", mapper.createObjectNode());
        assetService.create(
                new CreateAssetCommand(project.getId(), AssetType.PAGE, "Home", null, pagePayload, null), ctx);

        GenerationTarget target = targetRepository.save(new GenerationTarget(
                project.getId(),
                "default",
                TargetType.FILESYSTEM,
                mapper.readTree("{\"baseUrl\":\"https://example.com\"}"),
                true));

        GenerationRun run = generationService.start(
                project.getKey(),
                new GenerationRequest(GenerationMode.FULL, null, List.of("html"), target.getId(), null, null, null, null),
                user.getId());
        long runId = run.getId();

        GenerationRun finished = awaitTerminal(project.getKey(), runId);
        assertThat(finished.getStatus()).isEqualTo(RunStatus.SUCCESS);
        assertThat(finished.getFilesWritten()).isPositive();

        Path targetDir = TargetLocations.resolve(outputRoot, project.getKey(), target);
        assertThat(targetDir).isEqualTo(outputRoot.toAbsolutePath().normalize().resolve("genproj").resolve("target-" + target.getId()));
        Path buildDir = targetDir.resolve("builds").resolve(String.valueOf(runId));
        assertThat(Files.isDirectory(buildDir)).isTrue();
        List<Path> files;
        try (var stream = Files.walk(buildDir)) {
            files = stream.filter(Files::isRegularFile).toList();
        }
        assertThat(files).isNotEmpty();
        assertThat(files.stream().anyMatch(p -> p.toString().endsWith(".html"))).isTrue();
        assertThat(files.stream().anyMatch(p -> p.getFileName().toString().equals("sitemap.xml"))).isTrue();
        assertThat(files.stream().anyMatch(p -> p.getFileName().toString().equals("robots.txt"))).isTrue();

        assertThat(Files.readString(targetDir.resolve("current")).trim()).isEqualTo(String.valueOf(runId));
    }

    /**
     * {@code nav:root} is the documented way to address the whole navigation tree: it must save,
     * pass generation's validate stage and render the Navigation store's root — not fail with
     * SF-TPL-0110 because the uid "root" belongs to the hidden folder that parents every store.
     */
    @Test
    void navRootTemplateSavesAndGeneratesSuccessfully() throws Exception {
        AppUser user = userService.create("gen-nav-user", "gen-nav-user@example.com", "Gen Nav User", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("gennavroot", "Gen Nav Root", null, "nav:root generation test"), user.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), user.getId(), "nav:root generation test");

        TemplateView template = templateService.create(
                new CreateTemplateCommand(project.getId(), AssetType.PAGE_TEMPLATE, "Nav Template", "",
                        Map.of("html", "<nav>$CMS_NAVIGATION(nav:root)$</nav>"), null, false, null, null),
                ctx);
        ObjectNode pagePayload = mapper.createObjectNode();
        pagePayload.put("templateRef", template.uuid().toString());
        pagePayload.set("content", mapper.createObjectNode());
        assetService.create(new CreateAssetCommand(project.getId(), AssetType.PAGE, "Home", null, pagePayload, null), ctx);
        GenerationTarget target = targetRepository.save(new GenerationTarget(
                project.getId(), "default", TargetType.FILESYSTEM, mapper.createObjectNode(), true));

        GenerationRun run = generationService.start(
                project.getKey(),
                new GenerationRequest(GenerationMode.FULL, null, List.of("html"), target.getId(), null, null, null, null),
                user.getId());
        GenerationRun finished = awaitTerminal(project.getKey(), run.getId());

        assertThat(finished.getStatus()).as("diagnostics: %s", finished.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        assertThat(finished.getErrorCount()).isZero();
    }

    /** Template save applies the same NAVIGATION-scope check as preview/generation, so the error surfaces on save. */
    @Test
    void navReferenceToAnotherStoresFolderIsRejectedOnTemplateSave() {
        AppUser user = userService.create("gen-nav-bad", "gen-nav-bad@example.com", "Gen Nav Bad", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("gennavbad", "Gen Nav Bad", null, "nav scope test"), user.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), user.getId(), "nav scope test");

        assertThatThrownBy(() -> templateService.create(
                new CreateTemplateCommand(project.getId(), AssetType.PAGE_TEMPLATE, "Bad Nav", "",
                        Map.of("html", "$CMS_NAVIGATION(nav:pages_root)$"), null, false, null, null),
                ctx))
                .isInstanceOf(SfException.class);
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
