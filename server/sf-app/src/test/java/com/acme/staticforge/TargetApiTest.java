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
