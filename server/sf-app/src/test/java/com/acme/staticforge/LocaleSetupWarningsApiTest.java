package com.acme.staticforge;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * M35.1 follow-up: saving the language setup warns ({@code SF-GEN-0112}) about every page template channel whose output
 * path lacks {@code {locale}} once the project has languages — the build would fail with {@code SF-GEN-0111}. The
 * save itself is not blocked.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class LocaleSetupWarningsApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static final String NO_LANGUAGES = "{\"locales\":[],\"fallbacks\":{},\"defaultWithoutPrefix\":false}";
    private static final String ONE_LANGUAGE =
            "{\"locales\":[{\"code\":\"de\",\"label\":\"Deutsch\"}],\"defaultLocale\":\"de\",\"fallbacks\":{},"
                    + "\"defaultWithoutPrefix\":false}";
    private static final String TWO_LANGUAGES =
            "{\"locales\":[{\"code\":\"de\",\"label\":\"Deutsch\"},{\"code\":\"en\",\"label\":\"English\"}],"
                    + "\"defaultLocale\":\"de\",\"fallbacks\":{},\"defaultWithoutPrefix\":false}";

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired UserService userService;
    @Autowired JwtService jwtService;
    @Autowired ProjectService projectService;

    @Test
    @DisplayName("going from no language to two lists the page template channels without {locale}; {locale} clears them")
    void warnsAboutPathsWithoutLocale() throws Exception {
        int n = SEQ.incrementAndGet();
        AppUser admin = userService.create("locwarn-" + n, "locwarn-" + n + "@example.com", "Loc Warn " + n, "secret-password");
        Project project = projectService.create(new CreateProjectRequest("locwarn_" + n, "Loc Warn " + n, null, null), admin.getId());
        String token = "Bearer " + jwtService.issueAccessToken(admin);
        String templates = "/api/v1/projects/" + project.getKey() + "/page-templates";
        String locales = "/api/v1/projects/" + project.getKey() + "/locales";

        JsonNode flat = json(saveTemplate(post(templates), token, "Flat", Map.of("html", "{folder}{uid}.{ext}"))
                .andExpect(status().isOk()));
        saveTemplate(post(templates), token, "Localized", Map.of("html", "{locale}/{folder}{uid}.{ext}"))
                .andExpect(status().isOk());
        saveTemplate(post(templates), token, "Default", Map.of()).andExpect(status().isOk());

        // No language: the paths are fine, and so is saving "no language" again.
        saveLocales(locales, token, NO_LANGUAGES)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.warnings.length()").value(0))
                .andExpect(jsonPath("$.warningCount").value(0));

        // Two languages: only the flat template warns, once, with what a client needs to link it. Saving went through.
        saveLocales(locales, token, TWO_LANGUAGES)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.locales.length()").value(2))
                .andExpect(jsonPath("$.warningCount").value(1))
                .andExpect(jsonPath("$.warnings.length()").value(1))
                .andExpect(jsonPath("$.warnings[0].code").value("SF-GEN-0112"))
                .andExpect(jsonPath("$.warnings[0].templateUuid").value(flat.path("uuid").asText()))
                .andExpect(jsonPath("$.warnings[0].templateUid").value(flat.path("uid").asText()))
                .andExpect(jsonPath("$.warnings[0].templateName").value("Flat"))
                .andExpect(jsonPath("$.warnings[0].channel").value("html"))
                .andExpect(jsonPath("$.warnings[0].outputPath").value("{folder}{uid}.{ext}"))
                .andExpect(jsonPath("$.warnings[0].message").value(org.hamcrest.Matchers.containsString("SF-GEN-0111")));
        mvc.perform(get(locales).header("Authorization", token))
                .andExpect(jsonPath("$.locales.length()").value(2))
                .andExpect(jsonPath("$.warnings.length()").value(0));

        // A project with one declared language is localized too: its build needs {locale} as well.
        saveLocales(locales, token, ONE_LANGUAGE)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.warningCount").value(1));

        // Adding {locale} to the template clears the warning on the next save.
        JsonNode fixed = json(saveTemplate(put(templates + "/" + flat.path("uuid").asText())
                        .header("If-Match", "\"rev-" + flat.path("revision").asLong() + "\""),
                token, "Flat", Map.of("html", "{locale}/{folder}{uid}.{ext}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.warnings.length()").value(0)));
        saveLocales(locales, token, TWO_LANGUAGES)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.warnings.length()").value(0))
                .andExpect(jsonPath("$.warningCount").value(0));

        // Back to no language: nothing to warn about, whatever the paths.
        saveTemplate(put(templates + "/" + flat.path("uuid").asText())
                        .header("If-Match", "\"rev-" + fixed.path("revision").asLong() + "\""),
                token, "Flat", Map.of("html", "flat/{uid}.{ext}"))
                .andExpect(status().isOk());
        saveLocales(locales + "?confirmDiscard=true", token, NO_LANGUAGES)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.warningCount").value(0));
    }

    private ResultActions saveLocales(String url, String token, String body) throws Exception {
        return mvc.perform(put(url).header("Authorization", token).contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private ResultActions saveTemplate(
            MockHttpServletRequestBuilder request, String token, String name, Map<String, String> outputPath) throws Exception {
        return mvc.perform(request
                .header("Authorization", token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                        "displayName", name,
                        "contentCdl", "editor text headline { label \"Headline\" }",
                        "channelSources", Map.of("html", "<h1>$CMS_VALUE(headline)$</h1>"),
                        "outputPath", outputPath))));
    }

    private JsonNode json(ResultActions actions) throws Exception {
        return objectMapper.readTree(actions.andReturn().getResponse().getContentAsString());
    }
}
