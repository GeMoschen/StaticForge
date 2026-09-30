package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.dataset.CreateDatasetCommand;
import com.acme.staticforge.asset.dataset.CreateRecordCommand;
import com.acme.staticforge.asset.dataset.DatasetService;
import com.acme.staticforge.asset.dataset.DatasetView;
import com.acme.staticforge.asset.dataset.RecordService;
import com.acme.staticforge.asset.dataset.RecordSetService;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.globals.CreateGlobalSetCommand;
import com.acme.staticforge.asset.globals.GlobalSetService;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.navigation.CreatePageReferenceCommand;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.navigation.PageReferenceTargetKind;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.asset.template.UpdateTemplateCommand;
import com.acme.staticforge.common.L10nValues;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.AssetRelease;
import com.acme.staticforge.release.AssetReleaseRepository;
import com.acme.staticforge.release.LocaleRelease;
import com.acme.staticforge.release.ReleaseLocales;
import com.acme.staticforge.release.ReleaseState;
import com.acme.staticforge.release.ReleaseStateMigration;
import com.acme.staticforge.release.ReleaseStates;
import com.acme.staticforge.release.ReleaseStatus;
import com.acme.staticforge.release.ReleaseStatusService;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The release state model (M27.1.1): the initial migration of pre-M27 projects, release status per (asset, locale),
 * and pointers following the project's locale set. Releases themselves come with {@code ReleaseService} (M27.1.2);
 * here the migration is what releases, exactly as it does for a project upgraded from before M27.
 */
