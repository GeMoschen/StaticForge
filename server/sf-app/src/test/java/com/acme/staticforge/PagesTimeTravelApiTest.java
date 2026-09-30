package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.template.cdl.CdlSources;
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
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * M35.1 follow-up: the pages tree and the page list at {@code ?revision=R} (time travel) answer with what existed at
 * {@code R} — what was deleted since is in, what was created later is out — with names, uids, paths and release
 * status as of then.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PagesTimeTravelApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final String CDL = "content { editor text title { label \"Title\" } }";

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired UserService userService;
    @Autowired JwtService jwtService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired FolderService folderService;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;
    @Autowired ReleaseService releases;
    @Autowired RevisionRepository revisionRepository;

    @Test
    @DisplayName("the tree and the list at revision R show the folders and pages of R: later deletions in, renames and later creations out")
    void readsTheStateAtTheRevision() throws Exception {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create("pttr" + n, "pttr" + n + "@example.com", "Pages Travel " + n, "secret-password");
        Project project = projectService.create(new CreateProjectRequest("pttr" + n, "pttr" + n, null, null), user.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), user.getId(), "time travel");
        String token = "Bearer " + jwtService.issueAccessToken(user);
        String key = project.getKey();
        TemplateView template = templateService.create(
                new CreateTemplateCommand(project.getId(), AssetType.PAGE_TEMPLATE, "Page", CdlSources.split(CDL),
                        Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"), null, false, Map.of("html", "{folder}{uid}.{ext}")),
                ctx);
        UUID root = assetService.ensurePagesRootFolder(project.getId(), ctx).uuid();
        AssetVersionView docs = folderService.create(root, "Docs", null, ctx);
        AssetVersionView temp = folderService.create(root, "Temp", null, ctx);
        AssetVersionView alpha = page(ctx, template, docs.uuid(), "Alpha");
        AssetVersionView beta = page(ctx, template, docs.uuid(), "Beta");
        AssetVersionView gamma = page(ctx, template, temp.uuid(), "Gamma");
        releases.release(List.of(ReleaseItem.of(alpha.uuid())), ctx);
        long r1 = revisionRepository.findHeadRevisionId(project.getId()).orElseThrow();

        // After r1: rename and retitle a page, change its uid, rename a folder, delete a page and a whole folder,
        // create another page.
        ObjectNode edited = alpha.payload().deepCopy();
        edited.withObject("content").put("title", "changed");
        assetService.update(alpha.uuid(), new UpdateAssetCommand("Alpha renamed", edited), alpha.validFromRevision(), ctx);
        assetService.changeUid(alpha.uuid(), "alpha_new", ctx);
        folderService.update(docs.uuid(), "Docs renamed", docs.validFromRevision(), ctx);
        assetService.softDelete(beta.uuid(), true, ctx);
        folderService.delete(temp.uuid(), true, ctx);
        AssetVersionView delta = page(ctx, template, docs.uuid(), "Delta");

        // The current state: the folder tree and list know nothing of the past.
        assertThat(folderNames(read(token, "/api/v1/projects/" + key + "/folders?scope=PAGES&depth=10")))
                .containsExactly("All Pages", "Docs renamed");
        assertThat(pageNames(read(token, "/api/v1/projects/" + key + "/pages")))
                .containsExactlyInAnyOrder("Alpha renamed", "Delta");

        // At r1: the tree has both folders under their names then, the list all three pages under theirs.
        JsonNode tree = read(token, "/api/v1/projects/" + key + "/folders?scope=PAGES&depth=10&revision=" + r1);
        assertThat(folderNames(tree)).containsExactly("All Pages", "Docs", "Temp");
        assertThat(find(tree, temp.uuid()).path("uid").asText()).isEqualTo(temp.uid());
        assertThat(find(tree, temp.uuid()).path("revision").asLong()).isEqualTo(temp.validFromRevision());
        assertThat(find(tree, docs.uuid()).path("path").asText()).isEqualTo(docs.folderPath());

        JsonNode pages = read(token, "/api/v1/projects/" + key + "/pages?revision=" + r1);
        assertThat(pageNames(pages)).containsExactlyInAnyOrder("Alpha", "Beta", "Gamma");
        assertThat(pages.toString()).doesNotContain(delta.uuid().toString());
        JsonNode alphaThen = find(pages, alpha.uuid());
        assertThat(alphaThen.path("uid").asText()).as("the uid it had then").isEqualTo(alpha.uid()).isNotEqualTo("alpha_new");
        assertThat(alphaThen.path("folderPath").asText()).isEqualTo(alpha.folderPath());
        assertThat(alphaThen.path("revision").asLong()).isEqualTo(alpha.validFromRevision());
        assertThat(find(pages, gamma.uuid()).path("folderPath").asText()).isEqualTo(gamma.folderPath());

        // The release status is the one of r1: Alpha was published then, and is changed now.
        assertThat(releaseStatus(alphaThen)).isEqualTo("PUBLISHED");
        assertThat(releaseStatus(find(read(token, "/api/v1/projects/" + key + "/pages"), alpha.uuid()))).isEqualTo("CHANGED");
        assertThat(releaseStatus(find(pages, beta.uuid()))).isEqualTo("NEW");

        // The folder filter of the list works against the tree of that revision.
        assertThat(pageNames(read(token, "/api/v1/projects/" + key + "/pages?revision=" + r1 + "&folder=" + docs.uuid())))
                .containsExactlyInAnyOrder("Alpha", "Beta");

        // Before the first folder and page existed: the store's root only.
        assertThat(folderNames(read(token, "/api/v1/projects/" + key + "/folders?scope=PAGES&depth=10&revision=1")))
                .containsExactly("All Pages");
        assertThat(pageNames(read(token, "/api/v1/projects/" + key + "/pages?revision=1"))).isEmpty();
    }

    private AssetVersionView page(RevisionContext ctx, TemplateView template, UUID folder, String name) {
        return pageService.create(new CreatePageCommand(name, folder, template.uuid()), ctx);
    }

    private JsonNode read(String token, String url) throws Exception {
        String body = mvc.perform(get(url).header("Authorization", token))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        return mapper.readTree(body);
    }

    /** The display names of the tree in pre-order. */
    private static List<String> folderNames(JsonNode nodes) {
        List<String> names = new ArrayList<>();
        nodes.forEach(node -> {
            names.add(node.path("displayName").asText());
            names.addAll(folderNames(node.path("children")));
        });
        return names;
    }

    private static List<String> pageNames(JsonNode list) {
        List<String> names = new ArrayList<>();
        list.forEach(page -> names.add(page.path("displayName").asText()));
        return names;
    }

    /** The node (of a tree, recursively, or of a list) with {@code uuid}. */
    private static JsonNode find(JsonNode nodes, UUID uuid) {
        for (JsonNode node : nodes) {
            if (uuid.toString().equals(node.path("uuid").asText())) {
                return node;
            }
            JsonNode inChildren = find(node.path("children"), uuid);
            if (!inChildren.isMissingNode()) {
                return inChildren;
            }
        }
        return com.fasterxml.jackson.databind.node.MissingNode.getInstance();
    }

    /** The release status of the (single, language-less) key of a row. */
    private static String releaseStatus(JsonNode row) {
        return row.path("release").elements().next().path("status").asText();
    }
}
