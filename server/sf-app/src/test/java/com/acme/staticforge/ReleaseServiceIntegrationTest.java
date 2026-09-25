package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

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
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.asset.template.UpdateTemplateCommand;
import com.acme.staticforge.common.L10nValues;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.AssetReleaseRepository;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseLocales;
import com.acme.staticforge.release.ReleaseOutcome;
import com.acme.staticforge.release.ReleasePlan;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.release.ReleaseStatus;
import com.acme.staticforge.release.ReleaseStatusService;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.ProjectRestoreService;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
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
import java.util.function.Consumer;
import java.util.stream.Collectors;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/** {@code ReleaseService}: release, unpublish, discard and the dependency-aware dry run (M27.1.2). */
@SpringBootTest
@ActiveProfiles("test")
class ReleaseServiceIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static final String CDL = """
            content {
              editor text headline { label "Headline" required }
              editor text sku      { label "SKU" }
              editor media hero    { label "Hero" }
              editor link cta      { label "Call to action" }
            }
            """;

    private static final String LOCALIZED_CDL = """
            content {
              editor text headline { label "Headline" localizable }
              editor text sku      { label "SKU" }
            }
            """;

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired AssetRepository assetRepository;
    @Autowired AssetVersionRepository versionRepository;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;
    @Autowired FolderService folderService;
    @Autowired MediaService mediaService;
    @Autowired DatasetService datasetService;
    @Autowired RecordService recordService;
    @Autowired RecordSetService recordSetService;
    @Autowired ReleaseService releases;
    @Autowired ReleaseStatusService statuses;
    @Autowired AssetReleaseRepository releaseRepository;
    @Autowired RevisionRepository revisionRepository;
    @Autowired ProjectRestoreService projectRestore;
    @Autowired ObjectMapper mapper;

    private record Fixture(Project project, AppUser user, RevisionContext ctx) {
        long id() {
            return project.getId();
        }
    }

    // ------------------------------------------------------------------
    // Revisions and refusals
    // ------------------------------------------------------------------

    @Test
    @DisplayName("release, unpublish and discard each record one revision with their change type and summary")
    void oneRevisionEach() {
        Fixture fx = newFixture("rs-rev");
        TemplateView template = template(fx, CDL);
        UUID page = page(fx, template, "Home", c -> c.put("headline", "Hello"));

        ReleaseOutcome released = releases.release(List.of(ReleaseItem.of(page)), fx.ctx());
        assertRevision(fx, released.revision(), ChangeType.RELEASE);
        JsonNode entry = latestRevision(fx).getSummary().path("assets").get(0);
        assertThat(entry.path("action").asText()).isEqualTo("RELEASE");
        assertThat(entry.path("locale").asText()).isEqualTo(ReleaseLocales.ALL);
        assertThat(entry.path("releasedVersion").asLong()).isEqualTo(openVersionId(fx, page));
        assertThat(statusOf(fx, page)).containsEntry(ReleaseLocales.ALL, ReleaseStatus.PUBLISHED);

        edit(fx, page, c -> c.put("headline", "Hi"));
        ReleaseOutcome discarded = releases.discard(List.of(ReleaseItem.of(page)), fx.ctx());
        assertRevision(fx, discarded.revision(), ChangeType.DISCARD);
        assertThat(assetService.requireCurrent(fx.id(), page).payload().at("/content/headline").asText()).isEqualTo("Hello");
        assertThat(statusOf(fx, page)).containsEntry(ReleaseLocales.ALL, ReleaseStatus.PUBLISHED);

        ReleaseOutcome unpublished = releases.unpublish(List.of(ReleaseItem.of(page)), fx.ctx());
        assertRevision(fx, unpublished.revision(), ChangeType.UNPUBLISH);
        assertThat(statusOf(fx, page)).containsEntry(ReleaseLocales.ALL, ReleaseStatus.UNPUBLISHED);
    }

    @Test
    @DisplayName("an already published item is a no-op: skipped, and no revision")
    void publishedIsNoOp() {
        Fixture fx = newFixture("rs-noop");
        UUID page = page(fx, template(fx, CDL), "Home", c -> c.put("headline", "Hello"));
        releases.release(List.of(ReleaseItem.of(page)), fx.ctx());
        long revisions = revisionCount(fx);

        ReleaseOutcome again = releases.release(List.of(ReleaseItem.of(page)), fx.ctx());

        assertThat(again.revision()).isNull();
        assertThat(again.skipped()).hasSize(1);
        assertThat(revisionCount(fx)).isEqualTo(revisions);
    }

    @Test
    @DisplayName("incomplete content refuses the whole release, listing every incomplete item, and writes nothing")
    void incompleteContentBlocks() {
        Fixture fx = newFixture("rs-inc");
        TemplateView template = template(fx, CDL);
        UUID complete = page(fx, template, "Complete", c -> c.put("headline", "Hello"));
        UUID empty1 = page(fx, template, "Empty one", c -> c.put("sku", "A"));
        UUID empty2 = page(fx, template, "Empty two", c -> c.put("sku", "B"));
        long revisions = revisionCount(fx);

        assertThatThrownBy(() -> releases.release(
                        List.of(ReleaseItem.of(complete), ReleaseItem.of(empty1), ReleaseItem.of(empty2)), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, e -> {
                    assertThat(e.getProblem().getStatus()).isEqualTo(422);
                    assertThat(e.getProblem().getExtensions()).containsEntry("code", "SF-DOM-0150");
                    assertThat(e.getProblem().getExtensions().get("assets").toString())
                            .contains(empty1.toString(), empty2.toString())
                            .doesNotContain(complete.toString());
                });

        assertThat(revisionCount(fx)).as("the refusal allocates no revision").isEqualTo(revisions);
        assertThat(statusOf(fx, complete)).containsEntry(ReleaseLocales.ALL, ReleaseStatus.NEW);
        assertThat(releases.plan(fx.id(), List.of(ReleaseItem.of(empty1))).incomplete()).hasSize(1);
    }

    @Test
    @DisplayName("unknown assets, locales and types, empty selections and foreign pins are refused")
    void validationErrors() {
        Fixture fx = newFixture("rs-val");
        TemplateView template = template(fx, CDL);
        UUID page = page(fx, template, "Home", c -> c.put("headline", "Hello"));
        UUID other = page(fx, template, "Other", c -> c.put("headline", "Hi"));
        long revisions = revisionCount(fx);

        assertCode(() -> releases.release(List.of(ReleaseItem.of(UUID.randomUUID())), fx.ctx()), "SF-DOM-0151");
        assertCode(() -> releases.release(List.of(ReleaseItem.of(page, "fr")), fx.ctx()), "SF-DOM-0151");
        assertCode(() -> releases.release(List.of(ReleaseItem.of(template.uuid())), fx.ctx()), "SF-DOM-0151");
        assertCode(() -> releases.discard(List.of(ReleaseItem.of(page)), fx.ctx()), "SF-DOM-0152");
        assertCode(() -> releases.release(List.of(), fx.ctx()), "SF-DOM-0153");
        assertCode(
                () -> releases.release(List.of(new ReleaseItem(page, null, openVersionId(fx, other))), fx.ctx()),
                "SF-DOM-0154");
        assertThat(revisionCount(fx)).isEqualTo(revisions);
    }

    @Test
    @DisplayName("an editor may not release; an archived project refuses every mutation but still plans")
    void permissionsAndArchive() {
        Fixture fx = newFixture("rs-perm");
        UUID page = page(fx, template(fx, CDL), "Home", c -> c.put("headline", "Hello"));
        AppUser editor = userService.create("ed" + SEQ.incrementAndGet(), "ed" + SEQ.get() + "@example.com", "Ed", "secret-password");
        projectService.setMemberRole(fx.project().getKey(), editor.getId(), ProjectRole.EDITOR, fx.ctx());

        assertThatThrownBy(() -> releases.release(
                        List.of(ReleaseItem.of(page)), RevisionContext.of(fx.id(), editor.getId(), "try")))
                .isInstanceOfSatisfying(SfException.class, e -> assertThat(e.getProblem().getStatus()).isEqualTo(403));

        projectService.archive(fx.project().getKey(), fx.ctx());
        assertCode(() -> releases.release(List.of(ReleaseItem.of(page)), fx.ctx()), "SF-DOM-0141");
        assertThat(releases.plan(fx.id(), List.of(ReleaseItem.of(page))).items()).hasSize(1);
    }

    // ------------------------------------------------------------------
    // Dependencies
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the plan proposes new media, linked pages' needs transitively, containers and set members")
    void dependencyClosure() throws IOException {
        Fixture fx = newFixture("rs-dep");
        TemplateView template = template(fx, CDL);
        AssetVersionView outer = folderService.create(null, "Shop", FolderScope.PAGES, fx.ctx());
        AssetVersionView inner = folderService.create(outer.uuid(), "Coats", FolderScope.PAGES, fx.ctx());
        UUID heroA = mediaService.upload(fx.id(), null, "a.png", "image/png", png(), fx.ctx()).uuid();
        UUID heroB = mediaService.upload(fx.id(), null, "b.png", "image/png", png(), fx.ctx()).uuid();
        UUID shared = mediaService.upload(fx.id(), null, "shared.png", "image/png", png(), fx.ctx()).uuid();
        UUID linked = page(fx, template, "Linked", c -> {
            c.put("headline", "Linked");
            c.set("hero", mediaRef(heroB));
        });
        UUID parka = pageIn(fx, template, inner.uuid(), "Parka", c -> {
            c.put("headline", "Parka");
            c.set("hero", mediaRef(heroA));
            c.set("cta", mapper.createObjectNode().put("kind", "INTERNAL").put("uuid", linked.toString()));
        });
        // A published dependency is not proposed: release the shared image, then reference it.
        releases.release(List.of(ReleaseItem.of(shared)), fx.ctx());
        edit(fx, linked, c -> c.set("hero", mediaRef(shared)));
        edit(fx, linked, c -> c.set("hero", mediaRef(heroB)));

        ReleasePlan plan = releases.plan(fx.id(), List.of(ReleaseItem.of(parka)));

        Map<UUID, ReleasePlan.Reason> proposed = plan.dependencies().stream()
                .collect(Collectors.toMap(d -> d.target().assetUuid(), ReleasePlan.Dependency::reason));
        assertThat(proposed).containsEntry(heroA, ReleasePlan.Reason.REFERENCE)
                .containsEntry(linked, ReleasePlan.Reason.REFERENCE)
                .containsEntry(heroB, ReleasePlan.Reason.REFERENCE)
                .containsEntry(inner.uuid(), ReleasePlan.Reason.CONTAINER)
                .containsEntry(outer.uuid(), ReleasePlan.Reason.CONTAINER)
                .doesNotContainKey(shared);
        assertThat(plan.dependencies()).allSatisfy(d -> assertThat(d.includedByDefault()).isTrue());

        // Record sets propose their unreleased records.
        DatasetView dataset = datasetService.create(
                new CreateDatasetCommand(fx.id(), null, "Team", "content { editor text name { label \"Name\" } }", "name", "People"),
                fx.ctx());
        UUID set = new RecordSetFixtures(recordSetService).setFor(fx.id(), dataset.uuid(), null, fx.ctx());
        UUID ada = recordService.create(new CreateRecordCommand(fx.id(), set, mapper.readTree("{\"name\": \"Ada\"}")), fx.ctx())
                .record().uuid();
        assertThat(releases.plan(fx.id(), List.of(ReleaseItem.of(set))).dependencies())
                .anySatisfy(d -> {
                    assertThat(d.target().assetUuid()).isEqualTo(ada);
                    assertThat(d.reason()).isEqualTo(ReleasePlan.Reason.SET_MEMBER);
                });
    }

    @Test
    @DisplayName("pages linking each other: the closure terminates")
    void cyclesTerminate() {
        Fixture fx = newFixture("rs-cyc");
        TemplateView template = template(fx, CDL);
        UUID a = page(fx, template, "A", c -> c.put("headline", "A"));
        UUID b = page(fx, template, "B", c -> {
            c.put("headline", "B");
            c.set("cta", mapper.createObjectNode().put("kind", "INTERNAL").put("uuid", a.toString()));
        });
        edit(fx, a, c -> c.set("cta", mapper.createObjectNode().put("kind", "INTERNAL").put("uuid", b.toString())));

        ReleasePlan plan = releases.plan(fx.id(), List.of(ReleaseItem.of(a)));

        assertThat(plan.dependencies()).extracting(d -> d.target().assetUuid()).containsExactly(b);
    }

    // ------------------------------------------------------------------
    // Discard, delete, structure
    // ------------------------------------------------------------------

    @Test
    @DisplayName("discarding English restores only English; with German changed in a shared field it keeps the shared fields")
    void localeDiscard() {
        Fixture fx = newFixture("rs-disc");
        enableLocales(fx, "de", "en");
        TemplateView template = template(fx, LOCALIZED_CDL);
        UUID page = page(fx, template, "Parka", c -> {
            c.set("headline", L10nValues.with(L10nValues.wrap(text("Parka"), "de"), "en", text("The parka")));
            c.put("sku", "A-1");
        });
        releases.release(List.of(ReleaseItem.of(page)), fx.ctx());

        // English only: discard restores it and nothing else is touched.
        edit(fx, page, c -> c.set("headline", L10nValues.with(c.get("headline"), "en", text("The new parka"))));
        ReleaseOutcome only = releases.discard(List.of(ReleaseItem.of(page, "en")), fx.ctx());
        assertThat(only.sharedFieldsKept()).isEmpty();
        assertThat(statusOf(fx, page)).isEqualTo(Map.of("de", ReleaseStatus.PUBLISHED, "en", ReleaseStatus.PUBLISHED));

        // English and the shared SKU changed, German keeps its changed SKU: English gets its text back, the SKU stays.
        edit(fx, page, c -> {
            c.set("headline", L10nValues.with(c.get("headline"), "en", text("The new parka")));
            c.put("sku", "A-2");
        });
        ReleaseOutcome kept = releases.discard(List.of(ReleaseItem.of(page, "en")), fx.ctx());
        JsonNode payload = assetService.requireCurrent(fx.id(), page).payload();
        assertThat(L10nValues.get(payload.at("/content/headline"), "en").asText()).isEqualTo("The parka");
        assertThat(payload.at("/content/sku").asText()).isEqualTo("A-2");
        assertThat(kept.sharedFieldsKept()).extracting(t -> t.locale()).containsExactly("en");
        assertThat(statusOf(fx, page)).isEqualTo(Map.of("de", ReleaseStatus.CHANGED, "en", ReleaseStatus.CHANGED));
    }

    @Test
    @DisplayName("discard moves, renames and undeletes back to the released state")
    void discardStructure() {
        Fixture fx = newFixture("rs-struct");
        TemplateView template = template(fx, CDL);
        AssetVersionView folder = folderService.create(null, "Archive", FolderScope.PAGES, fx.ctx());
        UUID moved = page(fx, template, "Moved", c -> c.put("headline", "M"));
        UUID renamed = page(fx, template, "Renamed", c -> c.put("headline", "R"));
        UUID deleted = page(fx, template, "Deleted", c -> c.put("headline", "D"));
        releases.release(List.of(ReleaseItem.of(moved), ReleaseItem.of(renamed), ReleaseItem.of(deleted)), fx.ctx());
        String uid = assetService.requireCurrent(fx.id(), renamed).uid();

        assetService.move(moved, folder.uuid(), fx.ctx());
        assetService.changeUid(renamed, "renamed_" + SEQ.incrementAndGet(), fx.ctx());
        assetService.softDelete(deleted, true, fx.ctx());
        assertThat(statusOf(fx, deleted)).containsEntry(ReleaseLocales.ALL, ReleaseStatus.DELETION_PENDING);
        long revisions = revisionCount(fx);

        releases.discard(List.of(ReleaseItem.of(moved), ReleaseItem.of(renamed), ReleaseItem.of(deleted)), fx.ctx());

        assertThat(revisionCount(fx)).as("one revision for the whole discard").isEqualTo(revisions + 1);
        assertThat(assetService.requireCurrent(fx.id(), moved).folderId()).isNotEqualTo(folderId(fx, folder.uuid()));
        assertThat(assetService.requireCurrent(fx.id(), renamed).uid()).isEqualTo(uid);
        assertThat(assetService.requireCurrent(fx.id(), deleted).deleted()).isFalse();
        for (UUID uuid : List.of(moved, renamed, deleted)) {
            assertThat(statusOf(fx, uuid)).containsEntry(ReleaseLocales.ALL, ReleaseStatus.PUBLISHED);
        }
    }

    @Test
    @DisplayName("deleting a new page is immediate; deleting a published page waits for its release")
    void deletion() {
        Fixture fx = newFixture("rs-del");
        TemplateView template = template(fx, CDL);
        UUID fresh = page(fx, template, "Fresh", c -> c.put("headline", "F"));
        UUID live = page(fx, template, "Live", c -> c.put("headline", "L"));
        releases.release(List.of(ReleaseItem.of(live)), fx.ctx());

        assetService.softDelete(fresh, true, fx.ctx());
        assetService.softDelete(live, true, fx.ctx());

        assertThat(statuses.ofAsset(fx.id(), fresh)).isEmpty();
        assertThat(releaseRepository.findByAssetIdAndValidToRevisionIsNull(assetId(fx, fresh))).isEmpty();
        assertThat(statusOf(fx, live)).containsEntry(ReleaseLocales.ALL, ReleaseStatus.DELETION_PENDING);

        ReleaseOutcome outcome = releases.release(List.of(ReleaseItem.of(live)), fx.ctx());

        assertThat(outcome.applied()).hasSize(1);
        assertThat(releaseRepository.findByAssetIdAndValidToRevisionIsNull(assetId(fx, live))).isEmpty();
        assertThat(statuses.ofAsset(fx.id(), live)).isEmpty();
    }

    @Test
    @DisplayName("a move keeps the released version at its old folder until released")
    void structuralDraft() {
        Fixture fx = newFixture("rs-move");
        TemplateView template = template(fx, CDL);
        AssetVersionView folder = folderService.create(null, "Archive", FolderScope.PAGES, fx.ctx());
        UUID page = page(fx, template, "Page", c -> c.put("headline", "P"));
        releases.release(List.of(ReleaseItem.of(page)), fx.ctx());
        Long releasedVersion = releaseRepository.findByAssetIdAndValidToRevisionIsNull(assetId(fx, page)).get(0).getReleasedVersionId();
        String releasedPath = assetService.requireCurrent(fx.id(), page).folderPath();

        assetService.move(page, folder.uuid(), fx.ctx());

        assertThat(assetService.requireCurrent(fx.id(), page).folderPath()).isNotEqualTo(releasedPath);
        assertThat(versionRepository.findById(releasedVersion).orElseThrow().getFolderPath()).isEqualTo(releasedPath);
        assertThat(statusOf(fx, page)).containsEntry(ReleaseLocales.ALL, ReleaseStatus.CHANGED);
    }

    // ------------------------------------------------------------------
    // System migrations and restore
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the localizable toggle moves published pointers to the migrated version, in its revision")
    void carryForward() {
        Fixture fx = newFixture("rs-carry");
        enableLocales(fx, "de", "en");
        TemplateView template = template(fx, CDL.replace("editor media hero    { label \"Hero\" }\n", ""));
        UUID page = page(fx, template, "Parka", c -> c.put("headline", "Parka"));
        releases.release(List.of(ReleaseItem.of(page)), fx.ctx());

        templateService.update(
                template.uuid(),
                new UpdateTemplateCommand("Article", CDL.replace("label \"Headline\" required", "label \"Headline\" required localizable"),
                        Map.of("html", "<h1>$CMS_VALUE(headline)$</h1>"), null, false, null, false, null),
                assetService.requireCurrent(fx.id(), template.uuid()).validFromRevision(),
                fx.ctx());

        long migrated = openVersionId(fx, page);
        assertThat(releaseRepository.findByAssetIdAndValidToRevisionIsNull(assetId(fx, page)))
                .hasSize(2)
                .allSatisfy(p -> assertThat(p.getReleasedVersionId()).isEqualTo(migrated));
        assertThat(statusOf(fx, page)).isEqualTo(Map.of("de", ReleaseStatus.PUBLISHED, "en", ReleaseStatus.PUBLISHED));
    }

    @Test
    @DisplayName("a project restore restores drafts only; release state is unchanged")
    void projectRestoreLeavesPointers() {
        Fixture fx = newFixture("rs-restore");
        TemplateView template = template(fx, CDL);
        UUID page = page(fx, template, "Page", c -> c.put("headline", "One"));
        long before = latestRevision(fx).getRevisionId();
        edit(fx, page, c -> c.put("headline", "Two"));
        releases.release(List.of(ReleaseItem.of(page)), fx.ctx());
        Long pointer = releaseRepository.findByAssetIdAndValidToRevisionIsNull(assetId(fx, page)).get(0).getId();

        projectRestore.restoreTo(fx.id(), before, fx.user().getId(), "restore");

        assertThat(releaseRepository.findByAssetIdAndValidToRevisionIsNull(assetId(fx, page)))
                .extracting(p -> p.getId())
                .containsExactly(pointer);
        assertThat(statusOf(fx, page)).containsEntry(ReleaseLocales.ALL, ReleaseStatus.CHANGED);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private Fixture newFixture(String prefix) {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(prefix + n, prefix + n + "@example.com", "Release", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest(prefix + n, prefix + n, null, "release service"), user.getId());
        return new Fixture(project, user, RevisionContext.of(project.getId(), user.getId(), "release service"));
    }

    private void enableLocales(Fixture fx, String... codes) {
        projectService.updateLocales(
                fx.project().getKey(),
                LocaleConfig.of(java.util.Arrays.stream(codes).map(c -> new ProjectLocale(c, c)).toList(), codes[0], Map.of(), false),
                true,
                fx.ctx());
    }

    private TemplateView template(Fixture fx, String cdl) {
        return templateService.create(
                new CreateTemplateCommand(
                        fx.id(), AssetType.PAGE_TEMPLATE, "Article" + SEQ.incrementAndGet(), cdl,
                        Map.of("html", "<h1>$CMS_VALUE(headline)$</h1>"), null, false, Map.of()),
                fx.ctx());
    }

    private UUID page(Fixture fx, TemplateView template, String name, Consumer<ObjectNode> content) {
        return pageIn(fx, template, null, name, content);
    }

    private UUID pageIn(Fixture fx, TemplateView template, UUID folder, String name, Consumer<ObjectNode> content) {
        UUID page = pageService.create(new CreatePageCommand(name, folder, template.uuid()), fx.ctx()).uuid();
        edit(fx, page, content);
        return page;
    }

    private void edit(Fixture fx, UUID page, Consumer<ObjectNode> edit) {
        AssetVersionView current = assetService.requireCurrent(fx.id(), page);
        ObjectNode payload = (ObjectNode) current.payload().deepCopy();
        ObjectNode content = payload.has("content") && payload.get("content").isObject()
                ? (ObjectNode) payload.get("content")
                : payload.putObject("content");
        edit.accept(content);
        pageService.update(page, payload, current.validFromRevision(), fx.ctx());
    }

    private ObjectNode mediaRef(UUID media) {
        return mapper.createObjectNode().put("type", "MEDIA_REF").put("uuid", media.toString());
    }

    private static JsonNode text(String value) {
        return JsonNodeFactory.instance.textNode(value);
    }

    private Map<String, ReleaseStatus> statusOf(Fixture fx, UUID uuid) {
        return statuses.ofAsset(fx.id(), uuid).entrySet().stream()
                .collect(Collectors.toMap(Map.Entry::getKey, e -> e.getValue().status()));
    }

    private Long assetId(Fixture fx, UUID uuid) {
        return assetRepository.findByProjectIdAndUuid(fx.id(), uuid).orElseThrow().getId();
    }

    private Long folderId(Fixture fx, UUID uuid) {
        return assetId(fx, uuid);
    }

    private long openVersionId(Fixture fx, UUID uuid) {
        return versionRepository.findByAssetIdAndValidToRevisionIsNull(assetId(fx, uuid)).orElseThrow().getId();
    }

    private long revisionCount(Fixture fx) {
        return revisionRepository.findByProjectIdOrderByRevisionIdDesc(fx.id()).size();
    }

    private Revision latestRevision(Fixture fx) {
        return revisionRepository.findByProjectIdOrderByRevisionIdDesc(fx.id()).get(0);
    }

    private void assertRevision(Fixture fx, Long revision, ChangeType type) {
        assertThat(revision).isNotNull();
        Revision latest = latestRevision(fx);
        assertThat(latest.getRevisionId()).isEqualTo(revision);
        assertThat(latest.getChangeType()).isEqualTo(type);
    }

    private static void assertCode(org.assertj.core.api.ThrowableAssert.ThrowingCallable call, String code) {
        assertThatThrownBy(call)
                .isInstanceOfSatisfying(SfException.class, e -> assertThat(e.getProblem().getExtensions()).containsEntry("code", code));
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
