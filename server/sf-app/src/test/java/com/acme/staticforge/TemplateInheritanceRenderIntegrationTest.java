package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.asset.template.UpdateTemplateCommand;
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.channel.CreateChannelRequest;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetLocations;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.generate.plan.BuildPlan;
import com.acme.staticforge.generate.plan.BuildPlanner;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.render.OutputPathResolver;
import com.acme.staticforge.generate.snapshot.SnapshotService;
import com.acme.staticforge.generate.snapshot.SnapshotView;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.preview.PageRenderService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.cdl.CdlSources;
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
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * {@code M20.3.1}: a page on {@code article} → {@code docs_layout} → {@code base} renders the same in generation and
 * preview for HTML and Markdown; a change to the root layout alone rebuilds the page incrementally; time travel
 * renders the old layout; a broken chain fails generation validation without crashing the run.
 */
@SpringBootTest
@ActiveProfiles("test")
class TemplateInheritanceRenderIntegrationTest {

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-inheritance-test");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired TemplateService templateService;
    @Autowired PageService pageService;
    @Autowired ChannelService channelService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired PageRenderService pageRenderService;
    @Autowired SnapshotService snapshotService;
    @Autowired ReleaseFixtures releaseFixtures;
    @Autowired BuildPlanner buildPlanner;

    private final ObjectMapper mapper = new ObjectMapper();

    private static final String BASE_HTML =
            "<html><title>$CMS_VALUE(title)$</title>$CMS_BLOCK(content)$<p>base</p>$CMS_END_BLOCK$"
                    + "<footer>$CMS_BLOCK(footer)$v1$CMS_END_BLOCK$</footer></html>";
    private static final String BASE_MD = "# $CMS_VALUE(title)$\n\n$CMS_BLOCK(content)$base$CMS_END_BLOCK$\n\n-- $CMS_BLOCK(footer)$v1$CMS_END_BLOCK$";

