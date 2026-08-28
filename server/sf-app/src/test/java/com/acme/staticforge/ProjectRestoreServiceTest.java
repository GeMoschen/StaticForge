package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.ProjectRestoreService;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * {@link ProjectRestoreService} tests (spec §7.6, `M15.2.2`): a project-wide rollback is a
 * single compound {@code RESTORE} revision touching every asset that changed between
 * {@code toRevision} and now, so its {@code summary.assets} must list every one of them —
 * fixing the bug where {@code restoreTo} allocated the revision but never called
 * {@code appendSummary}, leaving {@code summary.assets} always empty.
 */
@SpringBootTest
@ActiveProfiles("test")
class ProjectRestoreServiceTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired FolderService folderService;
    @Autowired AssetService assetService;
    @Autowired ProjectRestoreService projectRestoreService;
    @Autowired AssetVersionRepository assetVersionRepository;

    @Test
    void restoreSummaryListsEveryRestoredOrDeletedAsset() {
        Fixture fx = newFixture();

        AssetVersionView keep = folderService.create(null, "Keep", FolderScope.PAGES, fx.ctx());
        AssetVersionView toDelete = folderService.create(null, "ToDelete", FolderScope.PAGES, fx.ctx());
        long toRevision = toDelete.validFromRevision();

        // Diverge from toRevision: delete one folder, create a new one that didn't exist there.
        assetService.softDelete(toDelete.uuid(), false, fx.ctx());
        folderService.create(null, "CreatedAfter", FolderScope.PAGES, fx.ctx());

        // restoreTo rewrites every asset valid in either the current snapshot or the target
        // snapshot (a full bulk restore, not a diff) — M is that union's size, project-wide
        // (project creation's own bootstrap folders are included, not just this test's own).
        java.util.Set<Long> union = new java.util.HashSet<>(distinctAssetIds(assetVersionRepository.findCurrentByProject(fx.project().getId())));
        union.addAll(distinctAssetIds(assetVersionRepository.findValidAtRevisionByProject(fx.project().getId(), toRevision)));

        Revision restore = projectRestoreService.restoreTo(
                fx.project().getId(), toRevision, fx.user().getId(), "rollback");

        assertThat(restore.getChangeType().name()).isEqualTo("RESTORE");

        JsonNode assets = restore.getSummary().get("assets");
        assertThat(assets.isArray()).isTrue();
        assertThat(assets).hasSize(union.size());

        boolean sawRestore = false;
        boolean sawDelete = false;
        for (JsonNode entry : assets) {
            assertThat(entry.get("uuid").asText()).isNotBlank();
            assertThat(entry.get("type").asText()).isEqualTo("FOLDER");
            String action = entry.get("action").asText();
            assertThat(action).isIn("RESTORE", "DELETE");
            if (toDelete.uuid().toString().equals(entry.get("uuid").asText())) {
                assertThat(action).isEqualTo("RESTORE");
                sawRestore = true;
            }
            if (!sawDelete && "DELETE".equals(action)) {
                sawDelete = true;
            }
        }
        assertThat(sawRestore).isTrue();
        assertThat(sawDelete).isTrue();
        assertThat(keep).isNotNull();
    }

    private static java.util.Set<Long> distinctAssetIds(List<AssetVersion> versions) {
        java.util.Set<Long> ids = new java.util.HashSet<>();
        for (AssetVersion v : versions) {
            ids.add(v.getAssetId());
        }
        return ids;
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(
                "restore-user-" + n, "restore-user-" + n + "@example.com", "Restore User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("restorep_" + n, "Restore Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }
}
