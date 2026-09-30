package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.ReferenceKind;
import com.acme.staticforge.asset.UsageView;
import com.acme.staticforge.asset.dataset.CreateDatasetCommand;
import com.acme.staticforge.asset.dataset.CreateRecordCommand;
import com.acme.staticforge.asset.dataset.CreateRecordSetCommand;
import com.acme.staticforge.asset.dataset.DatasetService;
import com.acme.staticforge.asset.dataset.DatasetView;
import com.acme.staticforge.asset.dataset.RecordDetail;
import com.acme.staticforge.asset.dataset.RecordService;
import com.acme.staticforge.asset.dataset.RecordService.RecordListQuery;
import com.acme.staticforge.template.query.RecordSetQuery;
import com.acme.staticforge.asset.dataset.RecordSetService;
import com.acme.staticforge.asset.dataset.RecordSetView;
import com.acme.staticforge.asset.dataset.UpdateRecordSetCommand;
import com.acme.staticforge.asset.folder.FolderNode;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageQuery;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.preview.PageRenderService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * {@code M25.1.1}: record sets as assets and the containment rules — a record always lives in a set of its
 * dataset, a set lives in a Content folder and holds records only — on every write path (create, move,
 * restore), the folder-style cascade delete and restore, the delete guards, the Content tree and the
 * {@code template_asset_id} readers.
 */
