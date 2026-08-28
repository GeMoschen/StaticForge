package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectMember;
import com.acme.staticforge.project.ProjectMemberRepository;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.AppUserRepository;
import com.acme.staticforge.user.SystemRole;
import com.acme.staticforge.user.UserService;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Project + membership end-to-end (spec §20.2). Verifies that {@code ProjectService.create}
 * allocates revision 1 ({@code CREATE}) and grants the creator {@code PROJECT_ADMIN}, and
 * that the REST endpoints are role-gated and allocate an {@code UPDATE} revision on a
 * membership change.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ProjectApiIntegrationTests {

    @Autowired MockMvc mvc;

    @Autowired UserService userService;

    @Autowired JwtService jwtService;

    @Autowired AppUserRepository appUserRepository;

    @Autowired ProjectService projectService;

    @Autowired ProjectMemberRepository projectMemberRepository;

    @Autowired RevisionRepository revisionRepository;

    @Test
    void createAllocatesRevisionOneAndGrantsCreatorProjectAdmin() {
        AppUser admin = userService.create("svc-admin", "svc-admin@example.com", "Svc Admin", "secret-password");
        admin.setSystemRole(SystemRole.INSTANCE_ADMIN);
        appUserRepository.save(admin);

        Project project = projectService.create(
                new CreateProjectRequest("demo", "Demo", "A demo project", "initial revision"), admin.getId());

        assertThat(project.getId()).isNotNull();
        assertThat(project.getKey()).isEqualTo("demo");

        // Project creation is one user-facing action that bootstraps the project itself plus
        // seven fixed folders: the implicit hidden root, the fixed "All Templates" wrapper root,
        // the two fixed "Page Templates" / "Section Templates" folders nested inside it (spec
        // M13.1.2, generalized), and the fixed "All Navigation" / "All Pages" / "All Media"
        // roots — every store (Pages, Media, Navigation, Templates) provisions its own fixed
        // wrapper root upfront. M15 folds all 8 creations into exactly one compound revision
        // instead of fragmenting them across 8.
        List<Revision> revisions = revisionRepository.findByProjectIdOrderByRevisionIdDesc(project.getId());
        assertThat(revisions).hasSize(1);
        Revision projectCreateRevision = revisions.get(0);
        assertThat(projectCreateRevision.getRevisionId()).isEqualTo(1L);
        assertThat(projectCreateRevision.getChangeType()).isEqualTo(ChangeType.CREATE);

        List<String> touchedTypes = new java.util.ArrayList<>();
        projectCreateRevision.getSummary().get("assets").forEach(entry -> touchedTypes.add(entry.get("type").asText()));
        assertThat(touchedTypes).hasSize(8);
        assertThat(touchedTypes).containsOnlyOnce("PROJECT");
        assertThat(touchedTypes.stream().filter("FOLDER"::equals).count()).isEqualTo(7);

        Optional<ProjectMember> member =
                projectMemberRepository.findByProjectIdAndUserId(project.getId(), admin.getId());
        assertThat(member).isPresent();
        assertThat(member.get().getRole()).isEqualTo(ProjectRole.PROJECT_ADMIN);
    }

    @Test
    void httpFlowCreatesListsAndSetsMemberRole() throws Exception {
        AppUser admin = userService.create("http-admin", "http-admin@example.com", "Http Admin", "secret-password");
        admin.setSystemRole(SystemRole.INSTANCE_ADMIN);
        appUserRepository.save(admin);
        String token = jwtService.issueAccessToken(admin);

        mvc.perform(post("/api/v1/projects")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"key\":\"acme\",\"name\":\"Acme\",\"description\":\"desc\"}"))
                .andExpect(status().isCreated())
                .andExpect(header().string("Location", "/api/v1/projects/acme"))
                .andExpect(jsonPath("$.key").value("acme"))
                .andExpect(jsonPath("$.name").value("Acme"));

        mvc.perform(get("/api/v1/projects").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].key").value("acme"))
                .andExpect(jsonPath("$[0].yourRole").value("PROJECT_ADMIN"));

        AppUser member = userService.create("http-member", "http-member@example.com", "Http Member", "secret-password");

        mvc.perform(put("/api/v1/projects/acme/members/" + member.getId())
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"role\":\"EDITOR\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value("http-member"))
                .andExpect(jsonPath("$.role").value("EDITOR"));

        Project project = projectService.requireByKey("acme");
        List<Revision> revisions = revisionRepository.findByProjectIdOrderByRevisionIdDesc(project.getId());
        assertThat(revisions.stream().anyMatch(r -> r.getChangeType() == ChangeType.UPDATE)).isTrue();
    }
}
