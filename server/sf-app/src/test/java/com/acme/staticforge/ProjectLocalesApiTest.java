package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
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
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/** {@code GET/PUT /api/v1/projects/{key}/locales} (M24.1.1). */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ProjectLocalesApiTest {

    @Autowired MockMvc mvc;

    @Autowired UserService userService;

    @Autowired JwtService jwtService;

    @Autowired AppUserRepository appUserRepository;

    @Autowired ProjectService projectService;

    @Autowired RevisionRepository revisionRepository;

    private record Setup(Project project, String adminToken) {}

    private Setup setup(String key) {
        AppUser admin = userService.create(
                key + "-admin", key + "-admin@example.com", "Admin", "secret-password");
        admin.setSystemRole(SystemRole.INSTANCE_ADMIN);
        appUserRepository.save(admin);
        Project project = projectService.create(new CreateProjectRequest(key, key, null, null), admin.getId());
        return new Setup(project, jwtService.issueAccessToken(admin));
    }

    @Test
    void projectWithoutLocalesReportsTheEmptyConfiguration() throws Exception {
        Setup s = setup("loc-empty");

        mvc.perform(get("/api/v1/projects/loc-empty/locales").header("Authorization", "Bearer " + s.adminToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.locales").isEmpty())
                .andExpect(jsonPath("$.defaultLocale").doesNotExist())
                .andExpect(jsonPath("$.fallbacks").isEmpty())
                .andExpect(jsonPath("$.defaultWithoutPrefix").value(false));

        assertThat(projectService.locales("loc-empty")).isEqualTo(LocaleConfig.EMPTY);
    }

    @Test
    void putPersistsNormalizedConfigurationAndAllocatesOneUpdateRevision() throws Exception {
        Setup s = setup("loc-put");
        long before = revisionRepository.findByProjectIdOrderByRevisionIdDesc(s.project().getId()).size();

        mvc.perform(put("/api/v1/projects/loc-put/locales")
                        .header("Authorization", "Bearer " + s.adminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(
                                """
                                {"locales":[{"code":"DE","label":"Deutsch"},{"code":"de-ch","label":null},\
                                {"code":"en","label":"English"}],
                                 "defaultLocale":"de","fallbacks":{"de-CH":["de"]},"defaultWithoutPrefix":false}"""))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.locales[0].code").value("de"))
                .andExpect(jsonPath("$.locales[1].code").value("de-CH"))
                .andExpect(jsonPath("$.locales[1].label").value("de-CH"))
                .andExpect(jsonPath("$.defaultLocale").value("de"))
                .andExpect(jsonPath("$.fallbacks['de-CH'][0]").value("de"))
                .andExpect(jsonPath("$.urlsWillChange").value(true));

        LocaleConfig stored = projectService.locales("loc-put");
        assertThat(stored.codes()).containsExactly("de", "de-CH", "en");
        assertThat(stored.effectiveChain("de-CH")).containsExactly("de-CH", "de");

        List<Revision> revisions = revisionRepository.findByProjectIdOrderByRevisionIdDesc(s.project().getId());
        assertThat(revisions).hasSize((int) before + 1);
        assertThat(revisions.get(0).getChangeType()).isEqualTo(ChangeType.UPDATE);

        // The configuration survives a round trip through the JSON column.
        mvc.perform(get("/api/v1/projects/loc-put/locales").header("Authorization", "Bearer " + s.adminToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.locales.length()").value(3))
                .andExpect(jsonPath("$.urlsWillChange").value(false));
    }

    @Test
    void urlsWillChangeOnlyWhenPathsAreAffected() throws Exception {
        Setup s = setup("loc-urls");
        String auth = "Bearer " + s.adminToken();
        String enabled =
                """
                {"locales":[{"code":"de","label":"Deutsch"},{"code":"en","label":"English"}],
                 "defaultLocale":"de","fallbacks":{},"defaultWithoutPrefix":false}""";

        mvc.perform(put("/api/v1/projects/loc-urls/locales")
                        .header("Authorization", auth)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(enabled))
                .andExpect(jsonPath("$.urlsWillChange").value(true));

        // A label-only edit leaves every output path alone.
        mvc.perform(put("/api/v1/projects/loc-urls/locales")
                        .header("Authorization", auth)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(enabled.replace("Deutsch", "Deutsch (DE)")))
                .andExpect(jsonPath("$.urlsWillChange").value(false));

        // Flipping the prefix setting moves the default locale to the site root.
        mvc.perform(put("/api/v1/projects/loc-urls/locales")
                        .header("Authorization", auth)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(enabled.replace("\"defaultWithoutPrefix\":false", "\"defaultWithoutPrefix\":true")))
                .andExpect(jsonPath("$.urlsWillChange").value(true));

        // Dropping a locale is reported; its stored values are kept.
        mvc.perform(put("/api/v1/projects/loc-urls/locales")
                        .header("Authorization", auth)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(
                                """
                                {"locales":[{"code":"de","label":"Deutsch"}],
                                 "defaultLocale":"de","fallbacks":{},"defaultWithoutPrefix":true}"""))
                .andExpect(jsonPath("$.removedLocales[0]").value("en"))
                .andExpect(jsonPath("$.urlsWillChange").value(false));
    }

    @Test
    void invalidConfigurationIsRejectedWithFieldErrors() throws Exception {
        Setup s = setup("loc-invalid");

        mvc.perform(put("/api/v1/projects/loc-invalid/locales")
                        .header("Authorization", "Bearer " + s.adminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(
                                """
                                {"locales":[{"code":"de"},{"code":"en"}],
                                 "defaultLocale":"de","fallbacks":{"de":["en"],"en":["de"]},
                                 "defaultWithoutPrefix":false}"""))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("SF-API-0400"))
                .andExpect(jsonPath("$.errors[0].field").exists())
                .andExpect(jsonPath("$.errors[0].message").value(org.hamcrest.Matchers.containsString("cyclic")));

        assertThat(projectService.locales("loc-invalid").isLocalized()).isFalse();
    }

    @Test
    void editorsAndViewersCannotChangeLocales() throws Exception {
        Setup s = setup("loc-roles");
        AppUser editor = userService.create("loc-editor", "loc-editor@example.com", "Editor", "secret-password");
        projectService.setMemberRole(
                "loc-roles",
                editor.getId(),
                ProjectRole.EDITOR,
                com.acme.staticforge.revision.RevisionContext.of(s.project().getId(), s.project().getCreatedBy(), null));
        String editorToken = jwtService.issueAccessToken(editor);

        mvc.perform(put("/api/v1/projects/loc-roles/locales")
                        .header("Authorization", "Bearer " + editorToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"locales\":[],\"fallbacks\":{},\"defaultWithoutPrefix\":false}"))
                .andExpect(status().isForbidden());

        // …but they may read it, because every content form needs the locale list.
        mvc.perform(get("/api/v1/projects/loc-roles/locales").header("Authorization", "Bearer " + editorToken))
                .andExpect(status().isOk());
    }
}