@SpringBootTest
@ActiveProfiles("test")
class RecordSetIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static final String TEAM_CDL = "content { editor text name { label \"Name\" } editor text role { label \"Role\" } }";
    private static final String PRODUCT_CDL = "content { editor text sku { label \"SKU\" } }";

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired AssetRepository assetRepository;
    @Autowired AssetVersionRepository assetVersionRepository;
    @Autowired RevisionRepository revisionRepository;
    @Autowired DatasetService datasetService;
    @Autowired RecordService recordService;
    @Autowired RecordSetService recordSetService;
    @Autowired FolderService folderService;
    @Autowired TemplateService templateService;
    @Autowired PageService pageService;
    @Autowired PageRenderService pageRenderService;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void recordsMoveOnlyBetweenSetsOfTheirDatasetAndSetsOnlyLiveInFolders() {
        Fixture fx = newFixture();
        DatasetView team = dataset(fx, "Team", TEAM_CDL);
        DatasetView products = dataset(fx, "Products", PRODUCT_CDL);
        AssetVersionView people = folderService.create(null, "People", FolderScope.CONTENT, fx.ctx());
        AssetVersionView staff = folderService.create(people.uuid(), "Staff", FolderScope.CONTENT, fx.ctx());

        RecordSetView leads = set(fx, team, staff.uuid(), "Leads");
        assertThat(leads.folderPath()).isEqualTo("/people/staff/");
        assertThat(leads.datasetUid()).isEqualTo("team");
        assertThat(leads.recordCount()).isZero();
        RecordDetail ada = record(fx, leads, "Ada");
        RecordDetail bob = record(fx, leads, "Bob");
        RecordDetail cy = record(fx, leads, "Cy");
        assertThat(List.of(ada, bob, cy)).allSatisfy(record -> {
            assertThat(record.recordSetUuid()).isEqualTo(leads.uuid());
            assertThat(record.recordSetUid()).isEqualTo("leads");
            assertThat(record.folderUuid()).isEqualTo(staff.uuid());
            assertThat(record.folderPath()).isEqualTo("/people/staff/");
            assertThat(record.datasetUuid()).isEqualTo(team.uuid());
        });

        // Same dataset: fine, the record follows its new set's folder.
        RecordSetView alumni = set(fx, team, people.uuid(), "Alumni");
        assetService.move(cy.uuid(), alumni.uuid(), fx.ctx());
        RecordDetail moved = current(fx, cy);
        assertThat(moved.recordSetUuid()).isEqualTo(alumni.uuid());
        assertThat(moved.folderPath()).isEqualTo("/people/");
        assertThat(recordSetService.find(fx.project().getId(), leads.uuid(), null).orElseThrow().recordCount()).isEqualTo(2);

        // Another dataset's set, a folder, the store root: the containment error.
        RecordSetView catalog = set(fx, products, people.uuid(), "Catalog");
        assertContainmentViolation(() -> assetService.move(ada.uuid(), catalog.uuid(), fx.ctx()));
        assertContainmentViolation(() -> assetService.move(ada.uuid(), staff.uuid(), fx.ctx()));
        assertContainmentViolation(() -> assetService.move(ada.uuid(), null, fx.ctx()));
        assertThat(current(fx, ada).recordSetUuid()).isEqualTo(leads.uuid());

        // A set inside a set, or anything but a record in a set: the containment error.
        assertContainmentViolation(() -> set(fx, team, leads.uuid(), "Nested"));
        assertContainmentViolation(() -> assetService.move(catalog.uuid(), leads.uuid(), fx.ctx()));
        assertContainmentViolation(() -> folderService.create(leads.uuid(), "Sub", FolderScope.CONTENT, fx.ctx()));
        assertContainmentViolation(() -> folderService.move(staff.uuid(), leads.uuid(), fx.ctx()));
        assertContainmentViolation(() -> assetService.create(
                new CreateAssetCommand(fx.project().getId(), AssetType.FOLDER, "Sub", leads.uuid(),
                        mapper.createObjectNode().put("scope", "CONTENT"), null),
                fx.ctx()));

        // A set outside the Content store is the FolderScope violation.
        AssetVersionView docs = folderService.create(null, "Docs", FolderScope.PAGES, fx.ctx());
        assertThatThrownBy(() -> set(fx, team, docs.uuid(), "Misplaced"))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(422));
    }

    @Test
    void aRecordIsNeverCreatedOrRestoredOutsideALiveSet() {
        Fixture fx = newFixture();
        DatasetView team = dataset(fx, "Team", TEAM_CDL);
        AssetVersionView people = folderService.create(null, "People", FolderScope.CONTENT, fx.ctx());
        UUID contentRoot = assetRepository.findByProjectIdAndAssetTypeAndUid(
                        fx.project().getId(), AssetType.FOLDER, FolderScope.CONTENT_ROOT_UID)
                .orElseThrow()
                .getUuid();

        assertContainmentViolation(() -> recordService.create(
                new CreateRecordCommand(fx.project().getId(), null, values("Ada")), fx.ctx()));
        assertContainmentViolation(() -> recordService.create(
                new CreateRecordCommand(fx.project().getId(), contentRoot, values("Ada")), fx.ctx()));
        assertContainmentViolation(() -> recordService.create(
                new CreateRecordCommand(fx.project().getId(), people.uuid(), values("Ada")), fx.ctx()));
        // The generic create path enforces the same rule.
        ObjectNode payload = mapper.createObjectNode().put("datasetRef", team.uuid().toString());
        payload.set("content", values("Ada"));
        assertContainmentViolation(() -> assetService.create(
                new CreateAssetCommand(fx.project().getId(), AssetType.RECORD, "Ada", people.uuid(), payload, team.uuid()),
                fx.ctx()));
        assertContainmentViolation(() -> assetService.create(
                new CreateAssetCommand(fx.project().getId(), AssetType.RECORD, "Ada", null, payload, team.uuid()),
                fx.ctx()));
        assertThat(assetVersionRepository.countCurrentRecordsOfDataset(fx.project().getId(), assetId(fx, team.uuid())))
                .isZero();

        // A record whose set is deleted stays deleted until the set comes back — with it.
        RecordSetView members = set(fx, team, people.uuid(), "Members");
        RecordDetail ada = record(fx, members, "Ada");
        recordSetService.delete(members.uuid(), true, fx.ctx());
        assertContainmentViolation(() -> assetService.restore(ada.uuid(), ada.revision(), fx.ctx()));
        assertContainmentViolation(() -> recordService.create(
                new CreateRecordCommand(fx.project().getId(), members.uuid(), values("Bob")), fx.ctx()));
        assertThat(current(fx, ada).deleted()).isTrue();

        assetService.restore(members.uuid(), members.revision(), fx.ctx());
        assertThat(current(fx, ada).deleted()).isFalse();
    }

    @Test
    void aSetIsDeletedLikeAFolderAndRestoredWithItsRecords() {
        Fixture fx = newFixture();
        DatasetView team = dataset(fx, "Team", TEAM_CDL);
        RecordSetView members = set(fx, team, null, "Members");
        RecordDetail ada = record(fx, members, "Ada");
        RecordDetail bob = record(fx, members, "Bob");
        RecordDetail gone = record(fx, members, "Gone");
        assetService.softDelete(gone.uuid(), false, fx.ctx());

        // Without cascade, a set with live records is the folder "not empty" conflict with a count —
        // through the set service and through the generic delete alike.
        for (Runnable delete : List.<Runnable>of(
                () -> recordSetService.delete(members.uuid(), false, fx.ctx()),
                () -> assetService.softDelete(members.uuid(), true, fx.ctx()))) {
            assertThatThrownBy(delete::run).isInstanceOfSatisfying(SfException.class, ex -> {
                assertThat(ex.getStatus()).isEqualTo(409);
                assertThat(ex.getProblem().getExtensions())
                        .containsEntry("code", "SF-DOM-0110")
                        .containsEntry("recordCount", 2L);
            });
        }

        long beforeDelete = head(fx);
        long revisionsBefore = revisionCount(fx);
        recordSetService.delete(members.uuid(), true, fx.ctx());
        assertThat(revisionCount(fx)).as("the set and its records go in one revision").isEqualTo(revisionsBefore + 1);
        long deleteRevision = head(fx);
        assertThat(List.of(current(fx, ada), current(fx, bob))).allSatisfy(record -> {
            assertThat(record.deleted()).isTrue();
            assertThat(record.revision()).isEqualTo(deleteRevision);
        });
        assertThat(recordSetService.find(fx.project().getId(), members.uuid(), null).orElseThrow().deleted()).isTrue();

        // Time travel still sees the set and its records as they were.
        assertThat(recordService.find(fx.project().getId(), ada.uuid(), beforeDelete).orElseThrow().deleted()).isFalse();
        assertThat(recordSetService.find(fx.project().getId(), members.uuid(), beforeDelete).orElseThrow())
                .satisfies(set -> {
                    assertThat(set.deleted()).isFalse();
                    assertThat(set.recordCount()).isEqualTo(2);
                });
        assertThat(assetVersionRepository.findRecordsOfDatasetAt(fx.project().getId(), assetId(fx, team.uuid()), beforeDelete))
                .extracting(v -> v.getAsset().getUuid())
                .containsExactlyInAnyOrder(ada.uuid(), bob.uuid());

        // Restoring the set brings back what the cascade took — not the record deleted on its own before.
        revisionsBefore = revisionCount(fx);
        assetService.restore(members.uuid(), members.revision(), fx.ctx());
        assertThat(revisionCount(fx)).isEqualTo(revisionsBefore + 1);
        assertThat(current(fx, ada).deleted()).isFalse();
        assertThat(current(fx, bob).deleted()).isFalse();
        assertThat(current(fx, gone).deleted()).isTrue();
        assertThat(recordSetService.find(fx.project().getId(), members.uuid(), null).orElseThrow().recordCount()).isEqualTo(2);
    }

    @Test
    void anEmptySetBlocksItsDatasetsDeleteAndDeletesWithoutCascade() {
        Fixture fx = newFixture();
        DatasetView team = dataset(fx, "Team", TEAM_CDL);
        RecordSetView empty = set(fx, team, null, "Empty");

        assertThatThrownBy(() -> datasetService.delete(team.uuid(), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> {
                    assertThat(ex.getStatus()).isEqualTo(409);
                    assertThat(ex.getProblem().getExtensions())
                            .containsEntry("code", "SF-DOM-0121")
                            .containsEntry("recordCount", 0L)
                            .containsEntry("setCount", 1L);
                });

        recordSetService.delete(empty.uuid(), false, fx.ctx());
        datasetService.delete(team.uuid(), fx.ctx());
        assertThat(datasetService.find(fx.project().getId(), team.uuid(), null).orElseThrow().deleted()).isTrue();
    }

    @Test
    void templateAssetIdReadersNeverMistakeASetForAPageOrARecord() {
        Fixture fx = newFixture();
        DatasetView team = dataset(fx, "Team", TEAM_CDL);
        RecordSetView members = set(fx, team, null, "Members");
        RecordDetail ada = record(fx, members, "Ada");
        long projectId = fx.project().getId();
        long teamId = assetId(fx, team.uuid());

        // Sets and records both carry the dataset in template_asset_id; every reader filters on asset_type.
        assertThat(assetVersionRepository.findCurrentPagesOfTemplates(projectId, List.of(teamId))).isEmpty();
        assertThat(pageService.list(projectId, new PageQuery(null, team.uuid(), null))).isEmpty();
        assertThat(assetVersionRepository.findCurrentRecordsOfDataset(projectId, teamId))
                .extracting(v -> v.getAsset().getUuid())
                .containsExactly(ada.uuid());
        assertThat(assetVersionRepository.countCurrentRecordsOfDataset(projectId, teamId)).isEqualTo(1);
        assertThat(recordService.list(projectId, team.uuid(), new RecordListQuery(null, null, null, List.of()), 0, 50)
                        .rows())
                .extracting(row -> row.uuid())
                .containsExactly(ada.uuid());
        assertThat(assetVersionRepository.findCurrentSetsOfDataset(projectId, teamId))
                .extracting(v -> v.getAsset().getUuid())
                .containsExactly(members.uuid());
        assertThat(assetVersionRepository.findSetsOfDatasetAt(projectId, teamId, head(fx)))
                .extracting(v -> v.getAsset().getUuid())
                .containsExactly(members.uuid());
        assertThat(datasetService.find(projectId, team.uuid(), null).orElseThrow().recordCount()).isEqualTo(1);

        // A set's dataset link is a TEMPLATE edge; the dataset's usages leave it out, like its records.
        assertThat(assetService.usages(projectId, team.uuid())).isEmpty();
    }

    @Test
    void aSetIsAnAssetWithAFixedDatasetAQueryAndUsages() {
        Fixture fx = newFixture();
        DatasetView team = dataset(fx, "Team", TEAM_CDL);
        DatasetView products = dataset(fx, "Products", PRODUCT_CDL);
        AssetVersionView people = folderService.create(null, "People", FolderScope.CONTENT, fx.ctx());
        RecordSetView leads = recordSetService.create(
                new CreateRecordSetCommand(fx.project().getId(), people.uuid(), team.uuid(), "team_leads", "Leadership",
                        new RecordSetQuery("role == 'lead'", "-name", 3, null)),
                fx.ctx());
        assertThat(leads.uid()).isEqualTo("team_leads");
        assertThat(leads.query()).isEqualTo(new RecordSetQuery("role == 'lead'", "-name", 3, null));
        JsonNode payload = assetService.requireCurrent(fx.project().getId(), leads.uuid()).payload();
        assertThat(payload.path("datasetRef").asText()).isEqualTo(team.uuid().toString());
        assertThat(payload.path("query").has("offset")).as("only the parts that are set are stored").isFalse();
        assertThat(assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(assetId(fx, leads.uuid())).orElseThrow()
                        .getTemplateAssetId())
                .as("datasetRef is mirrored into template_asset_id")
                .isEqualTo(assetId(fx, team.uuid()));
        assertThatThrownBy(() -> recordSetService.create(
                        new CreateRecordSetCommand(fx.project().getId(), null, team.uuid(), "team_leads", "Again", null),
                        fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(422));
        assertThatThrownBy(() -> recordSetService.create(
                        new CreateRecordSetCommand(fx.project().getId(), null, UUID.randomUUID(), null, "Nowhere", null),
                        fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(404));

        // Update: name and query change, the dataset stays; a stale revision conflicts.
        RecordSetView renamed = recordSetService.update(
                leads.uuid(), new UpdateRecordSetCommand("Leads", null), leads.revision(), fx.ctx());
        assertThat(renamed.displayName()).isEqualTo("Leads");
        assertThat(renamed.query()).isEqualTo(RecordSetQuery.ALL);
        assertThat(renamed.datasetUuid()).isEqualTo(team.uuid());
        assertThatThrownBy(() -> recordSetService.update(
                        leads.uuid(), new UpdateRecordSetCommand("Stale", null), leads.revision(), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(409));

        // Listing: live sets with their live record counts, optionally of one dataset.
        record(fx, renamed, "Ada");
        record(fx, renamed, "Bob");
        RecordSetView catalog = set(fx, products, null, "Catalog");
        assertThat(recordSetService.list(fx.project().getId(), null))
                .extracting(RecordSetView::uid, RecordSetView::recordCount, RecordSetView::datasetDisplayName)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple("catalog", 0L, "Products"),
                        org.assertj.core.groups.Tuple.tuple("team_leads", 2L, "Team"));
        assertThat(recordSetService.list(fx.project().getId(), products.uuid()))
                .extracting(RecordSetView::uuid)
                .containsExactly(catalog.uuid());

        // A set's usages are the pages that reference it.
        TemplateView template = templateService.create(
                new CreateTemplateCommand(fx.project().getId(), AssetType.PAGE_TEMPLATE, "Team page",
                        CdlSources.split("content { editor reference featured { label \"Featured\" } }"),
                        Map.of("html", "<p>team</p>"), null, false, Map.of("html", "{displayNameSlug}.{ext}")),
                fx.ctx());
        AssetVersionView page = pageService.create(new CreatePageCommand("Team", null, template.uuid()), fx.ctx());
        ObjectNode pagePayload = page.payload().deepCopy();
        pagePayload.putObject("content").putObject("featured")
                .put("type", "ASSET_REF").put("uuid", leads.uuid().toString()).put("assetType", "RECORD_SET");
        pageService.update(page.uuid(), pagePayload, page.validFromRevision(), fx.ctx());
        assertThat(assetService.usages(fx.project().getId(), leads.uuid()))
                .extracting(UsageView::fromUuid, UsageView::kind)
                .containsExactly(org.assertj.core.groups.Tuple.tuple(page.uuid(), ReferenceKind.CONTENT_REF));
    }

    @Test
    void theContentTreeShowsSetsWithRecordCountsAndMovingASetMovesItsRecords() {
        Fixture fx = newFixture();
        DatasetView team = dataset(fx, "Team", TEAM_CDL);
        AssetVersionView people = folderService.create(null, "People", FolderScope.CONTENT, fx.ctx());
        AssetVersionView archive = folderService.create(null, "Archive", FolderScope.CONTENT, fx.ctx());
        RecordSetView members = set(fx, team, people.uuid(), "Members");
        RecordDetail ada = record(fx, members, "Ada");
        record(fx, members, "Bob");
        set(fx, team, people.uuid(), "Alumni");

        FolderNode root = folderService.tree(fx.project().getId(), FolderScope.CONTENT, -1, fx.ctx()).get(0);
        assertThat(root.uid()).isEqualTo(FolderScope.CONTENT_ROOT_UID);
        FolderNode peopleNode = root.children().stream().filter(n -> n.uuid().equals(people.uuid())).findFirst().orElseThrow();
        assertThat(peopleNode.type()).isEqualTo(AssetType.FOLDER);
        assertThat(peopleNode.recordCount()).isNull();
        assertThat(peopleNode.children())
                .extracting(FolderNode::uid, FolderNode::type, FolderNode::recordCount)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple("alumni", AssetType.RECORD_SET, 0L),
                        org.assertj.core.groups.Tuple.tuple("members", AssetType.RECORD_SET, 2L));
        assertThat(peopleNode.children()).allSatisfy(set -> assertThat(set.children()).isEmpty());

        // Moving the set (one revision) takes its records along to the new folder path.
        long revisionsBefore = revisionCount(fx);
        assetService.move(members.uuid(), archive.uuid(), fx.ctx());
        assertThat(revisionCount(fx)).isEqualTo(revisionsBefore + 1);
        assertThat(current(fx, ada).folderPath()).isEqualTo("/archive/");
        assertThat(current(fx, ada).folderUuid()).isEqualTo(archive.uuid());
        assertThat(recordService.list(fx.project().getId(), team.uuid(), new RecordListQuery(null, "archive", null, List.of()), 0, 50)
                        .totalElements())
                .isEqualTo(2);

        // Moving the folder holding the set rebases the set and its records with the subtree.
        folderService.move(archive.uuid(), people.uuid(), fx.ctx());
        assertThat(current(fx, ada).folderPath()).isEqualTo("/people/archive/");
        assertThat(recordSetService.find(fx.project().getId(), members.uuid(), null).orElseThrow().folderPath())
                .isEqualTo("/people/archive/");
    }

    @Test
    void loopItemsCarryTheirRecordSet() {
        Fixture fx = newFixture();
        DatasetView team = dataset(fx, "Team", TEAM_CDL);
        record(fx, set(fx, team, null, "Leads"), "Ada");
        record(fx, set(fx, team, null, "Staff"), "Bob");
        TemplateView template = templateService.create(
                new CreateTemplateCommand(fx.project().getId(), AssetType.PAGE_TEMPLATE, "Team page", CdlSources.split(""),
                        Map.of("html", "$CMS_FOR(m : dataset:team, where=\"m._recordSet == 'staff'\")$"
                                + "$CMS_VALUE(m.name)$@$CMS_VALUE(m._recordSet)$$CMS_END_FOR$"),
                        null, false, Map.of("html", "{displayNameSlug}.{ext}")),
                fx.ctx());
        UUID page = pageService.create(new CreatePageCommand("Team", null, template.uuid()), fx.ctx()).uuid();

        assertThat(pageRenderService.renderPage(fx.project().getId(), page, null, "html", false)).isEqualTo("Bob@staff");
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private static void assertContainmentViolation(Runnable write) {
        assertThatThrownBy(write::run).isInstanceOfSatisfying(SfException.class, ex -> {
            assertThat(ex.getStatus()).isEqualTo(422);
            assertThat(ex.getProblem().getTitle()).isEqualTo("Validation Failed");
            assertThat(ex.getProblem().getType()).isEqualTo("https://cms.example.com/problems/sf-dom-0104");
            assertThat(ex.getProblem().getExtensions()).containsEntry("code", "SF-DOM-0104");
        });
    }

    private DatasetView dataset(Fixture fx, String name, String cdl) {
        return datasetService.create(new CreateDatasetCommand(fx.project().getId(), null, name, CdlSources.split(cdl), null, null), fx.ctx());
    }

    private RecordSetView set(Fixture fx, DatasetView dataset, UUID folder, String name) {
        return new RecordSetFixtures(recordSetService).create(fx.project().getId(), dataset.uuid(), folder, name, fx.ctx());
    }

    private RecordDetail record(Fixture fx, RecordSetView set, String name) {
        return recordService.create(new CreateRecordCommand(fx.project().getId(), set.uuid(), values(name)), fx.ctx())
                .record();
    }

    private ObjectNode values(String name) {
        return mapper.createObjectNode().put("name", name);
    }

    private RecordDetail current(Fixture fx, RecordDetail record) {
        return recordService.find(fx.project().getId(), record.uuid(), null).orElseThrow();
    }

    private long assetId(Fixture fx, UUID uuid) {
        return assetRepository.findByProjectIdAndUuid(fx.project().getId(), uuid).map(Asset::getId).orElseThrow();
    }

    private long head(Fixture fx) {
        return revisionRepository.findByProjectIdOrderByRevisionIdDesc(fx.project().getId()).get(0).getRevisionId();
    }

    private long revisionCount(Fixture fx) {
        return revisionRepository.findByProjectIdOrderByRevisionIdDesc(fx.project().getId()).size();
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(
                "recordset-user-" + n, "recordset-user-" + n + "@example.com", "Record Set User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("recordsetp_" + n, "Record Set Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }
}