    @Test
    void aThreeLevelChainRendersInGenerationAndPreviewAndFollowsLayoutChanges() throws Exception {
        AppUser user = userService.create("inh-render", "inh-render@example.com", "Inheritance Render", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("inhrender", "Inheritance Render", null, "inheritance render"), user.getId());
        long projectId = project.getId();
        RevisionContext ctx = RevisionContext.of(projectId, user.getId(), "inheritance render");
        channelService.create(
                new CreateChannelRequest("markdown", "Markdown", "md", "text/markdown", "MARKDOWN", true, false, 1, null, null), ctx);

        TemplateView base = template(ctx, projectId, "Base", "content { editor text title { label \"Title\" } }",
                Map.of("html", BASE_HTML, "markdown", BASE_MD), true);
        TemplateView docs = template(ctx, projectId, "Docs Layout", "", Map.of(
                "html", "$CMS_EXTENDS(page_template:" + base.uid() + ")$"
                        + "$CMS_BLOCK(content)$<div class=\"docs\">$CMS_PARENT$</div>$CMS_END_BLOCK$",
                "markdown", "$CMS_EXTENDS(page_template:" + base.uid() + ")$$CMS_BLOCK(content)$> $CMS_PARENT$$CMS_END_BLOCK$"), true);
        TemplateView article = template(ctx, projectId, "Article", "content { editor text summary { label \"Summary\" } }", Map.of(
                "html", "$CMS_EXTENDS(page_template:" + docs.uid() + ")$"
                        + "$CMS_BLOCK(content)$<article>$CMS_PARENT$$CMS_VALUE(summary)$</article>$CMS_END_BLOCK$",
                "markdown", "$CMS_EXTENDS(page_template:" + docs.uid() + ")$$CMS_BLOCK(content)$$CMS_PARENT$ $CMS_VALUE(summary)$$CMS_END_BLOCK$"),
                false);
        TemplateView other = template(ctx, projectId, "Other", "", Map.of("html", "other", "markdown", "other"), false);

        UUID page = page(ctx, projectId, article, Map.of("title", "Guide", "summary", "Read me"));
        UUID unrelated = page(ctx, projectId, other, Map.of());
        GenerationTarget target = targetRepository.save(new GenerationTarget(
                projectId, "default", TargetType.FILESYSTEM, mapper.readTree("{\"baseUrl\":\"https://example.com\"}"), true));

        String expectedHtml = "<html><title>Guide</title><article><div class=\"docs\"><p>base</p></div>Read me</article>"
                + "<footer>v1</footer></html>";
        String expectedMd = "# Guide\n\n> base Read me\n\n-- v1";

        GenerationRun full = run(project, target, GenerationMode.FULL, user);
        assertThat(full.getStatus()).as("diagnostics: %s", full.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        assertThat(output(project, target, full, "guide.html")).isEqualTo(expectedHtml);
        assertThat(output(project, target, full, "guide.md")).isEqualTo(expectedMd);
        assertThat(preview(projectId, page, null, "html")).isEqualTo(expectedHtml);
        assertThat(preview(projectId, page, null, "markdown")).isEqualTo(expectedMd);
        long beforeLayoutChange = assetService.requireCurrent(projectId, page).validFromRevision();

        // Only the root layout changes: the incremental plan holds exactly the chain's pages, and they show it.
        long lastRun = releasedSnapshot(projectId).revision();
        update(ctx, projectId, base, "content { editor text title { label \"Title\" } }",
                Map.of("html", BASE_HTML.replace("v1", "v2"), "markdown", BASE_MD.replace("v1", "v2")), true);
        assertThat(planned(projectId, lastRun)).containsExactly(page).doesNotContain(unrelated);
        assertThat(preview(projectId, page, null, "html")).isEqualTo(expectedHtml.replace("v1", "v2"));

        GenerationRun incremental = run(project, target, GenerationMode.INCREMENTAL, user);
        assertThat(incremental.getStatus()).as("diagnostics: %s", incremental.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        assertThat(output(project, target, incremental, "guide.html")).isEqualTo(expectedHtml.replace("v1", "v2"));

        // Time travel renders the layout as it was.
        assertThat(preview(projectId, page, beforeLayoutChange, "html")).isEqualTo(expectedHtml);

        // A chain broken behind the template service's back (the documented race window): the parent loses a channel
        // its descendants extend. Generation validation reports it for that template and channel; html still builds.
        AssetVersionView current = assetService.requireCurrent(projectId, docs.uuid());
        ObjectNode payload = current.payload().deepCopy();
        payload.withObject("channelTemplates").remove("markdown");
        assetService.update(docs.uuid(), new UpdateAssetCommand(current.displayName(), payload), current.validFromRevision(), ctx);
        GenerationRun broken = run(project, target, GenerationMode.FULL, user);
        assertThat(broken.getStatus()).isIn(RunStatus.FAILED, RunStatus.PARTIAL);
        assertThat(broken.getDiagnostics().toString()).contains(DiagnosticCodes.OCTL_ANCESTOR_MISSING_CHANNEL);
    }

    // ------------------------------------------------------------------

    private TemplateView template(
            RevisionContext ctx, long projectId, String name, String cdl, Map<String, String> channels, boolean abstractTemplate) {
        return templateService.create(new CreateTemplateCommand(
                projectId, AssetType.PAGE_TEMPLATE, name, CdlSources.split(cdl), channels, null, false,
                Map.of("html", "{displayNameSlug}.{ext}", "markdown", "{displayNameSlug}.{ext}"), null, abstractTemplate), ctx);
    }

    private void update(
            RevisionContext ctx, long projectId, TemplateView template, String cdl, Map<String, String> channels, boolean abstractTemplate) {
        TemplateView current = templateService.get(projectId, template.uuid());
        templateService.update(template.uuid(), new UpdateTemplateCommand(
                current.displayName(), CdlSources.split(cdl), channels, null, false,
                Map.of("html", "{displayNameSlug}.{ext}", "markdown", "{displayNameSlug}.{ext}"), abstractTemplate),
                current.validFromRevision(), ctx);
    }

    private UUID page(RevisionContext ctx, long projectId, TemplateView template, Map<String, String> content) {
        String name = content.getOrDefault("title", template.displayName() + " page");
        AssetVersionView page = pageService.create(new CreatePageCommand(name, null, template.uuid()), ctx);
        ObjectNode payload = page.payload().deepCopy();
        content.forEach(payload.withObject("content")::put);
        return pageService.update(page.uuid(), payload, page.validFromRevision(), ctx).uuid();
    }

    private String preview(long projectId, UUID page, Long revision, String channel) {
        return pageRenderService.renderPage(projectId, page, revision, channel, false);
    }

    private Set<UUID> planned(long projectId, long lastSuccessfulRevision) {
        OutputPathResolver paths = mock(OutputPathResolver.class);
        when(paths.resolvePagePath(any(), any())).thenAnswer(call -> call.getArgument(0).toString());
        BuildPlan plan = buildPlanner.plan(
                releasedSnapshot(projectId), GenerationMode.INCREMENTAL, lastSuccessfulRevision,
                Set.of("html"), null, null, paths);
        return plan.entries().stream().map(PlanEntry::pageUuid).collect(Collectors.toSet());
    }

    private String output(Project project, GenerationTarget target, GenerationRun run, String fileName) throws IOException {
        Path buildDir = TargetLocations.resolve(outputRoot, project.getKey(), target)
                .resolve("builds").resolve(String.valueOf(run.getId()));
        try (var files = Files.walk(buildDir)) {
            List<Path> matches = files.filter(p -> p.getFileName().toString().equals(fileName)).toList();
            assertThat(matches).as("%s in run %s", fileName, run.getId()).hasSize(1);
            return Files.readString(matches.get(0));
        }
    }

    private GenerationRun run(Project project, GenerationTarget target, GenerationMode mode, AppUser user)
            throws InterruptedException {
        releaseFixtures.releaseAll(project.getKey());
        GenerationRun started = generationService.start(
                project.getKey(),
                new GenerationRequest(mode, null, List.of("html", "markdown"), target.getId(), null, null, null, null),
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

    /** The released snapshot at head, after releasing everything pending (M27.2.1): what a build started now renders. */
    private Snapshot releasedSnapshot(long projectId) {
        releaseFixtures.releaseAll(projectId);
        return snapshotService.snapshot(projectId, null, SnapshotView.RELEASED);
    }
}
