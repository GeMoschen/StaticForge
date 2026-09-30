package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.ReferenceKind;
import com.acme.staticforge.asset.UsageView;
import com.acme.staticforge.asset.globals.CreateGlobalSetCommand;
import com.acme.staticforge.asset.globals.GlobalSetService;
import com.acme.staticforge.asset.globals.GlobalSetView;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
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
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * {@code M17.5.2} — the epic's closing end-to-end journey: one global property set from the
 * developer declaring its fields to the editor's value change reaching the published HTML, and
 * back out again through time travel.
 *
 * <p>It is the only test that puts the whole chain together — set → template OCTL → page →
 * incremental plan → output files → usages → preview — and therefore the only place the
 * <em>seams</em> between M17's parts are observable: that media reached only through a set value
 * is still copied by {@code AssetCopyStage} (the set is not a page, so nothing else pulls it in),
 * that a value change fans out over {@code page → template → set} reverse edges and rebuilds
 * exactly the pages that read it and no others, and that a {@code renamedFrom} schema change plus
 * the template edit it forces are one revision each rather than a cascade.
 *
 * <p>The piecewise mechanics live elsewhere and are not repeated here:
 * {@code GlobalSetIntegrationTest} (service invariants), {@code GlobalsApiTest} (HTTP and roles),
 * {@code GlobalValueRenderTest} and the {@code render/global-value} goldens (OCTL semantics).
 *
 * <p>Honest scope note, in the same spirit as {@code M8NavigationJourneyIntegrationTest}: the
 * Playwright counterpart ({@code ui/e2e/m17-journeys.spec.ts}) still has no seeded demo user or
 * interactive browser in this sandbox, so this {@code @SpringBootTest} is the executed journey.
 */
