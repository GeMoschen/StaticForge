package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.folder.FolderNode;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.common.JsonUtil;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.asset.template.UpdateTemplateCommand;
import com.acme.staticforge.exportimport.ExportSelection;
import com.acme.staticforge.exportimport.ImportOptions;
import com.acme.staticforge.exportimport.ProjectExportImportService;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * M13.1.1-M13.1.4 backend domain layer: the generic protected-folder primitive, the fixed
 * {@code TEMPLATES}-scope folder pair auto-provisioned per project, template create/move
 * wired to folders, and the lazy reparent of pre-M13 templates into those fixed folders.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class TemplateFolderIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired UserService userService;
    @Autowired JwtService jwtService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired FolderService folderService;
    @Autowired TemplateService templateService;
    @Autowired AssetRepository assetRepository;
    @Autowired AssetVersionRepository assetVersionRepository;
    @Autowired ProjectExportImportService exportImportService;
    @Autowired RevisionService revisionService;

    // ------------------------------------------------------------------
    // M13.1.1 — protected-folder primitive
    // ------------------------------------------------------------------

    @Test
    void protectedFolderCannotBeRenamedMovedOrDeleted() {
        Fixture fx = newFixture();
        AssetVersionView protectedFolder = createProtectedFolder(fx, "Protected");
        AssetVersionView otherFolder = folderService.create(null, "Other", FolderScope.PAGES, fx.ctx());

        assertThatThrownBy(() -> folderService.update(protectedFolder.uuid(), "Renamed", protectedFolder.validFromRevision(), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(422));

        assertThatThrownBy(() -> folderService.move(protectedFolder.uuid(), otherFolder.uuid(), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(422));

        assertThatThrownBy(() -> folderService.delete(protectedFolder.uuid(), true, fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(422));
    }

    @Test
    void movingAnOrdinaryFolderIntoAProtectedFolderIsFine() {
        Fixture fx = newFixture();
        AssetVersionView protectedFolder = createProtectedFolder(fx, "Protected");
        AssetVersionView movable = folderService.create(null, "Movable", FolderScope.PAGES, fx.ctx());

        // Moving INTO a protected folder mutates the moved folder, not the protected one.
        var result = folderService.move(movable.uuid(), protectedFolder.uuid(), fx.ctx());
        assertThat(result.touchedAssetCount()).isEqualTo(1);
    }

    @Test
    void childCreatedUnderAProtectedFolderIsNotItselfProtected() {
        Fixture fx = newFixture();
        AssetVersionView protectedFolder = createProtectedFolder(fx, "Protected");

        AssetVersionView child = folderService.create(protectedFolder.uuid(), "Child", FolderScope.PAGES, fx.ctx());
        assertThat(child.payload().path("protected").asBoolean(false)).isFalse();

        // The child, being ordinary, can itself be renamed/moved/deleted without issue.
        AssetVersionView renamed = folderService.update(child.uuid(), "Child Renamed", child.validFromRevision(), fx.ctx());
        assertThat(renamed.displayName()).isEqualTo("Child Renamed");
        folderService.delete(child.uuid(), false, fx.ctx());
    }

    @Test
    void ordinaryFoldersRegressionStillRenameMoveDelete() {
        Fixture fx = newFixture();
        AssetVersionView a = folderService.create(null, "A", FolderScope.PAGES, fx.ctx());
        AssetVersionView b = folderService.create(null, "B", FolderScope.PAGES, fx.ctx());

        AssetVersionView renamed = folderService.update(a.uuid(), "A Renamed", a.validFromRevision(), fx.ctx());
        assertThat(renamed.displayName()).isEqualTo("A Renamed");

        var moveResult = folderService.move(renamed.uuid(), b.uuid(), fx.ctx());
        assertThat(moveResult.touchedAssetCount()).isEqualTo(1);

        folderService.delete(renamed.uuid(), false, fx.ctx());
    }

    @Test
    void getFoldersEndpointIncludesProtectedFlagPerNode() throws Exception {
        Fixture fx = newFixture();

        mvc.perform(get("/api/v1/projects/" + fx.project().getKey() + "/folders")
                        .header("Authorization", "Bearer " + fx.token())
                        .param("scope", "TEMPLATES")
                        .param("depth", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].protectedFolder").value(true))
                .andExpect(jsonPath("$[0].children[0].protectedFolder").value(true))
                .andExpect(jsonPath("$[0].children[1].protectedFolder").value(true));
    }

    // ------------------------------------------------------------------
    // M13.1.2 — FolderScope.TEMPLATES + fixed-folder provisioning
    // ------------------------------------------------------------------

    @Test
    void newProjectHasBothFixedFoldersProtectedWithCorrectTemplateKind() {
        Fixture fx = newFixture();

        List<FolderNode> roots = folderService.tree(fx.project().getId(), FolderScope.TEMPLATES, -1, fx.ctx());
        assertThat(roots).hasSize(1);
        FolderNode wrapper = roots.get(0);
        assertThat(wrapper.uid()).isEqualTo(FolderScope.TEMPLATES_ROOT_UID);
        assertThat(wrapper.protectedFolder()).isTrue();
        assertThat(wrapper.children()).hasSize(2);
        assertThat(wrapper.children()).allMatch(FolderNode::protectedFolder);

        FolderNode pageFolder = wrapper.children().stream().filter(n -> n.uid().equals(FolderScope.PAGE_TEMPLATES_UID)).findFirst().orElseThrow();
        FolderNode sectionFolder = wrapper.children().stream().filter(n -> n.uid().equals(FolderScope.SECTION_TEMPLATES_UID)).findFirst().orElseThrow();

        assertThat(assetService.requireCurrent(fx.project().getId(), pageFolder.uuid()).payload().path("templateKind").asText())
                .isEqualTo("PAGE_TEMPLATE");
        assertThat(assetService.requireCurrent(fx.project().getId(), sectionFolder.uuid()).payload().path("templateKind").asText())
                .isEqualTo("SECTION_TEMPLATE");
    }

    @Test
    void templatesTreeAtDepthZeroAlwaysReturnsExactlyTheFixedWrapperWithNoChildrenExpanded() {
        Fixture fx = newFixture();
        folderService.create(fixedFolderUuid(fx, FolderScope.PAGE_TEMPLATES_UID), "Nested", null, fx.ctx());

        List<FolderNode> roots = folderService.tree(fx.project().getId(), FolderScope.TEMPLATES, 0, fx.ctx());
        assertThat(roots).hasSize(1);
        assertThat(roots.get(0).uid()).isEqualTo(FolderScope.TEMPLATES_ROOT_UID);
        assertThat(roots.get(0).children()).isEmpty();
    }

    @Test
    void creatingFolderAtTemplatesTopLevelIsRejected() {
        Fixture fx = newFixture();
        assertThatThrownBy(() -> folderService.create(null, "New Root", FolderScope.TEMPLATES, fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(422));
    }

    @Test
    void subfolderInheritsTemplateKindAndRejectsExplicitMismatch() {
        Fixture fx = newFixture();
        UUID pageTemplatesUuid = fixedFolderUuid(fx, FolderScope.PAGE_TEMPLATES_UID);

        AssetVersionView sub = folderService.create(pageTemplatesUuid, "Sub", null, fx.ctx());
        assertThat(sub.payload().path("templateKind").asText()).isEqualTo("PAGE_TEMPLATE");

        assertThatThrownBy(() -> folderService.create(pageTemplatesUuid, "BadSub", null, AssetType.SECTION_TEMPLATE, fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(422));
    }

    @Test
    void ensureTemplateFoldersIsIdempotent() {
        Fixture fx = newFixture();
        var first = assetService.ensureTemplateFolders(fx.project().getId(), fx.ctx());
        var second = assetService.ensureTemplateFolders(fx.project().getId(), fx.ctx());

        assertThat(first.get(AssetType.PAGE_TEMPLATE).uuid()).isEqualTo(second.get(AssetType.PAGE_TEMPLATE).uuid());
        assertThat(first.get(AssetType.SECTION_TEMPLATE).uuid()).isEqualTo(second.get(AssetType.SECTION_TEMPLATE).uuid());
        List<FolderNode> roots = folderService.tree(fx.project().getId(), FolderScope.TEMPLATES, -1, fx.ctx());
        assertThat(roots).hasSize(1);
        assertThat(roots.get(0).children()).hasSize(2);
    }

    // ------------------------------------------------------------------
    // M13.1.3 — template create/move wired to folders
    // ------------------------------------------------------------------

    @Test
    void creatingWithNoParentFolderUuidLandsUnderTheMatchingFixedFolder() {
        Fixture fx = newFixture();
        TemplateView view = createSectionTemplate(fx, "Teaser", null);
        UUID sectionTemplatesUuid = fixedFolderUuid(fx, FolderScope.SECTION_TEMPLATES_UID);
        assertThat(view.folderUuid()).isEqualTo(sectionTemplatesUuid);
    }

    @Test
    void creatingWithExplicitParentUnderCorrectKindSucceeds() {
        Fixture fx = newFixture();
        UUID sectionTemplatesUuid = fixedFolderUuid(fx, FolderScope.SECTION_TEMPLATES_UID);
        AssetVersionView sub = folderService.create(sectionTemplatesUuid, "Marketing", null, fx.ctx());

        TemplateView view = createSectionTemplate(fx, "Teaser", sub.uuid());
        assertThat(view.folderUuid()).isEqualTo(sub.uuid());
        assertThat(view.folderPath()).isEqualTo(sub.folderPath());
    }

    @Test
    void creatingUnderWrongKindSubtreeIsRejected() {
        Fixture fx = newFixture();
        UUID pageTemplatesUuid = fixedFolderUuid(fx, FolderScope.PAGE_TEMPLATES_UID);
        AssetVersionView subUnderPages = folderService.create(pageTemplatesUuid, "Wrong", null, fx.ctx());

        assertThatThrownBy(() -> createSectionTemplate(fx, "Teaser", subUnderPages.uuid()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(422));
    }

    @Test
    void creatingUnderAPagesFolderIsRejected() {
        Fixture fx = newFixture();
        AssetVersionView pagesFolder = folderService.create(null, "Docs", FolderScope.PAGES, fx.ctx());

        assertThatThrownBy(() -> createSectionTemplate(fx, "Teaser", pagesFolder.uuid()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(422));
    }

    @Test
    void moveTemplateBetweenFoldersUnderSameFixedRootSucceedsAndAcrossRootsRejected() throws Exception {
        Fixture fx = newFixture();
        UUID sectionTemplatesUuid = fixedFolderUuid(fx, FolderScope.SECTION_TEMPLATES_UID);
        UUID pageTemplatesUuid = fixedFolderUuid(fx, FolderScope.PAGE_TEMPLATES_UID);
        AssetVersionView folderA = folderService.create(sectionTemplatesUuid, "A", null, fx.ctx());
        AssetVersionView folderB = folderService.create(sectionTemplatesUuid, "B", null, fx.ctx());
        AssetVersionView pageSubfolder = folderService.create(pageTemplatesUuid, "PageSub", null, fx.ctx());

        TemplateView template = createSectionTemplate(fx, "Teaser", folderA.uuid());

        String moveBody = """
                {"folderUuid":"%s"}
                """.formatted(folderB.uuid());
        mvc.perform(post("/api/v1/projects/" + fx.project().getKey() + "/assets/" + template.uuid() + "/move")
                        .header("Authorization", "Bearer " + fx.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(moveBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.folderPath").value(folderB.folderPath()));

        String badMoveBody = """
                {"folderUuid":"%s"}
                """.formatted(pageSubfolder.uuid());
        mvc.perform(post("/api/v1/projects/" + fx.project().getKey() + "/assets/" + template.uuid() + "/move")
                        .header("Authorization", "Bearer " + fx.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(badMoveBody))
                .andExpect(status().is4xxClientError());
    }

    @Test
    void uidUniquenessStaysScopedToProjectAndTypeNotFolder() {
        Fixture fx = newFixture();
        UUID sectionTemplatesUuid = fixedFolderUuid(fx, FolderScope.SECTION_TEMPLATES_UID);
        AssetVersionView folderA = folderService.create(sectionTemplatesUuid, "A", null, fx.ctx());
        AssetVersionView folderB = folderService.create(sectionTemplatesUuid, "B", null, fx.ctx());

        TemplateView one = createSectionTemplate(fx, "Same Name", folderA.uuid());
        TemplateView two = createSectionTemplate(fx, "Same Name", folderB.uuid());

        // Different folders, same display name -> uid collision is still resolved with a
        // numeric suffix scoped to (project, assetType), exactly as before this milestone.
        assertThat(one.uid()).isNotEqualTo(two.uid());
        assertThat(two.uid()).startsWith(one.uid());
    }

    @Test
    void detailEndpointReturnsFolderUuidAndPath() throws Exception {
        Fixture fx = newFixture();
        TemplateView view = createSectionTemplate(fx, "Teaser", null);

        mvc.perform(get("/api/v1/projects/" + fx.project().getKey() + "/section-templates/" + view.uuid())
                        .header("Authorization", "Bearer " + fx.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.folderUuid").value(view.folderUuid().toString()))
                .andExpect(jsonPath("$.folderPath").value(view.folderPath()));
    }

    // ------------------------------------------------------------------
    // M13.1.4 — reparent pre-existing templates into the fixed folders
    // ------------------------------------------------------------------

    @Test
    void preExistingTemplatesAreReparentedOnFirstAccessExactlyOnce() {
        Fixture fx = newFixture();

        // Simulate a pre-M13 template sitting at the hidden root, bypassing TemplateService's
        // (now folder-aware) create path entirely, and with several revisions plus a channel edit.
        AssetVersionView legacy = createLegacyRootedSectionTemplate(fx, "Legacy Card");
        TemplateView updated = templateService.update(
                legacy.uuid(),
                new UpdateTemplateCommand(
                        "Legacy Card", "content { editor text headline {} }", Map.of("html", "<span>x</span>"), null, false, null),
                legacy.validFromRevision(),
                fx.ctx());
        TemplateView withChannel = templateService.saveChannel(
                legacy.uuid(), "markdown", "# static", updated.validFromRevision(), fx.ctx());
        long revisionBeforeMigration = withChannel.validFromRevision();
        int historyLengthBefore = assetService.history(fx.project().getId(), legacy.uuid()).size();

        // First relevant access (list) triggers the lazy migration.
        var page = templateService.list(fx.project().getId(), AssetType.SECTION_TEMPLATE, PageRequest.of(0, 50), fx.ctx());
        assertThat(page.getContent()).anyMatch(s -> s.uuid().equals(legacy.uuid()));

        AssetVersionView migrated = assetService.requireCurrent(fx.project().getId(), legacy.uuid());
        UUID sectionTemplatesUuid = fixedFolderUuid(fx, FolderScope.SECTION_TEMPLATES_UID);
        assertThat(migrated.folderId()).isEqualTo(assetRepository.findByProjectIdAndUuid(fx.project().getId(), sectionTemplatesUuid).orElseThrow().getId());
        assertThat(migrated.validFromRevision()).isGreaterThan(revisionBeforeMigration);

        // Content/channel data is untouched by the reparent — only folderId/folderPath changed.
        assertThat(migrated.payload().path("channelTemplates").has("markdown")).isTrue();
        assertThat(migrated.payload().path("contentDefinition").asText()).contains("headline");

        // Revision history is intact: one extra (MOVE) version, prior versions still queryable.
        assertThat(assetService.history(fx.project().getId(), legacy.uuid())).hasSize(historyLengthBefore + 1);

        // Second access is a no-op: no additional MOVE revision, folder unchanged.
        templateService.list(fx.project().getId(), AssetType.SECTION_TEMPLATE, PageRequest.of(0, 50), fx.ctx());
        AssetVersionView afterSecondPass = assetService.requireCurrent(fx.project().getId(), legacy.uuid());
        assertThat(afterSecondPass.validFromRevision()).isEqualTo(migrated.validFromRevision());
        assertThat(assetService.history(fx.project().getId(), legacy.uuid())).hasSize(historyLengthBefore + 1);
    }

    @Test
    void migrationIsNoOpForAProjectWithZeroTemplates() {
        Fixture fx = newFixture();
        var page = templateService.list(fx.project().getId(), AssetType.SECTION_TEMPLATE, PageRequest.of(0, 50), fx.ctx());
        assertThat(page.getContent()).isEmpty();
    }

    // ------------------------------------------------------------------
    // M13.4 — end-to-end integration: full lifecycle + export/import round trip
    // ------------------------------------------------------------------

    /**
     * Full lifecycle in one flow (feature `verification`, `M13.4`): create folders under both
     * fixed roots, create page/section templates in them, move a template within its own kind's
     * subtree (succeeds), attempt and confirm rejection of a cross-kind move, export the whole
     * {@code TEMPLATES} store, and import into a SECOND fresh project — asserting the two fixed
     * folders were resolved onto the target's own copies (not duplicated) and every folder /
     * template landed at the correct parent with the correct kind.
     */
    @Test
    void fullLifecycleCreateMoveExportImportIntoFreshProjectLandsCorrectly() {
        Fixture source = newFixture();
        UUID pageTemplatesUuid = fixedFolderUuid(source, FolderScope.PAGE_TEMPLATES_UID);
        UUID sectionTemplatesUuid = fixedFolderUuid(source, FolderScope.SECTION_TEMPLATES_UID);

        // Folders under both fixed roots.
        AssetVersionView pageSubA = folderService.create(pageTemplatesUuid, "Landing Pages", null, source.ctx());
        AssetVersionView pageSubB = folderService.create(pageTemplatesUuid, "Archived Pages", null, source.ctx());
        AssetVersionView sectionSub = folderService.create(sectionTemplatesUuid, "Marketing Sections", null, source.ctx());

        // Templates in them.
        TemplateView pageTemplate = createPageTemplate(source, "Landing", pageSubA.uuid());
        TemplateView sectionTemplate = createSectionTemplate(source, "Teaser", sectionSub.uuid());

        // Move within same kind's subtree: succeeds.
        var moveResult = folderService.move(pageSubA.uuid(), pageSubB.uuid(), source.ctx());
        assertThat(moveResult.touchedAssetCount()).isGreaterThanOrEqualTo(1);
        AssetVersionView movedTemplate = assetService.requireCurrent(source.project().getId(), pageTemplate.uuid());
        assertThat(movedTemplate.folderPath()).startsWith(pageSubB.folderPath());

        // Cross-kind move: rejected.
        assertThatThrownBy(() -> folderService.move(pageSubB.uuid(), sectionTemplatesUuid, source.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(422));

        // Export the whole TEMPLATES store.
        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(Set.of(), false, false, Set.of(FolderScope.TEMPLATES)));

        // Import into a SECOND, fresh project.
        Fixture target = newFixture();
        UUID targetPageTemplatesUuid = fixedFolderUuid(target, FolderScope.PAGE_TEMPLATES_UID);
        UUID targetSectionTemplatesUuid = fixedFolderUuid(target, FolderScope.SECTION_TEMPLATES_UID);
        exportImportService.importProject(target.project().getId(), archive, target.ctx(), ImportOptions.DEFAULT);

        // Exactly one of each fixed folder in the target — no duplicates.
        List<Asset> targetPageTemplateFolders = assetRepository.findAll().stream()
                .filter(a -> a.getProjectId() == target.project().getId()
                        && a.getAssetType() == AssetType.FOLDER
                        && FolderScope.PAGE_TEMPLATES_UID.equals(a.getUid()))
                .toList();
        List<Asset> targetSectionTemplateFolders = assetRepository.findAll().stream()
                .filter(a -> a.getProjectId() == target.project().getId()
                        && a.getAssetType() == AssetType.FOLDER
                        && FolderScope.SECTION_TEMPLATES_UID.equals(a.getUid()))
                .toList();
        assertThat(targetPageTemplateFolders).hasSize(1);
        assertThat(targetPageTemplateFolders.get(0).getUuid()).isEqualTo(targetPageTemplatesUuid);
        assertThat(targetSectionTemplateFolders).hasSize(1);
        assertThat(targetSectionTemplateFolders.get(0).getUuid()).isEqualTo(targetSectionTemplatesUuid);

        // Every folder/template landed at the correct parent, with the correct kind.
        Asset importedArchivedPages = assetRepository.findByProjectIdAndAssetTypeAndUid(
                        target.project().getId(), AssetType.FOLDER, pageSubB.uid())
                .orElseThrow();
        AssetVersionView importedArchivedPagesVersion = assetService.requireCurrent(target.project().getId(), importedArchivedPages.getUuid());
        assertThat(importedArchivedPagesVersion.folderId()).isEqualTo(
                assetRepository.findByProjectIdAndUuid(target.project().getId(), targetPageTemplatesUuid).orElseThrow().getId());
        assertThat(FolderScope.templateKindFromPayload(importedArchivedPagesVersion.payload())).isEqualTo(AssetType.PAGE_TEMPLATE);

        Asset importedSectionSub = assetRepository.findByProjectIdAndAssetTypeAndUid(
                        target.project().getId(), AssetType.FOLDER, sectionSub.uid())
                .orElseThrow();
        AssetVersionView importedSectionSubVersion = assetService.requireCurrent(target.project().getId(), importedSectionSub.getUuid());
        assertThat(importedSectionSubVersion.folderId()).isEqualTo(
                assetRepository.findByProjectIdAndUuid(target.project().getId(), targetSectionTemplatesUuid).orElseThrow().getId());

        // pageTemplate lives in pageSubA, which itself was moved to be a CHILD of pageSubB
        // ("Archived Pages") — so its direct folder is the imported copy of pageSubA, not
        // pageSubB itself.
        Asset importedPageSubA = assetRepository.findByProjectIdAndAssetTypeAndUid(
                        target.project().getId(), AssetType.FOLDER, pageSubA.uid())
                .orElseThrow();
        AssetVersionView importedPageSubAVersion = assetService.requireCurrent(target.project().getId(), importedPageSubA.getUuid());
        assertThat(importedPageSubAVersion.folderId()).isEqualTo(importedArchivedPages.getId());
        assertThat(FolderScope.templateKindFromPayload(importedPageSubAVersion.payload())).isEqualTo(AssetType.PAGE_TEMPLATE);

        Asset importedPageTemplate = assetRepository.findByProjectIdAndAssetTypeAndUid(
                        target.project().getId(), AssetType.PAGE_TEMPLATE, pageTemplate.uid())
                .orElseThrow();
        assertThat(assetService.requireCurrent(target.project().getId(), importedPageTemplate.getUuid()).folderId())
                .isEqualTo(importedPageSubA.getId());

        Asset importedSectionTemplate = assetRepository.findByProjectIdAndAssetTypeAndUid(
                        target.project().getId(), AssetType.SECTION_TEMPLATE, sectionTemplate.uid())
                .orElseThrow();
        assertThat(assetService.requireCurrent(target.project().getId(), importedSectionTemplate.getUuid()).folderId())
                .isEqualTo(importedSectionSub.getId());
    }

    // ------------------------------------------------------------------
    // M13.4 — migration fixture test: realistic pre-existing data
    // ------------------------------------------------------------------

    /**
     * The highest-value test in this milestone (feature `verification`, `M13.4`): seeds a
     * project the way it would have looked BEFORE M13 — several legacy, folder-less
     * (root-parented) templates, mixing PAGE_TEMPLATE and SECTION_TEMPLATE, one with multiple
     * revisions and a channel-template edit — then triggers the same lazy migration production
     * code triggers ({@code TemplateService.list}), and proves: correct fixed-folder placement by
     * kind, byte-identical prior revision content (only folder fields differ on the reparented
     * version), the channel-template history survives untouched, the reparent itself is a normal
     * {@code MOVE} revision matching {@code FolderServiceImpl.move}'s pattern, and a second
     * migration pass is a genuine no-op.
     */
    @Test
    void migrationOfRealisticPreExistingDataReparentsCorrectlyAndPreservesHistory() {
        Fixture fx = newFixture();

        // Multiple legacy (root-parented) templates, mixed kinds.
        AssetVersionView legacyPage1 = createLegacyRootedTemplate(fx, AssetType.PAGE_TEMPLATE, "Legacy Landing");
        AssetVersionView legacyPage2 = createLegacyRootedTemplate(fx, AssetType.PAGE_TEMPLATE, "Legacy Article");
        AssetVersionView legacySection1 = createLegacyRootedTemplate(fx, AssetType.SECTION_TEMPLATE, "Legacy Card");
        AssetVersionView legacySection2 = createLegacyRootedTemplate(fx, AssetType.SECTION_TEMPLATE, "Legacy Teaser");

        // legacySection1 gets multiple revisions before migration.
        TemplateView rev2 = templateService.update(
                legacySection1.uuid(),
                new UpdateTemplateCommand(
                        "Legacy Card", "content { editor text headline {} }", Map.of("html", "<span>v2</span>"), null, false, null),
                legacySection1.validFromRevision(),
                fx.ctx());
        TemplateView rev3 = templateService.update(
                rev2.uuid(),
                new UpdateTemplateCommand(
                        "Legacy Card v3", "content { editor text headline {} }", Map.of("html", "<span>v3</span>"), null, false, null),
                rev2.validFromRevision(),
                fx.ctx());
        // ...plus a channel-template edit.
        TemplateView withChannel = templateService.saveChannel(
                legacySection1.uuid(), "markdown", "# static card", rev3.validFromRevision(), fx.ctx());

        // Snapshot pre-migration state to compare against post-migration.
        List<AssetVersionView> historyBefore = assetService.history(fx.project().getId(), legacySection1.uuid());
        assertThat(historyBefore).hasSize(4); // create, update, update, saveChannel
        List<JsonNode> payloadsBefore = historyBefore.stream().map(AssetVersionView::payload).toList();
        List<Long> revisionsBefore = historyBefore.stream().map(AssetVersionView::validFromRevision).toList();
        long currentRevisionBeforeMigration = withChannel.validFromRevision();

        long revisionCountBefore = revisionService.findRecent(fx.project().getId(), PageRequest.of(0, 200)).size();

        // Trigger the lazy migration the same way production code does: TemplateService.list.
        templateService.list(fx.project().getId(), AssetType.PAGE_TEMPLATE, PageRequest.of(0, 50), fx.ctx());

        // ---- correct placement by kind ----
        UUID pageTemplatesUuid = fixedFolderUuid(fx, FolderScope.PAGE_TEMPLATES_UID);
        UUID sectionTemplatesUuid = fixedFolderUuid(fx, FolderScope.SECTION_TEMPLATES_UID);
        Long pageTemplatesFolderId = assetRepository.findByProjectIdAndUuid(fx.project().getId(), pageTemplatesUuid).orElseThrow().getId();
        Long sectionTemplatesFolderId = assetRepository.findByProjectIdAndUuid(fx.project().getId(), sectionTemplatesUuid).orElseThrow().getId();

        assertThat(assetService.requireCurrent(fx.project().getId(), legacyPage1.uuid()).folderId()).isEqualTo(pageTemplatesFolderId);
        assertThat(assetService.requireCurrent(fx.project().getId(), legacyPage2.uuid()).folderId()).isEqualTo(pageTemplatesFolderId);
        assertThat(assetService.requireCurrent(fx.project().getId(), legacySection1.uuid()).folderId()).isEqualTo(sectionTemplatesFolderId);
        assertThat(assetService.requireCurrent(fx.project().getId(), legacySection2.uuid()).folderId()).isEqualTo(sectionTemplatesFolderId);

        // ---- revision history intact: exactly one extra (MOVE) version ----
        List<AssetVersionView> historyAfter = assetService.history(fx.project().getId(), legacySection1.uuid());
        assertThat(historyAfter).hasSize(historyBefore.size() + 1);

        // Every PRIOR version's payload is byte-identical to before migration.
        // historyAfter is validFromRevision DESC; index 0 is the new MOVE version, the rest align
        // with historyBefore in the same order.
        for (int i = 0; i < historyBefore.size(); i++) {
            AssetVersionView afterEntry = historyAfter.get(i + 1);
            assertThat(afterEntry.validFromRevision()).isEqualTo(revisionsBefore.get(i));
            assertThat(afterEntry.payload()).isEqualTo(payloadsBefore.get(i));
        }

        // The new (current) version: folderId/folderPath changed, payload content unchanged from
        // the pre-migration current version (channel data + content definition intact).
        AssetVersionView migratedCurrent = historyAfter.get(0);
        assertThat(migratedCurrent.validFromRevision()).isGreaterThan(currentRevisionBeforeMigration);
        assertThat(migratedCurrent.folderId()).isEqualTo(sectionTemplatesFolderId);
        assertThat(migratedCurrent.payload().path("channelTemplates").path("markdown").path("source").asText())
                .isEqualTo("# static card");
        assertThat(migratedCurrent.payload().path("contentDefinition").asText()).contains("headline");
        // Only folderId/folderPath differ from the pre-migration current payload — everything else identical.
        assertThat(migratedCurrent.payload()).isEqualTo(withChannel.payload());

        // ---- the reparent is a normal MOVE revision, mirroring FolderServiceImpl.move ----
        Revision moveRevision = revisionService.find(fx.project().getId(), migratedCurrent.validFromRevision()).orElseThrow();
        assertThat(moveRevision.getChangeType()).isEqualTo(ChangeType.MOVE);
        assertThat(summaryTouchesWithAction(moveRevision, legacySection1.uuid(), "MOVE")).isTrue();
        assertThat(summaryTouchesWithAction(moveRevision, legacyPage1.uuid(), "MOVE")).isTrue();

        // All 4 legacy templates migrated in the SAME single revision (one MOVE revision for the batch).
        long distinctMigrationRevisions = List.of(legacyPage1, legacyPage2, legacySection1, legacySection2).stream()
                .map(v -> assetService.requireCurrent(fx.project().getId(), v.uuid()).validFromRevision())
                .distinct()
                .count();
        assertThat(distinctMigrationRevisions).isEqualTo(1);

        // ---- second migration pass is a genuine no-op ----
        long revisionCountAfterFirstMigration = revisionService.findRecent(fx.project().getId(), PageRequest.of(0, 500)).size();
        templateService.list(fx.project().getId(), AssetType.SECTION_TEMPLATE, PageRequest.of(0, 50), fx.ctx());
        long revisionCountAfterSecondPass = revisionService.findRecent(fx.project().getId(), PageRequest.of(0, 500)).size();
        assertThat(revisionCountAfterSecondPass).isEqualTo(revisionCountAfterFirstMigration);
        assertThat(revisionCountAfterFirstMigration).isGreaterThan(revisionCountBefore);

        AssetVersionView afterSecondPass = assetService.requireCurrent(fx.project().getId(), legacySection1.uuid());
        assertThat(afterSecondPass.validFromRevision()).isEqualTo(migratedCurrent.validFromRevision());
        assertThat(assetService.history(fx.project().getId(), legacySection1.uuid())).hasSize(historyBefore.size() + 1);
        // No duplicate MOVE entries for this asset across all revisions.
        long moveRevisionsTouchingLegacySection1 = revisionService.findRecent(fx.project().getId(), PageRequest.of(0, 500)).stream()
                .filter(r -> r.getChangeType() == ChangeType.MOVE)
                .filter(r -> summaryTouchesWithAction(r, legacySection1.uuid(), "MOVE"))
                .count();
        assertThat(moveRevisionsTouchingLegacySection1).isEqualTo(1);
    }

    /** Mirrors {@code RevisionFilterIntegrationTest.summaryTouches} but also checks the {@code
     * action} field, matching the {@code {"assets":[{"uuid":…,"action":…}]}} shape written by
     * {@link AssetChange#appendTo}. */
    private static boolean summaryTouchesWithAction(Revision r, UUID uuid, String action) {
        JsonNode summary = r.getSummary();
        if (summary == null || !summary.has("assets")) {
            return false;
        }
        for (JsonNode entry : summary.get("assets")) {
            if (entry.has("uuid") && uuid.toString().equals(entry.get("uuid").asText())
                    && action.equals(entry.path("action").asText())) {
                return true;
            }
        }
        return false;
    }

    // ------------------------------------------------------------------
    // Fixture helpers
    // ------------------------------------------------------------------

    private AssetVersionView createProtectedFolder(Fixture fx, String name) {
        ObjectNode payload = (ObjectNode) JsonUtil.parse("{}");
        payload.put("protected", true);
        return assetService.create(
                new CreateAssetCommand(fx.project().getId(), AssetType.FOLDER, name, null, payload, null), fx.ctx());
    }

    private UUID fixedFolderUuid(Fixture fx, String uid) {
        Asset asset = assetRepository.findByProjectIdAndAssetTypeAndUid(fx.project().getId(), AssetType.FOLDER, uid)
                .orElseThrow();
        return asset.getUuid();
    }

    private TemplateView createSectionTemplate(Fixture fx, String name, UUID parentFolderUuid) {
        return templateService.create(
                new CreateTemplateCommand(
                        fx.project().getId(),
                        AssetType.SECTION_TEMPLATE,
                        name,
                        "content { editor text headline {} }",
                        Map.of("html", "<h2>$CMS_VALUE(headline)$</h2>"),
                        null,
                        false,
                        null,
                        parentFolderUuid),
                fx.ctx());
    }

    private TemplateView createPageTemplate(Fixture fx, String name, UUID parentFolderUuid) {
        return templateService.create(
                new CreateTemplateCommand(
                        fx.project().getId(),
                        AssetType.PAGE_TEMPLATE,
                        name,
                        "content { editor text title {} }",
                        Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"),
                        null,
                        false,
                        null,
                        parentFolderUuid),
                fx.ctx());
    }

    /** Creates a SECTION_TEMPLATE asset directly through {@link AssetService}, bypassing
     * {@link TemplateService}'s folder resolution, to simulate a pre-M13 template still sitting
     * at the project's hidden root ({@code parentFolderUuid == null}). */
    private AssetVersionView createLegacyRootedSectionTemplate(Fixture fx, String name) {
        ObjectNode payload = MAPPER.createObjectNode();
        payload.put("contentDefinition", "content { editor text headline {} }");
        payload.putObject("channelTemplates");
        payload.put("category", "");
        payload.put("deprecated", false);
        return assetService.create(
                new CreateAssetCommand(fx.project().getId(), AssetType.SECTION_TEMPLATE, name, null, payload, null), fx.ctx());
    }

    /** Generalized form of {@link #createLegacyRootedSectionTemplate} for either template kind
     * (feature `verification`, `M13.4`) — used to seed a realistic pre-M13 fixture mixing
     * PAGE_TEMPLATE and SECTION_TEMPLATE, all folder-less (root-parented), bypassing {@link
     * TemplateService}'s folder resolution entirely. */
    private AssetVersionView createLegacyRootedTemplate(Fixture fx, AssetType kind, String name) {
        ObjectNode payload = MAPPER.createObjectNode();
        if (kind == AssetType.SECTION_TEMPLATE) {
            payload.put("contentDefinition", "content { editor text headline {} }");
            payload.putObject("channelTemplates");
            payload.put("category", "");
            payload.put("deprecated", false);
        } else {
            payload.put("contentDefinition", "content { editor text title {} }");
            payload.putObject("channelTemplates");
            payload.put("category", "");
            payload.putArray("bodies");
            payload.putObject("outputPath");
        }
        return assetService.create(
                new CreateAssetCommand(fx.project().getId(), kind, name, null, payload, null), fx.ctx());
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(
                "tplfolder-user-" + n, "tplfolder-user-" + n + "@example.com", "Tpl Folder User " + n, "secret-password");
        Project project = projectService.create(new CreateProjectRequest("tplfp_" + n, "Tpl Folder Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private final class Fixture {
        private final Project project;
        private final AppUser user;

        Fixture(Project project, AppUser user) {
            this.project = project;
            this.user = user;
        }

        Project project() {
            return project;
        }

        RevisionContext ctx() {
            return RevisionContext.of(project.getId(), user.getId(), "test");
        }

        String token() {
            return jwtService.issueAccessToken(user);
        }
    }
}
