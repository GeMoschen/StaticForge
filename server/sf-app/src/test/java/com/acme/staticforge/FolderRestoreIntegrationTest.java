package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.dataset.CreateDatasetCommand;
import com.acme.staticforge.asset.dataset.CreateRecordCommand;
import com.acme.staticforge.asset.dataset.DatasetService;
import com.acme.staticforge.asset.dataset.DatasetView;
import com.acme.staticforge.asset.dataset.RecordService;
import com.acme.staticforge.asset.dataset.RecordSetService;
import com.acme.staticforge.asset.dataset.RecordSetView;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * {@code POST /folders/{uuid}/restore} (M35.13): undoing a folder delete brings the folder and everything the same
 * delete revision tombstoned back — in one new revision, under the parent's current path, or not at all.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class FolderRestoreIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired MockMvc mvc;
    @Autowired UserService userService;
    @Autowired JwtService jwtService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired AssetRepository assetRepository;
    @Autowired AssetVersionRepository assetVersionRepository;
    @Autowired RevisionRepository revisionRepository;
    @Autowired FolderService folderService;
    @Autowired PageService pageService;
    @Autowired DatasetService datasetService;
    @Autowired RecordService recordService;
    @Autowired RecordSetService recordSetService;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void aDeepSubtreeComesBackInOneRevisionWithItsPaths() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView a = folder(fx, null, "A", FolderScope.PAGES);
        AssetVersionView b = folder(fx, a.uuid(), "B", FolderScope.PAGES);
        AssetVersionView c = folder(fx, b.uuid(), "C", FolderScope.PAGES);
        UUID template = pageTemplate(fx);
        AssetVersionView pa = page(fx, "Pa", a.uuid(), template);
        AssetVersionView pb = page(fx, "Pb", b.uuid(), template);
        AssetVersionView pc = page(fx, "Pc", c.uuid(), template);
        AssetVersionView earlier = page(fx, "Earlier", b.uuid(), template);
        assetService.softDelete(earlier.uuid(), false, fx.ctx());

        folderService.delete(a.uuid(), true, fx.ctx());
        long revisionsBefore = revisions(fx);

        mvc.perform(restore(fx, a.uuid()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.uuid").value(a.uuid().toString()))
                .andExpect(jsonPath("$.uid").value(a.uid()))
                .andExpect(jsonPath("$.path").value(a.folderPath()));

        assertThat(revisions(fx)).isEqualTo(revisionsBefore + 1);
        long newRevision = assetService.requireCurrent(fx.id(), a.uuid()).validFromRevision();
        for (AssetVersionView original : List.of(a, b, c, pa, pb, pc)) {
            AssetVersionView now = assetService.requireCurrent(fx.id(), original.uuid());
            assertThat(now.deleted()).as(original.displayName()).isFalse();
            assertThat(now.validFromRevision()).as(original.displayName()).isEqualTo(newRevision);
            assertThat(now.folderPath()).as(original.displayName()).isEqualTo(original.folderPath());
            assertThat(now.folderId()).as(original.displayName()).isEqualTo(original.folderId());
            assertThat(now.payload()).as(original.displayName()).isEqualTo(original.payload());
        }
        // Deleted on its own before the folder: not part of that delete, stays deleted.
        assertThat(assetService.requireCurrent(fx.id(), earlier.uuid()).deleted()).isTrue();
        // The tombstones stay in the history; the restore is a new version after them.
        assertThat(assetService.history(fx.id(), pc.uuid())).extracting(AssetVersionView::deleted)
                .containsExactly(false, true, false);
    }

    @Test
    void anEmptyFolderAndAllTheOtherStoresRestoreToo() throws Exception {
        Fixture fx = newFixture();
        // Templates: a folder of page templates with a template in it.
        UUID pageTemplates = assetService.ensureTemplateFolders(fx.id(), fx.ctx()).get(AssetType.PAGE_TEMPLATE).uuid();
        AssetVersionView layouts = folder(fx, pageTemplates, "Layouts", null);
        ObjectNode payload = mapper.createObjectNode();
        payload.putArray("bodies").addObject().put("name", "main");
        AssetVersionView layout = assetService.create(
                new CreateAssetCommand(fx.id(), AssetType.PAGE_TEMPLATE, "Hero Layout", layouts.uuid(), payload, null),
                fx.ctx());
        // Navigation: a folder with a page reference in it.
        AssetVersionView nav = folder(fx, null, "Menu", FolderScope.NAVIGATION);
        AssetVersionView target = page(fx, "Target", null, pageTemplate(fx));
        ObjectNode referencePayload = mapper.createObjectNode();
        referencePayload.putObject("target").put("kind", "PAGE").put("assetUuid", target.uuid().toString());
        AssetVersionView reference = assetService.create(
                new CreateAssetCommand(fx.id(), AssetType.PAGE_REFERENCE, "Target Link", nav.uuid(), referencePayload, null),
                fx.ctx());
        // Media store, empty folder.
        AssetVersionView media = folder(fx, null, "Images", FolderScope.MEDIA);

        folderService.delete(layouts.uuid(), true, fx.ctx());
        folderService.delete(nav.uuid(), true, fx.ctx());
        folderService.delete(media.uuid(), false, fx.ctx());
        assertThat(assetService.requireCurrent(fx.id(), layout.uuid()).deleted()).isTrue();

        mvc.perform(restore(fx, layouts.uuid())).andExpect(status().isOk());
        mvc.perform(restore(fx, nav.uuid())).andExpect(status().isOk());
        mvc.perform(restore(fx, media.uuid()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.scope").value("MEDIA"));

        AssetVersionView layoutNow = assetService.requireCurrent(fx.id(), layout.uuid());
        assertThat(layoutNow.deleted()).isFalse();
        assertThat(layoutNow.folderPath()).isEqualTo(layout.folderPath());
        AssetVersionView referenceNow = assetService.requireCurrent(fx.id(), reference.uuid());
        assertThat(referenceNow.deleted()).isFalse();
        // The reference edge to its target is open again.
        assertThat(assetService.usages(fx.id(), target.uuid())).extracting(u -> u.fromUuid()).contains(reference.uuid());
    }

    @Test
    void recordSetsComeBackWithTheirRecordsExceptThoseDeletedBefore() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView staff = folder(fx, null, "Staff", FolderScope.CONTENT);
        AssetVersionView inner = folder(fx, staff.uuid(), "Inner", FolderScope.CONTENT);
        DatasetView team = datasetService.create(
                new CreateDatasetCommand(
                        fx.id(), null, "Team", CdlSources.split("content { editor text name { label \"Name\" required } }"),
                        null, null),
                fx.ctx());
        RecordSetView set = new RecordSetFixtures(recordSetService).create(fx.id(), team.uuid(), inner.uuid(), "Members", fx.ctx());
        UUID ada = recordService.create(new CreateRecordCommand(fx.id(), set.uuid(), name("Ada")), fx.ctx()).record().uuid();
        UUID bob = recordService.create(new CreateRecordCommand(fx.id(), set.uuid(), name("Bob")), fx.ctx()).record().uuid();
        UUID gone = recordService.create(new CreateRecordCommand(fx.id(), set.uuid(), name("Gone")), fx.ctx()).record().uuid();
        assetService.softDelete(gone, false, fx.ctx());
        String setPath = assetService.requireCurrent(fx.id(), set.uuid()).folderPath();

        folderService.delete(staff.uuid(), true, fx.ctx());
        assertThat(assetService.requireCurrent(fx.id(), ada).deleted()).isTrue();
        long revisionsBefore = revisions(fx);

        mvc.perform(restore(fx, staff.uuid())).andExpect(status().isOk());

        assertThat(revisions(fx)).isEqualTo(revisionsBefore + 1);
        assertThat(assetService.requireCurrent(fx.id(), inner.uuid()).deleted()).isFalse();
        AssetVersionView setNow = assetService.requireCurrent(fx.id(), set.uuid());
        assertThat(setNow.deleted()).isFalse();
        assertThat(setNow.folderPath()).isEqualTo(setPath);
        for (UUID record : List.of(ada, bob)) {
            AssetVersionView now = assetService.requireCurrent(fx.id(), record);
            assertThat(now.deleted()).isFalse();
            assertThat(now.folderPath()).isEqualTo(setPath);
            assertThat(now.validFromRevision()).isEqualTo(setNow.validFromRevision());
        }
        assertThat(assetService.requireCurrent(fx.id(), gone).deleted()).isTrue();
        assertThat(recordSetService.find(fx.id(), set.uuid(), null)).isPresent();
    }

    @Test
    void aDeletedParentIsAConflictAndNothingIsWritten() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView parent = folder(fx, null, "Parent", FolderScope.PAGES);
        AssetVersionView child = folder(fx, parent.uuid(), "Child", FolderScope.PAGES);
        AssetVersionView grandchildPage = page(fx, "Deep", child.uuid(), pageTemplate(fx));
        folderService.delete(child.uuid(), true, fx.ctx());
        folderService.delete(parent.uuid(), true, fx.ctx());
        long revisionsBefore = revisions(fx);

        mvc.perform(restore(fx, child.uuid()))
                .andExpect(status().isConflict())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("SF-DOM-0112"))
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("parent folder has been deleted")));

        assertThat(revisions(fx)).isEqualTo(revisionsBefore);
        assertThat(assetService.requireCurrent(fx.id(), child.uuid()).deleted()).isTrue();

        // The parent's own restore takes only what the parent's delete took: the child was deleted by an earlier one.
        mvc.perform(restore(fx, parent.uuid())).andExpect(status().isOk());
        assertThat(assetService.requireCurrent(fx.id(), parent.uuid()).deleted()).isFalse();
        assertThat(assetService.requireCurrent(fx.id(), child.uuid()).deleted()).isTrue();
        // ...and now the child can follow.
        mvc.perform(restore(fx, child.uuid())).andExpect(status().isOk());
        assertThat(assetService.requireCurrent(fx.id(), grandchildPage.uuid()).deleted()).isFalse();
    }

    @Test
    void aParentMovedInTheMeantimeGivesTheSubtreeItsNewPath() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView parent = folder(fx, null, "Parent", FolderScope.PAGES);
        AssetVersionView elsewhere = folder(fx, null, "Elsewhere", FolderScope.PAGES);
        AssetVersionView child = folder(fx, parent.uuid(), "Child", FolderScope.PAGES);
        AssetVersionView page = page(fx, "Inside", child.uuid(), pageTemplate(fx));
        folderService.delete(child.uuid(), true, fx.ctx());
        folderService.move(parent.uuid(), elsewhere.uuid(), fx.ctx());
        String parentPath = assetService.requireCurrent(fx.id(), parent.uuid()).folderPath();

        mvc.perform(restore(fx, child.uuid()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.path").value(parentPath + child.uid() + "/"));

        assertThat(assetService.requireCurrent(fx.id(), page.uuid()).folderPath()).isEqualTo(parentPath + child.uid() + "/");
        assertThat(assetService.requireCurrent(fx.id(), page.uuid()).deleted()).isFalse();
    }

    @Test
    void aLiveFolderAtTheSamePathIsAConflict() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView a = folder(fx, null, "Alpha", FolderScope.PAGES);
        AssetVersionView page = page(fx, "Inside", a.uuid(), pageTemplate(fx));
        AssetVersionView other = folder(fx, null, "Beta", FolderScope.PAGES);
        folderService.delete(a.uuid(), true, fx.ctx());
        // A uid is never reused through the API, so squat the path by hand.
        AssetVersion squatter = assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(
                assetRepository.findByProjectIdAndUuid(fx.id(), other.uuid()).orElseThrow().getId()).orElseThrow();
        squatter.setFolderPath(a.folderPath());
        assetVersionRepository.save(squatter);
        long revisionsBefore = revisions(fx);

        mvc.perform(restore(fx, a.uuid()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-DOM-0113"));

        assertThat(revisions(fx)).isEqualTo(revisionsBefore);
        assertThat(assetService.requireCurrent(fx.id(), a.uuid()).deleted()).isTrue();
        assertThat(assetService.requireCurrent(fx.id(), page.uuid()).deleted()).isTrue();
    }

    @Test
    void notDeletedUnknownAndForbidden() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView live = folder(fx, null, "Live", FolderScope.PAGES);

        mvc.perform(restore(fx, live.uuid()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-DOM-0111"));
        mvc.perform(restore(fx, UUID.randomUUID())).andExpect(status().isNotFound());

        folderService.delete(live.uuid(), false, fx.ctx());
        AppUser viewer = userService.create(
                "fr-viewer-" + fx.n(), "fr-viewer-" + fx.n() + "@example.com", "Viewer", "secret-password");
        projectService.setMemberRole(fx.project().getKey(), viewer.getId(), ProjectRole.VIEWER, fx.ctx());
        mvc.perform(post("/api/v1/projects/" + fx.project().getKey() + "/folders/" + live.uuid() + "/restore")
                        .header("Authorization", "Bearer " + jwtService.issueAccessToken(viewer)))
                .andExpect(status().isForbidden());
        assertThat(assetService.requireCurrent(fx.id(), live.uuid()).deleted()).isTrue();
    }

    // ------------------------------------------------------------------

    private org.springframework.test.web.servlet.RequestBuilder restore(Fixture fx, UUID folder) {
        return post("/api/v1/projects/" + fx.project().getKey() + "/folders/" + folder + "/restore")
                .header("Authorization", "Bearer " + jwtService.issueAccessToken(fx.admin()));
    }

    private static org.springframework.test.web.servlet.result.ContentResultMatchers content() {
        return org.springframework.test.web.servlet.result.MockMvcResultMatchers.content();
    }

    private long revisions(Fixture fx) {
        return revisionRepository.findByProjectIdOrderByRevisionIdDesc(fx.id()).size();
    }

    private AssetVersionView folder(Fixture fx, UUID parent, String name, FolderScope scope) {
        return folderService.create(parent, name, scope, fx.ctx());
    }

    private UUID pageTemplate(Fixture fx) {
        ObjectNode payload = mapper.createObjectNode();
        payload.putArray("bodies").addObject().put("name", "main");
        return assetService.create(
                        new CreateAssetCommand(fx.id(), AssetType.PAGE_TEMPLATE, "Layout " + SEQ.incrementAndGet(), null, payload, null),
                        fx.ctx())
                .uuid();
    }

    private AssetVersionView page(Fixture fx, String name, UUID folder, UUID template) {
        return pageService.create(new CreatePageCommand(name, folder, template), fx.ctx());
    }

    private ObjectNode name(String value) {
        return mapper.createObjectNode().put("name", value);
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser admin = userService.create("fr-admin-" + n, "fr-admin-" + n + "@example.com", "Admin " + n, "secret-password");
        Project project = projectService.create(new CreateProjectRequest("frp_" + n, "Folder Restore " + n, null, null), admin.getId());
        return new Fixture(project, admin, n);
    }

    private record Fixture(Project project, AppUser admin, int n) {
        long id() {
            return project.getId();
        }

        RevisionContext ctx() {
            return RevisionContext.of(project.getId(), admin.getId(), "test");
        }
    }
}
