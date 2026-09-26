package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.BuildInsightFixtures.Fixture;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.audit.AuditLog;
import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationRunRepository;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.project.publish.PublishPermission;
import com.acme.staticforge.project.publish.PublishPolicy;
import com.acme.staticforge.scheduler.ScheduledAction;
import com.acme.staticforge.scheduler.SchedulerEngine;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.AppUserRepository;
import com.acme.staticforge.user.SystemRole;
import com.acme.staticforge.user.UserAdministrationService;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * Generation for editors (M28.2.2, epic decision 7): the request decides the permission — {@code INCREMENTAL_BUILD}
 * for an explicit incremental run to the default target, {@code FULL_BUILD} for a full run or another target,
 * {@code DEVELOPER} for a pinned revision — for start and dry run alike; editors cancel their own runs; runs carry
 * {@code startedBy}; start, cancel and promote are audited.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class EditorGenerationApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;
    @Autowired UserService users;
    @Autowired AppUserRepository appUsers;
    @Autowired UserAdministrationService administration;
    @Autowired ProjectService projects;
    @Autowired com.acme.staticforge.asset.AssetService assetService;
    @Autowired com.acme.staticforge.asset.AssetRepository assetRepository;
    @Autowired com.acme.staticforge.asset.template.TemplateService templateService;
    @Autowired com.acme.staticforge.asset.media.MediaService mediaService;
    @Autowired com.acme.staticforge.asset.navigation.PageReferenceService pageReferenceService;
    @Autowired com.acme.staticforge.generate.GenerationService generationService;
    @Autowired com.acme.staticforge.generate.GenerationProperties generationProperties;
    @Autowired ReleaseFixtures releases;
    @Autowired SchedulerFixtures schedules;
    @Autowired GenerationTargetRepository targets;
    @Autowired GenerationRunRepository runs;
    @Autowired AuditService audit;
    @Autowired ObjectMapper mapper;

    private final List<Long> created = new ArrayList<>();
    private BuildInsightFixtures fixtures;

    @BeforeEach
    void setUp() {
        fixtures = new BuildInsightFixtures(users, projects, assetService, assetRepository, templateService, mediaService,
                pageReferenceService, targets, generationService, releases, Path.of(generationProperties.getOutputRoot()));
    }

    /** A released one-page site with a default target and a second one. */
    private record Site(Fixture fx, String adminToken, GenerationTarget primary, GenerationTarget second, AssetVersionView page) {
        String key() {
            return fx.project().getKey();
        }
    }

    private record Member(AppUser user, String token) {}

    @AfterEach
    void retire() {
        created.forEach(schedules::retire);
    }

    @Test
    @DisplayName("INCREMENTAL_BUILD: incremental to the default target (scoped or not) only; FULL_BUILD adds full runs and any target")
    void buildPermissions() throws Exception {
        Site site = site("egen-build");
        Member editor = member(site, ProjectRole.EDITOR);
        Member viewer = member(site, ProjectRole.VIEWER);
        String incremental = "{\"mode\":\"INCREMENTAL\",\"channels\":[\"html\"]}";
        String toDefault = "{\"mode\":\"INCREMENTAL\",\"targetId\":" + site.primary().getId() + "}";
        String scoped = "{\"mode\":\"INCREMENTAL\",\"assetUuids\":[\"" + site.page().uuid() + "\"]}";
        String noMode = "{}";
        String full = "{\"mode\":\"FULL\"}";
        String toSecond = "{\"mode\":\"INCREMENTAL\",\"targetId\":" + site.second().getId() + "}";
        String pinned = "{\"mode\":\"INCREMENTAL\",\"revision\":1}";

        // Nothing opened: even the incremental request names what's missing.
        for (String body : List.of(incremental, noMode)) {
            expectDenied(start(site, editor.token(), body), body.equals(noMode) ? "FULL_BUILD" : "INCREMENTAL_BUILD");
            expectDenied(plan(site, editor.token(), body), body.equals(noMode) ? "FULL_BUILD" : "INCREMENTAL_BUILD");
        }

        policy(site, PublishPermission.INCREMENTAL_BUILD);
        for (String body : List.of(incremental, toDefault, scoped)) {
            plan(site, editor.token(), body).andExpect(status().isOk());
            await(site, start(site, editor.token(), body).andExpect(status().isAccepted()));
        }
        for (String body : List.of(noMode, full, toSecond)) {
            expectDenied(start(site, editor.token(), body), "FULL_BUILD");
            expectDenied(plan(site, editor.token(), body), "FULL_BUILD");
        }
        expectDenied(start(site, editor.token(), pinned), "ROLE:DEVELOPER");
        expectDenied(plan(site, editor.token(), pinned), "ROLE:DEVELOPER");

        policy(site, PublishPermission.INCREMENTAL_BUILD, PublishPermission.FULL_BUILD);
        for (String body : List.of(noMode, full, toSecond)) {
            plan(site, editor.token(), body).andExpect(status().isOk());
            await(site, start(site, editor.token(), body).andExpect(status().isAccepted()));
        }
        expectDenied(start(site, editor.token(), pinned), "ROLE:DEVELOPER");

        // Viewers never build; developers are untouched by the policy.
        policy(site);
        for (String body : List.of(incremental, full)) {
            start(site, viewer.token(), body).andExpect(status().isForbidden());
            plan(site, viewer.token(), body).andExpect(status().isForbidden());
        }
        Member developer = member(site, ProjectRole.DEVELOPER);
        await(site, start(site, developer.token(), pinned).andExpect(status().isAccepted()));
        await(site, start(site, developer.token(), toSecond).andExpect(status().isAccepted()));
    }

    @Test
    @DisplayName("an incremental request the planner turns into a full build is allowed; the run shows who started it and why")
    void fallbackToFullIsAllowed() throws Exception {
        Site site = site("egen-fallback");
        Member editor = member(site, ProjectRole.EDITOR);
        policy(site, PublishPermission.INCREMENTAL_BUILD);

        // No complete build for the target yet: the planner falls back to a full build.
        JsonNode run = await(site, start(site, editor.token(), "{\"mode\":\"INCREMENTAL\",\"comment\":\"First build\"}")
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.startedBy.id").value(editor.user().getId()))
                .andExpect(jsonPath("$.startedBy.displayName").value(editor.user().getDisplayName())));
        assertThat(run.path("status").asText()).isEqualTo("SUCCESS");
        assertThat(run.path("planSummary").path("fallbackCause").asText()).isEqualTo("NO_COMPLETE_BUILD_FOR_TARGET");
        assertThat(run.path("comment").asText()).isEqualTo("First build");
        assertThat(run.path("startedBy").path("displayName").asText()).isEqualTo(editor.user().getDisplayName());
        JsonNode history = json(perform(get(base(site) + "/generations"), site.adminToken()));
        assertThat(history.get(0).path("startedBy").path("id").asLong()).isEqualTo(editor.user().getId());
    }

    @Test
    @DisplayName("cancel: an editor with a build permission cancels their own run only; developers cancel any")
    void cancelRules() throws Exception {
        Site site = site("egen-cancel");
        Member editor = member(site, ProjectRole.EDITOR);
        Member other = member(site, ProjectRole.EDITOR);
        Member developer = member(site, ProjectRole.DEVELOPER);

        GenerationRun own = queued(site, editor.user());
        expectDenied(cancel(site, editor.token(), own), "INCREMENTAL_BUILD");
        policy(site, PublishPermission.INCREMENTAL_BUILD);
        expectDenied(cancel(site, other.token(), own), "ROLE:DEVELOPER");
        cancel(site, editor.token(), own).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("CANCELLED"));

        GenerationRun developers = queued(site, developer.user());
        expectDenied(cancel(site, editor.token(), developers), "ROLE:DEVELOPER");
        GenerationRun editors = runs.findById(developers.getId()).orElseThrow();
        assertThat(editors.getStatus()).isEqualTo(RunStatus.QUEUED);
        cancel(site, developer.token(), developers).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("CANCELLED"));

        GenerationRun editorsQueued = queued(site, editor.user());
        cancel(site, developer.token(), editorsQueued).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("CANCELLED"));
        member(site, ProjectRole.VIEWER);

        List<AuditLog> cancelled = audit.findRecent(site.fx().projectId(), PageRequest.of(0, 100)).stream()
                .filter(e -> e.getAction().equals("GENERATION_CANCELLED"))
                .toList();
        assertThat(cancelled).extracting(AuditLog::getTarget).containsExactlyInAnyOrder(
                "generation:" + own.getId(), "generation:" + developers.getId(), "generation:" + editorsQueued.getId());
        assertThat(cancelled).filteredOn(e -> e.getTarget().equals("generation:" + own.getId()))
                .singleElement()
                .satisfies(e -> assertThat(e.getActorUserId()).isEqualTo(editor.user().getId()));
    }

    @Test
    @DisplayName("audit: manual and scheduled starts (with scheduledActionId), promote by a developer only; startedBy survives deletion")
    void auditAndAttribution() throws Exception {
        Site site = site("egen-audit");
        Member editor = member(site, ProjectRole.EDITOR);
        Member developer = member(site, ProjectRole.DEVELOPER);
        policy(site, PublishPermission.values());

        JsonNode manual = await(site, start(site, editor.token(),
                "{\"mode\":\"INCREMENTAL\",\"folderPath\":\"/\",\"channels\":[\"html\"]}").andExpect(status().isAccepted()));
        long manualId = manual.path("id").asLong();

        // A scheduled GENERATION owned by the developer, executed by an engine whose clock is at its time.
        Instant runAt = Instant.parse("2025-03-01T10:00:00Z");
        ScheduledAction action = schedules.oneOff(site.fx().projectId(), "GENERATION",
                mapper.readTree("{\"mode\":\"FULL\",\"channels\":[],\"targetId\":null,\"scope\":{\"folderPath\":null,\"assetUuids\":[]}}"),
                runAt, developer.user().getId());
        SchedulerEngine node = schedules.engine("egen-node", new MutableClock(runAt.plusSeconds(1)));
        try {
            schedules.drain(node);
        } finally {
            node.close();
        }
        long scheduledRunId = schedules.executions(action.getId()).get(0).getGenerationRunId();
        fixtures.succeeded(fixtures.await(site.fx(), scheduledRunId));

        expectDenied(promote(site, editor.token(), manualId), "ROLE:DEVELOPER");
        promote(site, developer.token(), manualId).andExpect(status().isOk());

        List<AuditLog> entries = audit.findRecent(site.fx().projectId(), PageRequest.of(0, 100));
        AuditLog startedByEditor = entries.stream()
                .filter(e -> e.getAction().equals("GENERATION_STARTED") && e.getTarget().equals("generation:" + manualId))
                .findFirst().orElseThrow();
        assertThat(startedByEditor.getActorUserId()).isEqualTo(editor.user().getId());
        assertThat(startedByEditor.getDetail().path("mode").asText()).isEqualTo("INCREMENTAL");
        assertThat(startedByEditor.getDetail().path("scoped").asBoolean()).isTrue();
        assertThat(startedByEditor.getDetail().path("channels").toString()).isEqualTo("[\"html\"]");
        assertThat(startedByEditor.getDetail().has("scheduledActionId")).isFalse();
        AuditLog scheduled = entries.stream()
                .filter(e -> e.getAction().equals("GENERATION_STARTED") && e.getTarget().equals("generation:" + scheduledRunId))
                .findFirst().orElseThrow();
        assertThat(scheduled.getActorUserId()).isEqualTo(developer.user().getId());
        assertThat(scheduled.getDetail().path("scheduledActionId").asLong()).isEqualTo(action.getId());
        assertThat(scheduled.getDetail().path("mode").asText()).isEqualTo("FULL");
        assertThat(entries).filteredOn(e -> e.getAction().equals("GENERATION_PROMOTED"))
                .singleElement()
                .satisfies(e -> {
                    assertThat(e.getTarget()).isEqualTo("generation:" + manualId);
                    assertThat(e.getActorUserId()).isEqualTo(developer.user().getId());
                    assertThat(e.getDetail().path("runId").asLong()).isEqualTo(manualId);
                });

        // A deleted starter stays attributed, as "Deleted user".
        administration.delete(editor.user().getId(), editor.user().getUsername(), instanceAdmin().getId());
        perform(get(base(site) + "/generations/{id}", manualId), site.adminToken())
                .andExpect(jsonPath("$.startedBy.id").value(editor.user().getId()))
                .andExpect(jsonPath("$.startedBy.displayName").value("Deleted user"));
    }

    @Test
    @DisplayName("an Idempotency-Key is scoped by user: another user reusing it starts their own run")
    void idempotencyKeyIsPerUser() throws Exception {
        Site site = site("egen-idem");
        Member editor = member(site, ProjectRole.EDITOR);
        policy(site, PublishPermission.INCREMENTAL_BUILD);
        String key = "idem-" + SEQ.incrementAndGet();

        JsonNode first = await(site, perform(post(base(site) + "/generations").header("Idempotency-Key", key)
                .contentType(MediaType.APPLICATION_JSON).content("{\"mode\":\"INCREMENTAL\"}"), site.adminToken())
                .andExpect(status().isAccepted()));
        JsonNode again = json(perform(post(base(site) + "/generations").header("Idempotency-Key", key)
                .contentType(MediaType.APPLICATION_JSON).content("{\"mode\":\"INCREMENTAL\"}"), site.adminToken()));
        assertThat(again.path("id").asLong()).isEqualTo(first.path("id").asLong());
        JsonNode editors = await(site, perform(post(base(site) + "/generations").header("Idempotency-Key", key)
                .contentType(MediaType.APPLICATION_JSON).content("{\"mode\":\"INCREMENTAL\"}"), editor.token())
                .andExpect(status().isAccepted()));
        assertThat(editors.path("id").asLong()).isNotEqualTo(first.path("id").asLong());
        assertThat(editors.path("startedBy").path("id").asLong()).isEqualTo(editor.user().getId());
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private Site site(String prefix) {
        Fixture fx = fixtures.project(prefix);
        created.add(fx.projectId());
        TemplateView plain = fixtures.pageTemplate(fx, "Plain", "", "<p>plain</p>");
        AssetVersionView page = fixtures.page(fx, "Home", plain.uuid());
        GenerationTarget primary = target(fx, "primary", true);
        GenerationTarget second = target(fx, "second", false);
        releases.releaseAll(fx.projectId());
        return new Site(fx, jwt.issueAccessToken(fx.user()), primary, second, page);
    }

    private GenerationTarget target(Fixture fx, String name, boolean isDefault) {
        GenerationTarget target = fixtures.target(fx, name, TargetType.FILESYSTEM);
        target.setDefaultTarget(isDefault);
        return targets.save(target);
    }

    private Member member(Site site, ProjectRole role) {
        int n = SEQ.incrementAndGet();
        AppUser user = users.create("eg" + n + role.name().toLowerCase(), "eg" + n + "@example.com", "Egen " + n, "secret-password");
        projects.setMemberRole(site.key(), user.getId(), role, site.fx().ctx());
        AppUser fresh = users.findById(user.getId()).orElseThrow();
        return new Member(fresh, jwt.issueAccessToken(fresh));
    }

    private AppUser instanceAdmin() {
        int n = SEQ.incrementAndGet();
        AppUser user = users.create("egia" + n, "egia" + n + "@example.com", "IA", "secret-password");
        user.setSystemRole(SystemRole.INSTANCE_ADMIN);
        return appUsers.save(user);
    }

    private void policy(Site site, PublishPermission... permissions) {
        projects.updatePublishPolicy(site.key(), PublishPolicy.of(permissions), site.fx().ctx());
    }

    /** A queued run started by {@code user}, never executed: a stable target for cancel. */
    private GenerationRun queued(Site site, AppUser user) {
        return runs.saveAndFlush(new GenerationRun(site.fx().projectId(), null, GenerationMode.INCREMENTAL, "[]", null,
                RunStatus.QUEUED, Instant.now(), null, user.getId(), 0, 0, 0, 0, 0, null, null));
    }

    private String base(Site site) {
        return "/api/v1/projects/" + site.key();
    }

    private ResultActions start(Site site, String token, String body) throws Exception {
        return perform(post(base(site) + "/generations").contentType(MediaType.APPLICATION_JSON).content(body), token);
    }

    private ResultActions plan(Site site, String token, String body) throws Exception {
        return perform(post(base(site) + "/generations/plan").contentType(MediaType.APPLICATION_JSON).content(body), token);
    }

    private ResultActions cancel(Site site, String token, GenerationRun run) throws Exception {
        return perform(post(base(site) + "/generations/{id}/cancel", run.getId()), token);
    }

    private ResultActions promote(Site site, String token, long runId) throws Exception {
        return perform(post(base(site) + "/generations/{id}/promote", runId), token);
    }

    /** Waits for the accepted run to finish; its view, read again. */
    private JsonNode await(Site site, ResultActions accepted) throws Exception {
        long id = json(accepted).path("id").asLong();
        fixtures.await(site.fx(), id);
        return json(perform(get(base(site) + "/generations/{id}", id), site.adminToken()));
    }

    private static void expectDenied(ResultActions result, String permission) throws Exception {
        result.andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SF-API-0403"))
                .andExpect(jsonPath("$.permission").value(permission));
    }

    private ResultActions perform(MockHttpServletRequestBuilder request, String token) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + token));
    }

    private JsonNode json(ResultActions result) throws Exception {
        return mapper.readTree(result.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
    }
}
