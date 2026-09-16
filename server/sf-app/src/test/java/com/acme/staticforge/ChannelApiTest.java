package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
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
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * Channel endpoints (spec §15.3): output settings ({@code fileExtension}, {@code urlStrategy},
 * {@code indexFileName}, …) are validated on create/update with field-addressed 400s, and settings
 * keys the server doesn't interpret ({@code prettyPrint}, {@code minify}, …) are kept (`M16.4.1`).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ChannelApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Autowired MockMvc mvc;
    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired JwtService jwtService;

    @Test
    void invalidUrlStrategyIsRejectedWithAFieldError() throws Exception {
        Fixture fx = newFixture();

        update(fx, "html", "html", settings().put("urlStrategy", "NICE"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("settings.urlStrategy"));
        create(fx, "amp", "html", settings().put("urlStrategy", "pretty"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("settings.urlStrategy"));
    }

    @Test
    void invalidFileExtensionOrIndexFileNameIsRejected() throws Exception {
        Fixture fx = newFixture();

        update(fx, "html", ".HTML", settings())
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("fileExtension"));
        create(fx, "amp", "toolongextension", settings().put("indexFileName", "a/b.html"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.length()").value(2))
                .andExpect(jsonPath("$.fieldErrors[1].field").value("settings.indexFileName"));

        // Nothing was written by the rejected requests.
        JsonNode channels = body(mvc.perform(get(base(fx)).header("Authorization", "Bearer " + fx.token())));
        assertThat(channels).hasSize(1);
        assertThat(channels.get(0).path("fileExtension").asText()).isEqualTo("html");
    }

    @Test
    void unknownSettingsKeysSurviveAnUpdate() throws Exception {
        Fixture fx = newFixture();
        ObjectNode settings = settings()
                .put("urlStrategy", "PRETTY")
                .put("trailingSlash", true)
                .put("prettyPrint", true)
                .put("minify", false)
                .put("lineEnding", "LF");

        update(fx, "html", "htm", settings)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.fileExtension").value("htm"))
                .andExpect(jsonPath("$.settings.prettyPrint").value(true))
                .andExpect(jsonPath("$.settings.lineEnding").value("LF"));

        JsonNode html = body(mvc.perform(get(base(fx)).header("Authorization", "Bearer " + fx.token()))).get(0);
        assertThat(html.path("settings")).isEqualTo(settings);
    }

    private ResultActions create(Fixture fx, String key, String fileExtension, ObjectNode settings) throws Exception {
        ObjectNode body = MAPPER.createObjectNode()
                .put("key", key)
                .put("name", key)
                .put("fileExtension", fileExtension)
                .put("enabled", true);
        body.set("settings", settings);
        return mvc.perform(post(base(fx))
                .header("Authorization", "Bearer " + fx.token())
                .contentType(MediaType.APPLICATION_JSON)
                .content(body.toString()));
    }

    private ResultActions update(Fixture fx, String key, String fileExtension, ObjectNode settings) throws Exception {
        ObjectNode body = MAPPER.createObjectNode()
                .put("name", "HTML")
                .put("fileExtension", fileExtension)
                .put("defaultEscaping", "HTML")
                .put("enabled", true)
                .put("isDefault", true);
        body.set("settings", settings);
        return mvc.perform(put(base(fx) + "/" + key)
                .header("Authorization", "Bearer " + fx.token())
                .contentType(MediaType.APPLICATION_JSON)
                .content(body.toString()));
    }

    private static ObjectNode settings() {
        return MAPPER.createObjectNode().put("indexFileName", "index.html").put("urlStrategy", "RELATIVE");
    }

    private static JsonNode body(ResultActions result) throws Exception {
        return MAPPER.readTree(result.andReturn().getResponse().getContentAsString());
    }

    private static String base(Fixture fx) {
        return "/api/v1/projects/" + fx.key() + "/channels";
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(
                "chapi-user-" + n, "chapi-user-" + n + "@example.com", "Channel API User " + n, "secret-password");
        Project project = projectService.create(new CreateProjectRequest("chapi" + n, "chapi" + n, null, null), user.getId());
        return new Fixture(project, jwtService.issueAccessToken(user));
    }

    private record Fixture(Project project, String token) {
        String key() {
            return project.getKey();
        }
    }
}
