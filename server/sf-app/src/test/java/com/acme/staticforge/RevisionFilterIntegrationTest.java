package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.test.context.ActiveProfiles;

/**
 * Integration tests for the revision-list filters (spec §20.2, M6.2.1): the {@code since}
 * cursor, {@code userId} author filter and {@code assetUuid} touched-asset filter, combined
 * with pagination.
 */
@SpringBootTest
@ActiveProfiles("test")
class RevisionFilterIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired FolderService folderService;
    @Autowired RevisionService revisionService;

    @Test
    void sinceReturnsOnlyNewerRevisions() {
        Fixture fx = newFixture();
        AssetVersionView first = folderService.create(null, "One", FolderScope.PAGES, fx.ctx());
        AssetVersionView second = folderService.create(null, "Two", FolderScope.PAGES, fx.ctx());
        long firstRevision = first.validFromRevision();

        List<Revision> result = revisionService.findRecent(
                fx.project().getId(), firstRevision, null, null, Pageable.unpaged());

        assertThat(result).isNotEmpty();
        assertThat(result).allMatch(r -> r.getRevisionId() > firstRevision);
        assertThat(result).extracting(Revision::getRevisionId).doesNotContain(firstRevision);
    }

    @Test
    void userIdRestrictsToThatAuthor() {
        Fixture fx = newFixture();
        AppUser other = userService.create(
                "other-" + SEQ.get(), "other-" + SEQ.get() + "@example.com", "Other User", "secret-password");
        folderService.create(null, "Mine", FolderScope.PAGES, fx.ctx());
        folderService.create(null, "Theirs", FolderScope.PAGES, RevisionContext.of(fx.project().getId(), other.getId(), "test"));

        List<Revision> result = revisionService.findRecent(
                fx.project().getId(), null, other.getId(), null, Pageable.unpaged());

        assertThat(result).isNotEmpty();
        assertThat(result).allMatch(r -> other.getId().equals(r.getCreatedBy()));
    }

    @Test
    void assetUuidRestrictsToTouchingRevisions() {
        Fixture fx = newFixture();
        AssetVersionView target = folderService.create(null, "Target", FolderScope.PAGES, fx.ctx());
        folderService.create(null, "Other", FolderScope.PAGES, fx.ctx());

        List<Revision> result = revisionService.findRecent(
                fx.project().getId(), null, null, target.uuid(), Pageable.unpaged());

        assertThat(result).isNotEmpty();
        assertThat(result).allMatch(r -> summaryTouches(r, target.uuid()));
        assertThat(result).allMatch(r -> r.getSummary() != null);
    }

    @Test
    void filtersComposeWithPagination() {
        Fixture fx = newFixture();
        UUID touched = folderService.create(null, "A", FolderScope.PAGES, fx.ctx()).uuid();
        for (int i = 0; i < 5; i++) {
            folderService.create(null, "B" + i, FolderScope.PAGES, fx.ctx());
        }

        List<Revision> result = revisionService.findRecent(
                fx.project().getId(), null, null, null, PageRequest.of(0, 3));

        assertThat(result).hasSize(3);
        assertThat(result).isSortedAccordingTo((a, b) -> Long.compare(b.getRevisionId(), a.getRevisionId()));
    }

    private static boolean summaryTouches(Revision r, UUID uuid) {
        var summary = r.getSummary();
        if (summary == null || !summary.has("assets")) {
            return false;
        }
        for (var entry : summary.get("assets")) {
            if (entry.has("uuid") && uuid.toString().equals(entry.get("uuid").asText())) {
                return true;
            }
        }
        return false;
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create("filt-user-" + n, "filt-user-" + n + "@example.com", "Filter User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("filtp_" + n, "Filter Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }
}
