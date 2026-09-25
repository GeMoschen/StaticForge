package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.navigation.CreatePageReferenceCommand;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.navigation.PageReferenceTargetKind;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.common.L10nValues;
import com.acme.staticforge.generate.GenerationDiagnosticCodes;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.ImpactService;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetLocations;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.generate.insight.PlanEntryRecord;
import com.acme.staticforge.generate.insight.RebuildRootKind;
import com.acme.staticforge.generate.plan.BuildPlan;
import com.acme.staticforge.generate.plan.BuildPlanner;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.render.OutputPathResolver;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotService;
import com.acme.staticforge.generate.snapshot.SnapshotView;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.release.ReleaseStateMigration;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.Pageable;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Incremental builds are seeded by release changes, not by saves (M27.2.2): a draft plans nothing; a release, an
 * unpublish or a released media file rebuilds what depends on the released state, per language; the initial release
 * of a pre-M27 project plans nothing.
 */
@SpringBootTest
@ActiveProfiles("test")
class ReleaseIncrementalPlanIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-gen-release-plan");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired ProjectRepository projectRepository;
    @Autowired AssetService assetService;
    @Autowired AssetRepository assetRepository;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired MediaService mediaService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired ImpactService impactService;
    @Autowired ReleaseService releaseService;
    @Autowired ReleaseStateMigration releaseStateMigration;
    @Autowired SnapshotService snapshotService;
    @Autowired BuildPlanner buildPlanner;
    @Autowired RevisionRepository revisionRepository;
    @Autowired ReleaseFixtures releaseFixtures;

    private final ObjectMapper mapper = new ObjectMapper();

    private record Fixture(Project project, AppUser user, RevisionContext ctx, GenerationTarget target) {

        long projectId() {
            return project.getId();
        }

        String key() {
            return project.getKey();
        }
    }

    /** {@code about} and {@code other} render the navigation; {@code linker} links {@code about}. */
    private record Site(Fixture fx, UUID about, UUID other, UUID linker) {}

    private Site site(String prefix, boolean localized) throws Exception {
        Fixture fx = newFixture(prefix);
        String path = "{folder}{uid}.{ext}";
        String cdl = "content { editor text title { label \"Title\" } }";
        if (localized) {
            projectService.updateLocales(fx.key(), LocaleConfig.of(
                    List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English")), "de", Map.of(), false),
                    true, fx.ctx());
            path = "{locale}/" + path;
            cdl = "content { editor text title { label \"Title\" localizable } }";
        }
        TemplateView page = template(fx, "Page", cdl, "<h1>$CMS_VALUE(title)$</h1><nav>$CMS_NAVIGATION(nav:root)$</nav>", path);
        UUID about = page(fx, page, "about");
        UUID other = page(fx, page, "other");
        TemplateView linker = template(fx, "Linker", "", "<a href=\"$CMS_REF(page:about)$\">about</a>", path);
        UUID linkerPage = page(fx, linker, "linker");
        reference(fx, "About link", about);
        releaseFixtures.releaseAll(fx.projectId());
        run(fx, GenerationMode.FULL);
        return new Site(fx, about, other, linkerPage);
    }

    @Test
    @DisplayName("a saved draft plans nothing; releasing it plans the page and what depends on it, rooted at the release")
    void releasesSeedIncrementalPlans() throws Exception {
        Site site = site("relplan", false);
        Fixture fx = site.fx();

        setTitle(fx, site.about(), "About v2");
        assertThat(dryRun(fx)).as("a draft changes nothing online").isEmpty();

        long released = release(fx, ReleaseItem.of(site.about()));
        List<PlanEntryRecord> planned = dryRun(fx);
        assertThat(planned).extracting(PlanEntryRecord::outputPath).containsExactlyInAnyOrder("about.html", "linker.html");
        PlanEntryRecord about = planned.stream().filter(e -> e.outputPath().equals("about.html")).findFirst().orElseThrow();
        assertThat(about.reason().rootKind()).isEqualTo(RebuildRootKind.ASSET_RELEASED);
        assertThat(about.reason().rootRevision()).isEqualTo(released);

        GenerationRun run = run(fx, GenerationMode.INCREMENTAL);
        assertThat(files(fx, run).get("about.html")).contains("About v2");
        // The stored plan carries the new root kind.
        List<PlanEntryRecord> stored = generationService
                .storedPlan(fx.key(), run.getId(), PlanEntryRecord.Filter.NONE, Pageable.unpaged())
                .entries()
                .getContent();
        assertThat(stored).extracting(entry -> entry.reason().rootKind()).containsOnly(RebuildRootKind.ASSET_RELEASED);
    }

    @Test
    @DisplayName("unpublishing removes the page's output and rebuilds its links and the navigation that listed it")
    void unpublishingRebuildsWhatPointedAtThePage() throws Exception {
        Site site = site("relunpub", false);
        Fixture fx = site.fx();

        releaseService.unpublish(List.of(ReleaseItem.of(site.about())), RevisionContext.of(fx.projectId(), null, "test"));
        List<PlanEntryRecord> planned = dryRun(fx);
        assertThat(planned).extracting(PlanEntryRecord::outputPath).containsExactlyInAnyOrder("other.html", "linker.html");
        assertThat(planned).allSatisfy(entry -> assertThat(entry.reason().rootKind()).isEqualTo(RebuildRootKind.ASSET_UNPUBLISHED));

        GenerationRun run = run(fx, GenerationMode.INCREMENTAL);
        Map<String, String> files = files(fx, run);
        assertThat(files).doesNotContainKey("about.html");
        assertThat(files.get("linker.html")).isEqualTo("<a href=\"\">about</a>");
        assertThat(files.get("other.html")).doesNotContain("About link");
        assertThat(run.getDiagnostics().toString()).contains(GenerationDiagnosticCodes.GEN_UNRELEASED_REFERENCE);
    }

    @Test
    @DisplayName("releasing one language rebuilds only that language's outputs")
    void aLanguageReleaseRebuildsThatLanguage() throws Exception {
        Site site = site("relplanl10n", true);
        Fixture fx = site.fx();

        setTitles(fx, site.about(), Map.of("de", "Ueber v2", "en", "About v2"));
        release(fx, ReleaseItem.of(site.about(), "en"));

        List<PlanEntryRecord> planned = dryRun(fx);
        assertThat(planned).extracting(PlanEntryRecord::outputPath).containsExactlyInAnyOrder("en/about.html", "en/linker.html");
        assertThat(planned).extracting(PlanEntryRecord::locale).containsOnly("en");
        PlanEntryRecord about = planned.stream().filter(e -> e.outputPath().equals("en/about.html")).findFirst().orElseThrow();
        assertThat(about.reason().changedLocales()).containsExactly("en");

        GenerationRun run = run(fx, GenerationMode.INCREMENTAL);
        Map<String, String> files = files(fx, run);
        assertThat(files.get("en/about.html")).contains("About v2");
        assertThat(files.get("de/about.html")).contains("about").doesNotContain("Ueber v2");
        assertThat(generationService.storedPlan(fx.key(), run.getId(), PlanEntryRecord.Filter.NONE, Pageable.unpaged())
                        .entries().getContent())
                .extracting(PlanEntryRecord::locale)
                .containsOnly("en");
    }

    @Test
    @DisplayName("a media draft plans nothing; releasing it rebuilds its pages and copies the new file")
    void releasedMediaRebuildsItsPages() throws Exception {
        Fixture fx = newFixture("relmedia");
        AssetVersionView logo = mediaService.upload(
                fx.projectId(), null, "logo.txt", null, "V1".getBytes(StandardCharsets.UTF_8), fx.ctx());
        TemplateView template = template(fx, "Page", "", "<img src=\"$CMS_REF(media:" + logo.uid() + ")$\">", "{folder}{uid}.{ext}");
        page(fx, template, "home");
        TemplateView plain = template(fx, "Plain", "", "plain", "{folder}{uid}.{ext}");
        page(fx, plain, "plain");
        releaseFixtures.releaseAll(fx.projectId());
        run(fx, GenerationMode.FULL);

        mediaService.replace(logo.uuid(), "logo.txt", null, "V2".getBytes(StandardCharsets.UTF_8), fx.ctx());
        assertThat(dryRun(fx)).isEmpty();

        release(fx, ReleaseItem.of(logo.uuid()));
        assertThat(dryRun(fx)).extracting(PlanEntryRecord::outputPath).containsExactly("home.html");
        Map<String, String> files = files(fx, run(fx, GenerationMode.INCREMENTAL));
        assertThat(files).containsEntry("assets/media/" + logo.uid() + ".txt", "V2");
    }

    @Test
    @DisplayName("the first incremental plan after the initial release plans nothing on an unchanged project")
    void theInitialReleasePlansNothing() throws Exception {
        Fixture fx = newFixture("relmig");
        TemplateView template = template(fx, "Page", "content { editor text title { label \"Title\" } }",
                "<h1>$CMS_VALUE(title)$</h1>", "{folder}{uid}.{ext}");
        UUID about = page(fx, template, "about");
        page(fx, template, "news");
        // A project from before M27: content, no release state, a build that rendered the drafts at this revision.
        long before = revisionRepository.findHeadRevisionId(fx.projectId()).orElseThrow();
        Project project = projectRepository.findById(fx.projectId()).orElseThrow();
        project.setReleaseStateInitialized(false);
        projectRepository.save(project);
        assertThat(releaseStateMigration.initialize(fx.projectId())).isGreaterThan(0);

        assertThat(incrementalSince(fx, before)).isEmpty();

        setTitle(fx, about, "About v2");
        release(fx, ReleaseItem.of(about));
        assertThat(incrementalSince(fx, before)).containsExactly(about);
    }

    @Test
    @DisplayName("the impact of a draft is what would rebuild if it were released, the page's own outputs included")
    void impactAnswersForTheReleasedDraft() throws Exception {
        Site site = site("relimpact", false);
        Fixture fx = site.fx();
        TemplateView plain = template(fx, "Plain", "", "plain", "{folder}{uid}.{ext}");
        UUID fresh = page(fx, plain, "fresh");

        ImpactService.Impact impact = impactService.impact(fx.key(), fresh, null);
        assertThat(impact.entries()).extracting(PlanEntryRecord::outputPath).containsExactly("fresh.html");
        assertThat(impactService.impact(fx.key(), site.about(), null).entries())
                .extracting(PlanEntryRecord::outputPath)
                .as("an upper bound: its link, and the navigation listing it")
                .containsExactlyInAnyOrder("about.html", "linker.html", "other.html");
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private Fixture newFixture(String prefix) throws IOException {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(prefix + n, prefix + n + "@example.com", "Release Plan", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest(prefix + n, prefix + n, null, "release plan"), user.getId());
        GenerationTarget target = targetRepository.save(new GenerationTarget(
                project.getId(), "default", TargetType.FILESYSTEM, mapper.readTree("{\"baseUrl\":\"https://example.com\"}"), true));
        return new Fixture(project, user, RevisionContext.of(project.getId(), user.getId(), "release plan"), target);
    }

    private TemplateView template(Fixture fx, String name, String cdl, String html, String outputPath) {
        return templateService.create(
                new CreateTemplateCommand(fx.projectId(), AssetType.PAGE_TEMPLATE, name, cdl, Map.of("html", html), null, false,
                        Map.of("html", outputPath)),
                fx.ctx());
    }

    private UUID page(Fixture fx, TemplateView template, String name) {
        return pageService.create(new CreatePageCommand(name, null, template.uuid()), fx.ctx()).uuid();
    }

    private void setTitle(Fixture fx, UUID page, String title) {
        AssetVersionView current = assetService.requireCurrent(fx.projectId(), page);
        ObjectNode payload = current.payload().deepCopy();
        payload.withObject("content").put("title", title);
        pageService.update(page, payload, current.validFromRevision(), fx.ctx());
    }

    private void setTitles(Fixture fx, UUID page, Map<String, String> titles) {
        AssetVersionView current = assetService.requireCurrent(fx.projectId(), page);
        ObjectNode payload = current.payload().deepCopy();
        ObjectNode wrapper = L10nValues.empty();
        titles.forEach((locale, text) -> wrapper.withObject("/values").set(locale, JsonNodeFactory.instance.textNode(text)));
        payload.withObject("content").set("title", wrapper);
        pageService.update(page, payload, current.validFromRevision(), fx.ctx());
    }

    private void reference(Fixture fx, String name, UUID page) {
        UUID navigationRoot = assetRepository
                .findByProjectIdAndAssetTypeAndUid(fx.projectId(), AssetType.FOLDER, FolderScope.NAVIGATION_ROOT_UID)
                .map(Asset::getUuid)
                .orElseThrow();
        pageReferenceService.create(
                new CreatePageReferenceCommand(name, navigationRoot, PageReferenceTargetKind.PAGE, page, null), fx.ctx());
    }

    private long release(Fixture fx, ReleaseItem... items) {
        return releaseService.release(Arrays.asList(items), RevisionContext.of(fx.projectId(), null, "test release"))
                .revision();
    }

    private GenerationRequest request(Fixture fx, GenerationMode mode) {
        return new GenerationRequest(mode, null, List.of("html"), fx.target().getId(), null, null, null, null);
    }

    /** The entries an incremental run started now would plan. */
    private List<PlanEntryRecord> dryRun(Fixture fx) {
        return generationService.dryRun(fx.key(), request(fx, GenerationMode.INCREMENTAL), false).entries();
    }

    /** The pages an incremental plan counting changes since {@code lastSuccessfulRevision} rebuilds (no base build). */
    private Set<UUID> incrementalSince(Fixture fx, long lastSuccessfulRevision) {
        Snapshot snapshot = snapshotService.snapshot(fx.projectId(), null, SnapshotView.RELEASED);
        BuildPlan plan = buildPlanner.plan(snapshot, GenerationMode.INCREMENTAL, lastSuccessfulRevision, Set.of("html"), null,
                null, OutputPathResolver.forSnapshot(snapshot, Map.of()));
        return plan.entries().stream().map(PlanEntry::pageUuid).collect(Collectors.toSet());
    }

    /** Runs a build of the release state as it is — nothing is released first. */
    private GenerationRun run(Fixture fx, GenerationMode mode) throws InterruptedException {
        GenerationRun started = generationService.start(fx.key(), request(fx, mode), fx.user().getId());
        long deadline = System.currentTimeMillis() + 60_000;
        while (System.currentTimeMillis() < deadline) {
            GenerationRun run = generationService.status(fx.key(), started.getId());
            if (run.getStatus().isTerminal()) {
                assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isIn(RunStatus.SUCCESS, RunStatus.PARTIAL);
                return run;
            }
            Thread.sleep(50);
        }
        throw new AssertionError("Generation did not finish within 60s");
    }

    private Map<String, String> files(Fixture fx, GenerationRun run) throws IOException {
        Path dir = TargetLocations.resolve(outputRoot, fx.key(), fx.target()).resolve("builds").resolve(String.valueOf(run.getId()));
        Map<String, String> files = new TreeMap<>();
        try (Stream<Path> stream = Files.walk(dir)) {
            for (Path file : stream.filter(Files::isRegularFile).toList()) {
                files.put(dir.relativize(file).toString().replace('\\', '/'), Files.readString(file));
            }
        }
        return files;
    }
}
