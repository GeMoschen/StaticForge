package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.reference.ReferenceMaterializer;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.test.context.ActiveProfiles;

/**
 * A folder restore is all or nothing (M35.13): when writing one of the subtree's versions fails half way, the
 * transaction rolls back — no new revision, no half-restored subtree, the tombstones are still the current versions.
 */
@SpringBootTest
@ActiveProfiles("test")
class FolderRestoreAtomicityIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired RevisionRepository revisionRepository;
    @Autowired FolderService folderService;
    @Autowired PageService pageService;
    @SpyBean ReferenceMaterializer referenceMaterializer;

    @Test
    void aFailureHalfWayRollsTheWholeRestoreBack() {
        int n = SEQ.incrementAndGet();
        AppUser admin = userService.create("fra-" + n, "fra-" + n + "@example.com", "Admin", "secret-password");
        Project project = projectService.create(new CreateProjectRequest("frap_" + n, "Atomic " + n, null, null), admin.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), admin.getId(), "test");

        ObjectNode payload = new ObjectMapper().createObjectNode();
        payload.putArray("bodies").addObject().put("name", "main");
        AssetVersionView template = assetService.create(
                new CreateAssetCommand(project.getId(), AssetType.PAGE_TEMPLATE, "Layout", null, payload, null), ctx);
        AssetVersionView folder = folderService.create(null, "Doomed", FolderScope.PAGES, ctx);
        AssetVersionView sub = folderService.create(folder.uuid(), "Sub", FolderScope.PAGES, ctx);
        List<AssetVersionView> assets = List.of(
                folder,
                sub,
                pageService.create(new CreatePageCommand("One", folder.uuid(), template.uuid()), ctx),
                pageService.create(new CreatePageCommand("Two", sub.uuid(), template.uuid()), ctx));
        folderService.delete(folder.uuid(), true, ctx);
        long revisions = revisionRepository.findByProjectIdOrderByRevisionIdDesc(project.getId()).size();
        List<Integer> versionCounts = assets.stream()
                .map(a -> assetService.history(project.getId(), a.uuid()).size())
                .toList();

        // The third version the restore writes fails.
        AtomicInteger calls = new AtomicInteger();
        Mockito.doAnswer(invocation -> {
                    if (calls.incrementAndGet() == 3) {
                        throw new IllegalStateException("boom");
                    }
                    return invocation.callRealMethod();
                })
                .when(referenceMaterializer)
                .materialize(Mockito.any(), Mockito.any());
        try {
            assertThatThrownBy(() -> folderService.restore(folder.uuid(), ctx)).hasMessageContaining("boom");
        } finally {
            Mockito.reset(referenceMaterializer);
        }
        assertThat(calls.get()).isEqualTo(3);

        assertThat(revisionRepository.findByProjectIdOrderByRevisionIdDesc(project.getId())).hasSize((int) revisions);
        for (int i = 0; i < assets.size(); i++) {
            assertThat(assetService.requireCurrent(project.getId(), assets.get(i).uuid()).deleted()).isTrue();
            assertThat(assetService.history(project.getId(), assets.get(i).uuid())).hasSize(versionCounts.get(i));
        }

        // And the same restore succeeds once nothing fails.
        folderService.restore(folder.uuid(), ctx);
        assertThat(assetService.requireCurrent(project.getId(), assets.get(3).uuid()).deleted()).isFalse();
    }
}
