package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
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
 * The pages tree and the page list at a revision cost a fixed number of reads, whatever the project's size: the same
 * shape with four times the folders and pages (some of them deleted since, some released) runs exactly as many
 * queries. Statements are counted on the test's thread only ({@link ThreadStatementCounter}).
 */
@SpringBootTest(properties =
        "spring.jpa.properties.hibernate.session_factory.statement_inspector=com.acme.staticforge.ThreadStatementCounter")
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PagesTimeTravelQueryCountIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final String CDL = "content { editor text title { label \"Title\" } }";

    @Autowired MockMvc mvc;
    @Autowired UserService userService;
    @Autowired JwtService jwtService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired FolderService folderService;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;
    @Autowired ReleaseService releases;
    @Autowired RevisionRepository revisionRepository;

    private record Site(String key, String token, long revision) {}

    /** {@code folders} folders with {@code perFolder} pages each; every other page released, then a third deleted. */
    private Site site(int folders, int perFolder) {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create("ptqc" + n, "ptqc" + n + "@example.com", "Travel Queries " + n, "secret-password");
        Project project = projectService.create(new CreateProjectRequest("ptqc" + n, "ptqc" + n, null, null), user.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), user.getId(), "travel queries");
        TemplateView template = templateService.create(
                new CreateTemplateCommand(project.getId(), AssetType.PAGE_TEMPLATE, "Page", CdlSources.split(CDL),
                        Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"), null, false, Map.of("html", "{folder}{uid}.{ext}")),
                ctx);
        UUID root = assetService.ensurePagesRootFolder(project.getId(), ctx).uuid();
        List<ReleaseItem> toRelease = new ArrayList<>();
        List<UUID> toDelete = new ArrayList<>();
        for (int f = 0; f < folders; f++) {
            UUID folder = folderService.create(root, "f" + f, null, ctx).uuid();
            for (int p = 0; p < perFolder; p++) {
                AssetVersionView page = pageService.create(new CreatePageCommand("p" + f + "_" + p, folder, template.uuid()), ctx);
                if (p % 2 == 0) {
                    toRelease.add(ReleaseItem.of(page.uuid()));
                }
                if (p % 3 == 0) {
                    toDelete.add(page.uuid());
                }
            }
        }
        releases.release(toRelease, ctx);
        long revision = revisionRepository.findHeadRevisionId(project.getId()).orElseThrow();
        toDelete.forEach(uuid -> assetService.softDelete(uuid, true, ctx));
        return new Site(project.getKey(), "Bearer " + jwtService.issueAccessToken(user), revision);
    }

    @Test
    @DisplayName("the tree and the list at a revision run the same reads for a project four times the size")
    void readsDoNotGrowWithTheProject() {
        Site warmUp = site(2, 4);
        read(warmUp);
        Site small = site(3, 6);
        Site large = site(12, 6);

        ThreadStatementCounter.Counts smallTree = count(small, "/folders?scope=PAGES&depth=10&revision=" + small.revision());
        ThreadStatementCounter.Counts largeTree = count(large, "/folders?scope=PAGES&depth=10&revision=" + large.revision());
        assertThat(smallTree.selects()).as("the inspector counts").isPositive();
        assertThat(largeTree.selects()).as("tree reads").isEqualTo(smallTree.selects());

        ThreadStatementCounter.Counts smallList = count(small, "/pages?revision=" + small.revision());
        ThreadStatementCounter.Counts largeList = count(large, "/pages?revision=" + large.revision());
        assertThat(largeList.selects()).as("list reads").isEqualTo(smallList.selects());
        assertThat(largeTree.inserts() + largeTree.other() + largeList.inserts() + largeList.other()).as("writes").isZero();
    }

    /** The statements of one read of {@code path}, after an unmeasured one of the same project warmed its caches. */
    private ThreadStatementCounter.Counts count(Site site, String path) {
        fetch(site, path);
        return ThreadStatementCounter.during(() -> fetch(site, path));
    }

    private void read(Site site) {
        fetch(site, "/folders?scope=PAGES&depth=10&revision=" + site.revision());
        fetch(site, "/pages?revision=" + site.revision());
    }

    private void fetch(Site site, String path) {
        try {
            mvc.perform(get("/api/v1/projects/" + site.key() + path).header("Authorization", site.token()))
                    .andExpect(status().isOk());
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
