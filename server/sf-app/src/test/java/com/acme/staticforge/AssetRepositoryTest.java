package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link AssetRepository} tests (feature uuid-scope-schema, `M9.1.1`/`M9.1.2`): the
 * {@code (projectId, uuid)} composite unique constraint replacing the old server-wide
 * uniqueness on {@code asset.uuid}, and the project-scoped {@code findByProjectIdAndUuid}
 * finder that every caller migrates onto in `M9.2`.
 */
@SpringBootTest
@ActiveProfiles("test")
class AssetRepositoryTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetRepository assetRepository;

    @Test
    void findByProjectIdAndUuidResolvesTheSameUuidIndependentlyInTwoProjects() {
        Fixture a = newFixture();
        Fixture b = newFixture();
        UUID sharedUuid = UUID.randomUUID();

        Asset assetA = assetRepository.save(asset(sharedUuid, a));
        Asset assetB = assetRepository.save(asset(sharedUuid, b));

        Asset foundA = assetRepository.findByProjectIdAndUuid(a.project().getId(), sharedUuid).orElseThrow();
        Asset foundB = assetRepository.findByProjectIdAndUuid(b.project().getId(), sharedUuid).orElseThrow();

        assertThat(foundA.getId()).isEqualTo(assetA.getId());
        assertThat(foundB.getId()).isEqualTo(assetB.getId());
        assertThat(foundA.getId()).isNotEqualTo(foundB.getId());
    }

    @Test
    void findByProjectIdAndUuidReturnsEmptyForAWrongProject() {
        Fixture a = newFixture();
        Fixture b = newFixture();
        UUID uuid = UUID.randomUUID();
        assetRepository.save(asset(uuid, a));

        assertThat(assetRepository.findByProjectIdAndUuid(b.project().getId(), uuid)).isEmpty();
    }

    @Test
    @Transactional
    void sameUuidAcrossTwoDifferentProjectsIsAllowed() {
        Fixture a = newFixture();
        Fixture b = newFixture();
        UUID sharedUuid = UUID.randomUUID();

        assetRepository.saveAndFlush(asset(sharedUuid, a));
        assetRepository.saveAndFlush(asset(sharedUuid, b));

        assertThat(assetRepository.findByProjectIdAndUuid(a.project().getId(), sharedUuid)).isPresent();
        assertThat(assetRepository.findByProjectIdAndUuid(b.project().getId(), sharedUuid)).isPresent();
    }

    @Test
    @Transactional
    void duplicateUuidWithinTheSameProjectStillFailsAtTheDbLevel() {
        Fixture a = newFixture();
        UUID uuid = UUID.randomUUID();
        assetRepository.saveAndFlush(asset(uuid, a));

        assertThatThrownBy(() -> assetRepository.saveAndFlush(asset(uuid, a)))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    private Asset asset(UUID uuid, Fixture fx) {
        return new Asset(uuid, fx.project().getId(), AssetType.FOLDER, "folder-" + SEQ.incrementAndGet(),
                Instant.now(), fx.user().getId());
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(
                "assetrepo-user-" + n, "assetrepo-user-" + n + "@example.com", "AssetRepo User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("assetrepop_" + n, "AssetRepo Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {}
}
