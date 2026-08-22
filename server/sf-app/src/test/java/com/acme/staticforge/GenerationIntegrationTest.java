package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
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

        GenerationRun finished = awaitTerminal(runId);
        assertThat(finished.getStatus()).isEqualTo(RunStatus.SUCCESS);
        assertThat(finished.getFilesWritten()).isPositive();

        Path buildDir = outputRoot.resolve("builds").resolve(String.valueOf(runId));
        assertThat(Files.isDirectory(buildDir)).isTrue();
        List<Path> files;
        try (var stream = Files.walk(buildDir)) {
            files = stream.filter(Files::isRegularFile).toList();
        }
        assertThat(files).isNotEmpty();
        assertThat(files.stream().anyMatch(p -> p.toString().endsWith(".html"))).isTrue();
        assertThat(files.stream().anyMatch(p -> p.getFileName().toString().equals("sitemap.xml"))).isTrue();
        assertThat(files.stream().anyMatch(p -> p.getFileName().toString().equals("robots.txt"))).isTrue();

        assertThat(Files.readString(outputRoot.resolve("current")).trim()).isEqualTo(String.valueOf(runId));
    }

    private GenerationRun awaitTerminal(long runId) throws InterruptedException {
        long deadline = System.currentTimeMillis() + 60_000;
        while (System.currentTimeMillis() < deadline) {
            GenerationRun run = generationService.status("genproj", runId);
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
