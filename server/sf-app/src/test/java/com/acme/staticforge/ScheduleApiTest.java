package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
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
import com.acme.staticforge.release.ReleaseLocales;
import com.acme.staticforge.release.ReleaseStatus;
import com.acme.staticforge.release.ReleaseStatusService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.scheduler.ScheduledAction;
import com.acme.staticforge.scheduler.SchedulerEngine;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
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
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** The schedules API (M27.4.4): roles, validation codes, optimistic locking, archived projects, {@code scheduled}. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ScheduleApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final String CDL = "content { editor text title { label \"Title\" } }";

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;
    @Autowired UserService users;
    @Autowired com.acme.staticforge.user.AppUserRepository appUsers;
    @Autowired ProjectService projects;
    @Autowired AssetService assets;
    @Autowired PageService pages;
    @Autowired TemplateService templates;
    @Autowired GenerationTargetRepository targets;
    @Autowired ReleaseStatusService statuses;
    @Autowired SchedulerFixtures fixtures;
    @Autowired SchedulerEngine engine;
    @Autowired ObjectMapper mapper;
    @Autowired com.acme.staticforge.audit.AuditService audit;

    private final List<Long> created = new ArrayList<>();

    private record Fixture(Project project, AppUser admin, RevisionContext ctx, TemplateView template, GenerationTarget target) {
        long id() {
            return project.getId();
        }

        String key() {
            return project.getKey();
        }
    }

    @AfterEach
    void retire() {
        created.forEach(fixtures::retire);
    }

    @Test
    @DisplayName("viewers read, editors can't schedule, developers can; strangers get 404")
    void roles() throws Exception {
        Fixture fx = fixture("sapi-role");
        UUID page = page(fx, "home");
        String viewer = member(fx, ProjectRole.VIEWER);
        String editor = member(fx, ProjectRole.EDITOR);
        String developer = member(fx, ProjectRole.DEVELOPER);
        String stranger = stranger();
        String body = release(future(1), page);

        create(fx, viewer, body).andExpect(status().isForbidden());
        create(fx, editor, body).andExpect(status().isForbidden());
        create(fx, stranger, body).andExpect(status().isNotFound());
        long id = id(create(fx, developer, body).andExpect(status().isOk()));

        perform(get("/api/v1/projects/{key}/schedules", fx.key()), viewer).andExpect(status().isOk())
                .andExpect(jsonPath("$.rows", hasSize(1)));
        perform(get("/api/v1/projects/{key}/schedules/{id}", fx.key(), id), viewer).andExpect(status().isOk());
        perform(get("/api/v1/projects/{key}/schedules/{id}/executions", fx.key(), id), viewer).andExpect(status().isOk());
        perform(post("/api/v1/projects/{key}/schedules/{id}/cancel", fx.key(), id), viewer).andExpect(status().isForbidden());
        perform(post("/api/v1/projects/{key}/schedules/{id}/cancel", fx.key(), id), editor).andExpect(status().isForbidden());
        perform(post("/api/v1/projects/{key}/schedules/{id}/take-over", fx.key(), id), editor).andExpect(status().isForbidden());
        perform(post("/api/v1/projects/{key}/schedules/{id}/run-now", fx.key(), id), viewer).andExpect(status().isForbidden());
        perform(get("/api/v1/projects/{key}/schedules", fx.key()), stranger).andExpect(status().isNotFound());
        perform(post("/api/v1/projects/{key}/schedules/preview-times", fx.key())
                .contentType(MediaType.APPLICATION_JSON).content("{\"cron\":\"0 0 3 * * *\",\"zoneId\":\"Europe/Berlin\"}"), viewer)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.times", hasSize(5)));
    }

    @Test
    @DisplayName("validation: SF-DOM-0160, 0161, 0164, 0165, 0166, 0167, 0168")
    void validationCodes() throws Exception {
        Fixture fx = fixture("sapi-val");
        UUID page = page(fx, "home");
        String dev = member(fx, ProjectRole.DEVELOPER);

        expectCode(create(fx, dev, "{\"type\":\"NOPE\",\"runAt\":\"" + future(1) + "\",\"params\":{}}"), 422, "SF-DOM-0160");
        expectCode(create(fx, dev, generation("GENERATION", "\"runAt\":\"" + future(1) + "\"", "\"revision\":3")), 422, "SF-DOM-0161");
        expectCode(create(fx, dev, generation("GENERATION", "\"runAt\":\"" + future(1) + "\"", "\"targetId\":999999")), 422, "SF-DOM-0161");
        expectCode(create(fx, dev, generation("GENERATION", "\"runAt\":\"" + future(1) + "\"", "\"channels\":[\"nope\"]")), 422, "SF-DOM-0161");
        expectCode(create(fx, dev, release(Instant.now().minusSeconds(60), page)), 422, "SF-DOM-0164");
        expectCode(create(fx, dev, generation("RECURRING_GENERATION", "\"cron\":\"every day\",\"zoneId\":\"UTC\"", null)), 422, "SF-DOM-0165");
        expectCode(create(fx, dev, generation("RECURRING_GENERATION", "\"cron\":\"0 0 3 * * *\",\"zoneId\":\"Mars/Base\"", null)), 422, "SF-DOM-0165");
        expectCode(create(fx, dev, "{\"type\":\"RELEASE\",\"cron\":\"0 0 3 * * *\",\"zoneId\":\"UTC\",\"params\":{\"items\":[{\"assetUuid\":\""
                + page + "\"}]}}"), 422, "SF-DOM-0166");
        expectCode(create(fx, dev, generation("RECURRING_GENERATION", "\"runAt\":\"" + future(1) + "\"", null)), 422, "SF-DOM-0166");
        expectCode(create(fx, dev, generation("GENERATION", null, null)), 422, "SF-DOM-0166");
        expectCode(create(fx, dev, "{\"type\":\"RELEASE\",\"runAt\":\"" + future(1) + "\",\"params\":{\"items\":[]}}"), 422, "SF-DOM-0153");

        long generationId = id(create(fx, dev, generation("GENERATION", "\"runAt\":\"" + future(1) + "\"", null)).andExpect(status().isOk()));
        expectCode(perform(post("/api/v1/projects/{key}/schedules/{id}/repin", fx.key(), generationId), dev), 422, "SF-DOM-0168");
        long latestId = id(create(fx, dev, "{\"type\":\"RELEASE\",\"runAt\":\"" + future(1)
                + "\",\"pinPolicy\":\"LATEST\",\"params\":{\"items\":[{\"assetUuid\":\"" + page + "\"}]}}").andExpect(status().isOk()));
        expectCode(perform(post("/api/v1/projects/{key}/schedules/{id}/repin", fx.key(), latestId), dev), 422, "SF-DOM-0168");

        fixtures.crash(generationId, "some-node", Instant.now().plusSeconds(120));
        expectCode(perform(post("/api/v1/projects/{key}/schedules/{id}/cancel", fx.key(), generationId), dev), 409, "SF-DOM-0167");
    }

    @Test
    @DisplayName("PUT needs If-Match with the current version: stale is 409 SF-API-0409, missing is 412; times round-trip")
    void optimisticLockingAndTimes() throws Exception {
        Fixture fx = fixture("sapi-lock");
        UUID page = page(fx, "home");
        String dev = member(fx, ProjectRole.DEVELOPER);
        Instant runAt = future(2);
        MvcResult created = create(fx, dev, release(runAt, page)).andExpect(status().isOk())
                .andExpect(jsonPath("$.runAt").value(runAt.toString()))
                .andExpect(jsonPath("$.nextRunAt").value(runAt.toString()))
                .andExpect(jsonPath("$.pinPolicy").value("PINNED"))
                .andExpect(jsonPath("$.missedPolicy").value("RUN_LATE"))
                .andExpect(jsonPath("$.itemCount").value(1))
                .andExpect(jsonPath("$.driftCount").value(0))
                .andExpect(jsonPath("$.items[0].uid").value("home"))
                .andExpect(jsonPath("$.items[0].locale").value(ReleaseLocales.ALL))
                .andReturn();
        long id = id(created);
        String etag = created.getResponse().getHeader("ETag");
        assertThat(etag).matches("\"v\\d+\"");

        Instant later = future(3);
        String edit = "{\"runAt\":\"" + later + "\",\"missedPolicy\":\"SKIP_IF_LATER_THAN\",\"maxLateness\":\"PT15M\"}";
        perform(put("/api/v1/projects/{key}/schedules/{id}", fx.key(), id).contentType(MediaType.APPLICATION_JSON).content(edit), dev)
                .andExpect(status().isPreconditionFailed());
        MvcResult updated = perform(put("/api/v1/projects/{key}/schedules/{id}", fx.key(), id)
                        .header("If-Match", etag).contentType(MediaType.APPLICATION_JSON).content(edit), dev)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.runAt").value(later.toString()))
                .andExpect(jsonPath("$.maxLateness").value("PT15M"))
                .andExpect(jsonPath("$.items[0].uid").value("home"))
                .andReturn();
        assertThat(updated.getResponse().getHeader("ETag")).isNotEqualTo(etag);
        expectCode(perform(put("/api/v1/projects/{key}/schedules/{id}", fx.key(), id)
                .header("If-Match", etag).contentType(MediaType.APPLICATION_JSON).content(edit), dev), 409, "SF-API-0409");

        long recurring = id(create(fx, dev, generation("RECURRING_GENERATION", "\"cron\":\"30 2 * * *\",\"zoneId\":\"Europe/Berlin\"", null))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cron").value("0 30 2 * * *"))
                .andExpect(jsonPath("$.zoneId").value("Europe/Berlin"))
                .andExpect(jsonPath("$.runAt").value(nullValue())));
        JsonNode view = json(perform(get("/api/v1/projects/{key}/schedules/{id}", fx.key(), recurring), dev).andReturn());
        Instant next = Instant.parse(view.path("nextRunAt").asText());
        assertThat(next.atZone(java.time.ZoneId.of("Europe/Berlin")).toLocalTime()).isIn(
                java.time.LocalTime.of(2, 30), java.time.LocalTime.of(3, 0));
        assertThat(next).isAfter(Instant.now());

        perform(get("/api/v1/projects/{key}/schedules", fx.key()).param("type", "RECURRING_GENERATION"), dev)
                .andExpect(jsonPath("$.rows", hasSize(1)))
                .andExpect(jsonPath("$.rows[0].id").value(recurring));
        perform(get("/api/v1/projects/{key}/schedules", fx.key()).param("assetUuid", page.toString()), dev)
                .andExpect(jsonPath("$.rows", hasSize(1)))
                .andExpect(jsonPath("$.rows[0].id").value(id))
                .andExpect(jsonPath("$.rows[0].items").value(nullValue()));
        perform(get("/api/v1/projects/{key}/schedules", fx.key()).param("status", "CANCELLED"), dev)
                .andExpect(jsonPath("$.rows", hasSize(0)));
    }

    @Test
    @DisplayName("archived projects refuse every schedule change with 409 SF-DOM-0141 but can be read")
    void archivedProject() throws Exception {
        Fixture fx = fixture("sapi-arch");
        UUID page = page(fx, "home");
        String dev = member(fx, ProjectRole.DEVELOPER);
        long id = id(create(fx, dev, release(future(1), page)).andExpect(status().isOk()));
        projects.archive(fx.key(), fx.ctx());
        // Archived projects are hidden from members (M26); an instance admin still sees them.
        AppUser instanceAdmin = users.create("iadm" + SEQ.incrementAndGet(), "iadm" + SEQ.get() + "@example.com", "Admin",
                "secret-password");
        instanceAdmin.setSystemRole(com.acme.staticforge.user.SystemRole.INSTANCE_ADMIN);
        String admin = jwt.issueAccessToken(appUsers.save(instanceAdmin));

        expectCode(create(fx, admin, release(future(1), page)), 409, "SF-DOM-0141");
        expectCode(perform(post("/api/v1/projects/{key}/schedules/{id}/cancel", fx.key(), id), admin), 409, "SF-DOM-0141");
        perform(get("/api/v1/projects/{key}/schedules/{id}", fx.key(), id), admin).andExpect(status().isOk());
        perform(post("/api/v1/projects/{key}/schedules/preview-times", fx.key())
                .contentType(MediaType.APPLICATION_JSON).content("{\"cron\":\"0 0 3 * * *\",\"zoneId\":\"UTC\",\"count\":2}"), admin)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.times", hasSize(2)));
    }

    @Test
    @DisplayName("a pending release shows in scheduled on the page and its Changes row; run-now executes on the next tick; cancel removes it")
    void scheduledBlockRunNowAndCancel() throws Exception {
        Fixture fx = fixture("sapi-block");
        UUID page = page(fx, "home");
        UUID other = page(fx, "other");
        String dev = member(fx, ProjectRole.DEVELOPER);
        Instant runAt = future(1);
        long id = id(create(fx, dev, release(runAt, page)).andExpect(status().isOk()));
        long otherId = id(create(fx, dev, release(runAt, other)).andExpect(status().isOk()));

        perform(get("/api/v1/projects/{key}/pages/{uuid}", fx.key(), page), dev)
                .andExpect(jsonPath("$.scheduled", hasSize(1)))
                .andExpect(jsonPath("$.scheduled[0].actionId").value(id))
                .andExpect(jsonPath("$.scheduled[0].type").value("RELEASE"))
                .andExpect(jsonPath("$.scheduled[0].runAt").value(runAt.toString()));
        perform(get("/api/v1/projects/{key}/pages", fx.key()), dev)
                .andExpect(jsonPath("$[?(@.uid == 'home')].scheduled[0].actionId").value((int) id));
        perform(get("/api/v1/projects/{key}/changes", fx.key()), dev)
                .andExpect(jsonPath("$.rows[?(@.uid == 'home')].scheduled[0].actionId").value((int) id))
                .andExpect(jsonPath("$.rows[?(@.uid == 'other')].scheduled[0].actionId").value((int) otherId));

        // Run now: due at once, executed by the next poll.
        perform(post("/api/v1/projects/{key}/schedules/{id}/run-now", fx.key(), id), dev).andExpect(status().isOk());
        SchedulerEngine.Tick tick = engine.tick();
        tick.done().join();
        assertThat(statuses.ofAsset(fx.id(), page).get(ReleaseLocales.ALL).status()).isEqualTo(ReleaseStatus.PUBLISHED);
        perform(get("/api/v1/projects/{key}/schedules/{id}", fx.key(), id), dev)
                .andExpect(jsonPath("$.status").value("SUCCEEDED"))
                .andExpect(jsonPath("$.lastExecution.outcome").value("SUCCEEDED"))
                .andExpect(jsonPath("$.lastExecution.revisionId").isNumber());
        perform(get("/api/v1/projects/{key}/schedules/{id}/executions", fx.key(), id), dev)
                .andExpect(jsonPath("$.rows", hasSize(1)))
                .andExpect(jsonPath("$.rows[0].detail.items[0].result").value("APPLIED"));
        perform(get("/api/v1/projects/{key}/pages/{uuid}", fx.key(), page), dev).andExpect(jsonPath("$.scheduled", hasSize(0)));

        perform(post("/api/v1/projects/{key}/schedules/{id}/cancel", fx.key(), otherId), dev)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"))
                .andExpect(jsonPath("$.nextRunAt").value(nullValue()));
        perform(get("/api/v1/projects/{key}/pages/{uuid}", fx.key(), other), dev).andExpect(jsonPath("$.scheduled", hasSize(0)));
        perform(get("/api/v1/projects/{key}/changes", fx.key()), dev)
                .andExpect(jsonPath("$.rows[?(@.uid == 'other')].scheduled[0]").doesNotExist());
        assertThat(audit.findRecent(fx.id(), org.springframework.data.domain.PageRequest.of(0, 50)))
                .extracting(com.acme.staticforge.audit.AuditLog::getAction)
                .contains("SCHEDULE_CREATED", "SCHEDULE_RUN_NOW", "SCHEDULE_EXECUTED", "SCHEDULE_CANCELLED");
    }

    @Test
    @DisplayName("take over re-activates a recurring action paused because its owner lost the role, under the new owner")
    void takeOverReactivates() throws Exception {
        Fixture fx = fixture("sapi-take");
        page(fx, "home");
        AppUser leaving = users.create("leave" + SEQ.incrementAndGet(), "leave" + SEQ.get() + "@example.com", "Leaving", "secret-password");
        projects.setMemberRole(fx.key(), leaving.getId(), ProjectRole.DEVELOPER, fx.ctx());
        String leavingToken = jwt.issueAccessToken(users.findById(leaving.getId()).orElseThrow());
        long id = id(create(fx, leavingToken, generation("RECURRING_GENERATION", "\"cron\":\"0 0 3 * * *\",\"zoneId\":\"UTC\"", null))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ownerUserId").value(leaving.getId())));
        projects.setMemberRole(fx.key(), leaving.getId(), ProjectRole.EDITOR, fx.ctx());

        ScheduledAction action = fixtures.reload(id);
        SchedulerEngine node = fixtures.engine("node-take", new MutableClock(action.getNextRunAt().plusSeconds(1)));
        try {
            fixtures.drain(node);
        } finally {
            node.close();
        }
        AppUser successor = users.create("succ" + SEQ.incrementAndGet(), "succ" + SEQ.get() + "@example.com", "Successor",
                "secret-password");
        projects.setMemberRole(fx.key(), successor.getId(), ProjectRole.DEVELOPER, fx.ctx());
        String dev = jwt.issueAccessToken(users.findById(successor.getId()).orElseThrow());
        perform(get("/api/v1/projects/{key}/schedules/{id}", fx.key(), id), dev)
                .andExpect(jsonPath("$.status").value("FAILED"))
                .andExpect(jsonPath("$.nextRunAt").value(nullValue()))
                .andExpect(jsonPath("$.lastExecution.detail.code").value("SF-DOM-0163"));
        perform(post("/api/v1/projects/{key}/schedules/{id}/run-now", fx.key(), id), dev).andExpect(status().isConflict());

        long devId = successor.getId();
        MvcResult taken = perform(post("/api/v1/projects/{key}/schedules/{id}/take-over", fx.key(), id), dev)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(jsonPath("$.ownerUserId").value(devId))
                .andExpect(jsonPath("$.createdBy").value(leaving.getId()))
                .andReturn();
        Instant next = Instant.parse(json(taken).path("nextRunAt").asText());
        assertThat(next).isAfter(Instant.now()).isBefore(Instant.now().plus(Duration.ofDays(1)).plusSeconds(5));
        perform(get("/api/v1/projects/{key}/schedules", fx.key()).param("owner", String.valueOf(devId)), dev)
                .andExpect(jsonPath("$.rows", hasSize(1)));
        perform(get("/api/v1/projects/{key}/schedules", fx.key()).param("owner", String.valueOf(leaving.getId())), dev)
                .andExpect(jsonPath("$.rows", hasSize(0)));
        assertThat(audit.findRecent(fx.id(), org.springframework.data.domain.PageRequest.of(0, 50)))
                .filteredOn(e -> e.getAction().equals("SCHEDULE_TAKEN_OVER"))
                .singleElement()
                .satisfies(e -> {
                    assertThat(e.getTarget()).isEqualTo("schedule:" + id);
                    assertThat(e.getDetail().path("previousOwnerId").asLong()).isEqualTo(leaving.getId());
                });
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private Fixture fixture(String prefix) {
        int n = SEQ.incrementAndGet();
        AppUser admin = users.create(prefix + n, prefix + n + "@example.com", "Admin", "secret-password");
        Project project = projects.create(new CreateProjectRequest(prefix.replace("-", "") + n, prefix + n, null, "schedule api"),
                admin.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), admin.getId(), "schedule api");
        TemplateView template = templates.create(new CreateTemplateCommand(project.getId(), AssetType.PAGE_TEMPLATE, "Page", CDL,
                Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"), null, false, Map.of()), ctx);
        GenerationTarget target;
        try {
            target = targets.save(new GenerationTarget(project.getId(), "default", TargetType.FILESYSTEM,
                    mapper.readTree("{\"baseUrl\":\"https://example.com\"}"), true));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
        created.add(project.getId());
        return new Fixture(project, admin, ctx, template, target);
    }

    private String member(Fixture fx, ProjectRole role) {
        int n = SEQ.incrementAndGet();
        AppUser user = users.create("s" + n + role.name().toLowerCase(), "s" + n + "@example.com", "Member", "secret-password");
        projects.setMemberRole(fx.key(), user.getId(), role, fx.ctx());
        return jwt.issueAccessToken(users.findById(user.getId()).orElseThrow());
    }

    private String stranger() {
        int n = SEQ.incrementAndGet();
        AppUser user = users.create("x" + n, "x" + n + "@example.com", "Stranger", "secret-password");
        return jwt.issueAccessToken(user);
    }

    private UUID page(Fixture fx, String name) {
        AssetVersionView view = pages.create(new CreatePageCommand(name, null, fx.template().uuid()), fx.ctx());
        AssetVersionView current = assets.requireCurrent(fx.id(), view.uuid());
        ObjectNode payload = current.payload().deepCopy();
        payload.withObject("content").put("title", name);
        pages.update(view.uuid(), payload, current.validFromRevision(), fx.ctx());
        return view.uuid();
    }

    private static Instant future(int hours) {
        return Instant.now().plus(Duration.ofHours(hours)).truncatedTo(ChronoUnit.SECONDS);
    }

    private static String release(Instant runAt, UUID page) {
        return "{\"type\":\"RELEASE\",\"runAt\":\"" + runAt + "\",\"params\":{\"items\":[{\"assetUuid\":\"" + page + "\"}]}}";
    }

    /** A generation schedule; {@code timing} is the JSON members for the time, {@code extra} extra params members. */
    private static String generation(String type, String timing, String extra) {
        return "{\"type\":\"" + type + "\"" + (timing == null ? "" : "," + timing)
                + ",\"params\":{\"mode\":\"FULL\"" + (extra == null ? "" : "," + extra) + "}}";
    }

    private ResultActions create(Fixture fx, String token, String body) throws Exception {
        return perform(post("/api/v1/projects/{key}/schedules", fx.key()).contentType(MediaType.APPLICATION_JSON).content(body), token);
    }

    private ResultActions perform(MockHttpServletRequestBuilder request, String token) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + token));
    }

    private static void expectCode(ResultActions result, int status, String code) throws Exception {
        result.andExpect(status().is(status)).andExpect(jsonPath("$.code").value(code));
    }

    private long id(ResultActions result) throws Exception {
        return id(result.andReturn());
    }

    private long id(MvcResult result) throws Exception {
        return json(result).path("id").asLong();
    }

    private JsonNode json(MvcResult result) throws Exception {
        return mapper.readTree(result.getResponse().getContentAsString());
    }
}
