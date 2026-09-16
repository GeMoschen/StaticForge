package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.UpdateAssetCommand;
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
import com.acme.staticforge.preview.PageRenderService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * `M16.2.2`: {@code $CMS_VALUE(page:b.headline)$} renders page B's value in generation
 * (snapshot-consistent, and an edit to B rebuilds A incrementally) and in preview (live and
 * time travel); a soft-deleted target renders empty with a warning.
 */
@SpringBootTest
@ActiveProfiles("test")
class CrossAssetValueIntegrationTest {

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-cross-asset-test");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired TemplateService templateService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired PageRenderService pageRenderService;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void crossAssetValueRendersInGenerationAndPreviewAndTracksTheTarget() throws Exception {
        AppUser user = userService.create("cross-asset", "cross-asset@example.com", "Cross Asset", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("crossasset", "Cross Asset", null, "cross-asset values"), user.getId());
        long projectId = project.getId();
        RevisionContext ctx = RevisionContext.of(projectId, user.getId(), "cross-asset values");

        TemplateView plain = templateService.create(
                new CreateTemplateCommand(projectId, AssetType.PAGE_TEMPLATE, "Plain", "",
                        Map.of("html", "B-page"), null, false, null, null),
                ctx);
        AssetVersionView pageB = page(projectId, ctx, "Page B", plain.uuid(), "First headline");
        TemplateView teaser = templateService.create(
                new CreateTemplateCommand(projectId, AssetType.PAGE_TEMPLATE, "Teaser", "",
                        Map.of("html", "A[$CMS_VALUE(page:" + pageB.uid() + ".headline)$]"), null, false, null, null),
                ctx);
        AssetVersionView pageA = page(projectId, ctx, "Page A", teaser.uuid(), "unused");
        GenerationTarget target = targetRepository.save(new GenerationTarget(
                projectId, "default", TargetType.FILESYSTEM, mapper.readTree("{\"baseUrl\":\"https://example.com\"}"), true));