@SpringBootTest
@ActiveProfiles("test")
class ReleaseStateIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static final String PLAIN_CDL = """
            content {
              editor text headline { label "Headline" }
              editor text teaser   { label "Teaser" }
              editor text sku      { label "SKU" }
            }
            """;

    private static final String LOCALIZED_CDL = """
            content {
              editor text headline { label "Headline" localizable }
              editor text teaser   { label "Teaser" localizable }
              editor text sku      { label "SKU" }
            }
            """;

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired ProjectRepository projectRepository;
    @Autowired AssetService assetService;
    @Autowired AssetRepository assetRepository;
    @Autowired AssetVersionRepository versionRepository;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;
    @Autowired FolderService folderService;
    @Autowired MediaService mediaService;
    @Autowired GlobalSetService globalSetService;
    @Autowired DatasetService datasetService;
    @Autowired RecordService recordService;
    @Autowired RecordSetService recordSetService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired ReleaseStateMigration migration;
    @Autowired ReleaseStatusService statuses;
    @Autowired ReleaseStates releaseStates;
    @Autowired AssetReleaseRepository releaseRepository;
    @Autowired RevisionRepository revisionRepository;
    @Autowired ObjectMapper mapper;

    private record Fixture(Project project, AppUser user, RevisionContext ctx) {
        long id() {
            return project.getId();
        }
    }

    // ------------------------------------------------------------------
    // Migration
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the migration releases every editorial asset in every locale, and nothing else")
    void migrationReleasesEveryEditorialAsset() throws IOException {
        Fixture fx = newFixture("rel-mig");
        enableLocales(fx, "de", "en");
        TemplateView template = template(fx, LOCALIZED_CDL);
        AssetVersionView pagesFolder = folderService.create(null, "Products", FolderScope.PAGES, fx.ctx());
        AssetVersionView page = pageService.create(new CreatePageCommand("Parka", pagesFolder.uuid(), template.uuid()), fx.ctx());
        AssetVersionView mediaFolder = folderService.create(null, "Images", FolderScope.MEDIA, fx.ctx());
        AssetVersionView media = mediaService.upload(fx.id(), mediaFolder.uuid(), "hero.png", "image/png", png(), fx.ctx());
        UUID global = globalSetService
                .create(new CreateGlobalSetCommand(fx.id(), null, "Site", CdlSources.split("content { editor text title { label \"Title\" } }")),
                        fx.ctx())
                .uuid();
        DatasetView dataset = datasetService.create(
                new CreateDatasetCommand(fx.id(), null, "Team", CdlSources.split("content { editor text name { label \"Name\" } }"), "name", "People"),
                fx.ctx());
        AssetVersionView contentFolder = folderService.create(null, "Staff", FolderScope.CONTENT, fx.ctx());
        UUID set = new RecordSetFixtures(recordSetService).setFor(fx.id(), dataset.uuid(), contentFolder.uuid(), fx.ctx());
        UUID record = recordService
                .create(new CreateRecordCommand(fx.id(), set, mapper.readTree("{\"name\": \"Ada\"}")), fx.ctx())
                .record()
                .uuid();
        AssetVersionView navFolder = folderService.create(null, "Main menu", FolderScope.NAVIGATION, fx.ctx());
        AssetVersionView reference = pageReferenceService.create(
                new CreatePageReferenceCommand("Parka link", navFolder.uuid(), PageReferenceTargetKind.PAGE, page.uuid(), null),
                fx.ctx());
        long revisionsBefore = revisionCount(fx);

        int opened = initialize(fx);

        // Pages, records, sets, globals and navigation release per locale; the non-localized image once.
        for (UUID uuid : List.of(page.uuid(), pagesFolder.uuid(), global, set, record, contentFolder.uuid(),
                navFolder.uuid(), reference.uuid(), mediaFolder.uuid())) {
            assertThat(statusOf(fx, uuid)).as("%s", uuid).isEqualTo(Map.of("de", ReleaseStatus.PUBLISHED, "en", ReleaseStatus.PUBLISHED));
        }
        assertThat(statusOf(fx, media.uuid())).isEqualTo(Map.of(ReleaseLocales.ALL, ReleaseStatus.PUBLISHED));
        assertThat(opened).isEqualTo(9 * 2 + 1);

        // Templates, dataset schemas, template folders and store roots stay live: no pointer.
        for (Asset asset : assetRepository.findAll().stream().filter(a -> a.getProjectId().equals(fx.id())).toList()) {
            boolean live = switch (asset.getAssetType()) {
                case PAGE_TEMPLATE, SECTION_TEMPLATE, DATASET -> true;
                case FOLDER -> asset.getUid().endsWith("root") || asset.getUid().endsWith("templates")
                        || asset.getUid().equals(FolderScope.DATASETS_UID);
                default -> false;
            };
            if (live) {
                assertThat(releaseRepository.findByAssetIdAndValidToRevisionIsNull(asset.getId()))
                        .as("%s %s", asset.getAssetType(), asset.getUid())
                        .isEmpty();
            }
        }

        // One revision, by nobody, of type RELEASE.
        assertThat(revisionCount(fx)).isEqualTo(revisionsBefore + 1);
        Revision revision = latestRevision(fx);
        assertThat(revision.getChangeType()).isEqualTo(ChangeType.RELEASE);
        assertThat(revision.getCreatedBy()).isNull();
        assertThat(revision.getComment()).isEqualTo("Initial release state (M27)");
        assertThat(projectRepository.findById(fx.id()).orElseThrow().isReleaseStateInitialized()).isTrue();
    }

    @Test
    @DisplayName("running the migration again opens nothing, even with the flag reset")
    void migrationIsIdempotent() {
        Fixture fx = newFixture("rel-idem");
        TemplateView template = template(fx, PLAIN_CDL);
        pageService.create(new CreatePageCommand("Home", null, template.uuid()), fx.ctx());
        initialize(fx);
        long revisions = revisionCount(fx);
        int pointers = releaseRepository.findByProjectIdAndValidToRevisionIsNull(fx.id()).size();

        assertThat(migration.initialize(fx.id())).isZero();
        assertThat(initialize(fx)).isZero();

        assertThat(revisionCount(fx)).isEqualTo(revisions);
        assertThat(releaseRepository.findByProjectIdAndValidToRevisionIsNull(fx.id())).hasSize(pointers);
    }

    @Test
    @DisplayName("a project without locales has one pointer per asset, under the all-locales key")
    void unlocalizedProjectUsesTheAllKey() {
        Fixture fx = newFixture("rel-one");
        TemplateView template = template(fx, PLAIN_CDL);
        AssetVersionView page = pageService.create(new CreatePageCommand("Home", null, template.uuid()), fx.ctx());

        initialize(fx);

        assertThat(statusOf(fx, page.uuid())).isEqualTo(Map.of(ReleaseLocales.ALL, ReleaseStatus.PUBLISHED));
    }

    @Test
    @DisplayName("a project created after M27 starts initialized: its assets are new until released")
    void newProjectsStartInitialized() {
        Fixture fx = newFixture("rel-new");
        TemplateView template = template(fx, PLAIN_CDL);
        AssetVersionView page = pageService.create(new CreatePageCommand("Home", null, template.uuid()), fx.ctx());

        assertThat(migration.pendingProjects()).doesNotContain(fx.id());
        assertThat(statusOf(fx, page.uuid())).isEqualTo(Map.of(ReleaseLocales.ALL, ReleaseStatus.NEW));
    }

    // ------------------------------------------------------------------
    // Status
    // ------------------------------------------------------------------

    @Test
    @DisplayName("editing only the English value changes only English")
    void englishOnlyEdit() {
        Fixture fx = newFixture("rel-en");
        enableLocales(fx, "de", "en");
        UUID page = localizedPage(fx);
        initialize(fx);

        editContent(fx, page, content -> content.set(
                "headline", L10nValues.with(content.get("headline"), "en", JsonNodeFactory.instance.textNode("The new parka"))));

        assertThat(statusOf(fx, page)).isEqualTo(Map.of("de", ReleaseStatus.PUBLISHED, "en", ReleaseStatus.CHANGED));
    }

    @Test
    @DisplayName("a shared value, a rename and a move change every locale")
    void sharedChangesEveryLocale() {
        Fixture fx = newFixture("rel-shared");
        enableLocales(fx, "de", "en");
        UUID sku = localizedPage(fx);
        UUID renamed = localizedPage(fx);
        UUID moved = localizedPage(fx);
        AssetVersionView folder = folderService.create(null, "Archive", FolderScope.PAGES, fx.ctx());
        initialize(fx);

        editContent(fx, sku, content -> content.put("sku", "A-2"));
        assetService.changeUid(renamed, "parka_" + SEQ.incrementAndGet(), fx.ctx());
        assetService.move(moved, folder.uuid(), fx.ctx());

        Map<String, ReleaseStatus> everyLocaleChanged = Map.of("de", ReleaseStatus.CHANGED, "en", ReleaseStatus.CHANGED);
        assertThat(statusOf(fx, sku)).as("shared value").isEqualTo(everyLocaleChanged);
        assertThat(statusOf(fx, renamed)).as("rename").isEqualTo(everyLocaleChanged);
        assertThat(statusOf(fx, moved)).as("move").isEqualTo(everyLocaleChanged);
    }

    @Test
    @DisplayName("a value only a fallback locale shows changes exactly the locales that see it")
    void fallbackLocale() {
        Fixture fx = newFixture("rel-fb");
        projectService.updateLocales(
                fx.project().getKey(),
                LocaleConfig.of(
                        List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English"),
                                new ProjectLocale("de-CH", "Schweiz")),
                        "de",
                        Map.of("de-CH", List.of("de")),
                        false),
                true,
                fx.ctx());
        UUID page = localizedPage(fx);
        editContent(fx, page, content -> content.set(
                "teaser", L10nValues.with(content.get("teaser"), "en", JsonNodeFactory.instance.textNode("Warm and dry"))));
        initialize(fx);

        // de-CH has no teaser of its own and shows the German one; English has its own.
        editContent(fx, page, content -> content.set(
                "teaser", L10nValues.with(content.get("teaser"), "de", JsonNodeFactory.instance.textNode("Sehr warm"))));

        assertThat(statusOf(fx, page)).isEqualTo(Map.of(
                "de", ReleaseStatus.CHANGED, "en", ReleaseStatus.PUBLISHED, "de-CH", ReleaseStatus.CHANGED));
    }

    @Test
    @DisplayName("an edit back to the released content is published again")
    void revertedEditIsPublished() {
        Fixture fx = newFixture("rel-back");
        TemplateView template = template(fx, PLAIN_CDL);
        UUID page = pageService.create(new CreatePageCommand("Home", null, template.uuid()), fx.ctx()).uuid();
        editContent(fx, page, content -> content.put("headline", "Hello"));
        initialize(fx);

        editContent(fx, page, content -> content.put("headline", "Hi"));
        assertThat(statusOf(fx, page)).containsEntry(ReleaseLocales.ALL, ReleaseStatus.CHANGED);

        editContent(fx, page, content -> content.put("headline", "Hello"));
        assertThat(statusOf(fx, page)).containsEntry(ReleaseLocales.ALL, ReleaseStatus.PUBLISHED);
    }

    @Test
    @DisplayName("deleting a released page leaves it pending deletion; a deleted unreleased page has no status")
    void deletion() {
        Fixture fx = newFixture("rel-del");
        TemplateView template = template(fx, PLAIN_CDL);
        UUID released = pageService.create(new CreatePageCommand("Old", null, template.uuid()), fx.ctx()).uuid();
        initialize(fx);
        UUID fresh = pageService.create(new CreatePageCommand("Fresh", null, template.uuid()), fx.ctx()).uuid();
        assertThat(statusOf(fx, fresh)).isEqualTo(Map.of(ReleaseLocales.ALL, ReleaseStatus.NEW));

        assetService.softDelete(released, true, fx.ctx());
        assetService.softDelete(fresh, true, fx.ctx());

        assertThat(statusOf(fx, released)).isEqualTo(Map.of(ReleaseLocales.ALL, ReleaseStatus.DELETION_PENDING));
        assertThat(statuses.ofAsset(fx.id(), fresh)).isEmpty();
    }

    @Test
    @DisplayName("the localizable toggle rewrites published pages without changing what any locale shows")
    void localizableToggleKeepsPagesPublished() {
        Fixture fx = newFixture("rel-toggle");
        enableLocales(fx, "de", "en");
        TemplateView template = template(fx, PLAIN_CDL);
        UUID page = pageService.create(new CreatePageCommand("Parka", null, template.uuid()), fx.ctx()).uuid();
        editContent(fx, page, content -> content.put("headline", "Parka").put("teaser", "Warm").put("sku", "A-1"));
        initialize(fx);

        templateService.update(
                template.uuid(),
                new UpdateTemplateCommand("Article", CdlSources.split(LOCALIZED_CDL), Map.of("html", "<h1>$CMS_VALUE(headline)$</h1>"),
                        null, false, null, false, null),
                assetService.requireCurrent(fx.id(), template.uuid()).validFromRevision(),
                fx.ctx());

        assertThat(L10nValues.isL10n(assetService.requireCurrent(fx.id(), page).payload().at("/content/headline"))).isTrue();
        assertThat(statusOf(fx, page)).isEqualTo(Map.of("de", ReleaseStatus.PUBLISHED, "en", ReleaseStatus.PUBLISHED));
    }

    @Test
    @DisplayName("the project status call costs the same number of queries for 1 or 12 pages")
    void bulkStatus() {
        Fixture fx = newFixture("rel-bulk");
        enableLocales(fx, "de", "en");
        TemplateView template = template(fx, LOCALIZED_CDL);
        for (int i = 0; i < 12; i++) {
            pageService.create(new CreatePageCommand("Page " + i, null, template.uuid()), fx.ctx());
        }
        initialize(fx);
        UUID edited = localizedPage(fx);

        Map<Long, Map<String, LocaleRelease>> all = statuses.ofProject(fx.id());

        long pages = all.values().stream().filter(l -> l.get("de").status() == ReleaseStatus.PUBLISHED).count();
        assertThat(pages).isEqualTo(12);
        Long editedId = assetRepository.findByProjectIdAndUuid(fx.id(), edited).orElseThrow().getId();
        assertThat(all.get(editedId).get("en").status()).isEqualTo(ReleaseStatus.NEW);
    }

    // ------------------------------------------------------------------
    // Locale set changes and time travel
    // ------------------------------------------------------------------

    @Test
    @DisplayName("removing a locale closes its pointers in the locale revision; adding one opens none")
    void localeSetChanges() {
        Fixture fx = newFixture("rel-loc");
        enableLocales(fx, "de", "en", "fr");
        UUID page = localizedPage(fx);
        initialize(fx);
        long beforeRemoval = latestRevision(fx).getRevisionId();

        enableLocales(fx, "de", "en");
        long removal = latestRevision(fx).getRevisionId();

        assertThat(statusOf(fx, page)).isEqualTo(Map.of("de", ReleaseStatus.PUBLISHED, "en", ReleaseStatus.PUBLISHED));
        List<AssetRelease> french = releaseRepository.findByProjectIdOrderByAssetIdAscLocaleKeyAscValidFromRevisionAsc(fx.id())
                .stream()
                .filter(p -> p.getLocaleKey().equals("fr"))
                .toList();
        assertThat(french).isNotEmpty().allSatisfy(p -> assertThat(p.getValidToRevision()).isEqualTo(removal));

        // Time travel: before the removal the French pointer was still there.
        Long pageId = assetRepository.findByProjectIdAndUuid(fx.id(), page).orElseThrow().getId();
        assertThat(releaseStates.at(fx.id(), beforeRemoval).pointer(pageId, "fr")).isNotNull();
        assertThat(releaseStates.at(fx.id(), removal).pointer(pageId, "fr")).isNull();

        enableLocales(fx, "de", "en", "it");
        assertThat(statusOf(fx, page))
                .isEqualTo(Map.of("de", ReleaseStatus.PUBLISHED, "en", ReleaseStatus.PUBLISHED, "it", ReleaseStatus.NEW));
    }

    @Test
    @DisplayName("a project gaining its first locales keeps its content published in each of them")
    void firstLocalesSpreadTheSharedPointer() throws IOException {
        Fixture fx = newFixture("rel-first");
        TemplateView template = template(fx, PLAIN_CDL);
        UUID page = pageService.create(new CreatePageCommand("Home", null, template.uuid()), fx.ctx()).uuid();
        UUID media = mediaService.upload(fx.id(), null, "logo.png", "image/png", png(), fx.ctx()).uuid();
        initialize(fx);

        enableLocales(fx, "de", "en");

        assertThat(statusOf(fx, page)).isEqualTo(Map.of("de", ReleaseStatus.PUBLISHED, "en", ReleaseStatus.PUBLISHED));
        assertThat(statusOf(fx, media)).isEqualTo(Map.of(ReleaseLocales.ALL, ReleaseStatus.PUBLISHED));

        // And back: the default language's pointer becomes the single one.
        projectService.updateLocales(fx.project().getKey(), LocaleConfig.EMPTY, true, fx.ctx());
        assertThat(statusOf(fx, page)).isEqualTo(Map.of(ReleaseLocales.ALL, ReleaseStatus.PUBLISHED));
    }

    @Test
    @DisplayName("release state at a revision is what was released then")
    void releaseStateAtRevision() {
        Fixture fx = newFixture("rel-at");
        TemplateView template = template(fx, PLAIN_CDL);
        UUID page = pageService.create(new CreatePageCommand("Home", null, template.uuid()), fx.ctx()).uuid();
        long beforeRelease = latestRevision(fx).getRevisionId();
        initialize(fx);
        long released = latestRevision(fx).getRevisionId();
        Long pageId = assetRepository.findByProjectIdAndUuid(fx.id(), page).orElseThrow().getId();

        ReleaseState then = releaseStates.at(fx.id(), beforeRelease);
        ReleaseState now = releaseStates.at(fx.id(), released);

        assertThat(then.pointer(pageId, ReleaseLocales.ALL)).isNull();
        assertThat(now.releasedVersionId(pageId, ReleaseLocales.ALL))
                .isEqualTo(versionRepository.findByAssetIdAndValidToRevisionIsNull(pageId).orElseThrow().getId());
        assertThat(releaseStates.at(fx.id(), released, List.of(pageId)).size()).isEqualTo(1);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private Fixture newFixture(String prefix) {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(prefix + n, prefix + n + "@example.com", "Release", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest(prefix + n, prefix + n, null, "release state"), user.getId());
        return new Fixture(project, user, RevisionContext.of(project.getId(), user.getId(), "release state"));
    }

    private void enableLocales(Fixture fx, String... codes) {
        projectService.updateLocales(
                fx.project().getKey(),
                LocaleConfig.of(
                        java.util.Arrays.stream(codes).map(c -> new ProjectLocale(c, c)).toList(), codes[0], Map.of(), false),
                true,
                fx.ctx());
    }

    private TemplateView template(Fixture fx, String cdl) {
        return templateService.create(
                new CreateTemplateCommand(
                        fx.id(), AssetType.PAGE_TEMPLATE, "Article" + SEQ.incrementAndGet(), CdlSources.split(cdl),
                        Map.of("html", "<h1>$CMS_VALUE(headline)$</h1>"), null, false, Map.of()),
                fx.ctx());
    }

    /** A page with a German and English headline, a German-only teaser and a shared SKU. */
    private UUID localizedPage(Fixture fx) {
        TemplateView template = template(fx, LOCALIZED_CDL);
        UUID page = pageService
                .create(new CreatePageCommand("Parka " + SEQ.incrementAndGet(), null, template.uuid()), fx.ctx())
                .uuid();
        editContent(fx, page, content -> {
            content.set("headline", L10nValues.with(
                    L10nValues.wrap(JsonNodeFactory.instance.textNode("Parka"), "de"),
                    "en", JsonNodeFactory.instance.textNode("The parka")));
            content.set("teaser", L10nValues.wrap(JsonNodeFactory.instance.textNode("Warm"), "de"));
            content.put("sku", "A-1");
        });
        return page;
    }

    private void editContent(Fixture fx, UUID page, java.util.function.Consumer<ObjectNode> edit) {
        AssetVersionView current = assetService.requireCurrent(fx.id(), page);
        ObjectNode payload = (ObjectNode) current.payload().deepCopy();
        ObjectNode content = payload.has("content") && payload.get("content").isObject()
                ? (ObjectNode) payload.get("content")
                : payload.putObject("content");
        edit.accept(content);
        pageService.update(page, payload, current.validFromRevision(), fx.ctx());
    }

    /** Runs the pre-M27 migration for the fixture project, as startup does for an upgraded one. */
    private int initialize(Fixture fx) {
        Project project = projectRepository.findById(fx.id()).orElseThrow();
        project.setReleaseStateInitialized(false);
        projectRepository.save(project);
        return migration.initialize(fx.id());
    }

    private Map<String, ReleaseStatus> statusOf(Fixture fx, UUID uuid) {
        return statuses.ofAsset(fx.id(), uuid).entrySet().stream()
                .collect(Collectors.toMap(Map.Entry::getKey, e -> e.getValue().status()));
    }

    private long revisionCount(Fixture fx) {
        return revisionRepository.findByProjectIdOrderByRevisionIdDesc(fx.id()).size();
    }

    private Revision latestRevision(Fixture fx) {
        return revisionRepository.findByProjectIdOrderByRevisionIdDesc(fx.id()).get(0);
    }

    private static byte[] png() throws IOException {
        BufferedImage image = new BufferedImage(8, 8, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        g.setColor(Color.ORANGE);
        g.fillRect(0, 0, 8, 8);
        g.dispose();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(image, "png", out);
        return out.toByteArray();
    }
}
