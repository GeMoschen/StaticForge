package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.folder.FolderNode;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * {@code PAGES}/{@code MEDIA} now get the exact same fixed, protected wrapper-root treatment as
 * {@code NAVIGATION}/{@code TEMPLATES} (see {@code AssetServiceImpl#ensurePagesRootFolder}/
 * {@code #ensureMediaRootFolder}): no page or media asset is ever a direct, ambiguous child of
 * the project's shared hidden root any more — every one of them nests under its own store's
 * fixed "All Pages"/"All Media" root, mirroring {@code NavigationDomainIntegrationTest}'s own
 * coverage of that pattern for {@code NAVIGATION}.
 */
@SpringBootTest
@ActiveProfiles("test")
class PagesMediaRootFolderIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired FolderService folderService;
    @Autowired AssetService assetService;

    @Test
    void pagesStoreProvisionsExactlyTheFixedRootOnProjectCreate() {
        Fixture fx = newFixture();

        List<FolderNode> tree = folderService.tree(fx.project().getId(), FolderScope.PAGES, -1, fx.ctx());

        assertThat(tree).hasSize(1);
        assertThat(tree.get(0).uid()).isEqualTo(FolderScope.PAGES_ROOT_UID);
        assertThat(tree.get(0).protectedFolder()).isTrue();
        assertThat(tree.get(0).children()).isEmpty();
    }

    @Test
    void mediaStoreProvisionsExactlyTheFixedRootOnProjectCreate() {
        Fixture fx = newFixture();

        List<FolderNode> tree = folderService.tree(fx.project().getId(), FolderScope.MEDIA, -1, fx.ctx());

        assertThat(tree).hasSize(1);
        assertThat(tree.get(0).uid()).isEqualTo(FolderScope.MEDIA_ROOT_UID);
        assertThat(tree.get(0).protectedFolder()).isTrue();
        assertThat(tree.get(0).children()).isEmpty();
    }

    @Test
    void topLevelPageFolderNestsUnderTheFixedPagesRoot() {
        Fixture fx = newFixture();

        AssetVersionView created = folderService.create(null, "Docs", FolderScope.PAGES, fx.ctx());

        List<FolderNode> tree = folderService.tree(fx.project().getId(), FolderScope.PAGES, -1, fx.ctx());
        assertThat(tree).hasSize(1);
        FolderNode root = tree.get(0);
        assertThat(root.uid()).isEqualTo(FolderScope.PAGES_ROOT_UID);
        assertThat(root.children()).hasSize(1);
        assertThat(root.children().get(0).uuid()).isEqualTo(created.uuid());
        assertThat(root.children().get(0).scope()).isEqualTo(FolderScope.PAGES);
    }

    @Test
    void looseTopLevelPageNestsDirectlyUnderTheFixedPagesRootRatherThanTheProjectHiddenRoot() {
        Fixture fx = newFixture();

        AssetVersionView page = assetService.create(
                new CreateAssetCommand(fx.project().getId(), AssetType.PAGE, "Home", null, MAPPER.createObjectNode(), null),
                fx.ctx());

        assertThat(page.folderPath()).isEqualTo("/pages_root/");
    }

    @Test
    void looseTopLevelMediaNestsDirectlyUnderTheFixedMediaRootRatherThanTheProjectHiddenRoot() {
        Fixture fx = newFixture();

        AssetVersionView media = assetService.create(
                new CreateAssetCommand(fx.project().getId(), AssetType.MEDIA, "pic", null, MAPPER.createObjectNode(), null),
                fx.ctx());

        assertThat(media.folderPath()).isEqualTo("/media_root/");
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(
                "pm-user-" + n, "pm-user-" + n + "@example.com", "Pages Media User " + n, "secret-password");
        Project project =
                projectService.create(new CreateProjectRequest("pmp_" + n, "Pages Media Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }
}