        // --- Generation: FULL renders B's headline into A. ---
        GenerationRun full = run(project, target, GenerationMode.FULL, null, user);
        assertThat(full.getStatus()).as("diagnostics: %s", full.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        assertThat(outputOfA(project, target, full)).contains("A[First headline]");

        // --- Preview: live shows B's current headline. ---
        // Page A was created after B, so at A's first revision both exist with B's first headline.
        long revisionBeforeEdit = assetService.requireCurrent(projectId, pageA.uuid()).validFromRevision();
        assertThat(preview(projectId, pageA.uuid(), null)).isEqualTo("A[First headline]");

        // --- Edit only B: INCREMENTAL rebuilds A (A's own version is unchanged). ---
        update(projectId, ctx, pageB, plain.uuid(), "Second headline");
        GenerationRun incremental = run(project, target, GenerationMode.INCREMENTAL, null, user);
        assertThat(incremental.getStatus()).as("diagnostics: %s", incremental.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        assertThat(outputOfA(project, target, incremental)).contains("A[Second headline]");

        // --- Preview: live shows the new headline, time travel the old one. ---
        assertThat(preview(projectId, pageA.uuid(), null)).isEqualTo("A[Second headline]");
        assertThat(preview(projectId, pageA.uuid(), revisionBeforeEdit)).isEqualTo("A[First headline]");

        // --- Soft-deleted target: empty render with a warning. A run pinned to a revision snapshots
        // deleted versions too, so page:b still resolves and its value degrades (§16.4); an unpinned
        // run is pinned to the head revision and behaves the same (see the next test).
        assetService.softDelete(pageB.uuid(), true, ctx);
        assertThat(preview(projectId, pageA.uuid(), null)).isEqualTo("A[]");
        long deletedAt = assetService.requireCurrent(projectId, pageB.uuid()).validFromRevision();
        GenerationRun afterDelete = run(project, target, GenerationMode.FULL, deletedAt, user);
        assertThat(afterDelete.getStatus()).as("diagnostics: %s", afterDelete.getDiagnostics()).isEqualTo(RunStatus.PARTIAL);
        assertThat(afterDelete.getDiagnostics().toString()).contains(DiagnosticCodes.OCTL_MISSING_VALUE_TARGET);
        assertThat(outputOfA(project, target, afterDelete)).contains("A[]");
    }

    /**
     * `M16.6.1`: a run without a revision pin sees soft-deleted assets exactly like a run pinned to the
     * head revision. A value, {@code $CMS_REF} and {@code $CMS_INCLUDE} to deleted targets render empty
     * with warnings ({@code SF-TPL-0112}, {@code SF-GEN-0220}) instead of failing VALIDATE with
     * {@code SF-TPL-0110}; deleting a referenced page rebuilds its referrer incrementally, and the
     * deleted page itself is never published.
     */
    @Test
    void unpinnedRunsTreatSoftDeletedTargetsLikeAPinnedRun() throws Exception {
        AppUser user = userService.create("cross-deleted", "cross-deleted@example.com", "Cross Deleted", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("crossdeleted", "Cross Deleted", null, "deleted targets"), user.getId());
        long projectId = project.getId();
        RevisionContext ctx = RevisionContext.of(projectId, user.getId(), "deleted targets");

        TemplateView plain = templateService.create(
                new CreateTemplateCommand(projectId, AssetType.PAGE_TEMPLATE, "Plain", "",
                        Map.of("html", "B-page"), null, false, null, null),
                ctx);
        AssetVersionView pageB = page(projectId, ctx, "Page B", plain.uuid(), "Kept headline");
        TemplateView box = templateService.create(
                new CreateTemplateCommand(projectId, AssetType.SECTION_TEMPLATE, "Box", "",
                        Map.of("html", "box"), null, false, null, null),
                ctx);
        TemplateView reader = templateService.create(
                new CreateTemplateCommand(projectId, AssetType.PAGE_TEMPLATE, "Reader", "",
                        Map.of("html", "A[$CMS_VALUE(page:" + pageB.uid() + ".headline)$|$CMS_REF(page:" + pageB.uid()
                                + ")$|$CMS_INCLUDE(section_template:" + box.uid() + ")$]"),
                        null, false, null, null),
                ctx);
        page(projectId, ctx, "Page A", reader.uuid(), "unused");
        GenerationTarget target = targetRepository.save(new GenerationTarget(
                projectId, "default", TargetType.FILESYSTEM, mapper.createObjectNode(), true));

        GenerationRun full = run(project, target, GenerationMode.FULL, null, user);
        assertThat(full.getStatus()).as("diagnostics: %s", full.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        assertThat(outputOfA(project, target, full)).isEqualTo("A[Kept headline|page_b.html|box]");

        assetService.softDelete(pageB.uuid(), true, ctx);
        assetService.softDelete(box.uuid(), true, ctx);

        GenerationRun incremental = run(project, target, GenerationMode.INCREMENTAL, null, user);
        assertThat(incremental.getStatus()).as("diagnostics: %s", incremental.getDiagnostics()).isEqualTo(RunStatus.PARTIAL);
        assertThat(incremental.getRevisionId())
                .isEqualTo(assetService.requireCurrent(projectId, box.uuid()).validFromRevision());
        assertThat(outputOfA(project, target, incremental)).isEqualTo("A[||]");
        String diagnostics = incremental.getDiagnostics().toString();
        assertThat(incremental.getDiagnostics().path("errors")).isEmpty();
        assertThat(diagnostics)
                .contains(DiagnosticCodes.OCTL_MISSING_VALUE_TARGET)
                .contains(GenerationDiagnosticCodes.GEN_DELETED_REFERENCE)
                .contains("Reference to deleted page '" + pageB.uid() + "'")
                .contains("Reference to deleted section_template '" + box.uid() + "'");

        GenerationRun fullAfterDelete = run(project, target, GenerationMode.FULL, null, user);
        assertThat(fullAfterDelete.getStatus()).isEqualTo(RunStatus.PARTIAL);
        assertThat(outputOfA(project, target, fullAfterDelete)).isEqualTo("A[||]");
        Path buildDir = TargetLocations.resolve(outputRoot, project.getKey(), target)
                .resolve("builds").resolve(String.valueOf(fullAfterDelete.getId()));
        try (var files = Files.walk(buildDir)) {
            assertThat(files.filter(Files::isRegularFile).map(CrossAssetValueIntegrationTest::read).flatMap(Optional::stream))
                    .as("the deleted page is not published")
                    .noneMatch(content -> content.equals("B-page"));
        }
    }

    private AssetVersionView page(long projectId, RevisionContext ctx, String name, UUID templateUuid, String headline) {
        return assetService.create(
                new CreateAssetCommand(projectId, AssetType.PAGE, name, null, pagePayload(templateUuid, headline), null), ctx);
    }

    private void update(long projectId, RevisionContext ctx, AssetVersionView page, UUID templateUuid, String headline) {
        AssetVersionView current = assetService.requireCurrent(projectId, page.uuid());
        assetService.update(page.uuid(), new UpdateAssetCommand(current.displayName(), pagePayload(templateUuid, headline)),
                current.validFromRevision(), ctx);
    }

    private ObjectNode pagePayload(UUID templateUuid, String headline) {
        ObjectNode payload = mapper.createObjectNode();
        payload.put("templateRef", templateUuid.toString());
        payload.putObject("content").put("headline", headline);
        return payload;
    }

    private String preview(long projectId, UUID page, Long revision) {
        return pageRenderService.renderPage(projectId, page, revision, "html", false);
    }

    /** The single generated file whose content is page A's ({@code A[…]}) in the run's build directory. */
    private String outputOfA(Project project, GenerationTarget target, GenerationRun run) throws IOException {
        Path buildDir = TargetLocations.resolve(outputRoot, project.getKey(), target)
                .resolve("builds").resolve(String.valueOf(run.getId()));
        try (var files = Files.walk(buildDir)) {
            List<String> pagesA = files.filter(p -> p.toString().endsWith(".html"))
                    .map(CrossAssetValueIntegrationTest::read)
                    .flatMap(Optional::stream)
                    .filter(content -> content.startsWith("A["))
                    .toList();
            assertThat(pagesA).as("page A output in run %s", run.getId()).hasSize(1);
            return pagesA.get(0);
        }
    }

    private static Optional<String> read(Path path) {
        try {
            return Optional.of(Files.readString(path));
        } catch (IOException e) {
            return Optional.empty();
        }
    }

    private GenerationRun run(Project project, GenerationTarget target, GenerationMode mode, Long revision, AppUser user)
            throws InterruptedException {
        GenerationRun started = generationService.start(
                project.getKey(),
                new GenerationRequest(mode, revision, List.of("html"), target.getId(), null, null, null, null),
                user.getId());
        long deadline = System.currentTimeMillis() + 60_000;
        while (System.currentTimeMillis() < deadline) {
            GenerationRun run = generationService.status(project.getKey(), started.getId());
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
