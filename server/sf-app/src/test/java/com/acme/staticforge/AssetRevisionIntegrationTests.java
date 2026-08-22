package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.folder.MoveResult;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.LongStream;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Revision-safety integration tests for the asset/folder core (spec §7.4, §7.5). Verifies
 * the version-interval write algorithm (close + insert), gapless revision ids, and the
 * optimistic-concurrency 409 on a stale {@code expectedRevision}.
 */
@SpringBootTest
@ActiveProfiles("test")
class AssetRevisionIntegrationTests {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired FolderService folderService;
    @Autowired RevisionRepository revisionRepository;
    @Autowired AssetRepository assetRepository;
    @Autowired AssetVersionRepository assetVersionRepository;

    @Test
    void createThenUpdateClosesPriorVersionAndAllocatesGaplessRevisions() {
        Fixture fx = newFixture();

        AssetVersionView created = folderService.create(null, "Products", FolderScope.PAGES, fx.ctx());
        long firstRevision = created.validFromRevision();

        AssetVersionView updated = folderService.update(created.uuid(), "Products Revised", firstRevision, fx.ctx());

        AssetVersionView atFirst = assetService.findAt(created.uuid(), firstRevision).orElseThrow();
        AssetVersionView atCurrent = assetService.requireCurrent(created.uuid());

        assertThat(atFirst.displayName()).isEqualTo("Products");
        assertThat(atCurrent.displayName()).isEqualTo("Products Revised");
        assertThat(atCurrent.validFromRevision()).isEqualTo(updated.validFromRevision());
        assertThat(atCurrent.validFromRevision()).isNotEqualTo(atFirst.validFromRevision());

        List<Revision> revisions = revisionRepository.findByProjectIdOrderByRevisionIdDesc(fx.project().getId());
        long maxRevision = revisions.stream().mapToLong(Revision::getRevisionId).max().orElseThrow();
        List<Long> ids = revisions.stream().map(Revision::getRevisionId).sorted().toList();
        assertThat(ids).isEqualTo(LongStream.rangeClosed(1, maxRevision).boxed().toList());
    }

    @Test
    void staleExpectedRevisionThrows409Conflict() {
        Fixture fx = newFixture();

        AssetVersionView created = folderService.create(null, "A", FolderScope.PAGES, fx.ctx());
        long originalRevision = created.validFromRevision();

        folderService.update(created.uuid(), "A Updated", originalRevision, fx.ctx());

        assertThatThrownBy(() -> folderService.update(created.uuid(), "A Stale", originalRevision, fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(409));
    }

    @Test
    void conflictDocumentCarriesBothVersionPayloads() {
        Fixture fx = newFixture();
        ObjectMapper mapper = new ObjectMapper();

        AssetVersionView created = folderService.create(null, "A", FolderScope.PAGES, fx.ctx());
        long originalRevision = created.validFromRevision();

        ObjectNode theirs = mapper.createObjectNode().put("v", 1);
        assetService.update(created.uuid(), new UpdateAssetCommand("A", theirs), originalRevision, fx.ctx());

        ObjectNode ours = mapper.createObjectNode().put("v", 2);
        assertThatThrownBy(() -> assetService.update(created.uuid(), new UpdateAssetCommand("A", ours), originalRevision, fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> {
                    assertThat(ex.getStatus()).isEqualTo(409);
                    Map<String, Object> extensions = ex.getProblem().getExtensions();
                    assertThat(extensions.get("code")).isEqualTo("SF-API-0409");
                    assertThat(extensions.get("expectedRevision")).isEqualTo(originalRevision);
                    assertThat(extensions.get("base")).isInstanceOf(JsonNode.class).isNotNull();
                    assertThat(extensions.get("theirs")).isInstanceOf(JsonNode.class).isNotNull();

                    JsonNode base = (JsonNode) extensions.get("base");
                    JsonNode current = (JsonNode) extensions.get("theirs");
                    assertThat(base.has("v")).isFalse();      // state the client loaded (empty folder payload)
                    assertThat(current.get("v").asInt()).isEqualTo(1);
                });
    }

    @Test
    void subtreeMoveRewritesDescendantPathsInOneRevision() {
        Fixture fx = newFixture();

        AssetVersionView parent = folderService.create(null, "Products", FolderScope.PAGES, fx.ctx());
        AssetVersionView child = folderService.create(parent.uuid(), "Tools", null, fx.ctx());

        long before = revisionRepository.findByProjectIdOrderByRevisionIdDesc(fx.project().getId()).stream()
                .mapToLong(Revision::getRevisionId).max().orElseThrow();

        MoveResult result = folderService.move(child.uuid(), null, fx.ctx());

        assertThat(result.touchedAssetCount()).isEqualTo(1);
        assertThat(result.revision()).isEqualTo(before + 1);

        AssetVersionView moved = assetService.requireCurrent(child.uuid());
        assertThat(moved.folderPath()).isEqualTo("/tools/");
    }

    @Test
    void changeUidUpdatesIdentityAndRecordsHistory() {
        Fixture fx = newFixture();

        AssetVersionView created = folderService.create(null, "About", FolderScope.PAGES, fx.ctx());
        assetService.changeUid(created.uuid(), "about_us", fx.ctx());

        AssetVersionView current = assetService.requireCurrent(created.uuid());
        assertThat(current.uid()).isEqualTo("about_us");
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create("rev-user-" + n, "rev-user-" + n + "@example.com", "Rev User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("revp_" + n, "Revision Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }
}
