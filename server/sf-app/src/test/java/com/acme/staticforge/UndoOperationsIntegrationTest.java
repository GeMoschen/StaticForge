package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.AssetUidHistoryRepository;
import com.acme.staticforge.asset.dataset.CreateDatasetCommand;
import com.acme.staticforge.asset.dataset.DatasetService;
import com.acme.staticforge.asset.dataset.DatasetView;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
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
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Map;
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
 * The undo paths of M35.13 that are not folder deletes: restoring a deleted page template, section template or dataset,
 * re-adding a deleted page section exactly as it was, and changing a uid back.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class UndoOperationsIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final String BASE_CDL = "content { editor text title { label \"Title\" required } }";
    private static final String BASE_HTML = "<h1>$CMS_VALUE(title)$</h1>$CMS_BLOCK(content)$base$CMS_END_BLOCK$";

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired UserService userService;
    @Autowired JwtService jwtService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired AssetUidHistoryRepository uidHistory;
    @Autowired RevisionRepository revisionRepository;
    @Autowired FolderService folderService;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;
    @Autowired DatasetService datasetService;

    // ------------------------------------------------------------------
    // B - templates and datasets
    // ------------------------------------------------------------------

    @Test
    void aDeletedPageTemplateComesBackExactlyAndItsEdgesReopen() throws Exception {
        Fixture fx = newFixture();
        UUID pageTemplates = assetService.ensureTemplateFolders(fx.id(), fx.ctx()).get(AssetType.PAGE_TEMPLATE).uuid();
        UUID layouts = folderService.create(pageTemplates, "Layouts", null, fx.ctx()).uuid();
        TemplateView base = pageTemplate(fx, "Base", BASE_CDL, BASE_HTML, null, true);
        TemplateView article = pageTemplate(
                fx, "Article", "", "$CMS_EXTENDS(page_template:" + base.uid() + ")$", layouts, false);
        long revisionsBefore = revisions(fx);

        mvc.perform(delete(url(fx, "page-templates", article.uuid())).header("Authorization", fx.token())).andExpect(status().isNoContent());
        assertThat(assetService.usages(fx.id(), base.uuid())).isEmpty();

        mvc.perform(post(url(fx, "page-templates", article.uuid()) + "/restore").header("Authorization", fx.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.uuid").value(article.uuid().toString()))
                .andExpect(jsonPath("$.revision").isNumber());

        assertThat(revisions(fx)).isEqualTo(revisionsBefore + 2);
        AssetVersionView now = assetService.requireCurrent(fx.id(), article.uuid());
        AssetVersionView original = assetService.findAt(fx.id(), article.uuid(), article.validFromRevision()).orElseThrow();
        assertThat(now.deleted()).isFalse();
        assertThat(now.payload()).isEqualTo(original.payload());
        assertThat(now.displayName()).isEqualTo(original.displayName());
        assertThat(now.folderPath()).isEqualTo(original.folderPath());
        assertThat(now.folderId()).isEqualTo(original.folderId());
        assertThat(assetService.usages(fx.id(), base.uuid()))
                .extracting(u -> u.fromUuid() + "/" + u.sourcePath())
                .containsExactly(article.uuid() + "/parentTemplateRef");
        // The restored template is the live one the project resolves again.
        assertThat(templateService.get(fx.id(), article.uuid()).ancestors()).extracting(TemplateView.TemplateRef::uuid)
                .containsExactly(base.uuid());
    }

    @Test
    void aTemplateWhoseParentOrFolderIsDeletedMustWaitForThem() throws Exception {
        Fixture fx = newFixture();
        UUID pageTemplates = assetService.ensureTemplateFolders(fx.id(), fx.ctx()).get(AssetType.PAGE_TEMPLATE).uuid();
        UUID layouts = folderService.create(pageTemplates, "Layouts", null, fx.ctx()).uuid();
        TemplateView base = pageTemplate(fx, "Base", BASE_CDL, BASE_HTML, null, true);
        TemplateView article = pageTemplate(
                fx, "Article", "", "$CMS_EXTENDS(page_template:" + base.uid() + ")$", layouts, false);
        TemplateView loose = pageTemplate(fx, "Loose", BASE_CDL, BASE_HTML, layouts, false);

        mvc.perform(delete(url(fx, "page-templates", article.uuid())).header("Authorization", fx.token())).andExpect(status().isNoContent());
        mvc.perform(delete(url(fx, "page-templates", base.uuid())).header("Authorization", fx.token())).andExpect(status().isNoContent());
        long revisions = revisions(fx);
        mvc.perform(post(url(fx, "page-templates", article.uuid()) + "/restore").header("Authorization", fx.token()))
                .andExpect(status().isConflict())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("SF-DOM-0112"));
        assertThat(revisions(fx)).isEqualTo(revisions);
        mvc.perform(post(url(fx, "page-templates", base.uuid()) + "/restore").header("Authorization", fx.token())).andExpect(status().isOk());
        mvc.perform(post(url(fx, "page-templates", article.uuid()) + "/restore").header("Authorization", fx.token())).andExpect(status().isOk());

        // A deleted folder blocks its template's restore until the folder is back.
        mvc.perform(delete(url(fx, "page-templates", loose.uuid())).header("Authorization", fx.token())).andExpect(status().isNoContent());
        folderService.delete(layouts, true, fx.ctx());
        mvc.perform(post(url(fx, "page-templates", loose.uuid()) + "/restore").header("Authorization", fx.token()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-DOM-0112"));
        mvc.perform(post("/api/v1/projects/" + fx.key() + "/folders/" + layouts + "/restore").header("Authorization", fx.token()))
                .andExpect(status().isOk());
        mvc.perform(post(url(fx, "page-templates", loose.uuid()) + "/restore").header("Authorization", fx.token()))
                .andExpect(status().isOk());

        // Not deleted: 409, and an editor may not undo what only a developer could do.
        mvc.perform(post(url(fx, "page-templates", loose.uuid()) + "/restore").header("Authorization", fx.token()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-DOM-0111"));
        AppUser editor = userService.create("uo-ed-" + fx.n(), "uo-ed-" + fx.n() + "@example.com", "Ed", "secret-password");
        projectService.setMemberRole(fx.key(), editor.getId(), ProjectRole.EDITOR, fx.ctx());
        mvc.perform(post(url(fx, "page-templates", loose.uuid()) + "/restore")
                        .header("Authorization", "Bearer " + jwtService.issueAccessToken(editor)))
                .andExpect(status().isForbidden());
        mvc.perform(post(url(fx, "page-templates", UUID.randomUUID()) + "/restore").header("Authorization", fx.token()))
                .andExpect(status().isNotFound());
    }

    @Test
    void aDeletedSectionTemplateAndDatasetComeBack() throws Exception {
        Fixture fx = newFixture();
        TemplateView card = templateService.create(
                new CreateTemplateCommand(
                        fx.id(), AssetType.SECTION_TEMPLATE, "Card", CdlSources.split("content { editor text title { } }"),
                        Map.of("html", "<p>$CMS_VALUE(title)$</p>"), null, false, null),
                fx.ctx());
        DatasetView team = datasetService.create(
                new CreateDatasetCommand(
                        fx.id(), null, "Team", CdlSources.split("content { editor text name { label \"Name\" } }"), null, null),
                fx.ctx());

        mvc.perform(delete(url(fx, "section-templates", card.uuid())).header("Authorization", fx.token())).andExpect(status().isNoContent());
        mvc.perform(delete(url(fx, "datasets", team.uuid())).header("Authorization", fx.token())).andExpect(status().isNoContent());
        assertThat(assetService.requireCurrent(fx.id(), card.uuid()).deleted()).isTrue();
        assertThat(assetService.requireCurrent(fx.id(), team.uuid()).deleted()).isTrue();

        mvc.perform(post(url(fx, "section-templates", card.uuid()) + "/restore").header("Authorization", fx.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.revision").isNumber());
        // The dataset's restore needs no body; an explicit fromRevision still works as before.
        mvc.perform(post(url(fx, "datasets", team.uuid()) + "/restore").header("Authorization", fx.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.uuid").value(team.uuid().toString()));
        assertThat(assetService.requireCurrent(fx.id(), card.uuid()).payload())
                .isEqualTo(assetService.findAt(fx.id(), card.uuid(), card.validFromRevision()).orElseThrow().payload());
        assertThat(assetService.requireCurrent(fx.id(), team.uuid()).deleted()).isFalse();

        mvc.perform(post(url(fx, "datasets", team.uuid()) + "/restore").header("Authorization", fx.token()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-DOM-0111"));
        mvc.perform(delete(url(fx, "datasets", team.uuid())).header("Authorization", fx.token())).andExpect(status().isNoContent());
        mvc.perform(post(url(fx, "datasets", team.uuid()) + "/restore")
                        .header("Authorization", fx.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fromRevision\":" + assetService.history(fx.id(), team.uuid()).get(1).validFromRevision() + "}"))
                .andExpect(status().isOk());
        assertThat(assetService.requireCurrent(fx.id(), team.uuid()).deleted()).isFalse();
    }

    // ------------------------------------------------------------------
    // C - section delete undo
    // ------------------------------------------------------------------

    @Test
    void aDeletedSectionIsReAddedWithItsIdContentAndPosition() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView section = assetService.create(
                new CreateAssetCommand(fx.id(), AssetType.SECTION_TEMPLATE, "Teaser", null, mapper.createObjectNode(), null),
                fx.ctx());
        ObjectNode templatePayload = mapper.createObjectNode();
        templatePayload.putArray("bodies").addObject().put("name", "main");
        AssetVersionView template = assetService.create(
                new CreateAssetCommand(fx.id(), AssetType.PAGE_TEMPLATE, "Layout", null, templatePayload, null), fx.ctx());
        AssetVersionView page = pageService.create(new CreatePageCommand("Home", null, template.uuid()), fx.ctx());
        for (int i = 0; i < 3; i++) {
            page = pageService.addSection(page.uuid(), "main", section.uuid().toString(), null, null, null, page.validFromRevision(), fx.ctx());
        }
        ObjectNode filled = page.payload().deepCopy();
        int[] index = {0};
        filled.withArray("/bodies/main").forEach(s -> ((ObjectNode) s).putObject("content").put("title", "Section " + index[0]++));
        page = pageService.update(page.uuid(), filled, page.validFromRevision(), fx.ctx());
        JsonNode before = page.payload().deepCopy();
        JsonNode middle = before.at("/bodies/main/1");
        long beforeDelete = page.validFromRevision();
        String pageUrl = url(fx, "pages", page.uuid());

        String deleted = mvc.perform(delete(pageUrl + "/bodies/main/sections/" + middle.path("instanceId").asText())
                        .header("Authorization", fx.token())
                        .header("If-Match", "\"rev-" + beforeDelete + "\""))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        long afterDelete = mapper.readTree(deleted).path("revision").asLong();

        // The undo: POST .../sections with the section's own templateUuid, position, instanceId and content.
        ObjectNode request = mapper.createObjectNode();
        request.put("templateUuid", middle.path("templateRef").asText());
        request.put("position", 1);
        request.put("instanceId", middle.path("instanceId").asText());
        request.set("content", middle.path("content"));
        mvc.perform(post(pageUrl + "/bodies/main/sections")
                        .header("Authorization", fx.token())
                        .header("If-Match", "\"rev-" + afterDelete + "\"")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(request)))
                .andExpect(status().isOk());

        AssetVersionView now = assetService.requireCurrent(fx.id(), page.uuid());
        assertThat(now.payload()).isEqualTo(before);
        // The versions in between stay as they were: the delete's version has two sections, the original three.
        assertThat(assetService.findAt(fx.id(), page.uuid(), beforeDelete).orElseThrow().payload()).isEqualTo(before);
        assertThat(assetService.findAt(fx.id(), page.uuid(), afterDelete).orElseThrow().payload().at("/bodies/main")).hasSize(2);

        // An instance id that is on the page already is refused.
        request.put("position", 0);
        mvc.perform(post(pageUrl + "/bodies/main/sections")
                        .header("Authorization", fx.token())
                        .header("If-Match", "\"rev-" + now.validFromRevision() + "\"")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(request)))
                .andExpect(status().isUnprocessableEntity());
    }

    // ------------------------------------------------------------------
    // D - uid change undo
    // ------------------------------------------------------------------

    @Test
    void aUidChangedBackRestoresTheOriginalUidAndKeepsEveryReference() throws Exception {
        Fixture fx = newFixture();
        TemplateView card = templateService.create(
                new CreateTemplateCommand(
                        fx.id(), AssetType.SECTION_TEMPLATE, "Card", CdlSources.split("content { editor text title { } }"),
                        Map.of("html", "<p>$CMS_VALUE(title)$</p>"), null, false, null),
                fx.ctx());
        TemplateView teaser = templateService.create(
                new CreateTemplateCommand(
                        fx.id(), AssetType.SECTION_TEMPLATE, "Teaser", CdlSources.split("content { editor text headline { } }"),
                        Map.of("html", "<div>$CMS_INCLUDE(section_template:card)$</div>"), null, false, null),
                fx.ctx());
        String originalUid = card.uid();
        long original = revisions(fx);
        assertThat(assetService.usages(fx.id(), card.uuid())).extracting(u -> u.fromUuid()).containsExactly(teaser.uuid());

        mvc.perform(patch(url(fx, "assets", card.uuid()) + "/uid")
                        .header("Authorization", fx.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"uid\":\"card_renamed\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.oldUid").value(originalUid))
                .andExpect(jsonPath("$.newUid").value("card_renamed"))
                .andExpect(jsonPath("$.affectedTemplates[0].assetUuid").value(teaser.uuid().toString()));
        long renamedAt = revisions(fx);

        // Undo: the same call with the old uid, the same result shape.
        mvc.perform(patch(url(fx, "assets", card.uuid()) + "/uid")
                        .header("Authorization", fx.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"uid\":\"" + originalUid + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.oldUid").value("card_renamed"))
                .andExpect(jsonPath("$.newUid").value(originalUid))
                .andExpect(jsonPath("$.affectedTemplates").isArray())
                .andExpect(jsonPath("$.affectedTemplates").isEmpty());

        assertThat(renamedAt).isEqualTo(original + 1);
        assertThat(revisions(fx)).isEqualTo(original + 2);
        assertThat(assetService.requireCurrent(fx.id(), card.uuid()).uid()).isEqualTo(originalUid);
        // References hold uuids: the include of the teaser still points at the card, under its original uid again.
        assertThat(assetService.usages(fx.id(), card.uuid())).extracting(u -> u.fromUuid()).containsExactly(teaser.uuid());
        // History: the uid at the first revision, in between and now.
        assertThat(uidHistory.uidsAt(fx.id(), original).values()).contains(originalUid);
        assertThat(uidHistory.uidsAt(fx.id(), renamedAt).values()).contains("card_renamed");
        assertThat(uidHistory.uidsAt(fx.id(), original + 2)).doesNotContainValue("card_renamed");

        // The uid freed by a change is free for others: once one took it, the way back is closed (422 SF-DOM-0101).
        mvc.perform(patch(url(fx, "assets", card.uuid()) + "/uid")
                        .header("Authorization", fx.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"uid\":\"card_two\"}"))
                .andExpect(status().isOk());
        templateService.create(
                new CreateTemplateCommand(
                        fx.id(), AssetType.SECTION_TEMPLATE, "Card", CdlSources.split(""), Map.of("html", "x"), null, false, null),
                fx.ctx());
        mvc.perform(patch(url(fx, "assets", card.uuid()) + "/uid")
                        .header("Authorization", fx.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"uid\":\"" + originalUid + "\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-DOM-0101"));
    }

    // ------------------------------------------------------------------

    private static org.springframework.test.web.servlet.result.ContentResultMatchers content() {
        return org.springframework.test.web.servlet.result.MockMvcResultMatchers.content();
    }

    private String url(Fixture fx, String collection, UUID uuid) {
        return "/api/v1/projects/" + fx.key() + "/" + collection + "/" + uuid;
    }

    private long revisions(Fixture fx) {
        return revisionRepository.findByProjectIdOrderByRevisionIdDesc(fx.id()).size();
    }

    private TemplateView pageTemplate(Fixture fx, String name, String cdl, String html, UUID folder, boolean abstractTemplate) {
        return templateService.create(
                new CreateTemplateCommand(
                        fx.id(), AssetType.PAGE_TEMPLATE, name, CdlSources.split(cdl), Map.of("html", html), null, false,
                        Map.of("html", "{displayNameSlug}.{ext}"), folder, abstractTemplate, null),
                fx.ctx());
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser admin = userService.create("uo-admin-" + n, "uo-admin-" + n + "@example.com", "Admin " + n, "secret-password");
        Project project = projectService.create(new CreateProjectRequest("uop_" + n, "Undo Ops " + n, null, null), admin.getId());
        return new Fixture(project, "Bearer " + jwtService.issueAccessToken(admin), admin, n);
    }

    private record Fixture(Project project, String token, AppUser admin, int n) {
        long id() {
            return project.getId();
        }

        String key() {
            return project.getKey();
        }

        RevisionContext ctx() {
            return RevisionContext.of(project.getId(), admin.getId(), "test");
        }
    }
}
