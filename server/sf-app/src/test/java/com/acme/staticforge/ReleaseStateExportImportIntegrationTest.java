package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.common.L10nValues;
import com.acme.staticforge.exportimport.ConflictReport;
import com.acme.staticforge.exportimport.ConflictSeverity;
import com.acme.staticforge.exportimport.ConflictType;
import com.acme.staticforge.exportimport.ExportSelection;
import com.acme.staticforge.exportimport.ImportConflict;
import com.acme.staticforge.exportimport.ImportOptions;
import com.acme.staticforge.exportimport.ImportResult;
import com.acme.staticforge.exportimport.ProjectExportImportService;
import com.acme.staticforge.exportimport.ReleaseMode;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetLocations;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.generate.insight.PlanEntryRecord;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.LocaleRelease;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseLocales;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.release.ReleaseStatus;
import com.acme.staticforge.release.ReleaseStatusService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Export/import protocol 8 (M27.5.1): archives carry release state per asset and locale — released payloads that
 * differ from the draft, deletion-pending tombstones, localized media files — and an import keeps it ({@code KEEP}) or
 * brings everything in as a draft ({@code DRAFT}). Archives of protocol 7 and older import as drafts.
 */
@SpringBootTest
@ActiveProfiles("test")
class ReleaseStateExportImportIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static final String CDL = "content { editor text title { label \"Title\" localizable } }";

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-release-io");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired AssetRepository assetRepository;
    @Autowired FolderService folderService;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;
    @Autowired MediaService mediaService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired ReleaseService releaseService;
    @Autowired ReleaseStatusService releaseStatusService;
    @Autowired ReleaseFixtures releaseFixtures;
    @Autowired ProjectExportImportService exportImportService;

    private final ObjectMapper mapper = new ObjectMapper();

    private record Fixture(Project project, AppUser user, RevisionContext ctx, GenerationTarget target) {

        long id() {
            return project.getId();
        }
    }

    /** A localized source project holding every release status, and the uuids the tests look at. */
    private record Source(
            Fixture fx, UUID template, UUID published, UUID changed, UUID unpublished, UUID doomed, UUID moved,
            UUID fresh, UUID folder, UUID shot) {}

    // ------------------------------------------------------------------
    // KEEP
    // ------------------------------------------------------------------

    @Test
    @DisplayName("KEEP round trip: identical statuses per locale and an identical full build")
    void keepRoundTrip() throws Exception {
        Source src = source();
        Map<UUID, Map<String, ReleaseStatus>> expected = statuses(src.fx());
        assertThat(expected.get(src.published())).containsOnly(Map.entry("de", ReleaseStatus.PUBLISHED), Map.entry("en", ReleaseStatus.PUBLISHED));
        assertThat(expected.get(src.changed())).containsOnly(Map.entry("de", ReleaseStatus.PUBLISHED), Map.entry("en", ReleaseStatus.CHANGED));
        assertThat(expected.get(src.unpublished())).containsOnly(Map.entry("de", ReleaseStatus.UNPUBLISHED), Map.entry("en", ReleaseStatus.UNPUBLISHED));
        assertThat(expected.get(src.doomed())).containsOnly(Map.entry("de", ReleaseStatus.DELETION_PENDING), Map.entry("en", ReleaseStatus.DELETION_PENDING));
        assertThat(expected.get(src.moved())).containsOnly(Map.entry("de", ReleaseStatus.CHANGED), Map.entry("en", ReleaseStatus.CHANGED));
        assertThat(expected.get(src.fresh())).containsOnly(Map.entry("de", ReleaseStatus.NEW), Map.entry("en", ReleaseStatus.NEW));
        assertThat(expected.get(src.shot())).containsOnly(Map.entry("de", ReleaseStatus.PUBLISHED), Map.entry("en", ReleaseStatus.CHANGED));
        Map<String, String> sourceBuild = files(src.fx(), generate(src.fx()));

        byte[] archive = exportImportService.exportProject(src.fx().id());
        String doomedEntry = entry(archive, "assets/" + src.doomed() + ".json");
        assertThat(mapper.readTree(doomedEntry).path("draftDeleted").asBoolean()).isTrue();
        assertThat(mapper.readTree(entry(archive, "manifest.json")).path("protocolVersion").asInt())
                .isGreaterThanOrEqualTo(ProjectExportImportService.RELEASE_STATE_PROTOCOL);

        Fixture target = newFixture("rkeep", false);
        ConflictReport report = exportImportService.analyzeImport(target.id(), archive, ImportOptions.DEFAULT);
        assertThat(report.releaseState()).isTrue();
        assertThat(report.releaseMode()).isEqualTo(ReleaseMode.KEEP);
        assertThat(report.conflicts()).extracting(ImportConflict::type)
                .doesNotContain(ConflictType.RELEASE_LOCALE_MISSING, ConflictType.ARCHIVE_WITHOUT_RELEASE_STATE);

        ImportResult result = exportImportService.importProject(target.id(), archive, target.ctx(), ImportOptions.DEFAULT);
        assertThat(result.releasedCount()).isPositive();

        assertThat(statuses(target)).isEqualTo(expected);
        assertThat(files(target, generate(target))).isEqualTo(sourceBuild);
        // The build itself shows what the statuses say: EN keeps its released text, the moved page its old path, the
        // deletion-pending page its output, and the localized media its released English file.
        assertThat(sourceBuild.get("en/changed.html")).contains("Changed EN v1");
        assertThat(sourceBuild).containsKeys("moved.html", "doomed.html").doesNotContainKeys("pf/moved.html", "fresh.html");
        assertThat(sourceBuild).containsEntry("en/assets/media/shot_txt.txt", "EN v1").containsEntry("assets/media/shot_txt.txt", "DE v1");
    }

    @Test
    @DisplayName("KEEP over an existing asset: the archive's release state replaces the target's")
    void keepOverwritesTheTargetsReleaseState() throws Exception {
        Source src = source();
        byte[] archive = exportImportService.exportProject(src.fx().id());
        Fixture target = newFixture("rover", false);
        exportImportService.importProject(target.id(), archive, target.ctx(), new ImportOptions(false, ReleaseMode.DRAFT));
        releaseFixtures.releaseAll(target.id());
        assertThat(statuses(target).get(src.unpublished())).containsValue(ReleaseStatus.PUBLISHED);

        exportImportService.importProject(target.id(), archive, target.ctx(), ImportOptions.DEFAULT);

        Map<UUID, Map<String, ReleaseStatus>> after = statuses(target);
        assertThat(after.get(src.unpublished())).containsOnly(Map.entry("de", ReleaseStatus.UNPUBLISHED), Map.entry("en", ReleaseStatus.UNPUBLISHED));
        assertThat(after.get(src.changed())).containsOnly(Map.entry("de", ReleaseStatus.PUBLISHED), Map.entry("en", ReleaseStatus.CHANGED));
        assertThat(after.get(src.doomed())).containsOnly(Map.entry("de", ReleaseStatus.DELETION_PENDING), Map.entry("en", ReleaseStatus.DELETION_PENDING));
    }

    @Test
    @DisplayName("KEEP: a released version's own references seed incremental builds, not only its draft's")
    void importedReleasedVersionKeepsItsReferences() throws Exception {
        Fixture fx = newFixture("rrefs", false);
        AssetVersionView one = mediaService.upload(fx.id(), null, "one.txt", null, bytes("ONE v1"), fx.ctx());
        AssetVersionView two = mediaService.upload(fx.id(), null, "two.txt", null, bytes("TWO"), fx.ctx());
        TemplateView template = templateService.create(
                new CreateTemplateCommand(fx.id(), AssetType.PAGE_TEMPLATE, "Card",
                        "content { editor media photo { label \"Photo\" } }", Map.of("html", "card"), null, false,
                        Map.of("html", "{folder}{uid}.{ext}")),
                fx.ctx());
        UUID card = pageService.create(new CreatePageCommand("card", null, template.uuid()), fx.ctx()).uuid();
        setPhoto(fx, card, one.uuid());
        releaseFixtures.releaseAll(fx.id());
        setPhoto(fx, card, two.uuid()); // the draft drops "one"; the released version still shows it

        Fixture target = newFixture("rrefs", false);
        exportImportService.importProject(
                target.id(), exportImportService.exportProject(fx.id()), target.ctx(), ImportOptions.DEFAULT);
        generate(target);
        mediaService.replace(one.uuid(), "one.txt", null, bytes("ONE v2"), target.ctx());
        releaseService.release(List.of(ReleaseItem.of(one.uuid())), RevisionContext.of(target.id(), null, "release"));

        List<PlanEntryRecord> plan = generationService
                .dryRun(target.project().getKey(), request(target, GenerationMode.INCREMENTAL), false)
                .entries();
        assertThat(plan).extracting(PlanEntryRecord::outputPath).contains("card.html");
    }

    // ------------------------------------------------------------------
    // DRAFT
    // ------------------------------------------------------------------

    @Test
    @DisplayName("DRAFT: every imported asset is NEW, deletion-pending assets stay out, and a build has no pages")
    void draftImportsEverythingAsNew() throws Exception {
        Source src = source();
        byte[] archive = exportImportService.exportProject(src.fx().id());
        Fixture target = newFixture("rdraft", false);
        ImportOptions draft = new ImportOptions(false, ReleaseMode.DRAFT);

        ConflictReport report = exportImportService.analyzeImport(target.id(), archive, draft);
        assertThat(report.releaseState()).isTrue();
        assertThat(report.releaseMode()).isEqualTo(ReleaseMode.DRAFT);

        ImportResult result = exportImportService.importProject(target.id(), archive, target.ctx(), draft);
        assertThat(result.releasedCount()).isZero();

        Map<UUID, Map<String, ReleaseStatus>> statuses = statuses(target);
        assertThat(statuses).isNotEmpty().doesNotContainKey(src.doomed());
        assertThat(assetRepository.findByProjectIdAndUuid(target.id(), src.doomed())).isEmpty();
        assertThat(statuses.values()).allSatisfy(locales -> assertThat(locales.values()).containsOnly(ReleaseStatus.NEW));

        Map<String, String> build = files(target, generate(target));
        assertThat(build.keySet()).noneMatch(path -> path.endsWith(".html")).noneMatch(path -> path.contains("assets/media/"));
    }

    // ------------------------------------------------------------------
    // Locales
    // ------------------------------------------------------------------

    @Test
    @DisplayName("A release locale the target lacks is a RELEASE_LOCALE_MISSING warning; that pointer is dropped")
    void missingLocaleDropsThePointer() throws Exception {
        Source src = source();
        // Without settings, the archive carries no languages: the target keeps its own (de, fr).
        byte[] archive = exportImportService.exportSelection(
                src.fx().id(), new ExportSelection(Set.of(src.published(), src.template()), false, false, Set.of()));
        Fixture target = newFixture("rloc", false);
        projectService.updateLocales(
                target.project().getKey(),
                LocaleConfig.of(List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("fr", "Français")), "de",
                        Map.of("fr", List.of("de")), true),
                true,
                target.ctx());

        ConflictReport report = exportImportService.analyzeImport(target.id(), archive, ImportOptions.DEFAULT);
        List<ImportConflict> missing = report.conflicts().stream()
                .filter(c -> c.type() == ConflictType.RELEASE_LOCALE_MISSING)
                .toList();
        assertThat(missing).singleElement().satisfies(c -> {
            assertThat(c.severity()).isEqualTo(ConflictSeverity.WARNING);
            assertThat(c.elementUuid()).isEqualTo(src.published().toString());
            assertThat(c.detail()).contains("'en'");
        });
        assertThat(report.blocksImport()).isFalse();

        exportImportService.importProject(target.id(), archive, target.ctx(), ImportOptions.DEFAULT);
        assertThat(statuses(target).get(src.published()))
                .containsOnly(Map.entry("de", ReleaseStatus.PUBLISHED), Map.entry("fr", ReleaseStatus.NEW));
    }

    @Test
    @DisplayName("A pointer for all languages is released only in the target languages the archive has")
    void sharedPointerReleasesOnlyTheArchivesLanguages() throws Exception {
        Fixture fx = newFixture("rshared", true); // de, en
        UUID template = localizedTemplate(fx);
        UUID page = page(fx, templateService.get(fx.id(), template), "shared", "Shared");
        releaseFixtures.releaseAll(fx.id());
        byte[] exported = exportImportService.exportSelection(
                fx.id(), new ExportSelection(Set.of(page, template), false, false, Set.of()));
        assertThat(mapper.readTree(entry(exported, "manifest.json")).path("locales"))
                .extracting(com.fasterxml.jackson.databind.JsonNode::asText)
                .containsExactly("de", "en");
        // One pointer for every language, as an archive of a project without languages would have for a page.
        byte[] archive = ArchiveFixtures.editAsset(exported, page, asset -> asset.putArray("release")
                .addObject().put("locale", ReleaseLocales.ALL).put("state", "DRAFT_EQUALS"));
        Fixture target = newFixture("rshared", false);
        projectService.updateLocales(
                target.project().getKey(),
                LocaleConfig.of(List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("fr", "Français")), "de",
                        Map.of("fr", List.of("de")), true),
                true,
                target.ctx());

        ConflictReport report = exportImportService.analyzeImport(target.id(), archive, ImportOptions.DEFAULT);
        assertThat(report.conflicts()).extracting(ImportConflict::type).doesNotContain(ConflictType.RELEASE_LOCALE_MISSING);
        exportImportService.importProject(target.id(), archive, target.ctx(), ImportOptions.DEFAULT);

        // German is in the archive; French isn't, so it stays unreleased.
        assertThat(statuses(target).get(page))
                .containsOnly(Map.entry("de", ReleaseStatus.PUBLISHED), Map.entry("fr", ReleaseStatus.NEW));
    }

    @Test
    @DisplayName("An archive without languages is released in the target's default language only")
    void archiveWithoutLanguagesReleasesTheDefaultLanguage() throws Exception {
        Fixture fx = newFixture("rnoloc", false);
        TemplateView template = templateService.create(
                new CreateTemplateCommand(fx.id(), AssetType.PAGE_TEMPLATE, "Plain", "", Map.of("html", "plain"), null,
                        false, Map.of("html", "{folder}{uid}.{ext}")),
                fx.ctx());
        UUID page = pageService.create(new CreatePageCommand("plain", null, template.uuid()), fx.ctx()).uuid();
        releaseFixtures.releaseAll(fx.id());
        byte[] archive = exportImportService.exportProject(fx.id());
        Fixture target = newFixture("rnoloc", true); // de, en

        assertThat(exportImportService.analyzeImport(target.id(), archive, ImportOptions.DEFAULT).conflicts())
                .extracting(ImportConflict::type)
                .doesNotContain(ConflictType.RELEASE_LOCALE_MISSING);

        exportImportService.importProject(target.id(), archive, target.ctx(), ImportOptions.DEFAULT);
        // Single-language content is the default language's (de); English was never part of the archive.
        assertThat(statuses(target).get(page))
                .containsOnly(Map.entry("de", ReleaseStatus.PUBLISHED), Map.entry("en", ReleaseStatus.NEW));
    }

    // ------------------------------------------------------------------
    // Protocol 7
    // ------------------------------------------------------------------

    @Test
    @DisplayName("A protocol 7 archive imports as drafts with an info entry, whatever mode is asked for")
    void protocol7ImportsAsDrafts() throws Exception {
        byte[] archive = ArchiveFixtures.zipResourceDirectory("exportimport/protocol-7-no-release-state");
        Fixture target = newFixture("rp7", false);

        ConflictReport report = exportImportService.analyzeImport(target.id(), archive, ImportOptions.DEFAULT);
        assertThat(report.releaseState()).isFalse();
        assertThat(report.releaseMode()).isEqualTo(ReleaseMode.DRAFT);
        assertThat(report.conflicts()).filteredOn(c -> c.type() == ConflictType.ARCHIVE_WITHOUT_RELEASE_STATE)
                .singleElement()
                .satisfies(c -> assertThat(c.severity()).isEqualTo(ConflictSeverity.INFO));
        assertThat(report.hasBlocking()).isFalse();

        ImportResult result = exportImportService.importProject(target.id(), archive, target.ctx(), ImportOptions.DEFAULT);
        assertThat(result.releasedCount()).isZero();
        UUID team = UUID.fromString("f6722bba-368d-45b3-b521-5e1c74bfe159");
        assertThat(statuses(target).get(team)).containsOnly(Map.entry(ReleaseLocales.ALL, ReleaseStatus.NEW));
    }

    // ------------------------------------------------------------------
    // Fixture
    // ------------------------------------------------------------------

    /**
     * A localized project (de default, en) with a page in each release status, a folder that was never released,
     * and a localized media asset whose English file changed after release.
     */
    private Source source() throws Exception {
        Fixture fx = newFixture("rsrc", true);
        AssetVersionView shot = mediaService.upload(fx.id(), null, "shot.txt", null, bytes("DE v1"), fx.ctx());
        shot = mediaService.setLocalized(shot.uuid(), true, false, shot.validFromRevision(), fx.ctx());
        mediaService.putLocaleFile(shot.uuid(), "en", "shot-en.txt", null, bytes("EN v1"), fx.ctx());
        TemplateView template = templateService.create(
                new CreateTemplateCommand(fx.id(), AssetType.PAGE_TEMPLATE, "Page", CDL,
                        Map.of("html", "<h1>$CMS_VALUE(title)$</h1><img src=\"$CMS_REF(media:" + shot.uid() + ")$\">"), null,
                        false, Map.of("html", "{locale}/{folder}{uid}.{ext}")),
                fx.ctx());
        UUID published = page(fx, template, "published", "Published");
        UUID changed = page(fx, template, "changed", "Changed");
        UUID unpublished = page(fx, template, "unpublished", "Unpublished");
        UUID doomed = page(fx, template, "doomed", "Doomed");
        UUID moved = page(fx, template, "moved", "Moved");
        releaseFixtures.releaseAll(fx.id());

        setTitles(fx, changed, Map.of("de", "Changed DE v1", "en", "Changed EN v2"));
        releaseService.unpublish(List.of(ReleaseItem.of(unpublished)), RevisionContext.of(fx.id(), null, "unpublish"));
        assetService.softDelete(doomed, true, fx.ctx());
        UUID pagesRoot = assetService.ensurePagesRootFolder(fx.id(), fx.ctx()).uuid();
        UUID folder = folderService.create(pagesRoot, "pf", null, fx.ctx()).uuid();
        assetService.move(moved, folder, fx.ctx());
        mediaService.putLocaleFile(shot.uuid(), "en", "shot-en.txt", null, bytes("EN v2"), fx.ctx());
        UUID fresh = page(fx, template, "fresh", "Fresh");
        return new Source(fx, template.uuid(), published, changed, unpublished, doomed, moved, fresh, folder, shot.uuid());
    }

    private UUID localizedTemplate(Fixture fx) {
        return templateService.create(
                        new CreateTemplateCommand(fx.id(), AssetType.PAGE_TEMPLATE, "Page", CDL, Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"),
                                null, false, Map.of("html", "{locale}/{folder}{uid}.{ext}")),
                        fx.ctx())
                .uuid();
    }

    /** A page whose localizable title reads "{title} DE v1" / "{title} EN v1". */
    private UUID page(Fixture fx, TemplateView template, String name, String title) {
        UUID page = pageService.create(new CreatePageCommand(name, null, template.uuid()), fx.ctx()).uuid();
        setTitles(fx, page, Map.of("de", title + " DE v1", "en", title + " EN v1"));
        return page;
    }

    private void setTitles(Fixture fx, UUID page, Map<String, String> titles) {
        AssetVersionView current = assetService.requireCurrent(fx.id(), page);
        ObjectNode payload = current.payload().deepCopy();
        ObjectNode wrapper = L10nValues.empty();
        titles.forEach((locale, text) -> wrapper.withObject("/values").set(locale, JsonNodeFactory.instance.textNode(text)));
        payload.withObject("content").set("title", wrapper);
        pageService.update(page, payload, current.validFromRevision(), fx.ctx());
    }

    private void setPhoto(Fixture fx, UUID page, UUID media) {
        AssetVersionView current = assetService.requireCurrent(fx.id(), page);
        ObjectNode payload = current.payload().deepCopy();
        payload.withObject("content").putObject("photo").put("type", "MEDIA_REF").put("uuid", media.toString());
        pageService.update(page, payload, current.validFromRevision(), fx.ctx());
    }

    private Fixture newFixture(String prefix, boolean localized) throws IOException {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(prefix + n, prefix + n + "@example.com", "Release IO", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest(prefix + n, prefix + n, null, "release export/import"), user.getId());
        GenerationTarget target = targetRepository.save(new GenerationTarget(
                project.getId(), "default", TargetType.FILESYSTEM, mapper.readTree("{\"baseUrl\":\"https://example.com\"}"), true));
        RevisionContext ctx = RevisionContext.of(project.getId(), user.getId(), "release export/import");
        if (localized) {
            projectService.updateLocales(
                    project.getKey(),
                    LocaleConfig.of(List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English")), "de",
                            Map.of(), true),
                    true,
                    ctx);
        }
        return new Fixture(project, user, ctx, target);
    }

    /** Every releasable asset's status per locale, keyed by uuid. */
    private Map<UUID, Map<String, ReleaseStatus>> statuses(Fixture fx) {
        Map<Long, Map<String, LocaleRelease>> byId = releaseStatusService.ofProject(fx.id());
        Map<Long, UUID> uuids = new TreeMap<>();
        assetRepository.findAllById(byId.keySet()).forEach(asset -> uuids.put(asset.getId(), asset.getUuid()));
        Map<UUID, Map<String, ReleaseStatus>> out = new TreeMap<>();
        byId.forEach((id, locales) -> {
            Map<String, ReleaseStatus> statuses = new TreeMap<>();
            locales.forEach((key, release) -> statuses.put(key, release.status()));
            out.put(uuids.get(id), statuses);
        });
        return out;
    }

    private GenerationRequest request(Fixture fx, GenerationMode mode) {
        return new GenerationRequest(mode, null, List.of("html"), fx.target().getId(), null, null, null, null);
    }

    private GenerationRun generate(Fixture fx) throws InterruptedException {
        GenerationRun started = generationService.start(
                fx.project().getKey(), request(fx, GenerationMode.FULL), fx.user().getId());
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

    private static String entry(byte[] archive, String name) throws IOException {
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archive))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (name.equals(entry.getName())) {
                    return new String(zip.readAllBytes(), StandardCharsets.UTF_8);
                }
            }
        }
        throw new AssertionError("No archive entry " + name);
    }

    private static byte[] bytes(String text) {
        return text.getBytes(StandardCharsets.UTF_8);
    }
}
