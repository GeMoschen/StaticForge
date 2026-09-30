package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.globals.CreateGlobalSetCommand;
import com.acme.staticforge.asset.globals.GlobalSetService;
import com.acme.staticforge.asset.globals.GlobalSetView;
import com.acme.staticforge.asset.media.MediaService;
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
import com.acme.staticforge.generate.plan.BuildPlan;
import com.acme.staticforge.generate.plan.BuildPlanner;
import com.acme.staticforge.generate.render.OutputPathResolver;
import com.acme.staticforge.generate.snapshot.SnapshotService;
import com.acme.staticforge.generate.snapshot.SnapshotView;
import com.acme.staticforge.generate.snapshot.Snapshot;
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
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Processed text media in generation (M18.3.1): the ASSETS stage renders opted-in media to its normal
 * {@code assets/media/{uid}.{ext}} path, follows its media dependencies transitively, re-sanitizes
 * SVG, reports a render failure as a PARTIAL run without the file, and an incremental plan re-renders
 * a processed file whose dependency changed although no page did.
 */
@SpringBootTest
@ActiveProfiles("test")
class ProcessedMediaGenerationIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-m18-generation-test");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired MediaService mediaService;
    @Autowired TemplateService templateService;
    @Autowired PageService pageService;
    @Autowired GlobalSetService globalSetService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired SnapshotService snapshotService;
    @Autowired ReleaseFixtures releaseFixtures;
    @Autowired BuildPlanner buildPlanner;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void aProcessedStylesheetIsRenderedAndWhatItReferencesIsCopied() throws Exception {
        Fixture fx = newFixture();
        siteSet(fx, "#c00", "Acme");
        byte[] bgBytes = png();
        AssetVersionView bg = mediaService.upload(fx.project().getId(), null, "bg.png", null, bgBytes, fx.ctx());
        AssetVersionView css = processed(fx, upload(fx, "main.css",
                "a{color:$CMS_VALUE(global:site.brandColor)$}\nbody{background:url($CMS_REF(media:bg_png)$)}\n"
                        + "/* $CMS_META(path)$ $CMS_META(mimeType)$ $CMS_META(channel)$ */"));
        page(fx, "Home", "<link rel=\"stylesheet\" href=\"$CMS_REF(media:main_css)$\">");
        GenerationTarget target = createTarget(fx);

        GenerationRun run = generate(fx, target, GenerationMode.FULL);

        assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        Path build = buildDir(fx, target, run);
        assertThat(read(build, "home.html")).contains("href=\"assets/media/main_css.css\"");
        assertThat(read(build, "assets/media/main_css.css")).isEqualTo(
                "a{color:#c00}\nbody{background:url(bg_png.png)}\n/* assets/media/main_css.css text/css html */");
        assertThat(build.resolve("assets/media/bg_png.png"))
                .as("media referenced only from the processed stylesheet is copied")
                .hasBinaryContent(bgBytes);
        // The source blob is untouched by rendering.
        assertThat(mediaService.readText(fx.project().getId(), css.uuid(), null).text())
                .startsWith("a{color:$CMS_VALUE(global:site.brandColor)$}");
        assertThat(bg.uid()).isEqualTo("bg_png");
    }

    @Test
    void anUnprocessedStylesheetIsCopiedByteForByte() throws Exception {
        Fixture fx = newFixture();
        siteSet(fx, "#c00", "Acme");
        String source = "a{color:$CMS_VALUE(global:site.brandColor)$} /* $$ */";
        upload(fx, "main.css", source);
        page(fx, "Home", "<link href=\"$CMS_REF(media:main_css)$\">");
        GenerationTarget target = createTarget(fx);

        GenerationRun run = generate(fx, target, GenerationMode.FULL);

        assertThat(run.getStatus()).isEqualTo(RunStatus.SUCCESS);
        assertThat(buildDir(fx, target, run).resolve("assets/media/main_css.css"))
                .hasBinaryContent(source.getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void pageLinksInProcessedJsonResolveToTheDefaultChannelRelativeToTheMediaFile() throws Exception {
        Fixture fx = newFixture();
        siteSet(fx, "#c00", "Acme \"Outdoor\"");
        page(fx, "About", "<p>about</p>");
        processed(fx, upload(fx, "config.json",
                "{\"about\": \"$CMS_REF(page:about)$\", \"title\": $CMS_VALUE(global:site.title | json)$}"));
        page(fx, "Home", "<script src=\"$CMS_REF(media:config_json)$\"></script>");
        GenerationTarget target = createTarget(fx);

        GenerationRun run = generate(fx, target, GenerationMode.FULL);

        assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        JsonNode config = mapper.readTree(read(buildDir(fx, target, run), "assets/media/config_json.json"));
        assertThat(config.path("about").asText()).isEqualTo("../../about.html");
        assertThat(config.path("title").asText()).isEqualTo("Acme \"Outdoor\"");
    }

    @Test
    void twoStylesheetsReferencingEachOtherBothRenderAndTheRunTerminates() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView a = upload(fx, "a.css", "/* a */");
        AssetVersionView b = upload(fx, "b.css", "@import url($CMS_REF(media:a_css)$);");
        a = mediaService.writeText(a.uuid(), "@import url($CMS_REF(media:b_css)$);", a.validFromRevision(), fx.ctx()).media();
        processed(fx, a);
        processed(fx, b);
        page(fx, "Home", "<link href=\"$CMS_REF(media:a_css)$\">");
        GenerationTarget target = createTarget(fx);

        GenerationRun run = generate(fx, target, GenerationMode.FULL);

        assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        Path build = buildDir(fx, target, run);
        assertThat(read(build, "assets/media/a_css.css")).isEqualTo("@import url(b_css.css);");
        assertThat(read(build, "assets/media/b_css.css")).isEqualTo("@import url(a_css.css);");
    }

    @Test
    void aRenderedSvgIsSanitizedAgain() throws Exception {
        Fixture fx = newFixture();
        siteSet(fx, "#c00", "<script>alert(1)</script><rect onload=\"x()\"/>");
        processed(fx, upload(fx, "icon.svg",
                "<svg xmlns=\"http://www.w3.org/2000/svg\"><g>$CMS_VALUE(global:site.title | raw)$</g>"
                        + "<rect fill=\"$CMS_VALUE(global:site.brandColor)$\"/></svg>"));
        page(fx, "Home", "<img src=\"$CMS_REF(media:icon_svg)$\">");
        GenerationTarget target = createTarget(fx);

        GenerationRun run = generate(fx, target, GenerationMode.FULL);

        assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        assertThat(read(buildDir(fx, target, run), "assets/media/icon_svg.svg"))
                .doesNotContain("<script", "onload")
                .contains("fill=\"#c00\"");
    }

    @Test
    void anIncrementalRunRerendersAStylesheetWhenOnlyAGlobalItReadsChanged() throws Exception {
        Fixture fx = newFixture();
        GlobalSetView site = siteSet(fx, "#c00", "Acme");
        AssetVersionView css = processed(fx, upload(fx, "main.css", "a{color:$CMS_VALUE(global:site.brandColor)$}"));
        page(fx, "Home", "<link href=\"$CMS_REF(media:main_css)$\">");
        AssetVersionView legal = page(fx, "Legal", "<p>legal</p>");
        GenerationTarget target = createTarget(fx);
        GenerationRun full = generate(fx, target, GenerationMode.FULL);
        assertThat(full.getStatus()).isEqualTo(RunStatus.SUCCESS);

        ObjectNode values = site.content().deepCopy();
        values.put("brandColor", "#00c");
        GlobalSetView recolored = globalSetService.updateValues(site.uuid(), values, site.revision(), fx.ctx());

        BuildPlan plan = plan(fx, full.getRevisionId());
        assertThat(plan.entries()).as("no page reads the global itself").isEmpty();
        assertThat(plan.processedMedia()).containsExactly(css.uuid());

        GenerationRun incremental = generate(fx, target, GenerationMode.INCREMENTAL);
        assertThat(incremental.getStatus()).as("diagnostics: %s", incremental.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        assertThat(read(buildDir(fx, target, incremental), "assets/media/main_css.css")).isEqualTo("a{color:#00c}");

        // An unrelated page change doesn't touch the stylesheet.
        AssetVersionView legalNow = assetService.requireCurrent(fx.project().getId(), legal.uuid());
        AssetVersionView renamed = assetService.update(legal.uuid(),
                new com.acme.staticforge.asset.UpdateAssetCommand("Legal notice", legalNow.payload()),
                legalNow.validFromRevision(), fx.ctx());
        BuildPlan unrelated = plan(fx, incremental.getRevisionId());
        assertThat(unrelated.processedMedia()).isEmpty();
        GenerationRun afterUnrelated = generate(fx, target, GenerationMode.INCREMENTAL);
        assertThat(afterUnrelated.getStatus()).isEqualTo(RunStatus.SUCCESS);
        // Not re-rendered, but still published: carried forward from the previous build (M22.4.1).
        assertThat(read(buildDir(fx, target, afterUnrelated), "assets/media/main_css.css")).isEqualTo("a{color:#00c}");
    }

    @Test
    void aStylesheetThatNoLongerCompilesFailsAloneAndTheRunIsPartial() throws Exception {
        Fixture fx = newFixture();
        GlobalSetView site = siteSet(fx, "#c00", "Acme");
        processed(fx, upload(fx, "main.css", "a{color:$CMS_VALUE(global:site.brandColor)$}"));
        page(fx, "Home", "<link href=\"$CMS_REF(media:main_css)$\">");
        GenerationTarget target = createTarget(fx);
        // The literal global:site no longer resolves once the set's uid changes.
        assetService.changeUid(site.uuid(), "brand", fx.ctx());

        GenerationRun run = generate(fx, target, GenerationMode.FULL);

        assertThat(run.getStatus()).isEqualTo(RunStatus.PARTIAL);
        assertThat(run.getErrorCount()).isEqualTo(1);
        JsonNode error = run.getDiagnostics().path("errors").get(0);
        assertThat(error.path("code").asText()).isEqualTo(DiagnosticCodes.OCTL_UNRESOLVABLE_REF);
        assertThat(error.path("messages").get(0).asText()).startsWith("Media 'main_css': ");
        Path build = buildDir(fx, target, run);
        assertThat(build.resolve("assets/media/main_css.css")).doesNotExist();
        assertThat(read(build, "home.html")).contains("assets/media/main_css.css");
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private GlobalSetView siteSet(Fixture fx, String brandColor, String title) {
        GlobalSetView site = globalSetService.create(new CreateGlobalSetCommand(fx.project().getId(), null, "Site", CdlSources.split("""
                content {
                  editor text brandColor { label "Brand color" }
                  editor text title { label "Title" }
                }
                """)), fx.ctx());
        ObjectNode values = mapper.createObjectNode().put("brandColor", brandColor).put("title", title);
        return globalSetService.updateValues(site.uuid(), values, site.revision(), fx.ctx());
    }

    private AssetVersionView upload(Fixture fx, String name, String text) {
        return mediaService.upload(fx.project().getId(), null, name, null, text.getBytes(StandardCharsets.UTF_8), fx.ctx());
    }

    private AssetVersionView processed(Fixture fx, AssetVersionView media) {
        return mediaService.setProcessCms(media.uuid(), true, media.validFromRevision(), fx.ctx()).media();
    }

    private AssetVersionView page(Fixture fx, String name, String html) {
        TemplateView template = templateService.create(new CreateTemplateCommand(
                fx.project().getId(), AssetType.PAGE_TEMPLATE, name + " Template", CdlSources.split(""), Map.of("html", html), null, false,
                Map.of("html", "{displayNameSlug}.{ext}")), fx.ctx());
        return pageService.create(new CreatePageCommand(name, null, template.uuid()), fx.ctx());
    }

    private BuildPlan plan(Fixture fx, long lastSuccessfulRevision) {
        OutputPathResolver paths = mock(OutputPathResolver.class);
        when(paths.resolvePagePath(any(), any())).thenAnswer(call -> call.getArgument(0).toString());
        return buildPlanner.plan(releasedSnapshot(fx.project().getId()), GenerationMode.INCREMENTAL,
                lastSuccessfulRevision, Set.of("html"), null, null, paths);
    }

    private GenerationTarget createTarget(Fixture fx) throws IOException {
        return targetRepository.save(new GenerationTarget(
                fx.project().getId(), "default", TargetType.FILESYSTEM, mapper.readTree("{\"baseUrl\":\"https://example.com\"}"), true));
    }

    private GenerationRun generate(Fixture fx, GenerationTarget target, GenerationMode mode) throws InterruptedException {
        releaseFixtures.releaseAll(fx.project().getKey());
        GenerationRun started = generationService.start(fx.project().getKey(),
                new GenerationRequest(mode, null, List.of("html"), target.getId(), null, null, null, null), fx.user().getId());
        long deadline = System.currentTimeMillis() + 60_000;
        while (System.currentTimeMillis() < deadline) {
            GenerationRun run = generationService.status(fx.project().getKey(), started.getId());
            RunStatus status = run.getStatus();
            if (status == RunStatus.SUCCESS || status == RunStatus.PARTIAL || status == RunStatus.FAILED
                    || status == RunStatus.CANCELLED) {
                return run;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Generation did not reach a terminal state within 60s");
    }

    private Path buildDir(Fixture fx, GenerationTarget target, GenerationRun run) {
        return TargetLocations.resolve(outputRoot, fx.project().getKey(), target).resolve("builds").resolve(String.valueOf(run.getId()));
    }

    private static String read(Path build, String path) throws IOException {
        Path file = build.resolve(path);
        assertThat(Files.isRegularFile(file)).as("%s exists in %s", path, build).isTrue();
        return Files.readString(file);
    }

    private static byte[] png() throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(4, 4, BufferedImage.TYPE_INT_RGB), "png", out);
        return out.toByteArray();
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(
                "m18gen-user-" + n, "m18gen-user-" + n + "@example.com", "M18 Generation User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("m18genp_" + n, "M18 Generation Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }

    /** The released snapshot at head, after releasing everything pending (M27.2.1): what a build started now renders. */
    private Snapshot releasedSnapshot(long projectId) {
        releaseFixtures.releaseAll(projectId);
        return snapshotService.snapshot(projectId, null, SnapshotView.RELEASED);
    }
}
