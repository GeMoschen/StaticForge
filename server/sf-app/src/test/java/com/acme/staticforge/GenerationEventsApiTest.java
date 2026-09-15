package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * {@code GET /generations/{runId}/events} for a run that has already finished: the stream must
 * deliver the final status (with diagnostics) and then close, rather than staying open until the
 * SSE timeout with the client showing nothing.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class GenerationEventsApiTest {

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        String outputRoot = Files.createTempDirectory("sf-gen-events-test").toString();
        registry.add("sf.generate.output-root", () -> outputRoot);
    }

    @Autowired MockMvc mvc;
    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired JwtService jwtService;
    @Autowired GenerationTargetRepository targets;
    @Autowired GenerationService generationService;

    @Test
    void subscribingToAFinishedRunSendsFinalStatusAndCompletes() throws Exception {
        AppUser user = userService.create("gen-events", "gen-events@example.com", "Gen Events", "secret-password");
        Project project = projectService.create(new CreateProjectRequest("genevents", "Gen Events", null, null), user.getId());
        GenerationTarget target = targets.save(new GenerationTarget(
                project.getId(), "default", TargetType.FILESYSTEM, new ObjectMapper().createObjectNode(), true));
        GenerationRun run = generationService.start(
                project.getKey(),
                new GenerationRequest(GenerationMode.FULL, null, List.of("html"), target.getId(), null, null, null, null),
                user.getId());
        String finalStatus = awaitTerminal(project.getKey(), run.getId());

        MvcResult started = mvc.perform(get("/api/v1/projects/genevents/generations/" + run.getId() + "/events")
                        .header("Authorization", "Bearer " + jwtService.issueAccessToken(user)))
                .andReturn();
        // A completed emitter lets the async dispatch finish; an open one would time out here.
        started.getAsyncResult(5_000);
        MvcResult completed = mvc.perform(asyncDispatch(started)).andExpect(status().isOk()).andReturn();

        String body = completed.getResponse().getContentAsString();
        assertThat(body).contains("event:progress").contains("\"stage\":\"STATUS\"").contains(finalStatus);
    }

    private String awaitTerminal(String projectKey, long runId) throws InterruptedException {
        long deadline = System.currentTimeMillis() + 60_000;
        while (System.currentTimeMillis() < deadline) {
            GenerationRun run = generationService.status(projectKey, runId);
            if (run.getStatus().isTerminal()) {
                return run.getStatus().name();
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Generation did not reach a terminal state within 60s");
    }
}
