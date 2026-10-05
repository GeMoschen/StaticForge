package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.dataset.CreateDatasetCommand;
import com.acme.staticforge.asset.dataset.CreateRecordCommand;
import com.acme.staticforge.asset.dataset.DatasetService;
import com.acme.staticforge.asset.dataset.DatasetView;
import com.acme.staticforge.asset.dataset.RecordSetService;
import com.acme.staticforge.asset.dataset.RecordService;
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
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * {@code POST /assets/{uuid}/duplicate}: one endpoint copying pages, records, record sets, navigation items, media
 * files and global sets into their own or another folder, as unreleased drafts with a name unique in the target.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AssetDuplicateApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final String TEAM_CDL = "content { editor text name { label \"Name\" required } }";

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired UserService userService;
    @Autowired JwtService jwtService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired FolderService folderService;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;
    @Autowired DatasetService datasetService;
    @Autowired RecordService recordService;
    @Autowired RecordSetService recordSetService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired GlobalSetService globalSetService;
    @Autowired MediaService mediaService;

    @Test
    void aPageIsCopiedIntoItsFolderThenIntoAnotherFolderUnderAFreeName() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView folder = folderService.create(null, "Docs", FolderScope.PAGES, fx.ctx());
        AssetVersionView other = folderService.create(null, "Other", FolderScope.PAGES, fx.ctx());
        AssetVersionView page = page(fx, "Guide", folder.uuid());

        JsonNode first = duplicate(fx, fx.editorToken(), page.uuid(), null).andExpect(status().isCreated())
                .andExpect(header().exists(HttpHeaders.ETAG)).andReturn().getResponse().getContentAsString()
                .transform(this::read);
        assertThat(first.get("uuid").asText()).isNotEqualTo(page.uuid().toString());
        assertThat(first.get("type").asText()).isEqualTo("PAGE");
        assertThat(first.get("displayName").asText()).isEqualTo("Guide copy");
        assertThat(first.get("folderUuid").asText()).isEqualTo(folder.uuid().toString());
        assertThat(first.get("uid").asText()).isNotBlank();
        assertThat(assetService.requireCurrent(fx.id(), UUID.fromString(first.get("uuid").asText())).payload())
                .isEqualTo(page.payload());

        // The name is free within the target: a second copy in the same folder is numbered ...
        assertThat(body(duplicate(fx, fx.editorToken(), page.uuid(), "{}")).get("displayName").asText())
                .isEqualTo("Guide copy 2");
        // ... and in another folder the first free name is "copy" again; the body names the target.
        JsonNode moved = body(duplicate(fx, fx.editorToken(), page.uuid(), "{\"folderUuid\":\"" + other.uuid() + "\"}"));
        assertThat(moved.get("displayName").asText()).isEqualTo("Guide copy");
        assertThat(moved.get("folderUuid").asText()).isEqualTo(other.uuid().toString());
        // The original stays where it was.
        assertThat(assetService.requireCurrent(fx.id(), page.uuid()).validFromRevision())
                .isEqualTo(page.validFromRevision());
    }

    @Test
    void aRecordIsCopiedIntoAnotherSetOfTheSameDataset() throws Exception {
        Fixture fx = newFixture();
        DatasetView team = datasetService.create(
                new CreateDatasetCommand(fx.id(), null, "Team", CdlSources.split(TEAM_CDL), "name", null), fx.ctx());
        RecordSetFixtures sets = new RecordSetFixtures(recordSetService);
        UUID one = sets.create(fx.id(), team.uuid(), null, "One", fx.ctx()).uuid();
        UUID two = sets.create(fx.id(), team.uuid(), null, "Two", fx.ctx()).uuid();
        UUID ada = recordService.create(
                        new CreateRecordCommand(fx.id(), one, objectMapper.readTree("{\"name\":\"Ada\"}")), fx.ctx())
                .record().uuid();

        JsonNode inSame = body(duplicate(fx, fx.editorToken(), ada, null));
        assertThat(inSame.get("type").asText()).isEqualTo("RECORD");
        assertThat(inSame.get("displayName").asText()).isEqualTo("Ada copy");
        assertThat(inSame.get("folderUuid").asText()).isEqualTo(one.toString());

        JsonNode inOther = body(duplicate(fx, fx.editorToken(), ada, "{\"folderUuid\":\"" + two + "\"}"));
        assertThat(inOther.get("displayName").asText()).isEqualTo("Ada copy");
        assertThat(inOther.get("folderUuid").asText()).isEqualTo(two.toString());
        assertThat(recordSetService.find(fx.id(), two, null).orElseThrow().recordCount()).isEqualTo(1);

        // A folder is not a record's parent: the containment rules refuse, and nothing is written.
        AssetVersionView content = folderService.create(null, "Loose", FolderScope.CONTENT, fx.ctx());
        duplicate(fx, fx.editorToken(), ada, "{\"folderUuid\":\"" + content.uuid() + "\"}")
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    void aRecordSetKeepsItsDatasetAndQueryButNotItsRecords() throws Exception {
        Fixture fx = newFixture();
        DatasetView team = datasetService.create(
                new CreateDatasetCommand(fx.id(), null, "Team", CdlSources.split(TEAM_CDL), "name", null), fx.ctx());
        UUID set = new RecordSetFixtures(recordSetService).create(fx.id(), team.uuid(), null, "Everyone", fx.ctx()).uuid();
        recordService.create(new CreateRecordCommand(fx.id(), set, objectMapper.readTree("{\"name\":\"Ada\"}")), fx.ctx());
        AssetVersionView target = folderService.create(null, "Sets", FolderScope.CONTENT, fx.ctx());

        JsonNode copy = body(duplicate(fx, fx.editorToken(), set, "{\"folderUuid\":\"" + target.uuid() + "\"}"));
        assertThat(copy.get("type").asText()).isEqualTo("RECORD_SET");
        assertThat(copy.get("displayName").asText()).isEqualTo("Everyone copy");
        UUID copyUuid = UUID.fromString(copy.get("uuid").asText());
        var view = recordSetService.find(fx.id(), copyUuid, null).orElseThrow();
        assertThat(view.datasetUuid()).isEqualTo(team.uuid());
        assertThat(view.folderUuid()).isEqualTo(target.uuid());
        assertThat(view.recordCount()).isZero();
        assertThat(recordSetService.find(fx.id(), set, null).orElseThrow().recordCount()).isEqualTo(1);
    }

    @Test
    void aNavigationItemKeepsItsTargetAndLabel() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView nav = folderService.create(null, "Menu", FolderScope.NAVIGATION, fx.ctx());
        AssetVersionView page = page(fx, "Home", null);
        AssetVersionView item = pageReferenceService.create(
                new CreatePageReferenceCommand("Home link", nav.uuid(), PageReferenceTargetKind.PAGE, page.uuid(), "Start"),
                fx.ctx());

        JsonNode copy = body(duplicate(fx, fx.editorToken(), item.uuid(), null));
        assertThat(copy.get("type").asText()).isEqualTo("PAGE_REFERENCE");
        assertThat(copy.get("displayName").asText()).isEqualTo("Home link copy");
        assertThat(copy.get("folderUuid").asText()).isEqualTo(nav.uuid().toString());
        JsonNode payload = assetService.requireCurrent(fx.id(), UUID.fromString(copy.get("uuid").asText())).payload();
        assertThat(payload.path("target").path("assetUuid").asText()).isEqualTo(page.uuid().toString());
        assertThat(payload.path("label").asText()).isEqualTo("Start");
    }

    @Test
    void aMediaFileKeepsItsBinaryAndMetadataAsANewDraft() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView folder = folderService.create(null, "Images", FolderScope.MEDIA, fx.ctx());
        AssetVersionView media = mediaService.upload(
                fx.id(), folder.uuid(), "hero.png", null, "A hero", "Caption", png(), fx.ctx());

        JsonNode copy = body(duplicate(fx, fx.editorToken(), media.uuid(), null));
        UUID copyUuid = UUID.fromString(copy.get("uuid").asText());
        assertThat(copy.get("type").asText()).isEqualTo("MEDIA");
        assertThat(copy.get("displayName").asText()).isEqualTo("hero.png copy");
        assertThat(copy.get("folderUuid").asText()).isEqualTo(folder.uuid().toString());
        JsonNode payload = assetService.requireCurrent(fx.id(), copyUuid).payload();
        assertThat(payload).isEqualTo(media.payload());
        assertThat(payload.get("altText").asText()).isEqualTo("A hero");
        assertThat(payload.get("variants").size()).isPositive();

        // The binary and a variant are served for the copy.
        assertThat(mediaService.binary(fx.id(), copyUuid, null).bytes())
                .isEqualTo(mediaService.binary(fx.id(), media.uuid(), null).bytes());
        String variant = payload.get("variants").get(0).get("name").asText();
        assertThat(mediaService.binary(fx.id(), copyUuid, variant).bytes()).isNotEmpty();

        assertThat(body(duplicate(fx, fx.editorToken(), media.uuid(), null)).get("displayName").asText())
                .isEqualTo("hero.png copy 2");
        mvc.perform(get("/api/v1/projects/" + fx.project().getKey() + "/media/" + copyUuid)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + fx.editorToken()))
                .andExpect(status().isOk());
    }

    @Test
    void aGlobalSetIsCopiedWithItsSchemaAndValues() throws Exception {
        Fixture fx = newFixture();
        var site = globalSetService.create(
                new CreateGlobalSetCommand(fx.id(), null, "Site", CdlSources.split(TEAM_CDL)), fx.ctx());

        JsonNode copy = body(duplicate(fx, fx.editorToken(), site.uuid(), null));
        assertThat(copy.get("type").asText()).isEqualTo("GLOBAL_SET");
        assertThat(copy.get("displayName").asText()).isEqualTo("Site copy");
        assertThat(globalSetService.find(fx.id(), UUID.fromString(copy.get("uuid").asText()), null)).isPresent();
    }

    @Test
    void foldersViewersAndUnknownAssetsAreRefusedWithoutWriting() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView folder = folderService.create(null, "Docs", FolderScope.PAGES, fx.ctx());
        AssetVersionView page = page(fx, "Guide", folder.uuid());
        AssetVersionView gone = page(fx, "Gone", folder.uuid());
        assetService.softDelete(gone.uuid(), true, fx.ctx());

        duplicate(fx, fx.editorToken(), folder.uuid(), null).andExpect(status().isUnprocessableEntity());
        duplicate(fx, fx.viewerToken(), page.uuid(), null).andExpect(status().isForbidden());
        duplicate(fx, fx.editorToken(), UUID.randomUUID(), null).andExpect(status().isNotFound());
        duplicate(fx, fx.editorToken(), gone.uuid(), null).andExpect(status().isNotFound());
        duplicate(fx, fx.editorToken(), page.uuid(), "{\"folderUuid\":\"" + UUID.randomUUID() + "\"}")
                .andExpect(status().isNotFound());
        // A target the type may not live in is refused by the containment rules.
        AssetVersionView media = folderService.create(null, "Images", FolderScope.MEDIA, fx.ctx());
        duplicate(fx, fx.editorToken(), page.uuid(), "{\"folderUuid\":\"" + media.uuid() + "\"}")
                .andExpect(status().isUnprocessableEntity());

        // Only the original (and the deleted one) exist: no half-written copy anywhere.
        assertThat(pageService.list(fx.id(), new com.acme.staticforge.asset.page.PageQuery(null, null, null, null)))
                .extracting(AssetVersionView::displayName)
                .containsExactly("Guide");
    }

    private ResultActions duplicate(Fixture fx, String token, UUID uuid, String json) throws Exception {
        var request = post("/api/v1/projects/" + fx.project().getKey() + "/assets/" + uuid + "/duplicate")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token);
        if (json != null) {
            request = request.contentType(MediaType.APPLICATION_JSON).content(json);
        }
        return mvc.perform(request);
    }

    private JsonNode body(ResultActions result) throws Exception {
        return read(result.andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
    }

    private JsonNode read(String json) {
        try {
            return objectMapper.readTree(json);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private AssetVersionView page(Fixture fx, String name, UUID folder) {
        TemplateView template = templateService.create(
                new CreateTemplateCommand(
                        fx.id(),
                        AssetType.PAGE_TEMPLATE,
                        name + " Template " + SEQ.incrementAndGet(),
                        CdlSources.split("content { editor text title { required } }"),
                        Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"),
                        null,
                        false,
                        null),
                fx.ctx());
        return pageService.create(new CreatePageCommand(name, folder, template.uuid()), fx.ctx());
    }

    private static byte[] png() throws Exception {
        BufferedImage image = new BufferedImage(800, 600, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        g.setColor(new Color((int) (System.nanoTime() & 0xFFFFFF)));
        g.fillRect(0, 0, 800, 600);
        g.dispose();
        image.setRGB(0, 0, SEQ.incrementAndGet());
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(image, "png", out);
        return out.toByteArray();
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser admin = userService.create(
                "dupapi-admin-" + n, "dupapi-admin-" + n + "@example.com", "Dup Api Admin " + n, "secret-password");
        Project project = projectService.create(new CreateProjectRequest("dupapip_" + n, "Dup Api Project " + n, null, null), admin.getId());
        AppUser viewer = userService.create(
                "dupapi-viewer-" + n, "dupapi-viewer-" + n + "@example.com", "Dup Api Viewer " + n, "secret-password");
        projectService.setMemberRole(project.getKey(), viewer.getId(), ProjectRole.VIEWER,
                RevisionContext.of(project.getId(), admin.getId(), "test"));
        return new Fixture(project, admin, viewer);
    }

    private final class Fixture {
        private final Project project;
        private final AppUser admin;
        private final AppUser viewer;

        Fixture(Project project, AppUser admin, AppUser viewer) {
            this.project = project;
            this.admin = admin;
            this.viewer = viewer;
        }

        Project project() {
            return project;
        }

        long id() {
            return project.getId();
        }

        RevisionContext ctx() {
            return RevisionContext.of(project.getId(), admin.getId(), "test");
        }

        String editorToken() {
            return jwtService.issueAccessToken(admin);
        }

        String viewerToken() {
            return jwtService.issueAccessToken(viewer);
        }
    }
}
