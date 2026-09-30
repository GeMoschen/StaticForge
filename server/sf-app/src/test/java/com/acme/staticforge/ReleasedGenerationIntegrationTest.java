package com.acme.staticforge;

import com.acme.staticforge.urlregistry.UrlRegistryService;
import com.acme.staticforge.urlregistry.UrlArea;
import com.acme.staticforge.urlregistry.ResetScope;
import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.dataset.CreateDatasetCommand;
import com.acme.staticforge.asset.dataset.CreateRecordCommand;
import com.acme.staticforge.asset.dataset.CreateRecordSetCommand;
import com.acme.staticforge.asset.dataset.DatasetService;
import com.acme.staticforge.asset.dataset.DatasetView;
import com.acme.staticforge.asset.dataset.RecordDetail;
import com.acme.staticforge.asset.dataset.RecordService;
import com.acme.staticforge.asset.dataset.RecordSetService;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
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
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetLocations;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.template.query.RecordSetQuery;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
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
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * A build renders the release state at its revision, per language (M27.2.1): drafts don't go live, unreleased assets
 * are absent everywhere a tombstone is absent, references to them render empty with {@code SF-GEN-0221}, and each
 * language renders its own released version of a page.
 */
@SpringBootTest
@ActiveProfiles("test")
class ReleasedGenerationIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static final String PAGE_CDL = "content { editor text title { label \"Title\" } }";

    private static final String PAGE_HTML = "<h1>$CMS_VALUE(title)$</h1><nav>$CMS_NAVIGATION(nav:root)$</nav>";

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-gen-released");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired AssetRepository assetRepository;
    @Autowired FolderService folderService;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired MediaService mediaService;
    @Autowired DatasetService datasetService;
    @Autowired RecordSetService recordSetService;
    @Autowired RecordService recordService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired UrlRegistryService urlRegistryService;
    @Autowired ReleaseService releaseService;
    @Autowired ReleaseFixtures releaseFixtures;

    private final ObjectMapper mapper = new ObjectMapper();

    private record Fixture(Project project, AppUser user, RevisionContext ctx, GenerationTarget target) {

        long projectId() {
            return project.getId();
        }
    }

    private Fixture newFixture(String prefix) throws IOException {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(prefix + n, prefix + n + "@example.com", "Released", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest(prefix + n, prefix + n, null, "released rendering"), user.getId());
        GenerationTarget target = targetRepository.save(new GenerationTarget(
                project.getId(), "default", TargetType.FILESYSTEM, mapper.readTree("{\"baseUrl\":\"https://example.com\"}"), true));
        return new Fixture(project, user, RevisionContext.of(project.getId(), user.getId(), "released rendering"), target);
    }

    // ------------------------------------------------------------------
    // Drafts, new pages, unreleased references
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a draft edit stays offline; a new page has no output, nav entry, sitemap or search entry; links to it render empty")
    void draftsAndNewPagesStayOffline() throws Exception {
        Fixture fx = newFixture("relnew");
        TemplateView template = template(fx, "Page", PAGE_CDL, PAGE_HTML, "{folder}{uid}.{ext}");
        UUID about = page(fx, template, "about", null, "About v1");
        UUID news = page(fx, template, "news", null, "News");
        reference(fx, "About link", about);
        reference(fx, "News link", news);
        releaseFixtures.releaseAll(fx.projectId());

        setTitle(fx, about, "About v2"); // a draft
        UUID fresh = page(fx, template, "fresh", null, "Fresh");
        UUID freshLink = reference(fx, "Fresh link", fresh);
        TemplateView linker = template(fx, "Linker", "", "<a href=\"$CMS_REF(page:fresh)$\">fresh</a>", "{folder}{uid}.{ext}");
        UUID linkerPage = page(fx, linker, "linker", null, null);
        // The navigation entry and the linking page go live; the page they point at doesn't.
        release(fx, ReleaseItem.of(freshLink), ReleaseItem.of(linkerPage));

        GenerationRun run = generate(fx, GenerationMode.FULL, null);
        Map<String, String> files = files(fx, run);

        assertThat(files.get("about.html")).contains("About v1").doesNotContain("About v2");
        assertThat(files).doesNotContainKey("fresh.html");
        // Navigation labels fall back to the pages' names; the entry of the unreleased page is left out.
        assertThat(files.get("about.html")).contains("href=\"news.html\"").doesNotContain("fresh.html");
        assertThat(files.get("sitemap.xml")).contains("news.html").doesNotContain("fresh");
        assertThat(files.get("search-index.json")).contains("news.html").doesNotContain("\"uid\":\"fresh\"");
        assertThat(files.get("linker.html")).isEqualTo("<a href=\"\">fresh</a>");
        assertThat(run.getStatus()).isEqualTo(RunStatus.PARTIAL);
        assertThat(run.getDiagnostics().path("errors")).isEmpty();
        assertThat(run.getDiagnostics().toString())
                .contains(GenerationDiagnosticCodes.GEN_UNRELEASED_REFERENCE)
                .contains("'linker.html': reference to unreleased page 'fresh' renders empty.")
                .doesNotContain("SF-GEN-0204");

        // Released, it appears everywhere at once.
        releaseFixtures.releaseAll(fx.projectId());
        Map<String, String> released = files(fx, generate(fx, GenerationMode.FULL, null));
        assertThat(released.get("about.html")).contains("About v2").contains("href=\"fresh.html\"");
        assertThat(released.get("linker.html")).isEqualTo("<a href=\"fresh.html\">fresh</a>");
        assertThat(released.get("sitemap.xml")).contains("fresh.html");
    }

    @Test
    @DisplayName("a deleted or moved published page keeps its old output until the change is released")
    void structuralDraftsKeepTheReleasedPath() throws Exception {
        Fixture fx = newFixture("relmove");
        TemplateView template = template(fx, "Page", PAGE_CDL, PAGE_HTML, "{folder}{uid}.{ext}");
        UUID about = page(fx, template, "about", null, "About");
        UUID news = page(fx, template, "news", null, "News");
        releaseFixtures.releaseAll(fx.projectId());

        assetService.softDelete(news, true, fx.ctx());
        AssetVersionView folder = folderService.create(pagesRoot(fx), "pf", null, fx.ctx());
        assetService.move(about, folder.uuid(), fx.ctx());
        // A navigation entry created after the move: the URL registry assigns its first URL now, and must take the
        // released path, not the draft's.
        UUID aboutLink = reference(fx, "About link", about);
        release(fx, ReleaseItem.of(aboutLink));

        Map<String, String> files = files(fx, generate(fx, GenerationMode.FULL, null));
        assertThat(files).containsKeys("news.html", "about.html").doesNotContainKey("pf/about.html");
        assertThat(files.get("news.html")).contains("href=\"about.html\"");
        assertThat(String.join("\n", files.values())).doesNotContain("pf/about.html");

        releaseFixtures.releaseAll(fx.projectId());
        // The released move takes effect once the page's URL is reset (M32: a registered URL is kept until then).
        urlRegistryService.reset(fx.projectId(), ResetScope.asset(about, UrlArea.GENERATED), fx.ctx());
        Map<String, String> released = files(fx, generate(fx, GenerationMode.FULL, null));
        // The moved page's old path now redirects (M30.4.2, M30.5.1); the deleted page's path is simply gone.
        assertThat(released).containsKeys("pf/about.html", "about.html").doesNotContainKey("news.html");
        assertThat(released.get("about.html")).contains("<meta http-equiv=\"refresh\" content=\"0; url=pf/about.html\">");
    }

    @Test
    @DisplayName("a build at an older revision renders the release state of that revision")
    void timeTravelUsesTheReleaseStateAtTheRevision() throws Exception {
        Fixture fx = newFixture("reltime");
        TemplateView template = template(fx, "Page", PAGE_CDL, "<h1>$CMS_VALUE(title)$</h1>", "{folder}{uid}.{ext}");
        UUID about = page(fx, template, "about", null, "About v1");
        long first = releaseFixtures.releaseAll(fx.projectId());
        setTitle(fx, about, "About v2");
        releaseFixtures.releaseAll(fx.projectId());
        setTitle(fx, about, "About v3"); // never released

        assertThat(files(fx, generate(fx, GenerationMode.FULL, first)).get("about.html")).isEqualTo("<h1>About v1</h1>");
        assertThat(files(fx, generate(fx, GenerationMode.FULL, null)).get("about.html")).isEqualTo("<h1>About v2</h1>");
    }

    // ------------------------------------------------------------------
    // Records and media
    // ------------------------------------------------------------------

    @Test
    @DisplayName("loops iterate released records only, with their released values; an unreleased set renders as missing")
    void recordsRenderTheirReleasedState() throws Exception {
        Fixture fx = newFixture("relrec");
        DatasetView team = datasetService.create(
                new CreateDatasetCommand(fx.projectId(), null, "Team", CdlSources.split("content { editor text name { label \"Name\" } }"), "name", null),
                fx.ctx());
        AssetVersionView folder = folderService.create(null, "Team", FolderScope.CONTENT, fx.ctx());
        UUID all = recordSetService.create(new CreateRecordSetCommand(
                fx.projectId(), folder.uuid(), team.uuid(), "all", "All", new RecordSetQuery(null, "name", null, null)), fx.ctx()).uuid();
        RecordDetail ada = record(fx, all, "Ada");
        record(fx, all, "Bob");
        UUID later = recordSetService.create(new CreateRecordSetCommand(
                fx.projectId(), folder.uuid(), team.uuid(), "later", "Later", RecordSetQuery.ALL), fx.ctx()).uuid();
        TemplateView template = template(fx, "Team", "",
                "[$CMS_FOR(m : recordset:all)$$CMS_VALUE(m.name)$;$CMS_END_FOR$]"
                        + "[$CMS_FOR(m : dataset:team, sort=\"name\")$$CMS_VALUE(m.name)$;$CMS_END_FOR$]"
                        + "[$CMS_FOR(m : recordset:later)$$CMS_VALUE(m.name)$;$CMS_END_FOR$]",
                "{folder}{uid}.{ext}");
        page(fx, template, "team", null, null);
        releaseFixtures.releaseAll(fx.projectId());
        // Drop the "later" set offline again, so it exists but isn't released.
        releaseService.unpublish(List.of(ReleaseItem.of(later)), RevisionContext.of(fx.projectId(), null, "test"));

        recordService.update(ada.uuid(), mapper.readTree("{\"name\":\"Ada L.\"}"), ada.revision(), fx.ctx()); // a draft
        record(fx, all, "Cy"); // new, never released
        RecordDetail dee = record(fx, later, "Dee");
        release(fx, ReleaseItem.of(dee.uuid()));

        String html = files(fx, generate(fx, GenerationMode.FULL, null)).get("team.html");
        assertThat(html).isEqualTo("[Ada;Bob;][Ada;Bob;Dee;][]");
    }

    @Test
    @DisplayName("an unreleased media file renders empty with SF-GEN-0221 and is not copied")
    void unreleasedMediaIsNotPublished() throws Exception {
        Fixture fx = newFixture("relmedia");
        AssetVersionView logo = mediaService.upload(
                fx.projectId(), null, "logo.txt", null, "LOGO".getBytes(StandardCharsets.UTF_8), fx.ctx());
        TemplateView template = template(fx, "Page", "", "<img src=\"$CMS_REF(media:" + logo.uid() + ")$\">", "{folder}{uid}.{ext}");
        UUID home = page(fx, template, "home", null, null);
        release(fx, ReleaseItem.of(home));

        GenerationRun run = generate(fx, GenerationMode.FULL, null);
        Map<String, String> files = files(fx, run);
        assertThat(files.get("home.html")).isEqualTo("<img src=\"\">");
        assertThat(files.keySet()).noneMatch(path -> path.startsWith("assets/media/"));
        assertThat(run.getDiagnostics().toString()).contains("reference to unreleased media '" + logo.uid() + "'");

        releaseFixtures.releaseAll(fx.projectId());
        Map<String, String> released = files(fx, generate(fx, GenerationMode.FULL, null));
        assertThat(released.get("home.html")).isEqualTo("<img src=\"assets/media/" + logo.uid() + ".txt\">");
        assertThat(released).containsEntry("assets/media/" + logo.uid() + ".txt", "LOGO");
    }

    // ------------------------------------------------------------------
    // Languages
    // ------------------------------------------------------------------

    @Test
    @DisplayName("each language renders its own released version: text, folder and presence in navigation")
    void languagesRenderTheirOwnReleasedVersions() throws Exception {
        Fixture fx = newFixture("rell10n");
        enableLocales(fx);
        TemplateView template = template(fx, "Article",
                "content { editor text title { label \"Title\" localizable } }", PAGE_HTML, "{locale}/{folder}{uid}.{ext}");
        UUID about = page(fx, template, "about", null, null);
        setTitles(fx, about, Map.of("de", "Ueber v1", "en", "About v1"));
        reference(fx, "About link", about);
        releaseFixtures.releaseAll(fx.projectId());

        setTitles(fx, about, Map.of("de", "Ueber v2", "en", "About v2"));
        AssetVersionView folder = folderService.create(pagesRoot(fx), "pf", null, fx.ctx());
        assetService.move(about, folder.uuid(), fx.ctx());
        UUID only = page(fx, template, "only", null, null);
        setTitles(fx, only, Map.of("de", "Nur", "en", "Only"));
        UUID onlyLink = reference(fx, "Only link", only);
        // English goes live with the new text in the new folder; German keeps the old version where it was.
        release(fx, ReleaseItem.of(about, "en"), ReleaseItem.of(folder.uuid(), "en"), ReleaseItem.of(only, "en"),
                ReleaseItem.of(onlyLink));

        GenerationRun run = generate(fx, GenerationMode.FULL, null);
        Map<String, String> files = files(fx, run);
        assertThat(files.get("en/pf/about.html")).contains("About v2");
        assertThat(files.get("de/about.html")).contains("Ueber v1");
        assertThat(files).doesNotContainKeys("de/pf/about.html", "en/about.html", "de/only.html");
        assertThat(files.get("en/only.html")).contains("Only");
        // The German navigation leaves out the page German doesn't have — no dangling-reference failure.
        assertThat(files.get("en/pf/about.html")).contains("only.html");
        assertThat(files.get("de/about.html")).doesNotContain("only.html");
        assertThat(run.getDiagnostics().path("errors")).isEmpty();
        assertThat(files.get("sitemap.xml")).contains("en/only.html").doesNotContain("de/only.html");
    }

    @Test
    @DisplayName("a released value keeps rendering after the template made its editor localizable")
    void releasedPlainValuesReadUnderALocalizableTemplate() throws Exception {
        Fixture fx = newFixture("reltol");
        enableLocales(fx);
        TemplateView template = template(fx, "Article", PAGE_CDL, "<h1>$CMS_VALUE(title)$</h1>", "{locale}/{folder}{uid}.{ext}");
        UUID about = page(fx, template, "about", null, "Plain title");
        releaseFixtures.releaseAll(fx.projectId());
        setTitle(fx, about, "Draft title"); // the released version keeps the plain shape

        templateService.update(
                template.uuid(),
                new com.acme.staticforge.asset.template.UpdateTemplateCommand(
                        "Article", CdlSources.split("content { editor text title { label \"Title\" localizable } }"),
                        Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"), null, false,
                        Map.of("html", "{locale}/{folder}{uid}.{ext}"), false, Map.of()),
                templateService.get(fx.projectId(), template.uuid()).validFromRevision(),
                fx.ctx());
        assertThat(L10nValues.isL10n(assetService.requireCurrent(fx.projectId(), about).payload().path("content").path("title")))
                .as("the draft was migrated to the localized shape")
                .isTrue();

        Map<String, String> files = files(fx, generate(fx, GenerationMode.FULL, null));
        assertThat(files.get("de/about.html")).isEqualTo("<h1>Plain title</h1>");
        assertThat(files.get("en/about.html")).isEqualTo("<h1>Plain title</h1>");
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private void enableLocales(Fixture fx) {
        projectService.updateLocales(
                fx.project().getKey(),
                LocaleConfig.of(
                        List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English")), "de", Map.of(), false),
                true,
                fx.ctx());
    }

    private TemplateView template(Fixture fx, String name, String cdl, String html, String outputPath) {
        return templateService.create(
                new CreateTemplateCommand(fx.projectId(), AssetType.PAGE_TEMPLATE, name, CdlSources.split(cdl), Map.of("html", html), null, false,
                        Map.of("html", outputPath)),
                fx.ctx());
    }

    private UUID page(Fixture fx, TemplateView template, String name, UUID folder, String title) {
        AssetVersionView page = pageService.create(new CreatePageCommand(name, folder, template.uuid()), fx.ctx());
        if (title != null) {
            setTitle(fx, page.uuid(), title);
        }
        return page.uuid();
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

    private UUID reference(Fixture fx, String name, UUID page) {
        UUID navigationRoot = assetRepository
                .findByProjectIdAndAssetTypeAndUid(fx.projectId(), AssetType.FOLDER, FolderScope.NAVIGATION_ROOT_UID)
                .map(Asset::getUuid)
                .orElseThrow();
        return pageReferenceService
                .create(new CreatePageReferenceCommand(name, navigationRoot, PageReferenceTargetKind.PAGE, page, null), fx.ctx())
                .uuid();
    }

    private UUID pagesRoot(Fixture fx) {
        return assetService.ensurePagesRootFolder(fx.projectId(), fx.ctx()).uuid();
    }

    private RecordDetail record(Fixture fx, UUID set, String name) throws IOException {
        JsonNode content = mapper.readTree("{\"name\":\"" + name + "\"}");
        return recordService.create(new CreateRecordCommand(fx.projectId(), set, content), fx.ctx()).record();
    }

    private void release(Fixture fx, ReleaseItem... items) {
        releaseService.release(Arrays.asList(items), RevisionContext.of(fx.projectId(), null, "test release"));
    }

    /** Runs a build without releasing anything first: the point of these tests is what is — and isn't — released. */
    private GenerationRun generate(Fixture fx, GenerationMode mode, Long revision) throws InterruptedException {
        GenerationRun started = generationService.start(
                fx.project().getKey(),
                new GenerationRequest(mode, revision, List.of("html"), fx.target().getId(), null, null, null, null),
                fx.user().getId());
        long deadline = System.currentTimeMillis() + 60_000;
        while (System.currentTimeMillis() < deadline) {
            GenerationRun run = generationService.status(fx.project().getKey(), started.getId());
            if (run.getStatus().isTerminal()) {
                assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isIn(RunStatus.SUCCESS, RunStatus.PARTIAL);
                return run;
            }
            Thread.sleep(50);
        }
        throw new AssertionError("Generation did not finish within 60s");
    }

    private Map<String, String> files(Fixture fx, GenerationRun run) throws IOException {
        Path dir = TargetLocations.resolve(outputRoot, fx.project().getKey(), fx.target())
                .resolve("builds")
                .resolve(String.valueOf(run.getId()));
        Map<String, String> files = new TreeMap<>();
        try (Stream<Path> stream = Files.walk(dir)) {
            for (Path file : stream.filter(Files::isRegularFile).toList()) {
                files.put(dir.relativize(file).toString().replace('\\', '/'), Files.readString(file));
            }
        }
        return files;
    }
}
