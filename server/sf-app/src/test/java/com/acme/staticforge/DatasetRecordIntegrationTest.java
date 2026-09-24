package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetReference;
import com.acme.staticforge.asset.AssetReferenceRepository;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.ReferenceKind;
import com.acme.staticforge.asset.content.ContentIssue;
import com.acme.staticforge.asset.dataset.CreateDatasetCommand;
import com.acme.staticforge.asset.dataset.CreateRecordCommand;
import com.acme.staticforge.asset.dataset.DatasetService;
import com.acme.staticforge.asset.dataset.DatasetView;
import com.acme.staticforge.asset.dataset.RecordDetail;
import com.acme.staticforge.asset.dataset.RecordService;
import com.acme.staticforge.asset.dataset.RecordSetService;
import com.acme.staticforge.asset.dataset.RecordSetView;
import com.acme.staticforge.asset.dataset.RecordWriteResult;
import com.acme.staticforge.asset.dataset.UpdateDatasetCommand;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * {@code M19.1.1}/{@code M19.1.2}: dataset schemas and records through their domain services —
 * store provisioning, placement, validation, the one-revision rename migration, reference edges,
 * the record-count delete guard and title editors.
 */
@SpringBootTest
@ActiveProfiles("test")
class DatasetRecordIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    static final String TEAM_CDL =
            """
            content {
              editor text name { label "Name" required }
              editor select role { label "Role" options [ { value "lead", label "Lead" }, { value "dev", label "Developer" } ] }
              editor number level { label "Level" }
              editor media photo { label "Photo" }
              editor reference mentor { label "Mentor" dataset "team" }
            }
            """;

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired AssetRepository assetRepository;
    @Autowired AssetVersionRepository assetVersionRepository;
    @Autowired AssetReferenceRepository referenceRepository;
    @Autowired RevisionRepository revisionRepository;
    @Autowired DatasetService datasetService;
    @Autowired RecordService recordService;
    @Autowired RecordSetService recordSetService;
    @Autowired FolderService folderService;
    @Autowired MediaService mediaService;
    @Autowired TemplateService templateService;
    @Autowired PageService pageService;

    private final ObjectMapper mapper = new ObjectMapper();

    // ------------------------------------------------------------------
    // M19.1.1 — stores and placement
    // ------------------------------------------------------------------

    @Test
    void aNewProjectProvisionsTheContentRootAndTheDatasetsFolderInItsCreationRevision() {
        Fixture fx = newFixture();

        List<Revision> revisions = revisionRepository.findByProjectIdOrderByRevisionIdDesc(fx.project().getId());
        assertThat(revisions).hasSize(1);
        List<String> uids = new ArrayList<>();
        for (UUID uuid : touchedAssetUuids(fx, revisions.get(0).getRevisionId())) {
            uids.add(assetRepository.findByProjectIdAndUuid(fx.project().getId(), uuid).orElseThrow().getUid());
        }
        assertThat(uids).contains(FolderScope.CONTENT_ROOT_UID, FolderScope.DATASETS_UID);

        AssetVersion datasets = currentFolder(fx, FolderScope.DATASETS_UID);
        assertThat(datasets.getPayload().path("templateKind").asText()).isEqualTo("DATASET");
        assertThat(datasets.getPayload().path("protected").asBoolean()).isTrue();
        assertThat(datasets.getFolderPath()).isEqualTo("/templates_root/datasets/");
        assertThat(currentFolder(fx, FolderScope.CONTENT_ROOT_UID).getFolderPath()).isEqualTo("/content_root/");
    }

    @Test
    void aPreM19ProjectGetsTheFoldersLazilyInsideTheCreatingRevision() {
        Fixture fx = newFixture();
        dropFolder(fx, FolderScope.DATASETS_UID);
        dropFolder(fx, FolderScope.CONTENT_ROOT_UID);
        long before = revisionCount(fx);

        DatasetView team = team(fx);
        assertThat(revisionCount(fx)).isEqualTo(before + 1);
        assertThat(touchedAssetUuids(fx, team.revision()))
                .contains(team.uuid(), assetRepository.findByProjectIdAndAssetTypeAndUid(
                                fx.project().getId(), AssetType.FOLDER, FolderScope.DATASETS_UID).orElseThrow().getUuid());
        assertThat(team.folderPath()).isEqualTo("/templates_root/datasets/");

        // M25: a record lives in a record set; the set's creation provisions the Content store root.
        RecordSetView members = sets().create(fx.project().getId(), team.uuid(), null, "Members", fx.ctx());
        assertThat(revisionCount(fx)).isEqualTo(before + 2);
        assertThat(touchedAssetUuids(fx, members.revision()))
                .contains(members.uuid(), assetRepository.findByProjectIdAndAssetTypeAndUid(
                                fx.project().getId(), AssetType.FOLDER, FolderScope.CONTENT_ROOT_UID).orElseThrow().getUuid());
        assertThat(members.folderPath()).isEqualTo("/");

        RecordDetail ada = record(fx, team, null, "{\"name\":\"Ada\",\"role\":\"lead\"}").record();
        assertThat(revisionCount(fx)).isEqualTo(before + 3);
        assertThat(ada.recordSetUuid()).isEqualTo(members.uuid());
        assertThat(ada.folderPath()).isEqualTo("/");
    }

    @Test
    void recordsBelongInTheContentStoreAndDatasetsInTheDatasetsFolder() {
        Fixture fx = newFixture();
        DatasetView team = team(fx);
        AssetVersionView pageFolder = folderService.create(null, "Docs", FolderScope.PAGES, fx.ctx());
        AssetVersion sectionTemplates = currentFolder(fx, FolderScope.SECTION_TEMPLATES_UID);

        assertThatThrownBy(() -> recordService.create(
                        new CreateRecordCommand(fx.project().getId(), pageFolder.uuid(), content("{\"name\":\"Ada\"}")),
                        fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(422));
        assertThatThrownBy(() -> sets().create(fx.project().getId(), team.uuid(), pageFolder.uuid(), "Docs set", fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(422));
        assertThatThrownBy(() -> datasetService.create(
                        new CreateDatasetCommand(fx.project().getId(), sectionTemplates.getAsset().getUuid(), "Other", TEAM_CDL, null, null),
                        fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(422));
    }

    @Test
    void theFixedFoldersAreProtected() {
        Fixture fx = newFixture();
        for (String uid : List.of(FolderScope.DATASETS_UID, FolderScope.CONTENT_ROOT_UID)) {
            AssetVersion folder = currentFolder(fx, uid);
            UUID uuid = folder.getAsset().getUuid();
            assertThatThrownBy(() -> folderService.update(uuid, "Renamed", folder.getValidFromRevision(), fx.ctx()))
                    .as("rename %s", uid)
                    .isInstanceOf(SfException.class);
            assertThatThrownBy(() -> folderService.delete(uuid, true, fx.ctx())).as("delete %s", uid).isInstanceOf(SfException.class);
        }
    }

    @Test
    void theRecordDatasetLinkIsTemplateAssetIdForCurrentAndRevisionPinnedReads() {
        Fixture fx = newFixture();
        DatasetView team = team(fx);
        DatasetView other = datasetService.create(
                new CreateDatasetCommand(fx.project().getId(), null, "Products", "content { editor text sku { label \"SKU\" } }", null, null),
                fx.ctx());
        RecordDetail ada = record(fx, team, null, "{\"name\":\"Ada\"}").record();
        record(fx, other, null, "{\"sku\":\"x-1\"}");
        long afterAda = ada.revision();
        RecordDetail bob = record(fx, team, null, "{\"name\":\"Bob\"}").record();
        assetService.softDelete(ada.uuid(), false, fx.ctx());

        long teamId = assetId(fx, team.uuid());
        assertThat(assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(assetId(fx, bob.uuid())).orElseThrow()
                        .getTemplateAssetId())
                .isEqualTo(teamId);
        assertThat(assetVersionRepository.findCurrentRecordsOfDataset(fx.project().getId(), teamId))
                .extracting(v -> v.getAsset().getUuid())
                .containsExactly(bob.uuid());
        assertThat(assetVersionRepository.findRecordsOfDatasetAt(fx.project().getId(), teamId, afterAda))
                .extracting(v -> v.getAsset().getUuid())
                .containsExactly(ada.uuid());
        assertThat(assetVersionRepository.countCurrentRecordsOfDataset(fx.project().getId(), teamId)).isEqualTo(1);
    }

    // ------------------------------------------------------------------
    // M19.1.2 — schemas
    // ------------------------------------------------------------------

    @Test
    void schemaErrorsAreDiagnosticsAndBodiesAreRejected() {
        Fixture fx = newFixture();

        assertThatThrownBy(() -> datasetService.create(
                        new CreateDatasetCommand(fx.project().getId(), null, "Broken", "content { editor wat x { } }", null, null),
                        fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> {
                    assertThat(ex.getStatus()).isEqualTo(422);
                    assertThat(diagnosticCodes(ex)).contains(DiagnosticCodes.CDL_UNKNOWN_EDITOR_TYPE);
                });
        assertThatThrownBy(() -> datasetService.create(
                        new CreateDatasetCommand(
                                fx.project().getId(), null, "Bodies",
                                "content { editor text name { label \"Name\" } }\nbodies { body main { label \"Main\" allow [\"*\"] } }",
                                null, null),
                        fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> {
                    assertThat(ex.getStatus()).isEqualTo(422);
                    assertThat(diagnosticCodes(ex)).containsExactly(DiagnosticCodes.CDL_NOT_ALLOWED_IN_DATASET);
                });
        assertThatThrownBy(() -> datasetService.create(
                        new CreateDatasetCommand(fx.project().getId(), null, "Title", TEAM_CDL, "level", null), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(422));
        assertThat(datasetService.list(fx.project().getId())).isEmpty();
    }

    @Test
    void renamingAnEditorMigratesEveryRecordInOneRevision() {
        Fixture fx = newFixture();
        DatasetView team = team(fx);
        List<RecordDetail> records = List.of(
                record(fx, team, null, "{\"name\":\"Ada\",\"role\":\"lead\"}").record(),
                record(fx, team, null, "{\"name\":\"Bob\",\"role\":\"dev\"}").record(),
                record(fx, team, null, "{\"name\":\"Cy\"}").record());
        DatasetView products = datasetService.create(
                new CreateDatasetCommand(fx.project().getId(), null, "Products", "content { editor text role { label \"R\" } }", null, null),
                fx.ctx());
        RecordDetail product = record(fx, products, null, "{\"role\":\"untouched\"}").record();
        long before = revisionCount(fx);

        DatasetView renamed = datasetService.update(
                team.uuid(),
                new UpdateDatasetCommand("Team", TEAM_CDL.replace("editor select role { label \"Role\"",
                        "editor select position { label \"Position\" renamedFrom \"role\""), null, "The team"),
                datasetService.find(fx.project().getId(), team.uuid(), null).orElseThrow().revision(),
                fx.ctx());

        assertThat(revisionCount(fx)).isEqualTo(before + 1);
        assertThat(touchedAssetUuids(fx, renamed.revision()))
                .as("the dataset and every record holding the renamed value; Cy has none and is not rewritten")
                .containsExactlyInAnyOrder(team.uuid(), records.get(0).uuid(), records.get(1).uuid());
        assertThat(current(fx, records.get(0)).content().path("position").asText()).isEqualTo("lead");
        assertThat(current(fx, records.get(0)).revision()).isEqualTo(renamed.revision());
        assertThat(current(fx, records.get(1)).content().has("role")).isFalse();
        assertThat(current(fx, records.get(2)).revision()).isEqualTo(records.get(2).revision());
        assertThat(current(fx, product).content().path("role").asText()).isEqualTo("untouched");
        assertThat(renamed.description()).isEqualTo("The team");
    }

    @Test
    void aRecordEditRacingASchemaMigrationIsAConflict() {
        Fixture fx = newFixture();
        DatasetView team = team(fx);
        RecordDetail ada = record(fx, team, null, "{\"name\":\"Ada\",\"role\":\"lead\"}").record();

        datasetService.update(
                team.uuid(),
                new UpdateDatasetCommand("Team", TEAM_CDL.replace("editor select role { label \"Role\"",
                        "editor select position { label \"Position\" renamedFrom \"role\""), null, null),
                team.revision(),
                fx.ctx());

        assertThatThrownBy(() -> recordService.update(
                        ada.uuid(), content("{\"name\":\"Ada L.\",\"role\":\"lead\"}"), ada.revision(), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(409));
        assertThat(current(fx, ada).content().path("position").asText()).isEqualTo("lead");
    }

    @Test
    void aStaleSchemaUpdateIsAConflictAndMigratesNothing() {
        Fixture fx = newFixture();
        DatasetView team = team(fx);
        RecordDetail ada = record(fx, team, null, "{\"name\":\"Ada\",\"role\":\"lead\"}").record();
        long before = revisionCount(fx);

        assertThatThrownBy(() -> datasetService.update(
                        team.uuid(),
                        new UpdateDatasetCommand("Team", TEAM_CDL.replace("editor select role { label \"Role\"",
                                "editor select position { label \"Position\" renamedFrom \"role\""), null, null),
                        team.revision() - 1,
                        fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(409));
        assertThat(revisionCount(fx)).isEqualTo(before);
        assertThat(current(fx, ada).content().path("role").asText()).isEqualTo("lead");
    }

    // ------------------------------------------------------------------
    // M19.1.2 — records
    // ------------------------------------------------------------------

    @Test
    void recordContentIsValidatedWithPageSemantics() {
        Fixture fx = newFixture();
        DatasetView team = team(fx);

        assertThatThrownBy(() -> record(fx, team, null, "{\"name\":\"Ada\",\"level\":\"high\"}"))
                .isInstanceOfSatisfying(SfException.class, ex -> {
                    assertThat(ex.getStatus()).isEqualTo(422);
                    assertThat(issuePaths(ex)).containsExactly("content.level");
                });
        assertThatThrownBy(() -> record(fx, team, null, "{\"name\":\"Ada\",\"role\":\"cto\"}"))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(issuePaths(ex)).containsExactly("content.role"));

        RecordWriteResult incomplete = recordService.create(
                new CreateRecordCommand(fx.project().getId(), set(fx, team), content("{\"level\":2}")),
                fx.ctx());
        assertThat(incomplete.issues()).extracting(ContentIssue::path, ContentIssue::code)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("content.name", "required"));

        RecordDetail updated = recordService.update(
                        incomplete.record().uuid(), content("{\"level\":3}"), incomplete.record().revision(), fx.ctx())
                .record();
        assertThatThrownBy(() -> recordService.update(
                        incomplete.record().uuid(), content("{\"level\":4}"), incomplete.record().revision(), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(409));
        assertThat(updated.content().path("level").asInt()).isEqualTo(3);
    }

    @Test
    void aDatasetRestrictedReferenceOnlyAcceptsRecordsOfThatDataset() {
        Fixture fx = newFixture();
        DatasetView team = team(fx);
        DatasetView products = datasetService.create(
                new CreateDatasetCommand(fx.project().getId(), null, "Products", "content { editor text sku { label \"SKU\" } }", null, null),
                fx.ctx());
        RecordDetail ada = record(fx, team, null, "{\"name\":\"Ada\"}").record();
        RecordDetail widget = record(fx, products, null, "{\"sku\":\"w\"}").record();

        RecordDetail bob = record(fx, team, null, "{\"name\":\"Bob\",\"mentor\":" + recordRef(ada) + "}").record();
        assertThat(bob.content().path("mentor").path("uuid").asText()).isEqualTo(ada.uuid().toString());
        assertThatThrownBy(() -> record(fx, team, null, "{\"name\":\"Cy\",\"mentor\":" + recordRef(widget) + "}"))
                .isInstanceOfSatisfying(SfException.class, ex -> {
                    assertThat(ex.getStatus()).isEqualTo(422);
                    assertThat(issuePaths(ex)).containsExactly("content.mentor");
                });
    }

    @Test
    void referencesAreMaterializedOnSave() throws Exception {
        Fixture fx = newFixture();
        DatasetView team = team(fx);
        AssetVersionView photo = mediaService.upload(
                fx.project().getId(), null, "ada.txt", "text/plain", "ada".getBytes(), fx.ctx());
        RecordDetail ada = record(fx, team, null,
                "{\"name\":\"Ada\",\"photo\":{\"type\":\"MEDIA_REF\",\"uuid\":\"" + photo.uuid() + "\"}}").record();

        assertThat(openRows(fx, ada.uuid()))
                .extracting(AssetReference::getKind, AssetReference::getToAssetId, AssetReference::getSourcePath)
                .containsExactlyInAnyOrder(
                        org.assertj.core.groups.Tuple.tuple(ReferenceKind.TEMPLATE, assetId(fx, team.uuid()), "datasetRef"),
                        org.assertj.core.groups.Tuple.tuple(ReferenceKind.MEDIA_REF, assetId(fx, photo.uuid()), "content.photo"));

        // Clearing the photo closes its row; the dataset edge stays.
        recordService.update(ada.uuid(), content("{\"name\":\"Ada\"}"), ada.revision(), fx.ctx());
        assertThat(openRows(fx, ada.uuid())).extracting(AssetReference::getKind).containsExactly(ReferenceKind.TEMPLATE);
    }

    @Test
    void aDatasetWithLiveRecordsCannotBeDeletedEvenForcibly() {
        Fixture fx = newFixture();
        DatasetView team = team(fx);
        RecordDetail ada = record(fx, team, null, "{\"name\":\"Ada\"}").record();
        RecordDetail bob = record(fx, team, null, "{\"name\":\"Bob\"}").record();

        assertThatThrownBy(() -> datasetService.delete(team.uuid(), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> {
                    assertThat(ex.getStatus()).isEqualTo(409);
                    assertThat(ex.getProblem().getExtensions()).containsEntry("code", "SF-DOM-0121")
                            .containsEntry("recordCount", 2L);
                });
        assertThatThrownBy(() -> assetService.softDelete(team.uuid(), true, fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(409));

        assetService.softDelete(ada.uuid(), false, fx.ctx());
        assetService.softDelete(bob.uuid(), false, fx.ctx());
        // M25: the now empty record set still holds the dataset.
        assertThatThrownBy(() -> datasetService.delete(team.uuid(), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getProblem().getExtensions())
                        .containsEntry("recordCount", 0L)
                        .containsEntry("setCount", 1L));
        recordSetService.delete(ada.recordSetUuid(), false, fx.ctx());
        datasetService.delete(team.uuid(), fx.ctx());
        assertThat(datasetService.list(fx.project().getId())).isEmpty();
    }

    @Test
    void aRecordIsNamedByItsTitleFieldElseItsUuidAndItsUidIsItsUuid() {
        Fixture fx = newFixture();
        DatasetView team = datasetService.create(
                new CreateDatasetCommand(fx.project().getId(), null, "Team", TEAM_CDL, "name", null), fx.ctx());

        RecordDetail jane = recordService.create(
                        new CreateRecordCommand(fx.project().getId(), set(fx, team), content("{\"name\":\"Jane Doe\"}")),
                        fx.ctx())
                .record();
        assertThat(jane.displayName()).isEqualTo("Jane Doe");
        assertThat(jane.uid()).isEqualTo(jane.uuid().toString().replace('-', '_'));

        RecordDetail renamed = recordService.update(
                        jane.uuid(), content("{\"name\":\"Jane Smith\"}"), jane.revision(), fx.ctx())
                .record();
        assertThat(renamed.displayName()).isEqualTo("Jane Smith");
        assertThat(renamed.uid()).isEqualTo(jane.uid());

        // No title value (and no dataset title editor at all): the uuid names it, and an update keeps that name.
        RecordDetail untitled = recordService.create(
                        new CreateRecordCommand(fx.project().getId(), set(fx, team), content("{}")), fx.ctx())
                .record();
        assertThat(untitled.displayName()).isEqualTo(untitled.uuid().toString());
        RecordDetail nameless = recordService.create(
                        new CreateRecordCommand(fx.project().getId(), set(fx, team(fx)), content("{\"name\":\"Ada\"}")),
                        fx.ctx())
                .record();
        assertThat(nameless.displayName()).isEqualTo(nameless.uuid().toString());
        assertThat(recordService.update(nameless.uuid(), content("{\"name\":\"Ada L.\"}"), nameless.revision(), fx.ctx())
                        .record()
                        .displayName())
                .isEqualTo(nameless.uuid().toString());

        // Neither can be changed by hand.
        assertThatThrownBy(() -> assetService.changeUid(jane.uuid(), "jane", fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> {
                    assertThat(ex.getStatus()).isEqualTo(422);
                    assertThat(ex.getProblem().getExtensions()).containsEntry("code", "SF-DOM-0105");
                });
    }

    @Test
    void recordsMoveBetweenSetsAndRestoreThroughTheGenericPaths() {
        Fixture fx = newFixture();
        DatasetView team = team(fx);
        AssetVersionView people = folderService.create(null, "People", FolderScope.CONTENT, fx.ctx());
        AssetVersionView leads = folderService.create(people.uuid(), "Leads", FolderScope.CONTENT, fx.ctx());
        RecordDetail ada = record(fx, team, people.uuid(), "{\"name\":\"Ada\"}").record();
        assertThat(ada.folderPath()).isEqualTo("/people/");

        UUID leadSet = set(fx, team, leads.uuid());
        assetService.move(ada.uuid(), leadSet, fx.ctx());
        assertThat(current(fx, ada).folderPath()).isEqualTo("/people/leads/");
        assertThat(current(fx, ada).folderUuid()).isEqualTo(leads.uuid());
        assertThat(current(fx, ada).recordSetUuid()).isEqualTo(leadSet);

        long live = current(fx, ada).revision();
        assetService.softDelete(ada.uuid(), false, fx.ctx());
        assetService.restore(ada.uuid(), live, fx.ctx());
        RecordDetail restored = current(fx, ada);
        assertThat(restored.deleted()).isFalse();
        assertThat(assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(assetId(fx, ada.uuid())).orElseThrow()
                        .getTemplateAssetId())
                .isEqualTo(assetId(fx, team.uuid()));
    }

    @Test
    void templateSaveChecksDatasetLoopFields() {
        Fixture fx = newFixture();
        team(fx);

        assertThatThrownBy(() -> sectionTemplate(fx, "$CMS_FOR(x : dataset:team, where=\"x.nope == 1\")$x$CMS_END_FOR$"))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(diagnosticCodes(ex))
                        .containsExactly(DiagnosticCodes.OCTL_DATASET_UNKNOWN_FIELD));
        assertThatThrownBy(() -> sectionTemplate(fx, "$CMS_FOR(x : dataset:nope)$x$CMS_END_FOR$"))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(diagnosticCodes(ex))
                        .containsExactly(DiagnosticCodes.OCTL_UNRESOLVABLE_REF));
        TemplateView ok = sectionTemplate(fx, "$CMS_FOR(x : dataset:team, where=\"x.role == 'lead'\", sort=\"-level\")$$CMS_VALUE(x.name)$$CMS_END_FOR$");
        assertThat(ok.uuid()).isNotNull();
    }

    @Test
    void datasetUsagesListLoopingTemplatesNotRecords() {
        Fixture fx = newFixture();
        DatasetView team = team(fx);
        RecordDetail ada = record(fx, team, null, "{\"name\":\"Ada\"}").record();
        TemplateView loop = sectionTemplate(fx, "$CMS_FOR(x : dataset:team)$$CMS_VALUE(x.name)$$CMS_END_FOR$");
        TemplateView single = sectionTemplate(fx, "$CMS_VALUE(record:" + ada.uid() + ".name)$");
        TemplateView pageTemplate = templateService.create(
                new CreateTemplateCommand(fx.project().getId(), AssetType.PAGE_TEMPLATE, "Profile",
                        "content { editor reference person { label \"Person\" dataset \"team\" } }",
                        Map.of("html", "$CMS_VALUE(person.name)$"), null, false, Map.of("html", "{displayNameSlug}.{ext}")),
                fx.ctx());
        AssetVersionView page = pageService.create(new CreatePageCommand("Profile", null, pageTemplate.uuid()), fx.ctx());
        ObjectNode pageContent = mapper.createObjectNode();
        pageContent.set("person", content(recordRef(ada)));
        ObjectNode payload = page.payload().deepCopy();
        payload.set("content", pageContent);
        pageService.update(page.uuid(), payload, page.validFromRevision(), fx.ctx());

        assertThat(assetService.usages(fx.project().getId(), team.uuid()))
                .extracting(u -> u.fromUuid())
                .containsExactly(loop.uuid());
        assertThat(assetService.usages(fx.project().getId(), ada.uuid()))
                .extracting(u -> u.fromUuid(), u -> u.kind())
                .containsExactlyInAnyOrder(
                        org.assertj.core.groups.Tuple.tuple(single.uuid(), ReferenceKind.OCTL_VALUE),
                        org.assertj.core.groups.Tuple.tuple(page.uuid(), ReferenceKind.CONTENT_REF));
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private DatasetView team(Fixture fx) {
        return datasetService.create(
                new CreateDatasetCommand(fx.project().getId(), null, "Team", TEAM_CDL, null, "People"), fx.ctx());
    }

    /** Creates a record in the record set of {@code dataset} in {@code folder} ({@code null}: the store root). */
    private RecordWriteResult record(Fixture fx, DatasetView dataset, UUID folder, String json) {
        JsonNode values = content(json);
        String name = values.path("name").asText(values.path("sku").asText("Record"));
        return recordService.create(
                new CreateRecordCommand(fx.project().getId(), set(fx, dataset, folder), values), fx.ctx());
    }

    private RecordSetFixtures sets() {
        return new RecordSetFixtures(recordSetService);
    }

    private UUID set(Fixture fx, DatasetView dataset) {
        return set(fx, dataset, null);
    }

    private UUID set(Fixture fx, DatasetView dataset, UUID folder) {
        return sets().setFor(fx.project().getId(), dataset.uuid(), folder, fx.ctx());
    }

    private TemplateView sectionTemplate(Fixture fx, String html) {
        return templateService.create(
                new CreateTemplateCommand(fx.project().getId(), AssetType.SECTION_TEMPLATE, "Section " + SEQ.incrementAndGet(),
                        "", Map.of("html", html), null, false, Map.of()),
                fx.ctx());
    }

    private RecordDetail current(Fixture fx, RecordDetail record) {
        return recordService.find(fx.project().getId(), record.uuid(), null).orElseThrow();
    }

    private static String recordRef(RecordDetail record) {
        return "{\"type\":\"ASSET_REF\",\"uuid\":\"" + record.uuid() + "\",\"assetType\":\"RECORD\"}";
    }

    private JsonNode content(String json) {
        try {
            return mapper.readTree(json);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private List<AssetReference> openRows(Fixture fx, UUID from) {
        return referenceRepository.findByFromAssetIdAndValidToRevisionIsNull(assetId(fx, from));
    }

    private AssetVersion currentFolder(Fixture fx, String uid) {
        Asset folder = assetRepository.findByProjectIdAndAssetTypeAndUid(fx.project().getId(), AssetType.FOLDER, uid)
                .orElseThrow();
        AssetVersion version = assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(folder.getId()).orElseThrow();
        version.setAsset(folder);
        return version;
    }

    /** Turns a fresh project into a pre-M19 one by removing a provisioned folder outright. */
    private void dropFolder(Fixture fx, String uid) {
        Asset folder = assetRepository.findByProjectIdAndAssetTypeAndUid(fx.project().getId(), AssetType.FOLDER, uid)
                .orElseThrow();
        assetVersionRepository.deleteAll(assetVersionRepository.findByAssetIdOrderByValidFromRevisionDesc(folder.getId()));
        assetRepository.delete(folder);
    }

    private long assetId(Fixture fx, UUID uuid) {
        return assetRepository.findByProjectIdAndUuid(fx.project().getId(), uuid).map(Asset::getId).orElseThrow();
    }

    private long revisionCount(Fixture fx) {
        return revisionRepository.findByProjectIdOrderByRevisionIdDesc(fx.project().getId()).size();
    }

    private List<UUID> touchedAssetUuids(Fixture fx, long revisionId) {
        Revision revision = revisionRepository.findByProjectIdAndRevisionId(fx.project().getId(), revisionId).orElseThrow();
        List<UUID> uuids = new ArrayList<>();
        revision.getSummary().path("assets").forEach(entry -> {
            if (!"PROJECT".equals(entry.path("type").asText())) {
                uuids.add(UUID.fromString(entry.path("uuid").asText()));
            }
        });
        return uuids;
    }

    @SuppressWarnings("unchecked")
    private static List<String> diagnosticCodes(SfException ex) {
        Object diagnostics = ex.getProblem().getExtensions().get("diagnostics");
        return ((List<Diagnostic>) diagnostics).stream()
                .filter(d -> d.severity() == com.acme.staticforge.template.diagnostic.Severity.ERROR)
                .map(Diagnostic::code)
                .toList();
    }

    @SuppressWarnings("unchecked")
    private static List<String> issuePaths(SfException ex) {
        return ((List<ContentIssue>) ex.getProblem().getExtensions().get("issues")).stream().map(ContentIssue::path).toList();
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(
                "dataset-user-" + n, "dataset-user-" + n + "@example.com", "Dataset User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("datasetp_" + n, "Dataset Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }
}
