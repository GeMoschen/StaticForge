package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.audit.AuditLog;
import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.project.publish.PublishPermission;
import com.acme.staticforge.project.publish.PublishPermissionEvaluator;
import com.acme.staticforge.project.publish.PublishPolicy;
import com.acme.staticforge.project.publish.PublishRequirements;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.scheduler.ScheduledAction;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserAdministrationService;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

/**
 * The publish policy (M28.1.1): storage and migration default, {@code GET/PUT /publish-policy}, the impact check,
 * {@code ProjectDetail.publishPolicy/permissions}, and the two evaluators — token-side ({@code @projectAuth.can}) and
 * row-side ({@link PublishPermissionEvaluator}) — agreeing on every role × valid policy.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PublishPolicyApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final String CDL = "content { editor text title { label \"Title\" } }";
    private static final Pattern CAN_LITERAL = Pattern.compile("@projectAuth\\.can\\(#\\w+,\\s*'([^']*)'\\)");

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;
    @Autowired UserService users;
    @Autowired UserAdministrationService administration;
    @Autowired com.acme.staticforge.user.AppUserRepository appUsers;
    @Autowired ProjectService projects;
    @Autowired PageService pages;
    @Autowired TemplateService templates;
    @Autowired GenerationTargetRepository targets;
    @Autowired RevisionRepository revisions;
    @Autowired AuditService audit;
    @Autowired PublishPermissionEvaluator evaluator;
    @Autowired SchedulerFixtures schedules;
    @Autowired ObjectMapper mapper;

    @Autowired
    @Qualifier("requestMappingHandlerMapping")
    RequestMappingHandlerMapping handlerMapping;

    private final List<Long> created = new ArrayList<>();

    private record Fixture(Project project, AppUser admin, RevisionContext ctx, String adminToken) {
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
        created.forEach(schedules::retire);
    }

    @Test
    @DisplayName("a new project opens nothing: GET and the detail show an empty policy; permissions follow the role")
    void newProjectStartsEmpty() throws Exception {
        Fixture fx = fixture("pp-new");
        Member viewer = member(fx, ProjectRole.VIEWER);
        Member editor = member(fx, ProjectRole.EDITOR);
        Member developer = member(fx, ProjectRole.DEVELOPER);

        assertThat(PublishPolicy.fromJson(projects.requireByKey(fx.key()).getPublishPolicy())).isEqualTo(PublishPolicy.EMPTY);
        perform(get("/api/v1/projects/{key}/publish-policy", fx.key()), viewer.token())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.editor", empty()));
        perform(get("/api/v1/projects/{key}", fx.key()), editor.token())
                .andExpect(jsonPath("$.publishPolicy.editor", empty()))
                .andExpect(jsonPath("$.permissions", empty()));
        perform(get("/api/v1/projects/{key}", fx.key()), viewer.token()).andExpect(jsonPath("$.permissions", empty()));
        perform(get("/api/v1/projects/{key}", fx.key()), developer.token())
                .andExpect(jsonPath("$.permissions", contains("RELEASE", "SCHEDULE_RELEASE", "INCREMENTAL_BUILD", "FULL_BUILD")));
        perform(get("/api/v1/projects/{key}", fx.key()), fx.adminToken())
                .andExpect(jsonPath("$.permissions", hasSize(4)));
    }

    @Test
    @DisplayName("PUT records one revision and PUBLISH_POLICY_SET {before, after}; an identical PUT records neither")
    void putRecordsRevisionAndAudit() throws Exception {
        Fixture fx = fixture("pp-put");
        int before = revisions.findByProjectIdOrderByRevisionIdDesc(fx.id()).size();

        putPolicy(fx, fx.adminToken(), "[\"INCREMENTAL_BUILD\", \"RELEASE\"]")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.editor", contains("RELEASE", "INCREMENTAL_BUILD")));

        List<Revision> after = revisions.findByProjectIdOrderByRevisionIdDesc(fx.id());
        assertThat(after).hasSize(before + 1);
        assertThat(after.get(0).getChangeType()).isEqualTo(ChangeType.UPDATE);
        assertThat(after.get(0).getSummary().toString()).contains("publishPolicy");
        List<AuditLog> entries = audit.findRecent(fx.id(), PageRequest.of(0, 50)).stream()
                .filter(e -> e.getAction().equals("PUBLISH_POLICY_SET"))
                .toList();
        assertThat(entries).singleElement().satisfies(e -> {
            assertThat(e.getTarget()).isEqualTo("project:" + fx.key());
            assertThat(e.getDetail().path("before").path("editor")).isEmpty();
            assertThat(e.getDetail().path("after").path("editor").toString()).isEqualTo("[\"RELEASE\",\"INCREMENTAL_BUILD\"]");
        });

        putPolicy(fx, fx.adminToken(), "[\"RELEASE\", \"INCREMENTAL_BUILD\"]").andExpect(status().isOk());
        assertThat(revisions.findByProjectIdOrderByRevisionIdDesc(fx.id())).hasSize(before + 1);
        assertThat(audit.findRecent(fx.id(), PageRequest.of(0, 50)))
                .filteredOn(e -> e.getAction().equals("PUBLISH_POLICY_SET"))
                .hasSize(1);
        perform(get("/api/v1/projects/{key}/publish-policy", fx.key()), member(fx, ProjectRole.VIEWER).token())
                .andExpect(jsonPath("$.editor", contains("RELEASE", "INCREMENTAL_BUILD")));
    }

    @Test
    @DisplayName("PUT: 400 with one error per broken rule or unknown name, 403 below PROJECT_ADMIN, 409 on an archived project")
    void putRules() throws Exception {
        Fixture fx = fixture("pp-rules");
        Member developer = member(fx, ProjectRole.DEVELOPER);

        putPolicy(fx, fx.adminToken(), "[\"SCHEDULE_RELEASE\", \"FULL_BUILD\"]")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("SF-API-0400"))
                .andExpect(jsonPath("$.errors", hasSize(2)))
                .andExpect(jsonPath("$.errors[0]", containsString("SCHEDULE_RELEASE requires RELEASE")))
                .andExpect(jsonPath("$.errors[1]", containsString("FULL_BUILD requires INCREMENTAL_BUILD")));
        putPolicy(fx, fx.adminToken(), "[\"RELEASE\", \"PUBLISH\"]")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors", contains("Unknown publish permission 'PUBLISH'.")));
        putPolicy(fx, developer.token(), "[\"RELEASE\"]").andExpect(status().isForbidden());
        assertThat(projects.publishPolicy(fx.key())).isEqualTo(PublishPolicy.EMPTY);

        projects.archive(fx.key(), fx.ctx());
        String instanceAdmin = instanceAdminToken();
        putPolicy(fx, instanceAdmin, "[\"RELEASE\"]")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-DOM-0141"));
        putPolicy(fx, instanceAdmin, "[]")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-DOM-0141"));
        perform(post("/api/v1/projects/{key}/publish-policy/impact", fx.key())
                .contentType(MediaType.APPLICATION_JSON).content("{\"editor\": []}"), instanceAdmin)
                .andExpect(status().isOk());
        projects.unarchive(fx.key(), fx.ctx());
    }

    @Test
    @DisplayName("next request: an editor's still-valid token gets 403 RELEASE before and 200 after the admin opens RELEASE")
    void appliesOnTheNextRequest() throws Exception {
        Fixture fx = fixture("pp-next");
        UUID page = page(fx, "home");
        Member editor = member(fx, ProjectRole.EDITOR);
        String body = "{\"items\": [{\"assetUuid\": \"" + page + "\"}]}";

        perform(post("/api/v1/projects/{key}/releases", fx.key()).contentType(MediaType.APPLICATION_JSON).content(body), editor.token())
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SF-API-0403"))
                .andExpect(jsonPath("$.permission").value("RELEASE"));
        putPolicy(fx, fx.adminToken(), "[\"RELEASE\"]").andExpect(status().isOk());
        perform(post("/api/v1/projects/{key}/releases", fx.key()).contentType(MediaType.APPLICATION_JSON).content(body), editor.token())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.applied", hasSize(1)));
        perform(get("/api/v1/projects/{key}", fx.key()), editor.token()).andExpect(jsonPath("$.permissions", contains("RELEASE")));
    }

    @Test
    @DisplayName("the token-side check and the evaluator agree for every role × valid policy × permission")
    void evaluatorsAgree() throws Exception {
        Fixture fx = fixture("pp-agree");
        Map<ProjectRole, Member> members = Map.of(
                ProjectRole.VIEWER, member(fx, ProjectRole.VIEWER),
                ProjectRole.EDITOR, member(fx, ProjectRole.EDITOR),
                ProjectRole.DEVELOPER, member(fx, ProjectRole.DEVELOPER),
                ProjectRole.PROJECT_ADMIN, member(fx, ProjectRole.PROJECT_ADMIN));
        int policies = 0;
        for (Set<PublishPermission> subset : subsets()) {
            PublishPolicy policy = new PublishPolicy(subset);
            if (!policy.validate().isEmpty()) {
                continue;
            }
            policies++;
            projects.updatePublishPolicy(fx.key(), policy, fx.ctx());
            for (Map.Entry<ProjectRole, Member> entry : members.entrySet()) {
                Member member = entry.getValue();
                JsonNode detail = json(perform(get("/api/v1/projects/{key}", fx.key()), member.token()));
                Set<String> viaToken = new TreeSet<>();
                detail.path("permissions").forEach(p -> viaToken.add(p.asText()));
                Set<String> viaRow = new TreeSet<>();
                for (PublishPermission permission : PublishPermission.values()) {
                    if (evaluator.permitted(fx.id(), member.user().getId(), permission)) {
                        viaRow.add(permission.name());
                    }
                }
                assertThat(viaToken).as("%s under %s", entry.getKey(), subset).isEqualTo(viaRow);
                assertThat(viaRow).as("%s under %s", entry.getKey(), subset)
                        .isEqualTo(names(policy.effective(entry.getKey())));
            }
        }
        assertThat(policies).isEqualTo(9);
    }

    @Test
    @DisplayName("a disabled member holds nothing in the evaluator, whatever role and policy")
    void disabledHoldsNothing() {
        Fixture fx = fixture("pp-disabled");
        Member developer = member(fx, ProjectRole.DEVELOPER);
        projects.updatePublishPolicy(fx.key(), PublishPolicy.of(PublishPermission.values()), fx.ctx());
        assertThat(evaluator.permitted(fx.id(), developer.user().getId(), PublishPermission.RELEASE)).isTrue();

        administration.disable(developer.user().getId(), fx.admin().getId());

        assertThat(evaluator.permitted(fx.id(), developer.user().getId(), PublishPermission.RELEASE)).isFalse();
        assertThat(evaluator.hasRole(fx.id(), developer.user().getId(), ProjectRole.VIEWER)).isFalse();
        assertThat(evaluator.denial(fx.id(), developer.user().getId(), PublishRequirements.permission(PublishPermission.RELEASE)))
                .hasValueSatisfying(d -> {
                    assertThat(d.reason()).contains("is disabled");
                    assertThat(d.missing()).isNull();
                });
    }

    @Test
    @DisplayName("impact lists exactly the editor-owned pending schedules the proposal would make fail, with what they'd lose")
    void impact() throws Exception {
        Fixture fx = fixture("pp-impact");
        GenerationTarget second = target(fx, "second", false);
        Member editor = member(fx, ProjectRole.EDITOR);
        Member developer = member(fx, ProjectRole.DEVELOPER);
        projects.updatePublishPolicy(fx.key(), PublishPolicy.of(PublishPermission.values()), fx.ctx());
        Instant runAt = Instant.now().plus(Duration.ofDays(3)).truncatedTo(ChronoUnit.SECONDS);
        ScheduledAction plain = schedules.oneOff(fx.id(), "RELEASE", mapper.readTree("{\"items\":[]}"), runAt, editor.user().getId());
        UUID home = page(fx, "home");
        ScheduledAction toSecond = schedules.oneOff(
                fx.id(), "RELEASE", mapper.readTree("{\"items\":[{\"assetUuid\":\"" + home + "\"}]}"), runAt, editor.user().getId());
        toSecond.setThenGenerate(mapper.readTree("{\"targetId\":" + second.getId() + ",\"channels\":[]}"));
        schedules.save(toSecond);
        schedules.oneOff(fx.id(), "RELEASE", mapper.readTree("{\"items\":[]}"), runAt, developer.user().getId());

        JsonNode noFull = json(impact(fx, "[\"RELEASE\", \"SCHEDULE_RELEASE\", \"INCREMENTAL_BUILD\"]"));
        assertThat(noFull.path("failingSchedules")).hasSize(1);
        JsonNode failing = noFull.path("failingSchedules").get(0);
        assertThat(failing.path("id").asLong()).isEqualTo(toSecond.getId());
        assertThat(failing.path("type").asText()).isEqualTo("RELEASE");
        assertThat(Instant.parse(failing.path("runAt").asText())).isEqualTo(runAt);
        assertThat(failing.path("ownerUserId").asLong()).isEqualTo(editor.user().getId());
        assertThat(failing.path("ownerName").asText()).isEqualTo("Member");
        assertThat(failing.path("missingPermission").asText()).isEqualTo("FULL_BUILD");
        assertThat(failing.path("itemName").asText()).isEqualTo("home");
        assertThat(failing.path("itemCount").asInt()).isEqualTo(1);

        JsonNode nothing = json(impact(fx, "[]"));
        assertThat(nothing.path("failingSchedules")).extracting(n -> n.path("id").asLong())
                .containsExactlyInAnyOrder(plain.getId(), toSecond.getId());
        assertThat(nothing.path("failingSchedules")).extracting(n -> n.path("missingPermission").asText())
                .containsOnly("SCHEDULE_RELEASE");
        // A schedule without items has no item name.
        JsonNode itemless = null;
        for (JsonNode n : nothing.path("failingSchedules")) {
            if (n.path("id").asLong() == plain.getId()) {
                itemless = n;
            }
        }
        assertThat(itemless).isNotNull();
        assertThat(itemless.path("itemName").isNull()).isTrue();
        assertThat(itemless.path("itemCount").asInt()).isZero();
        assertThat(json(impact(fx, "[\"RELEASE\", \"SCHEDULE_RELEASE\", \"INCREMENTAL_BUILD\", \"FULL_BUILD\"]"))
                .path("failingSchedules")).isEmpty();
        impact(fx, "[\"FULL_BUILD\"]", fx.adminToken()).andExpect(status().isOk());
        impact(fx, "[]", developer.token()).andExpect(status().isForbidden());
        assertThat(projects.publishPolicy(fx.key()).editor()).hasSize(4);
    }

    @Test
    @DisplayName("every @projectAuth.can(…) literal in @PreAuthorize names a publish permission or ROLE:<role>")
    void canLiteralsAreKnown() {
        List<String> literals = new ArrayList<>();
        handlerMapping.getHandlerMethods().values().forEach(method -> {
            PreAuthorize annotation = method.getMethodAnnotation(PreAuthorize.class);
            if (annotation == null) {
                return;
            }
            Matcher matcher = CAN_LITERAL.matcher(annotation.value());
            while (matcher.find()) {
                String literal = matcher.group(1);
                literals.add(literal);
                assertThat(PublishRequirements.parse(literal))
                        .as("%s on %s", literal, method.getMethod())
                        .isNotNull();
            }
            assertThat(annotation.value().contains("@projectAuth.can(") == CAN_LITERAL.matcher(annotation.value()).find())
                    .as("every can(...) on %s uses a literal", method.getMethod())
                    .isTrue();
        });
        assertThat(literals).contains("RELEASE", "ROLE:DEVELOPER");
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private static List<Set<PublishPermission>> subsets() {
        List<Set<PublishPermission>> all = new ArrayList<>();
        PublishPermission[] values = PublishPermission.values();
        for (int mask = 0; mask < 1 << values.length; mask++) {
            Set<PublishPermission> subset = java.util.EnumSet.noneOf(PublishPermission.class);
            for (int i = 0; i < values.length; i++) {
                if ((mask & 1 << i) != 0) {
                    subset.add(values[i]);
                }
            }
            all.add(subset);
        }
        return all;
    }

    private static Set<String> names(Set<PublishPermission> permissions) {
        Set<String> out = new TreeSet<>();
        permissions.forEach(p -> out.add(p.name()));
        return out;
    }

    private Fixture fixture(String prefix) {
        int n = SEQ.incrementAndGet();
        AppUser admin = users.create(prefix + n, prefix + n + "@example.com", "Admin", "secret-password");
        Project project = projects.create(new CreateProjectRequest(prefix.replace("-", "") + n, prefix + n, null, "publish policy"),
                admin.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), admin.getId(), "publish policy");
        created.add(project.getId());
        target(project.getId(), "default", true);
        return new Fixture(project, admin, ctx, jwt.issueAccessToken(users.findById(admin.getId()).orElseThrow()));
    }

    private GenerationTarget target(Fixture fx, String name, boolean isDefault) {
        return target(fx.id(), name, isDefault);
    }

    private GenerationTarget target(long projectId, String name, boolean isDefault) {
        try {
            return targets.save(new GenerationTarget(projectId, name, TargetType.FILESYSTEM,
                    mapper.readTree("{\"baseUrl\":\"https://example.com\"}"), isDefault));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private Member member(Fixture fx, ProjectRole role) {
        int n = SEQ.incrementAndGet();
        AppUser user = users.create("pp" + n + role.name().toLowerCase(), "pp" + n + "@example.com", "Member", "secret-password");
        projects.setMemberRole(fx.key(), user.getId(), role, fx.ctx());
        AppUser fresh = users.findById(user.getId()).orElseThrow();
        return new Member(fresh, jwt.issueAccessToken(fresh));
    }

    private String instanceAdminToken() {
        int n = SEQ.incrementAndGet();
        AppUser user = users.create("ppia" + n, "ppia" + n + "@example.com", "Instance admin", "secret-password");
        user.setSystemRole(com.acme.staticforge.user.SystemRole.INSTANCE_ADMIN);
        return jwt.issueAccessToken(appUsers.save(user));
    }

    private UUID page(Fixture fx, String name) {
        TemplateView template = templates.create(new CreateTemplateCommand(fx.id(), AssetType.PAGE_TEMPLATE, "Page " + name, CdlSources.split(CDL),
                Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"), null, false, Map.of()), fx.ctx());
        return pages.create(new CreatePageCommand(name, null, template.uuid()), fx.ctx()).uuid();
    }

    private ResultActions putPolicy(Fixture fx, String token, String editor) throws Exception {
        return perform(put("/api/v1/projects/{key}/publish-policy", fx.key())
                .contentType(MediaType.APPLICATION_JSON).content("{\"editor\": " + editor + "}"), token);
    }

    private ResultActions impact(Fixture fx, String editor) throws Exception {
        return impact(fx, editor, fx.adminToken()).andExpect(status().isOk());
    }

    private ResultActions impact(Fixture fx, String editor, String token) throws Exception {
        return perform(post("/api/v1/projects/{key}/publish-policy/impact", fx.key())
                .contentType(MediaType.APPLICATION_JSON).content("{\"editor\": " + editor + "}"), token);
    }

    private ResultActions perform(MockHttpServletRequestBuilder request, String token) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + token));
    }

    private JsonNode json(ResultActions result) throws Exception {
        return mapper.readTree(result.andReturn().getResponse().getContentAsString());
    }
}
