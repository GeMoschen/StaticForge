package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.common.JsonUtil;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.AppUserRepository;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

/**
 * Boots the full application context against H2 (PostgreSQL compatibility mode) with
 * {@code ddl-auto: validate}. This proves Liquibase creates a schema that Hibernate
 * accepts, and that the JSON payload column round-trips (spec §25.2, §5.3).
 */
@SpringBootTest
@ActiveProfiles("test")
class StaticForgeApplicationTests {

    @Autowired AppUserRepository users;
    @Autowired ProjectRepository projects;
    @Autowired AssetRepository assets;
    @Autowired AssetVersionRepository versions;

    @Test
    void contextLoads() {}

    @Test
    @Transactional
    void repositoriesRoundTripAProjectAssetAndJsonPayload() {
        Instant now = Instant.now();

        AppUser user = users.save(new AppUser("alice", "alice@example.com", now));
        assertThat(user.getId()).isNotNull();

        Project project = projects.save(new Project("acme_site", "Acme Site", now, user.getId()));
        assertThat(project.getId()).isNotNull();

        Asset asset = assets.save(new Asset(UUID.randomUUID(), project.getId(), AssetType.PAGE, "home", now, user.getId()));
        assertThat(asset.getId()).isNotNull();

        AssetVersion version = versions.save(
                new AssetVersion(asset.getId(), 1, "Home", JsonUtil.parse("{\"title\":\"Home\"}"), user.getId(), now));
        assertThat(version.getId()).isNotNull();
        assertThat(version.getPayload().path("title").asText()).isEqualTo("Home");
    }
}
