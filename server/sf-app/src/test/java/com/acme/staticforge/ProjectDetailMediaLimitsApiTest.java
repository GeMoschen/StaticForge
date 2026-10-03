package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.media.MediaProperties;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * What the media library reads from {@code GET /projects/{key}} to check files before it sends them (M35.19):
 * {@code effectiveAllowedMimeTypes} is the project's own allow-list, else the instance default, and
 * {@code mediaMaxUploadBytes} is the instance's cap per file.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ProjectDetailMediaLimitsApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired MockMvc mvc;
    @Autowired UserService userService;
    @Autowired JwtService jwtService;
    @Autowired ProjectService projectService;
    @Autowired MediaProperties mediaProperties;

    @Test
    @DisplayName("A project without its own allow-list reports the instance default and the upload cap")
    void theInstanceDefaultAndTheCap() throws Exception {
        Fixture fx = newFixture();

        mvc.perform(get("/api/v1/projects/" + fx.project().getKey())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + jwtService.issueAccessToken(fx.viewer())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.effectiveAllowedMimeTypes").isArray())
                .andExpect(jsonPath("$.effectiveAllowedMimeTypes.length()").value(mediaProperties.getAllowedMime().size()))
                .andExpect(jsonPath("$.effectiveAllowedMimeTypes[0]").value(mediaProperties.getAllowedMime().get(0)))
                .andExpect(jsonPath("$.mediaMaxUploadBytes").value(mediaProperties.getMaxUploadSize().toBytes()));
        assertThat(mediaProperties.getMaxUploadSize().toBytes()).isPositive();
    }

    @Test
    @DisplayName("The project's own allow-list replaces the default; clearing it brings the default back")
    void theProjectsOwnListWins() throws Exception {
        Fixture fx = newFixture();
        RevisionContext ctx = RevisionContext.of(fx.project().getId(), fx.admin().getId(), "test");
        projectService.update(fx.project().getKey(), fx.project().getName(), null, List.of("image/png", "text/css"), ctx);

        mvc.perform(get("/api/v1/projects/" + fx.project().getKey())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + jwtService.issueAccessToken(fx.viewer())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.effectiveAllowedMimeTypes.length()").value(2))
                .andExpect(jsonPath("$.effectiveAllowedMimeTypes[0]").value("image/png"))
                .andExpect(jsonPath("$.effectiveAllowedMimeTypes[1]").value("text/css"))
                .andExpect(jsonPath("$.mediaMaxUploadBytes").value(mediaProperties.getMaxUploadSize().toBytes()));

        projectService.update(fx.project().getKey(), fx.project().getName(), null, List.of(), ctx);

        mvc.perform(get("/api/v1/projects/" + fx.project().getKey())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + jwtService.issueAccessToken(fx.viewer())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.effectiveAllowedMimeTypes.length()").value(mediaProperties.getAllowedMime().size()));
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser admin = userService.create("lim-admin-" + n, "lim-admin-" + n + "@example.com", "Limits Admin " + n, "secret-password");
        Project project = projectService.create(new CreateProjectRequest("medialim_" + n, "Media Limits " + n, null, null), admin.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), admin.getId(), "test");
        AppUser viewer = userService.create("lim-viewer-" + n, "lim-viewer-" + n + "@example.com", "Limits Viewer " + n, "secret-password");
        projectService.setMemberRole(project.getKey(), viewer.getId(), ProjectRole.VIEWER, ctx);
        return new Fixture(project, admin, viewer);
    }

    private record Fixture(Project project, AppUser admin, AppUser viewer) {}
}
