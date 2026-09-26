package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.project.publish.PublishPermission;
import com.acme.staticforge.project.publish.PublishPolicy;
import com.acme.staticforge.release.ReleaseLocales;
import com.acme.staticforge.release.ReleaseStatus;
import com.acme.staticforge.release.ReleaseStatusService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.scheduler.ActionStatus;
import com.acme.staticforge.scheduler.ScheduledAction;
import com.acme.staticforge.scheduler.ScheduledActionExecution;
import com.acme.staticforge.scheduler.SchedulerEngine;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserAdministrationService;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
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
 * Release and schedule endpoints under the publish policy (M28.2.1, epic decisions 8, 9): release/unpublish/discard need
 * {@code RELEASE}; one-off scheduled releases need {@code SCHEDULE_RELEASE} plus the build permission of their "then
 * generate" step; generation schedules stay with developers; someone else's schedule needs {@code DEVELOPER}; and the
 * engine re-checks the owner at execution.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class EditorReleaseAndScheduleIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final String CDL = "content { editor text title { label \"Title\" } }";

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;
    @Autowired UserService users;
    @Autowired UserAdministrationService administration;
    @Autowired ProjectService projects;
    @Autowired AssetService assets;
    @Autowired PageService pages;
    @Autowired TemplateService templates;
    @Autowired GenerationTargetRepository targets;
    @Autowired ReleaseStatusService statuses;
    @Autowired SchedulerFixtures fixtures;
    @Autowired SchedulerEngine engine;
    @Autowired ObjectMapper mapper;

    private final List<Long> created = new ArrayList<>();

    private record Fixture(
            Project project, AppUser admin, RevisionContext ctx, TemplateView template, GenerationTarget primary,
            GenerationTarget second) {
        long id() {
            return project.getId();
        }

        String key() {
            return project.getKey();
        }
    }

    private record Member(AppUser user, String token) {}

    @AfterEach
    void retire() {
        created.forEach(fixtures::retire);
    }

    @Test
    @DisplayName("release, unpublish and discard: RELEASE for editors, never for viewers, always for developers")
    void releaseEndpoints() throws Exception {
        Fixture fx = fixture("erel-rel");
        Member viewer = member(fx, ProjectRole.VIEWER);
        Member editor = member(fx, ProjectRole.EDITOR);
        Member developer = member(fx, ProjectRole.DEVELOPER);
        UUID page = page(fx, "home");

        for (String path : List.of("", "/unpublish", "/discard")) {
            expectDenied(releases(fx, path, editor, page), "RELEASE");
        }
        policy(fx, PublishPermission.values());
        for (String path : List.of("", "/unpublish", "/discard")) {
            expectDenied(releases(fx, path, viewer, page), "RELEASE");
        }
        releases(fx, "", editor, page).andExpect(status().isOk()).andExpect(jsonPath("$.revision").isNumber());
        assertThat(releaseStatus(fx, page)).isEqualTo(ReleaseStatus.PUBLISHED);
        edit(fx, page, "home v2");
        releases(fx, "/discard", editor, page).andExpect(status().isOk());
        releases(fx, "/unpublish", editor, page).andExpect(status().isOk());
        assertThat(releaseStatus(fx, page)).isEqualTo(ReleaseStatus.UNPUBLISHED);

        policy(fx);
        expectDenied(releases(fx, "", editor, page), "RELEASE");
        releases(fx, "", developer, page).andExpect(status().isOk());
        assertThat(releaseStatus(fx, page)).isEqualTo(ReleaseStatus.PUBLISHED);
    }

    @Test
    @DisplayName("schedules: SCHEDULE_RELEASE creates; then-generate needs the build permission of its target; generation schedules stay with developers")
    void scheduleRequirements() throws Exception {
        Fixture fx = fixture("erel-req");
        Member editor = member(fx, ProjectRole.EDITOR);
        UUID page = page(fx, "home");
        String plain = release(future(2), page, null);
        String thenDefault = release(future(2), page, "{\"targetId\":null}");
        String thenPrimary = release(future(2), page, "{\"targetId\":" + fx.primary().getId() + "}");
        String thenSecond = release(future(2), page, "{\"targetId\":" + fx.second().getId() + "}");

        expectDenied(create(fx, editor, plain), "SCHEDULE_RELEASE");
        policy(fx, PublishPermission.RELEASE);
        expectDenied(create(fx, editor, plain), "SCHEDULE_RELEASE");
        expectDenied(create(fx, editor, unpublish(future(2), page)), "SCHEDULE_RELEASE");

        policy(fx, PublishPermission.RELEASE, PublishPermission.SCHEDULE_RELEASE);
        long own = id(create(fx, editor, plain).andExpect(status().isOk()));
        create(fx, editor, unpublish(future(3), page)).andExpect(status().isOk());
        expectDenied(create(fx, editor, thenDefault), "INCREMENTAL_BUILD");
        expectDenied(create(fx, editor, thenPrimary), "INCREMENTAL_BUILD");

        policy(fx, PublishPermission.RELEASE, PublishPermission.SCHEDULE_RELEASE, PublishPermission.INCREMENTAL_BUILD);
        create(fx, editor, thenDefault).andExpect(status().isOk());
        create(fx, editor, thenPrimary).andExpect(status().isOk());
        expectDenied(create(fx, editor, thenSecond), "FULL_BUILD");
        // Editing the own schedule to build to another target needs FULL_BUILD, as saved.
        expectDenied(update(fx, editor, own, thenSecond), "FULL_BUILD");

        policy(fx, PublishPermission.values());
        create(fx, editor, thenSecond).andExpect(status().isOk());
        update(fx, editor, own, thenSecond).andExpect(status().isOk());
        expectDenied(create(fx, editor, generation("GENERATION", "\"runAt\":\"" + future(2) + "\"")), "ROLE:DEVELOPER");
        expectDenied(create(fx, editor, generation("RECURRING_GENERATION", "\"cron\":\"0 0 3 * * *\",\"zoneId\":\"UTC\"")),
                "ROLE:DEVELOPER");
        member(fx, ProjectRole.VIEWER);
        expectDenied(create(fx, member(fx, ProjectRole.VIEWER), plain), "SCHEDULE_RELEASE");
    }

    @Test
    @DisplayName("an editor changes their own schedules; someone else's needs a developer; take-over follows the requirements")
    void ownership() throws Exception {
        Fixture fx = fixture("erel-own");
        Member editor = member(fx, ProjectRole.EDITOR);
        Member developer = member(fx, ProjectRole.DEVELOPER);
        UUID page = page(fx, "home");
        policy(fx, PublishPermission.RELEASE, PublishPermission.SCHEDULE_RELEASE);

        long mine = id(create(fx, editor, release(future(2), page, null)).andExpect(status().isOk()));
        update(fx, editor, mine, release(future(4), page, null)).andExpect(status().isOk());
        perform(post("/api/v1/projects/{key}/schedules/{id}/run-now", fx.key(), mine), editor).andExpect(status().isOk());
        perform(post("/api/v1/projects/{key}/schedules/{id}/cancel", fx.key(), mine), editor)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"));

        long theirs = id(create(fx, developer, release(future(2), page, null)).andExpect(status().isOk()));
        expectDenied(perform(post("/api/v1/projects/{key}/schedules/{id}/cancel", fx.key(), theirs), editor), "ROLE:DEVELOPER");
        expectDenied(update(fx, editor, theirs, release(future(5), page, null)), "ROLE:DEVELOPER");
        expectDenied(perform(post("/api/v1/projects/{key}/schedules/{id}/run-now", fx.key(), theirs), editor), "ROLE:DEVELOPER");
        expectDenied(perform(post("/api/v1/projects/{key}/schedules/{id}/repin", fx.key(), theirs), editor), "ROLE:DEVELOPER");
        perform(post("/api/v1/projects/{key}/schedules/{id}/take-over", fx.key(), theirs), editor)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ownerUserId").value(editor.user().getId()));
        // Now it's the editor's: a developer still changes it (any schedule).
        update(fx, developer, theirs, release(future(6), page, null)).andExpect(status().isOk());

        long generation = id(create(fx, developer, generation("GENERATION", "\"runAt\":\"" + future(2) + "\""))
                .andExpect(status().isOk()));
        policy(fx, PublishPermission.values());
        expectDenied(perform(post("/api/v1/projects/{key}/schedules/{id}/take-over", fx.key(), generation), editor),
                "ROLE:DEVELOPER");
        expectDenied(perform(post("/api/v1/projects/{key}/schedules/{id}/cancel", fx.key(), generation), editor),
                "ROLE:DEVELOPER");
    }

    @Test
    @DisplayName("execution: an editor's release fails once SCHEDULE_RELEASE is off; nothing is released; a developer takes over and it runs")
    void executionReChecksThePolicy() throws Exception {
        Fixture fx = fixture("erel-exec");
        Member editor = member(fx, ProjectRole.EDITOR);
        Member developer = member(fx, ProjectRole.DEVELOPER);
        UUID page = page(fx, "home");
        policy(fx, PublishPermission.RELEASE, PublishPermission.SCHEDULE_RELEASE);
        long id = id(create(fx, editor, release(future(2), page, null)).andExpect(status().isOk()));

        policy(fx, PublishPermission.RELEASE);
        dueNowAndTick(id);

        ScheduledAction failed = fixtures.reload(id);
        assertThat(failed.getStatus()).isEqualTo(ActionStatus.FAILED);
        ScheduledActionExecution execution = fixtures.executions(id).get(0);
        assertThat(execution.getMessage()).startsWith("Owner no longer permitted (SCHEDULE_RELEASE):");
        assertThat(execution.getDetail().path("code").asText()).isEqualTo("SF-DOM-0163");
        assertThat(releaseStatus(fx, page)).isEqualTo(ReleaseStatus.NEW);

        perform(post("/api/v1/projects/{key}/schedules/{id}/take-over", fx.key(), id), developer)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PENDING"));
        tick();
        assertThat(fixtures.reload(id).getStatus()).isEqualTo(ActionStatus.SUCCEEDED);
        assertThat(releaseStatus(fx, page)).isEqualTo(ReleaseStatus.PUBLISHED);
    }

    @Test
    @DisplayName("execution: a demoted owner and a disabled owner fail with SF-DOM-0163 as well")
    void demotedAndDisabledOwners() throws Exception {
        Fixture fx = fixture("erel-demote");
        Member demoted = member(fx, ProjectRole.EDITOR);
        Member disabled = member(fx, ProjectRole.EDITOR);
        UUID first = page(fx, "first");
        UUID second = page(fx, "second");
        policy(fx, PublishPermission.RELEASE, PublishPermission.SCHEDULE_RELEASE);
        long demotedId = id(create(fx, demoted, release(future(2), first, null)).andExpect(status().isOk()));
        long disabledId = id(create(fx, disabled, release(future(2), second, null)).andExpect(status().isOk()));

        projects.setMemberRole(fx.key(), demoted.user().getId(), ProjectRole.VIEWER, fx.ctx());
        administration.disable(disabled.user().getId(), fx.admin().getId());
        dueNowAndTick(demotedId, disabledId);

        assertThat(fixtures.executions(demotedId).get(0).getMessage())
                .startsWith("Owner no longer permitted (SCHEDULE_RELEASE):")
                .contains("is VIEWER");
        assertThat(fixtures.executions(disabledId).get(0).getMessage())
                .startsWith("Owner no longer permitted:")
                .contains("is disabled");
        assertThat(fixtures.reload(demotedId).getStatus()).isEqualTo(ActionStatus.FAILED);
        assertThat(fixtures.reload(disabledId).getStatus()).isEqualTo(ActionStatus.FAILED);
        assertThat(releaseStatus(fx, first)).isEqualTo(ReleaseStatus.NEW);
        assertThat(releaseStatus(fx, second)).isEqualTo(ReleaseStatus.NEW);
        perform(get("/api/v1/projects/{key}/schedules/{id}", fx.key(), demotedId), member(fx, ProjectRole.VIEWER))
                .andExpect(jsonPath("$.lastExecution.message", containsString("SCHEDULE_RELEASE")));
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private Fixture fixture(String prefix) {
        int n = SEQ.incrementAndGet();
        AppUser admin = users.create(prefix + n, prefix + n + "@example.com", "Admin", "secret-password");
        Project project = projects.create(new CreateProjectRequest(prefix.replace("-", "") + n, prefix + n, null, "editor publishing"),
                admin.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), admin.getId(), "editor publishing");
        TemplateView template = templates.create(new CreateTemplateCommand(project.getId(), AssetType.PAGE_TEMPLATE, "Page", CDL,
                Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"), null, false, Map.of()), ctx);
        created.add(project.getId());
        return new Fixture(project, admin, ctx, template, target(project, "primary", true), target(project, "second", false));
    }

    private GenerationTarget target(Project project, String name, boolean isDefault) {
        try {
            return targets.save(new GenerationTarget(project.getId(), name, TargetType.FILESYSTEM,
                    mapper.readTree("{\"baseUrl\":\"https://example.com\"}"), isDefault));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private Member member(Fixture fx, ProjectRole role) {
        int n = SEQ.incrementAndGet();
        AppUser user = users.create("er" + n + role.name().toLowerCase(), "er" + n + "@example.com", "Member " + n, "secret-password");
        projects.setMemberRole(fx.key(), user.getId(), role, fx.ctx());
        AppUser fresh = users.findById(user.getId()).orElseThrow();
        return new Member(fresh, jwt.issueAccessToken(fresh));
    }

    private void policy(Fixture fx, PublishPermission... permissions) {
        projects.updatePublishPolicy(fx.key(), PublishPolicy.of(permissions), fx.ctx());
    }

    private UUID page(Fixture fx, String name) {
        AssetVersionView view = pages.create(new CreatePageCommand(name, null, fx.template().uuid()), fx.ctx());
        edit(fx, view.uuid(), name);
        return view.uuid();
    }

    private void edit(Fixture fx, UUID page, String title) {
        AssetVersionView current = assets.requireCurrent(fx.id(), page);
        ObjectNode payload = current.payload().deepCopy();
        payload.withObject("content").put("title", title);
        pages.update(page, payload, current.validFromRevision(), fx.ctx());
    }

    private ReleaseStatus releaseStatus(Fixture fx, UUID page) {
        return statuses.ofAsset(fx.id(), page).get(ReleaseLocales.ALL).status();
    }

    /** Makes the actions due now and lets the application's engine execute them. */
    private void dueNowAndTick(long... ids) {
        Instant now = Instant.now().minusSeconds(1);
        for (long id : ids) {
            ScheduledAction action = fixtures.reload(id);
            action.setRunAt(now);
            action.setNextRunAt(now);
            fixtures.save(action);
        }
        tick();
    }

    private void tick() {
        SchedulerEngine.Tick tick = engine.tick();
        tick.done().join();
    }

    private static Instant future(int hours) {
        return Instant.now().plus(Duration.ofHours(hours)).truncatedTo(ChronoUnit.SECONDS);
    }

    private static String release(Instant runAt, UUID page, String thenGenerate) {
        return "{\"type\":\"RELEASE\",\"runAt\":\"" + runAt + "\",\"params\":{\"items\":[{\"assetUuid\":\"" + page + "\"}]}"
                + (thenGenerate == null ? "" : ",\"thenGenerate\":" + thenGenerate) + "}";
    }

    private static String unpublish(Instant runAt, UUID page) {
        return "{\"type\":\"UNPUBLISH\",\"runAt\":\"" + runAt + "\",\"params\":{\"items\":[{\"assetUuid\":\"" + page + "\"}]}}";
    }

    private static String generation(String type, String timing) {
        return "{\"type\":\"" + type + "\"," + timing + ",\"params\":{\"mode\":\"INCREMENTAL\"}}";
    }

    private ResultActions releases(Fixture fx, String path, Member member, UUID page) throws Exception {
        return perform(post("/api/v1/projects/{key}/releases" + path, fx.key())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"items\": [{\"assetUuid\": \"" + page + "\"}]}"), member);
    }

    private ResultActions create(Fixture fx, Member member, String body) throws Exception {
        return perform(post("/api/v1/projects/{key}/schedules", fx.key()).contentType(MediaType.APPLICATION_JSON).content(body), member);
    }

    private ResultActions update(Fixture fx, Member member, long id, String body) throws Exception {
        long version = fixtures.reload(id).getVersion();
        return perform(put("/api/v1/projects/{key}/schedules/{id}", fx.key(), id)
                .header("If-Match", "\"v" + version + "\"")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body), member);
    }

    private static void expectDenied(ResultActions result, String permission) throws Exception {
        result.andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SF-API-0403"))
                .andExpect(jsonPath("$.permission").value(permission));
    }

    private ResultActions perform(MockHttpServletRequestBuilder request, Member member) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + member.token()));
    }

    private long id(ResultActions result) throws Exception {
        JsonNode json = mapper.readTree(result.andReturn().getResponse().getContentAsString());
        return json.path("id").asLong();
    }
}
