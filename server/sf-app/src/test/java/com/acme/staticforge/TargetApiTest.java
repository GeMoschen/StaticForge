package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
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
 * Generation-target CRUD endpoints (spec §18.4): per-target output paths, path validation and
 * overlap rejection, and the single-default invariant.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class TargetApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Autowired MockMvc mvc;
    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired JwtService jwtService;
    @Autowired GenerationTargetRepository targets;

    @Test
    void createExposesOutputPathWithConfiguredOrFallbackDirectory() throws Exception {
        Fixture fx = newFixture("tgt_path");

        create(fx, "Live", "site/live", false)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.outputPath").value(fx.key() + "/site/live"));

        JsonNode fallback = body(create(fx, "Scratch", null, false).andExpect(status().isCreated()));
        assertThat(fallback.get("outputPath").asText())
                .isEqualTo(fx.key() + "/target-" + fallback.get("id").asLong());
    }

    @Test
    void invalidOrOverlappingPathsAreRejected() throws Exception {
        Fixture fx = newFixture("tgt_bad");
        create(fx, "Escape", "../other", false).andExpect(status().isBadRequest());
        create(fx, "Reserved", "target-1", false).andExpect(status().isBadRequest());
        create(fx, " ", "x", false).andExpect(status().isBadRequest());

        long site = body(create(fx, "Site", "site", false)).get("id").asLong();
        create(fx, "Nested", "site/staging", false).andExpect(status().isBadRequest());
        create(fx, "Same", "SITE", false).andExpect(status().isBadRequest());

        // Updating a target to its own path is not an overlap.
        update(fx, site, "Site renamed", "site", false).andExpect(status().isOk());
        assertThat(targets.findByProjectId(fx.project().getId())).hasSize(1);
    }

    @Test
    void settingDefaultClearsPreviousDefault() throws Exception {
        Fixture fx = newFixture("tgt_def");
        long first = body(create(fx, "First", "a", true)).get("id").asLong();
        long second = body(create(fx, "Second", "b", true)).get("id").asLong();

        assertThat(targets.findById(first)).get().extracting(GenerationTarget::isDefaultTarget).isEqualTo(false);
        assertThat(targets.findById(second)).get().extracting(GenerationTarget::isDefaultTarget).isEqualTo(true);

        update(fx, first, "First", "a", true).andExpect(status().isOk());
        assertThat(targets.findByProjectIdAndDefaultTargetTrue(fx.project().getId()))
                .get().extracting(GenerationTarget::getId).isEqualTo(first);
    }

    @Test
    void deleteRemovesTarget() throws Exception {
        Fixture fx = newFixture("tgt_del");
        long id = body(create(fx, "Doomed", null, false)).get("id").asLong();

        mvc.perform(delete(base(fx) + "/" + id).header("Authorization", "Bearer " + fx.token()))
                .andExpect(status().isNoContent());
        mvc.perform(get(base(fx)).header("Authorization", "Bearer " + fx.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    /** {@code config.redirectFormats} (M30.5.1): validated on create and update, exposed with its default. */
    @Test
    void redirectFormatsAreValidatedAndExposed() throws Exception {
        Fixture fx = newFixture("tgt_rdr");

        create(fx, "Default", "default", false)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.redirectFormats.length()").value(1))
                .andExpect(jsonPath("$.redirectFormats[0]").value("HTML_STUB"));
        long id = body(createWithFormats(fx, "Apache", "apache", "[\"JSON\",\"HTACCESS\"]")
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.redirectFormats[0]").value("HTACCESS"))
                        .andExpect(jsonPath("$.redirectFormats[1]").value("JSON")))
                .get("id").asLong();
        createWithFormats(fx, "None", "none", "[]")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.redirectFormats.length()").value(0));

        for (String invalid : List.of("\"HTML_STUB\"", "[\"NGINX\"]", "[\"JSON\",\"JSON\"]", "[1]")) {
            createWithFormats(fx, "Bad", "bad", invalid)
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.field").value("config.redirectFormats"));
        }
        mvc.perform(put(base(fx) + "/" + id)
                        .header("Authorization", "Bearer " + fx.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(formatsRequest("Apache", "apache", "[\"HTACCES\"]")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.field").value("config.redirectFormats"));
        assertThat(targets.findById(id)).get().extracting(target -> target.getConfig().path("redirectFormats").size())
                .isEqualTo(2);
    }

    /** Names are unique per project, ignoring case (409 on the field); output-directory clashes stay 400. */
    @Test
    void duplicateNamesAreRejectedIgnoringCase() throws Exception {
        Fixture fx = newFixture("tgt_name");
        long live = body(create(fx, "Live", "live", false).andExpect(status().isCreated())).get("id").asLong();
        long other = body(create(fx, "Staging", "staging", false)).get("id").asLong();

        create(fx, "live", "other", false)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-API-0409"))
                .andExpect(jsonPath("$.field").value("name"));
        update(fx, other, "LIVE ", "staging", false)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.field").value("name"));
        update(fx, live, "LIVE", "live", false).andExpect(status().isOk());
        update(fx, other, "Staging", "staging", false).andExpect(status().isOk());
        // Another project may reuse the name.
        create(newFixture("tgt_name2"), "Live", "live", false).andExpect(status().isCreated());
        // An output directory clash is a plain 400.
        create(fx, "Third", "live/sub", false)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("SF-API-0400"));
    }

    /** {@code baseUrl}: {@code config.baseUrl} surfaced on the view, settable through the request, validated. */
    @Test
    void baseUrlIsSurfacedAndValidated() throws Exception {
        Fixture fx = newFixture("tgt_url");
        create(fx, "None", "none", false).andExpect(jsonPath("$.baseUrl").isEmpty());

        // legacy form: only config.baseUrl
        ObjectNode legacy = (ObjectNode) MAPPER.readTree(request("Legacy", "legacy", false));
        legacy.withObject("/config").put("baseUrl", "https://www.example.com/blog/");
        long id = body(send(fx, legacy).andExpect(status().isCreated())
                .andExpect(jsonPath("$.baseUrl").value("https://www.example.com/blog/"))
                .andExpect(jsonPath("$.config.baseUrl").value("https://www.example.com/blog/"))).get("id").asLong();

        // the request field wins over config and is written to it; other config keys survive
        ObjectNode viaField = (ObjectNode) MAPPER.readTree(request("Field", "field", false));
        viaField.put("baseUrl", " http://localhost:8080 ");
        send(fx, viaField).andExpect(status().isCreated())
                .andExpect(jsonPath("$.baseUrl").value("http://localhost:8080"))
                .andExpect(jsonPath("$.config.baseUrl").value("http://localhost:8080"))
                .andExpect(jsonPath("$.config.path").value("field"));

        // null keeps, blank removes
        ObjectNode keep = (ObjectNode) MAPPER.readTree(request("Legacy", "legacy", false));
        keep.withObject("/config").put("baseUrl", "https://www.example.com/blog/");
        sendUpdate(fx, id, keep).andExpect(jsonPath("$.baseUrl").value("https://www.example.com/blog/"));
        keep.put("baseUrl", "");
        sendUpdate(fx, id, keep).andExpect(status().isOk())
                .andExpect(jsonPath("$.baseUrl").isEmpty())
                .andExpect(jsonPath("$.config.baseUrl").doesNotExist());

        for (String bad : List.of("ftp://example.com", "example.com", "/relative", "https://", "https://a.b/?x=1", "not a url")) {
            ObjectNode body = (ObjectNode) MAPPER.readTree(request("Bad", "bad", false));
            body.put("baseUrl", bad);
            send(fx, body).andExpect(status().isBadRequest()).andExpect(jsonPath("$.field").value("baseUrl"));
            ObjectNode viaConfig = (ObjectNode) MAPPER.readTree(request("Bad", "bad", false));
            viaConfig.withObject("/config").put("baseUrl", bad);
            send(fx, viaConfig).andExpect(status().isBadRequest()).andExpect(jsonPath("$.field").value("baseUrl"));
        }
    }

    private ResultActions send(Fixture fx, ObjectNode body) throws Exception {
        return mvc.perform(post(base(fx)).header("Authorization", "Bearer " + fx.token())
                .contentType(MediaType.APPLICATION_JSON).content(body.toString()));
    }

    private ResultActions sendUpdate(Fixture fx, long id, ObjectNode body) throws Exception {
        return mvc.perform(put(base(fx) + "/" + id).header("Authorization", "Bearer " + fx.token())
                .contentType(MediaType.APPLICATION_JSON).content(body.toString()));
    }

    private ResultActions createWithFormats(Fixture fx, String name, String path, String formats) throws Exception {
        return mvc.perform(post(base(fx))
                .header("Authorization", "Bearer " + fx.token())
                .contentType(MediaType.APPLICATION_JSON)
                .content(formatsRequest(name, path, formats)));
    }

    private static String formatsRequest(String name, String path, String formats) throws Exception {
        ObjectNode body = (ObjectNode) MAPPER.readTree(request(name, path, false));
        body.withObject("/config").set("redirectFormats", MAPPER.readTree(formats));
        return body.toString();
    }

    private ResultActions create(Fixture fx, String name, String path, boolean isDefault) throws Exception {
        return mvc.perform(post(base(fx))
                .header("Authorization", "Bearer " + fx.token())
                .contentType(MediaType.APPLICATION_JSON)
                .content(request(name, path, isDefault)));
    }

    private ResultActions update(Fixture fx, long id, String name, String path, boolean isDefault) throws Exception {
        return mvc.perform(put(base(fx) + "/" + id)
                .header("Authorization", "Bearer " + fx.token())
                .contentType(MediaType.APPLICATION_JSON)
                .content(request(name, path, isDefault)));
    }

    private static String request(String name, String path, boolean isDefault) {
        ObjectNode body = MAPPER.createObjectNode();
        body.put("name", name);
        body.put("type", "FILESYSTEM");
        ObjectNode config = body.putObject("config");
        if (path != null) {
            config.put("path", path);
        }
        body.put("isDefault", isDefault);
        return body.toString();
    }

    private static JsonNode body(ResultActions result) throws Exception {
        return MAPPER.readTree(result.andReturn().getResponse().getContentAsString());
    }

    private static String base(Fixture fx) {
        return "/api/v1/projects/" + fx.key() + "/targets";
    }

    private Fixture newFixture(String key) {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(
                key + "-user-" + n, key + "-user-" + n + "@example.com", key + " User " + n, "secret-password");
        Project project = projectService.create(new CreateProjectRequest(key + n, key + n, null, null), user.getId());
        return new Fixture(project, jwtService.issueAccessToken(user));
    }

    private record Fixture(Project project, String token) {
        String key() {
            return project.getKey();
        }
    }
}
