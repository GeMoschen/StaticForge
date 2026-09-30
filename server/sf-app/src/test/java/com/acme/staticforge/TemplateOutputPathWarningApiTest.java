package com.acme.staticforge;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * M35.1: a page template whose output path has no {@code {locale}} segment in a project with several languages
 * carries an {@code SF-GEN-0112} warning on save and on read — the build would fail with {@code SF-GEN-0111}.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class TemplateOutputPathWarningApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired UserService userService;
    @Autowired JwtService jwtService;
    @Autowired ProjectService projectService;

    @Test
    @DisplayName("SF-GEN-0112 names each channel whose output path lacks {locale}, only once the project has languages")
    void warnsOnlyInAMultiLanguageProject() throws Exception {
        int n = SEQ.incrementAndGet();
        AppUser admin = userService.create("tplpath-" + n, "tplpath-" + n + "@example.com", "Tpl Path " + n, "secret-password");
        Project project = projectService.create(new CreateProjectRequest("tplpath_" + n, "Tpl Path " + n, null, null), admin.getId());
        String token = "Bearer " + jwtService.issueAccessToken(admin);
        String base = "/api/v1/projects/" + project.getKey() + "/page-templates";

        // One language: a path without {locale} is fine.
        JsonNode created = json(save(post(base), token, Map.of("html", "{folder}{uid}.{ext}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.warnings.length()").value(0)));
        String uuid = created.path("uuid").asText();

        // Two languages: the same template now warns, on read and on save.
        projectService.updateLocales(
                project.getKey(),
                LocaleConfig.of(List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English")), "de", Map.of(), false),
                true,
                RevisionContext.of(project.getId(), admin.getId(), "test"));
        mvc.perform(get(base + "/" + uuid).header("Authorization", token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.warnings.length()").value(1))
                .andExpect(jsonPath("$.warnings[0].code").value("SF-GEN-0112"))
                .andExpect(jsonPath("$.warnings[0].severity").value("WARNING"))
                .andExpect(jsonPath("$.warnings[0].field").value("outputPath:html"))
                .andExpect(jsonPath("$.warnings[0].message").value(org.hamcrest.Matchers.containsString("'{folder}{uid}.{ext}'")));

        // Adding {locale} clears it; a template with no expression uses the localized default and never warns.
        save(put(base + "/" + uuid).header("If-Match", "\"rev-" + created.path("revision").asLong() + "\""), token,
                Map.of("html", "{locale}/{folder}{uid}.{ext}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.warnings.length()").value(0));
        save(post(base), token, Map.of()).andExpect(jsonPath("$.warnings.length()").value(0));
        save(post(base), token, Map.of("html", "flat/{uid}.{ext}"))
                .andExpect(jsonPath("$.warnings[0].code").value("SF-GEN-0112"));
    }

    private ResultActions save(
            org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request,
            String token,
            Map<String, String> outputPath) throws Exception {
        return mvc.perform(request
                .header("Authorization", token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                        "displayName", "Flat " + SEQ.incrementAndGet(),
                        "contentCdl", "editor text headline { label \"Headline\" }",
                        "channelSources", Map.of("html", "<h1>$CMS_VALUE(headline)$</h1>"),
                        "outputPath", outputPath))));
    }

    private JsonNode json(ResultActions actions) throws Exception {
        return objectMapper.readTree(actions.andReturn().getResponse().getContentAsString());
    }
}
