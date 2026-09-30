package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.acme.staticforge.api.GenerationController;
import com.acme.staticforge.api.PublishPolicyController;
import com.acme.staticforge.api.ReleaseController;
import com.acme.staticforge.api.ScheduleController;
import com.acme.staticforge.api.TargetController;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationRunRepository;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.project.publish.PublishPermission;
import com.acme.staticforge.project.publish.PublishPolicy;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.scheduler.ScheduledAction;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.AppUserRepository;
import com.acme.staticforge.user.SystemRole;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

/**
 * The permission matrix walk (M28.2.3): every mutating handler of the publishing controllers, for {@code VIEWER},
 * {@code EDITOR} under each of the 9 storable policies, {@code DEVELOPER}, {@code PROJECT_ADMIN} and an instance admin.
 * The expectation of each case is written out here — independent of the production rule — as the requirement it
 * names: a publish permission, a minimum role, or both. "Allowed" is any answer but 403 (a 409 because a run is
 * active, a 404 for an unknown id or a 422 all pass); "denied" is {@code 403 SF-API-0403} naming the expected
 * {@code permission}.
 *
 * <p>Fails when a mutating handler of these controllers has no case, or a case names a handler that doesn't exist.
 * Side effects are contained: a queued run by the project admin is always active, so allowed starts answer 409 and
 * never build; schedules that a case changes are recreated before every call.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PublishPermissionMatrixTest {

    private static final List<Class<?>> CONTROLLERS = List.of(
            GenerationController.class, TargetController.class, ReleaseController.class, ScheduleController.class,
            PublishPolicyController.class);
    private static final Set<RequestMethod> MUTATING =
            EnumSet.of(RequestMethod.POST, RequestMethod.PUT, RequestMethod.PATCH, RequestMethod.DELETE);
    private static final String CDL = "content { editor text title { label \"Title\" } }";
    private static final long UNKNOWN_ID = 987_654_321L;

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;
    @Autowired UserService users;
    @Autowired AppUserRepository appUsers;
    @Autowired ProjectService projects;
    @Autowired PageService pages;
    @Autowired TemplateService templates;
    @Autowired GenerationTargetRepository targets;
    @Autowired GenerationRunRepository runs;
    @Autowired SchedulerFixtures schedules;
    @Autowired ObjectMapper mapper;

    @Autowired
    @Qualifier("requestMappingHandlerMapping")
    RequestMappingHandlerMapping handlerMapping;

    private Project project;
    private AppUser admin;
    private RevisionContext ctx;
    private GenerationTarget primary;
    private GenerationTarget second;
    private UUID page;
    private GenerationRun activeRun;

    /**
     * A requirement — the expectation of one case: a role the annotation checks first ({@code gate}), then a minimum
     * role and publish permissions in the order a denial reports them.
     */
    private record Need(ProjectRole gate, ProjectRole role, List<PublishPermission> permissions) {
        static Need role(ProjectRole role) {
            return new Need(ProjectRole.VIEWER, role, List.of());
        }

        static Need permission(PublishPermission... permissions) {
            return new Need(ProjectRole.VIEWER, ProjectRole.VIEWER, List.of(permissions));
        }

        /** The generation endpoints: {@code EDITOR} at the annotation, then what the request needs. */
        Need behindEditorGate() {
            return new Need(ProjectRole.EDITOR, role, permissions);
        }

        /** What a member with {@code memberRole} under {@code editorPolicy} lacks — the rule of epic decisions 2, 6. */
        Optional<String> missing(ProjectRole memberRole, Set<PublishPermission> editorPolicy) {
            if (memberRole.ordinal() < gate.ordinal()) {
                return Optional.of("ROLE:" + gate.name());
            }
            if (memberRole.ordinal() < role.ordinal()) {
                return Optional.of("ROLE:" + role.name());
            }
            for (PublishPermission permission : permissions) {
                boolean held = switch (memberRole) {
                    case VIEWER -> false;
                    case EDITOR -> editorPolicy.contains(permission);
                    case DEVELOPER, PROJECT_ADMIN -> true;
                };
                if (!held) {
                    return Optional.of(permission.name());
                }
            }
            return Optional.empty();
        }
    }

    /** One request to one handler: how to build it (fresh per call) and what it needs. */
    private record Case(String handler, String label, Supplier<MockHttpServletRequestBuilder> request, Need need) {}

    /** A caller: a role in the project (none for the instance admin) and a token. */
    private record Caller(String name, ProjectRole role, String token) {}

    @BeforeEach
    void seed() throws Exception {
        int n = (int) (System.nanoTime() % 1_000_000);
        admin = users.create("pmx-admin" + n, "pmx-admin" + n + "@example.com", "Matrix admin", "secret-password");
        project = projects.create(new CreateProjectRequest("pmx" + n, "pmx " + n, null, "permission matrix"), admin.getId());
        ctx = RevisionContext.of(project.getId(), admin.getId(), "permission matrix");
        TemplateView template = templates.create(new CreateTemplateCommand(project.getId(), AssetType.PAGE_TEMPLATE, "Page", CdlSources.split(CDL),
                Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"), null, false, Map.of()), ctx);
        page = pages.create(new CreatePageCommand("home", null, template.uuid()), ctx).uuid();
        primary = targets.save(new GenerationTarget(project.getId(), "primary", TargetType.FILESYSTEM,
                mapper.readTree("{\"baseUrl\":\"https://example.com\"}"), true));
        second = targets.save(new GenerationTarget(project.getId(), "second", TargetType.FILESYSTEM,
                mapper.readTree("{\"baseUrl\":\"https://example.org\",\"path\":\"second\"}"), false));
    }

    @AfterEach
    void retire() {
        schedules.retire(project.getId());
        runs.findActive(project.getId()).ifPresent(run -> {
            run.setStatus(RunStatus.CANCELLED);
            runs.save(run);
        });
    }

    @Test
    @DisplayName("every publishing handler × every role and storable editor policy: allowed, or 403 naming what is missing")
    void matrix() throws Exception {
        List<Case> cases = cases();
        assertThat(new TreeSet<>(cases.stream().map(Case::handler).toList()))
                .as("every mutating handler of the publishing controllers has a case, and every case a handler")
                .isEqualTo(mutatingHandlers());

        List<Caller> callers = callers();
        List<Set<PublishPermission>> policies = storablePolicies();
        assertThat(policies).hasSize(9);
        List<String> mismatches = new ArrayList<>();
        int checked = 0;
        for (Set<PublishPermission> policy : policies) {
            projects.updatePublishPolicy(project.getKey(), new PublishPolicy(policy), ctx);
            for (Caller caller : callers) {
                // Roles other than EDITOR don't depend on the policy: walk them once.
                if (caller.role() != ProjectRole.EDITOR && !policy.isEmpty()) {
                    continue;
                }
                for (Case c : cases) {
                    Optional<String> expected = caller.role() == null ? Optional.empty() : c.need().missing(caller.role(), policy);
                    MockHttpServletResponse response = perform(c, caller);
                    String actual = outcome(response);
                    String wanted = expected.map(m -> "403 " + m).orElse("allowed");
                    checked++;
                    if (!actual.equals(wanted)) {
                        mismatches.add(c.label() + " as " + caller.name() + " under " + policy + ": expected " + wanted
                                + ", got " + actual + " " + response.getContentAsString());
                    }
                }
            }
        }
        assertThat(mismatches).as("%d checks", checked).isEmpty();
    }

    // ------------------------------------------------------------------
    // The expectation table
    // ------------------------------------------------------------------

    private List<Case> cases() {
        String gen = base() + "/generations";
        String sched = base() + "/schedules";
        Need incremental = Need.permission(PublishPermission.INCREMENTAL_BUILD).behindEditorGate();
        Need full = Need.permission(PublishPermission.FULL_BUILD).behindEditorGate();
        Need developer = Need.role(ProjectRole.DEVELOPER);
        Need admin = Need.role(ProjectRole.PROJECT_ADMIN);
        Need release = Need.permission(PublishPermission.RELEASE);
        Need scheduleRelease = Need.permission(PublishPermission.SCHEDULE_RELEASE);

        Map<String, Need> generationBodies = new LinkedHashMap<>();
        generationBodies.put("{\"mode\":\"INCREMENTAL\"}", incremental);
        generationBodies.put("{\"mode\":\"INCREMENTAL\",\"folderPath\":\"/\"}", incremental);
        generationBodies.put("{\"mode\":\"INCREMENTAL\",\"targetId\":" + primary.getId() + "}", incremental);
        generationBodies.put("{}", full);
        generationBodies.put("{\"mode\":\"FULL\"}", full);
        generationBodies.put("{\"mode\":\"INCREMENTAL\",\"targetId\":" + second.getId() + "}", full);
        generationBodies.put("{\"mode\":\"INCREMENTAL\",\"revision\":1}", Need.role(ProjectRole.DEVELOPER).behindEditorGate());

        List<Case> cases = new ArrayList<>();
        generationBodies.forEach((body, need) -> {
            cases.add(new Case("GenerationController#start", "start " + body, () -> json(post(gen), body), need));
            cases.add(new Case("GenerationController#plan", "plan " + body, () -> json(post(gen + "/plan"), body), need));
        });
        cases.add(new Case("GenerationController#cancel", "cancel another user's run",
                () -> post(gen + "/{id}/cancel", activeRun().getId()), Need.role(ProjectRole.DEVELOPER).behindEditorGate()));
        cases.add(new Case("GenerationController#promote", "promote", () -> post(gen + "/{id}/promote", UNKNOWN_ID), developer));

        String targetBody = "{\"name\":\"t\",\"type\":\"FILESYSTEM\",\"config\":{\"baseUrl\":\"https://t.example\"},\"isDefault\":false}";
        cases.add(new Case("TargetController#create", "create target", () -> json(post(base() + "/targets"), targetBody), developer));
        cases.add(new Case("TargetController#update", "update target",
                () -> json(put(base() + "/targets/{id}", UNKNOWN_ID), targetBody), admin));
        cases.add(new Case("TargetController#delete", "delete target", () -> delete(base() + "/targets/{id}", UNKNOWN_ID), admin));

        String items = "{\"items\":[{\"assetUuid\":\"" + page + "\"}]}";
        cases.add(new Case("ReleaseController#plan", "release plan", () -> json(post(base() + "/releases/plan"), items),
                Need.role(ProjectRole.VIEWER)));
        cases.add(new Case("ReleaseController#release", "release", () -> json(post(base() + "/releases"), items), release));
        cases.add(new Case("ReleaseController#unpublish", "unpublish", () -> json(post(base() + "/releases/unpublish"), items), release));
        cases.add(new Case("ReleaseController#discard", "discard", () -> json(post(base() + "/releases/discard"), items), release));

        cases.add(new Case("ScheduleController#create", "schedule release",
                () -> json(post(sched), releaseSchedule(null)), scheduleRelease));
        cases.add(new Case("ScheduleController#create", "schedule unpublish",
                () -> json(post(sched), "{\"type\":\"UNPUBLISH\",\"runAt\":\"" + future() + "\",\"params\":" + items + "}"),
                scheduleRelease));
        cases.add(new Case("ScheduleController#create", "schedule release, then build to the default target",
                () -> json(post(sched), releaseSchedule("{\"targetId\":null}")),
                Need.permission(PublishPermission.SCHEDULE_RELEASE, PublishPermission.INCREMENTAL_BUILD)));
        cases.add(new Case("ScheduleController#create", "schedule release, then build to another target",
                () -> json(post(sched), releaseSchedule("{\"targetId\":" + second.getId() + "}")),
                Need.permission(PublishPermission.SCHEDULE_RELEASE, PublishPermission.FULL_BUILD)));
        cases.add(new Case("ScheduleController#create", "schedule a generation",
                () -> json(post(sched), "{\"type\":\"GENERATION\",\"runAt\":\"" + future() + "\",\"params\":{\"mode\":\"INCREMENTAL\"}}"),
                developer));
        cases.add(new Case("ScheduleController#create", "schedule a recurring generation",
                () -> json(post(sched), "{\"type\":\"RECURRING_GENERATION\",\"cron\":\"0 0 3 * * *\",\"zoneId\":\"UTC\","
                        + "\"params\":{\"mode\":\"INCREMENTAL\"}}"),
                developer));
        // Someone else's (the project admin's) release schedule, fresh for every call.
        Need foreign = new Need(ProjectRole.VIEWER, ProjectRole.DEVELOPER, List.of(PublishPermission.SCHEDULE_RELEASE));
        cases.add(new Case("ScheduleController#update", "edit another user's schedule", () -> {
            ScheduledAction action = adminsSchedule();
            return json(put(sched + "/{id}", action.getId()).header("If-Match", "\"v" + action.getVersion() + "\""),
                    releaseSchedule(null));
        }, foreign));
        cases.add(new Case("ScheduleController#cancel", "cancel another user's schedule",
                () -> post(sched + "/{id}/cancel", adminsSchedule().getId()), foreign));
        cases.add(new Case("ScheduleController#runNow", "run another user's schedule now",
                () -> post(sched + "/{id}/run-now", adminsSchedule().getId()), foreign));
        cases.add(new Case("ScheduleController#repin", "re-pin another user's schedule",
                () -> post(sched + "/{id}/repin", adminsSchedule().getId()), foreign));
        cases.add(new Case("ScheduleController#takeOver", "take over a release schedule",
                () -> post(sched + "/{id}/take-over", adminsSchedule().getId()), scheduleRelease));
        cases.add(new Case("ScheduleController#takeOver", "take over a generation schedule",
                () -> post(sched + "/{id}/take-over", adminsGenerationSchedule().getId()), developer));
        cases.add(new Case("ScheduleController#previewTimes", "preview cron times",
                () -> json(post(sched + "/preview-times"), "{\"cron\":\"0 0 3 * * *\",\"zoneId\":\"UTC\"}"),
                Need.role(ProjectRole.VIEWER)));

        cases.add(new Case("PublishPolicyController#update", "set the publish policy",
                () -> json(put(base() + "/publish-policy"), "{\"editor\":" + currentPolicyJson() + "}"), admin));
        cases.add(new Case("PublishPolicyController#impact", "policy impact",
                () -> json(post(base() + "/publish-policy/impact"), "{\"editor\":[]}"), admin));
        return cases;
    }

    // ------------------------------------------------------------------
    // Fixtures per call
    // ------------------------------------------------------------------

    /** The run that is always active: queued by the project admin, never executed. Recreated once cancelled. */
    private GenerationRun activeRun() {
        if (activeRun == null || runs.findById(activeRun.getId()).map(r -> r.getStatus() != RunStatus.QUEUED).orElse(true)) {
            runs.findActive(project.getId()).ifPresent(run -> {
                run.setStatus(RunStatus.CANCELLED);
                runs.save(run);
            });
            activeRun = runs.saveAndFlush(new GenerationRun(project.getId(), null, GenerationMode.INCREMENTAL, "[]", null,
                    RunStatus.QUEUED, Instant.now(), null, admin.getId(), 0, 0, 0, 0, 0, null, null));
        }
        return activeRun;
    }

    private ScheduledAction adminsSchedule() {
        try {
            return schedules.oneOff(project.getId(), "RELEASE",
                    mapper.readTree("{\"items\":[{\"assetUuid\":\"" + page + "\",\"locale\":null}]}"), future(), admin.getId());
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private ScheduledAction adminsGenerationSchedule() {
        try {
            return schedules.oneOff(project.getId(), "GENERATION", mapper.readTree("{\"mode\":\"INCREMENTAL\"}"), future(),
                    admin.getId());
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private String currentPolicyJson() {
        return projects.publishPolicy(project.getKey()).toJson().path("editor").toString();
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private List<Caller> callers() {
        List<Caller> callers = new ArrayList<>();
        for (ProjectRole role : ProjectRole.values()) {
            AppUser user = users.create("pmx-" + role.name().toLowerCase() + System.nanoTime(),
                    "pmx" + System.nanoTime() + "@example.com", "Matrix " + role, "secret-password");
            projects.setMemberRole(project.getKey(), user.getId(), role, ctx);
            callers.add(new Caller(role.name(), role, jwt.issueAccessToken(users.findById(user.getId()).orElseThrow())));
        }
        AppUser instanceAdmin = users.create("pmx-ia" + System.nanoTime(), "pmxia" + System.nanoTime() + "@example.com",
                "Matrix IA", "secret-password");
        instanceAdmin.setSystemRole(SystemRole.INSTANCE_ADMIN);
        callers.add(new Caller("INSTANCE_ADMIN", null, jwt.issueAccessToken(appUsers.save(instanceAdmin))));
        return callers;
    }

    private static List<Set<PublishPermission>> storablePolicies() {
        List<Set<PublishPermission>> out = new ArrayList<>();
        PublishPermission[] values = PublishPermission.values();
        for (int mask = 0; mask < 1 << values.length; mask++) {
            EnumSet<PublishPermission> subset = EnumSet.noneOf(PublishPermission.class);
            for (int i = 0; i < values.length; i++) {
                if ((mask & 1 << i) != 0) {
                    subset.add(values[i]);
                }
            }
            if (new PublishPolicy(subset).validate().isEmpty()) {
                out.add(subset);
            }
        }
        return out;
    }

    private Set<String> mutatingHandlers() {
        Set<String> handlers = new TreeSet<>();
        for (Map.Entry<RequestMappingInfo, HandlerMethod> entry : handlerMapping.getHandlerMethods().entrySet()) {
            Class<?> type = entry.getValue().getBeanType();
            if (CONTROLLERS.contains(type)
                    && entry.getKey().getMethodsCondition().getMethods().stream().anyMatch(MUTATING::contains)) {
                handlers.add(type.getSimpleName() + "#" + entry.getValue().getMethod().getName());
            }
        }
        return handlers;
    }

    private MockHttpServletResponse perform(Case c, Caller caller) throws Exception {
        activeRun();
        return mvc.perform(c.request().get().header("Authorization", "Bearer " + caller.token())).andReturn().getResponse();
    }

    private String outcome(MockHttpServletResponse response) throws Exception {
        if (response.getStatus() != 403) {
            return "allowed";
        }
        JsonNode problem = mapper.readTree(response.getContentAsString());
        return "403 " + (problem.path("code").asText().equals("SF-API-0403") ? problem.path("permission").asText("<none>") : problem);
    }

    private String base() {
        return "/api/v1/projects/" + project.getKey();
    }

    private static MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder request, String body) {
        return request.contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private String releaseSchedule(String thenGenerate) {
        return "{\"type\":\"RELEASE\",\"runAt\":\"" + future() + "\",\"params\":{\"items\":[{\"assetUuid\":\"" + page + "\"}]}"
                + (thenGenerate == null ? "" : ",\"thenGenerate\":" + thenGenerate) + "}";
    }

    private static Instant future() {
        return Instant.now().plus(Duration.ofDays(2)).truncatedTo(ChronoUnit.SECONDS);
    }
}