@SpringBootTest
@ActiveProfiles("test")
class M17GlobalsJourneyIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-m17-journey-test");
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
    @Autowired PageRenderService pageRenderService;
    @Autowired RevisionRepository revisionRepository;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void globalSetFromCreationThroughIncrementalPublishToTimeTravel() throws Exception {
        Fixture fx = newFixture();

        // ------------------------------------------------------------------
        // 1. The developer declares the set; the editor fills it in.
        // ------------------------------------------------------------------
        AssetVersionView logo = mediaService.upload(
                fx.project().getId(), null, "logo.png", "image/png", solidPng(Color.BLUE), fx.ctx());
        GlobalSetView site = globalSetService.create(
                new CreateGlobalSetCommand(
                        fx.project().getId(),
                        null,
                        "Site",
                        CdlSources.split("""
                        content {
                          editor text title { label "Site title" required }
                          editor media logo { label "Logo" }
                          editor boolean showBanner { label "Show banner" default false }
                        }
                        """)),
                fx.ctx());
        assertThat(site.uid()).isEqualTo("site");

        ObjectNode values = mapper.createObjectNode();
        values.put("title", "Acme Outdoor");
        values.put("showBanner", true);
        values.putObject("logo").put("type", "MEDIA_REF").put("uuid", logo.uuid().toString());
        GlobalSetView valued = globalSetService.updateValues(site.uuid(), values, site.revision(), fx.ctx());

        // ------------------------------------------------------------------
        // 2. Two page templates: one reads the set through all three accessors, one ignores it.
        // ------------------------------------------------------------------
        TemplateView branded = template(fx, "Branded",
                "<h1>$CMS_VALUE(CMS_GLOBAL.site.title)$</h1>"
                        + "<img src=\"$CMS_REF(CMS_GLOBAL.site.logo)$\">"
                        + "$CMS_IF(CMS_GLOBAL.site.showBanner)$<aside>banner</aside>$CMS_END_IF$");
        TemplateView plain = template(fx, "Plain", "<p>plain</p>");

        AssetVersionView home = pageService.create(new CreatePageCommand("Home", null, branded.uuid()), fx.ctx());
        AssetVersionView about = pageService.create(new CreatePageCommand("About", null, branded.uuid()), fx.ctx());
        AssetVersionView legal = pageService.create(new CreatePageCommand("Legal", null, plain.uuid()), fx.ctx());

        // 6a. Usages already list the referring template here, before any generation has run:
        // the OCTL edge is written by the template save itself (M16.3.2), which is what makes
        // delete protection work for a set nobody has published yet.
        assertThat(globalSetUsages(fx, site))
                .allSatisfy(usage -> {
                    assertThat(usage.fromUuid()).isEqualTo(branded.uuid());
                    assertThat(usage.fromType()).isEqualTo(AssetType.PAGE_TEMPLATE);
                })
                .extracting(UsageView::kind)
                .as("one edge per accessor kind the template reads the set through")
                .containsExactlyInAnyOrder(ReferenceKind.OCTL_VALUE, ReferenceKind.OCTL_REF);

        // ------------------------------------------------------------------
        // 3. FULL generation: the value, the banner and the logo URL all land in the output, and
        //    the logo file itself is copied although no *page* references it — the only path to it
        //    runs through the set's value.
        // ------------------------------------------------------------------
        GenerationTarget target = createTarget(fx);
        GenerationRun full = generate(fx, target, GenerationMode.FULL);
        assertThat(full.getStatus()).as("diagnostics: %s", full.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);

        Path fullBuild = buildDir(fx, target, full);
        // The uid a media asset derives from its file name ("logo.png" -> "logo_png") is what
        // AssetCopyStage names the copied file after, so both sides are read from it.
        String logoPath = "assets/media/" + logo.uid() + ".png";
        assertThat(output(fullBuild, "home.html"))
                .contains("<h1>Acme Outdoor</h1>")
                .contains("<img src=\"" + logoPath + "\">")
                .contains("<aside>banner</aside>");
        assertThat(output(fullBuild, "about.html")).contains("<h1>Acme Outdoor</h1>");
        assertThat(output(fullBuild, "legal.html")).isEqualTo("<p>plain</p>");
        assertThat(fullBuild.resolve(logoPath))
                .as("media reached only through a set value is copied")
                .exists();

        // ------------------------------------------------------------------
        // 4. One value change → INCREMENTAL rebuilds exactly the two pages whose template reads
        //    the set. The fan-out is page → template → set, so the plan proves the reverse-edge
        //    walk takes that second hop rather than only looking at direct page edges.
        // ------------------------------------------------------------------
        long revisionBeforeTitleChange = releasedSnapshot(fx.project().getId()).revision();
        ObjectNode renamedValues = valued.content().deepCopy();
        renamedValues.put("title", "Acme Outdoor Co.");
        GlobalSetView retitled =
                globalSetService.updateValues(site.uuid(), renamedValues, valued.revision(), fx.ctx());

        assertThat(plannedPages(fx, revisionBeforeTitleChange))
                .containsExactlyInAnyOrder(home.uuid(), about.uuid())
                .doesNotContain(legal.uuid());

        GenerationRun incremental = generate(fx, target, GenerationMode.INCREMENTAL);
        assertThat(incremental.getStatus())
                .as("diagnostics: %s", incremental.getDiagnostics())
                .isEqualTo(RunStatus.SUCCESS);
        assertThat(output(buildDir(fx, target, incremental), "home.html")).contains("<h1>Acme Outdoor Co.</h1>");

        // ------------------------------------------------------------------
        // 5. Renaming the editor: the set migrates its own value in one revision, and the template
        //    that spells the old name out is a separate, ordinary edit — one revision too.
        // ------------------------------------------------------------------
        long revisionsBeforeRename = revisionCount(fx);
        GlobalSetView renamedSchema = globalSetService.updateSchema(
                site.uuid(),
                CdlSources.split("""
                content {
                  editor text siteTitle { label "Site title" required renamedFrom "title" }
                  editor media logo { label "Logo" }
                  editor boolean showBanner { label "Show banner" default false }
                }
                """),
                retitled.revision(),
                fx.ctx());
        assertThat(revisionCount(fx)).isEqualTo(revisionsBeforeRename + 1);
        assertThat(renamedSchema.content().path("siteTitle").asText()).isEqualTo("Acme Outdoor Co.");
        assertThat(renamedSchema.content().has("title")).isFalse();

        TemplateView retargeted = templateService.saveChannel(
                branded.uuid(),
                "html",
                "<h1>$CMS_VALUE(CMS_GLOBAL.site.siteTitle)$</h1>",
                assetService.requireCurrent(fx.project().getId(), branded.uuid()).validFromRevision(),
                fx.ctx());
        assertThat(revisionCount(fx)).isEqualTo(revisionsBeforeRename + 2);

        GenerationRun afterRename = generate(fx, target, GenerationMode.INCREMENTAL);
        assertThat(afterRename.getStatus())
                .as("diagnostics: %s", afterRename.getDiagnostics())
                .isEqualTo(RunStatus.SUCCESS);
        assertThat(output(buildDir(fx, target, afterRename), "home.html")).contains("<h1>Acme Outdoor Co.</h1>");

        // ------------------------------------------------------------------
        // 6b. A set that something still points at cannot be deleted, and the usage list names
        //     what is in the way — the generic in-use guard, reached through the same edges.
        // ------------------------------------------------------------------
        assertThatThrownBy(() -> assetService.softDelete(site.uuid(), false, fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(409));
        // Still only the template, after three generations: a page's *render* dependency on the
        // set is an in-memory result of the run (GenerationService only mines it for media to
        // copy) and is never materialized as an `asset_reference` row, so `usages` — which reads
        // open inbound rows — sees the template edge alone. The pages are reachable from it in one
        // more hop, which is exactly how BuildPlanner finds them in step 4.
        assertThat(globalSetUsages(fx, site))
                .extracting(UsageView::fromUuid)
                .as("the template that still reads the set is what blocks the delete")
                .containsOnly(retargeted.uuid());

        // ------------------------------------------------------------------
        // 7. Preview: live shows the current value, time travel to the revision before step 4
        //    shows the old one — both through the same resolver the generator used.
        // ------------------------------------------------------------------
        assertThat(pageRenderService.renderPage(fx.project().getId(), home.uuid(), null, "html", false))
                .contains("<h1>Acme Outdoor Co.</h1>");
        assertThat(pageRenderService.renderPage(
                        fx.project().getId(), home.uuid(), revisionBeforeTitleChange, "html", false))
                .contains("<h1>Acme Outdoor</h1>")
                .doesNotContain("Acme Outdoor Co.");
    }


    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private TemplateView template(Fixture fx, String displayName, String html) {
        return templateService.create(
                new CreateTemplateCommand(
                        fx.project().getId(),
                        AssetType.PAGE_TEMPLATE,
                        displayName,
                        CdlSources.split(""),
                        Map.of("html", html),
                        null,
                        false,
                        Map.of("html", "{displayNameSlug}.{ext}")),
                fx.ctx());
    }

    private List<UsageView> globalSetUsages(Fixture fx, GlobalSetView site) {
        return assetService.usages(fx.project().getId(), site.uuid());
    }

    /** The pages an INCREMENTAL run at {@code revision} would rebuild, given the last success. */
    private Set<UUID> plannedPages(Fixture fx, long lastSuccessfulRevision) {
        OutputPathResolver paths = mock(OutputPathResolver.class);
        when(paths.resolvePagePath(any(), any())).thenAnswer(call -> call.getArgument(0).toString());
        BuildPlan plan = buildPlanner.plan(
                releasedSnapshot(fx.project().getId()),
                GenerationMode.INCREMENTAL,
                lastSuccessfulRevision,
                Set.of("html"),
                null,
                null,
                paths);
        return plan.entries().stream().map(PlanEntry::pageUuid).collect(java.util.stream.Collectors.toSet());
    }

    private long revisionCount(Fixture fx) {
        return revisionRepository.findByProjectIdOrderByRevisionIdDesc(fx.project().getId()).size();
    }

    private GenerationTarget createTarget(Fixture fx) throws IOException {
        return targetRepository.save(new GenerationTarget(
                fx.project().getId(),
                "default",
                TargetType.FILESYSTEM,
                mapper.readTree("{\"baseUrl\":\"https://example.com\"}"),
                true));
    }

    private GenerationRun generate(Fixture fx, GenerationTarget target, GenerationMode mode)
            throws InterruptedException {
        releaseFixtures.releaseAll(fx.project().getKey());
        GenerationRun started = generationService.start(
                fx.project().getKey(),
                new GenerationRequest(mode, null, List.of("html"), target.getId(), null, null, null, null),
                fx.user().getId());
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
        return TargetLocations.resolve(outputRoot, fx.project().getKey(), target)
                .resolve("builds")
                .resolve(String.valueOf(run.getId()));
    }

    private static String output(Path buildDir, String fileName) throws IOException {
        Path file = buildDir.resolve(fileName);
        assertThat(Files.isRegularFile(file)).as("%s exists in %s", fileName, buildDir).isTrue();
        return Files.readString(file);
    }

    private static byte[] solidPng(Color color) {
        BufferedImage image = new BufferedImage(64, 64, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        g.setColor(color);
        g.fillRect(0, 0, 64, 64);
        g.dispose();
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            ImageIO.write(image, "png", out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(
                "m17journey-user-" + n, "m17journey-user-" + n + "@example.com", "M17 Journey User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("m17journeyp_" + n, "M17 Journey Project " + n, null, null), user.getId());
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
