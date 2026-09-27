package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.asset.template.UpdateTemplateCommand;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionDiff;
import com.acme.staticforge.revision.RevisionService;
import com.acme.staticforge.revision.compaction.RevisionCompactor;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Compacted history in the API (M29.4.3): revision flags, point-in-time reads, the diff of a compacted revision (a mix
 * of compacted and exact assets), restore from a compacted revision, the preview header and {@code compactedThrough};
 * and no change for a project that was never compacted.
 *
 * <p>The fixture: page P has five versions on day 1 (created, P1, P2, P3, P4) and P5 the next day; page Q has three on
 * day 1 (created, Q1 released, Q2) and Q3 the next day. One compound revision {@code batch} saves P3 and Q2. After
 * compaction P's day-1 versions are absorbed into P4, and Q's creation into Q1: in {@code batch}, P is compacted and Q
 * exact.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CompactedHistoryApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final Instant DAY_1 = CompactionFixtures.DAY_1;
    private static final String CDL = "content { editor text title { label \"Title\" } }";

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;
    @Autowired UserService users;
    @Autowired ProjectService projects;
    @Autowired AssetService assets;
    @Autowired PageService pages;
    @Autowired TemplateService templates;
    @Autowired ReleaseService releases;
    @Autowired MediaService media;
    @Autowired RevisionService revisionService;
    @Autowired RevisionCompactor compactor;
    @Autowired CompactionFixtures history;
    @Autowired PlatformTransactionManager transactionManager;
    @Autowired ObjectMapper mapper;

    private record Fx(Project project, AppUser user, String token, TemplateView template) {
        long id() {
            return project.getId();
        }

        String key() {
            return project.getKey();
        }

        RevisionContext ctx() {
            return RevisionContext.of(project.getId(), user.getId(), "compacted reads");
        }
    }

    private record Scenario(Fx fx, UUID p, UUID q, long pCreated, long batch, long p4, long p5, long head) {}

    @Test
    @DisplayName("revision list and detail flag compacted revisions; the project shows compactedThrough")
    void revisionFlags() throws Exception {
        Scenario s = compactedScenario();

        JsonNode list = json(perform(get("/api/v1/projects/{key}/revisions?size=100", s.fx().key()), s.fx()));
        Map<Long, Boolean> flags = new java.util.TreeMap<>();
        list.forEach(r -> flags.put(r.path("revisionId").asLong(), r.path("compacted").asBoolean()));
        assertThat(flags).containsEntry(s.pCreated(), true).containsEntry(s.batch(), true)
                .containsEntry(s.p4(), false).containsEntry(s.p5(), false);
        perform(get("/api/v1/projects/{key}/revisions/{r}", s.fx().key(), s.batch()), s.fx())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.compacted").value(true));
        perform(get("/api/v1/projects/{key}", s.fx().key()), s.fx())
                .andExpect(jsonPath("$.compactedThrough").value(s.head()));
    }

    @Test
    @DisplayName("an asset read at a compacted revision is flagged and shows the survivor; at an exact one it isn't")
    void pointInTimeReads() throws Exception {
        Scenario s = compactedScenario();

        perform(get("/api/v1/projects/{key}/assets/{uuid}/versions/{r}", s.fx().key(), s.p(), s.batch()), s.fx())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.compacted").value(true))
                .andExpect(jsonPath("$.payload.content.title").value("P4"));
        perform(get("/api/v1/projects/{key}/assets/{uuid}/versions/{r}", s.fx().key(), s.p(), s.p4()), s.fx())
                .andExpect(jsonPath("$.compacted").value(false))
                .andExpect(jsonPath("$.payload.content.title").value("P4"));
        perform(get("/api/v1/projects/{key}/assets/{uuid}/versions/{r}", s.fx().key(), s.p(), s.p5()), s.fx())
                .andExpect(jsonPath("$.compacted").value(false))
                .andExpect(jsonPath("$.payload.content.title").value("P5"));
        perform(get("/api/v1/projects/{key}/assets/{uuid}/versions/{r}", s.fx().key(), s.q(), s.batch()), s.fx())
                .andExpect(jsonPath("$.compacted").value(false))
                .andExpect(jsonPath("$.payload.content.title").value("Q2"));
        // The current read never is.
        perform(get("/api/v1/projects/{key}/assets/{uuid}", s.fx().key(), s.p()), s.fx())
                .andExpect(jsonPath("$.compacted").value(false));
    }

    @Test
    @DisplayName("the diff of a compacted revision: the absorbed asset flagged without changes, the exact one diffed, the message")
    void diffMixesCompactedAndExactAssets() throws Exception {
        Scenario s = compactedScenario();

        JsonNode diff = json(perform(get("/api/v1/projects/{key}/revisions/{r}/diff", s.fx().key(), s.batch()), s.fx()));
        assertThat(diff.path("compacted").asBoolean()).isTrue();
        assertThat(diff.path("message").asText()).isEqualTo(RevisionDiff.COMPACTED_MESSAGE);
        JsonNode p = entry(diff, s.p());
        JsonNode q = entry(diff, s.q());
        assertThat(p.path("compacted").asBoolean()).isTrue();
        assertThat(p.path("changes")).isEmpty();
        assertThat(p.path("action").asText()).isEqualTo("UPDATE");
        assertThat(q.path("compacted").asBoolean()).isFalse();
        assertThat(q.path("changes")).singleElement().satisfies(change -> {
            assertThat(change.path("path").asText()).isEqualTo("content.title");
            assertThat(change.path("before").asText()).isEqualTo("Q1");
            assertThat(change.path("after").asText()).isEqualTo("Q2");
        });

        // P4's own revision: its "before" was absorbed too, so the change can't be shown either.
        perform(get("/api/v1/projects/{key}/revisions/{r}/diff", s.fx().key(), s.p4()), s.fx())
                .andExpect(jsonPath("$.compacted").value(true))
                .andExpect(jsonPath("$.assets[0].compacted").value(true));
        // The next day is exact.
        perform(get("/api/v1/projects/{key}/revisions/{r}/diff", s.fx().key(), s.p5()), s.fx())
                .andExpect(jsonPath("$.compacted").value(false))
                .andExpect(jsonPath("$.message").isEmpty())
                .andExpect(jsonPath("$.assets[0].compacted").value(false))
                .andExpect(jsonPath("$.assets[0].changes", hasSize(1)))
                .andExpect(jsonPath("$.assets[0].changes[0].before").value("P4"))
                .andExpect(jsonPath("$.assets[0].changes[0].after").value("P5"));
    }

    @Test
    @DisplayName("restore from a compacted revision restores the surviving version and says so")
    void restoreFromACompactedRevision() throws Exception {
        Scenario s = compactedScenario();

        perform(post("/api/v1/projects/{key}/assets/{uuid}/restore", s.fx().key(), s.p())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fromRevision\": " + s.batch() + "}"), s.fx())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.compacted").value(true))
                .andExpect(jsonPath("$.payload.content.title").value("P4"));
        perform(post("/api/v1/projects/{key}/assets/{uuid}/restore", s.fx().key(), s.p())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fromRevision\": " + s.p5() + "}"), s.fx())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.compacted").value(false))
                .andExpect(jsonPath("$.payload.content.title").value("P5"));
        perform(post("/api/v1/projects/{key}/restore", s.fx().key())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"toRevision\": " + s.batch() + "}"), s.fx())
                .andExpect(status().isOk())
                .andExpect(header().string("X-SF-Compacted", "true"))
                .andExpect(jsonPath("$.compacted").value(false));
    }

    @Test
    @DisplayName("a draft preview at a compacted revision carries X-SF-Compacted; later and current previews don't")
    void previewHeader() throws Exception {
        Scenario s = compactedScenario();

        perform(get("/api/v1/projects/{key}/preview/pages/{uuid}?revision={r}", s.fx().key(), s.p(), s.batch()), s.fx())
                .andExpect(status().isOk())
                .andExpect(header().string("X-SF-Compacted", "true"));
        perform(get("/api/v1/projects/{key}/preview/pages/{uuid}?revision={r}", s.fx().key(), s.p(), s.p5()), s.fx())
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist("X-SF-Compacted"));
        perform(get("/api/v1/projects/{key}/preview/pages/{uuid}", s.fx().key(), s.p()), s.fx())
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist("X-SF-Compacted"));
    }

    @Test
    @DisplayName("a preview at an old revision after compaction renders the surviving template, never a cached removed one")
    void previewUsesTheSurvivingTemplate() throws Exception {
        Fx fx = fixture("chtpl");
        UUID page = page(fx, "tp", "Title");
        long first = history.head(fx.id());
        template(fx, "<h2>$CMS_VALUE(title)$</h2>");
        template(fx, "<h3>$CMS_VALUE(title)$</h3>");
        long dayEnd = history.head(fx.id());
        template(fx, "<h4>$CMS_VALUE(title)$</h4>");
        long head = history.head(fx.id());
        history.backdate(fx.id(), 1, dayEnd, DAY_1);
        history.backdate(fx.id(), dayEnd + 1, head, DAY_1.plus(Duration.ofDays(1)));
        // Warm the compile cache with the template version valid at `first`.
        assertThat(preview(fx, page, first)).contains("<h1>Title</h1>");

        compactor.compact(fx.id(), DAY_1.plus(Duration.ofDays(60)), false, null);

        // The surviving template version now starts where the removed one did: same uuid and validFromRevision.
        assertThat(preview(fx, page, first)).contains("<h3>Title</h3>").doesNotContain("<h1>");
        assertThat(preview(fx, page, head)).contains("<h4>Title</h4>");
    }

    @Test
    @DisplayName("typed detail reads at a compacted revision carry X-SF-Compacted (media as the example)")
    void typedReadsCarryTheHeader() throws Exception {
        Fx fx = fixture("chmedia");
        AssetVersionView file = media.upload(fx.id(), null, "a.txt", null, "one".getBytes(StandardCharsets.UTF_8), fx.ctx());
        long first = history.head(fx.id());
        media.replace(file.uuid(), "a.txt", null, "two".getBytes(StandardCharsets.UTF_8), fx.ctx());
        media.replace(file.uuid(), "a.txt", null, "three".getBytes(StandardCharsets.UTF_8), fx.ctx());
        long dayEnd = history.head(fx.id());
        media.replace(file.uuid(), "a.txt", null, "four".getBytes(StandardCharsets.UTF_8), fx.ctx());
        long head = history.head(fx.id());
        history.backdate(fx.id(), 1, dayEnd, DAY_1);
        history.backdate(fx.id(), dayEnd + 1, head, DAY_1.plus(Duration.ofDays(1)));
        assertThat(compactor.compact(fx.id(), DAY_1.plus(Duration.ofDays(60)), false, null).versionsRemoved()).isEqualTo(2);

        perform(get("/api/v1/projects/{key}/media/{uuid}?revision={r}", fx.key(), file.uuid(), first), fx)
                .andExpect(status().isOk())
                .andExpect(header().string("X-SF-Compacted", "true"));
        perform(get("/api/v1/projects/{key}/media/{uuid}?revision={r}", fx.key(), file.uuid(), dayEnd), fx)
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist("X-SF-Compacted"));
        perform(get("/api/v1/projects/{key}/media/{uuid}", fx.key(), file.uuid()), fx)
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist("X-SF-Compacted"));
    }

    @Test
    @DisplayName("a project never compacted: compacted false everywhere, and the diff JSON is the old one plus the new fields")
    void noCompactionNoChange() throws Exception {
        Fx fx = fixture("chplain");
        UUID page = page(fx, "plain", "Before");
        title(fx, page, "After");
        long r = history.head(fx.id());

        String diff = perform(get("/api/v1/projects/{key}/revisions/{r}/diff", fx.key(), r), fx)
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String uid = assets.requireCurrent(fx.id(), page).uid();
        assertThat(mapper.readTree(diff)).isEqualTo(mapper.readTree("""
                {"projectId": %d, "revisionId": %d,
                 "assets": [{"uuid": "%s", "uid": "%s", "type": "PAGE", "action": "UPDATE",
                             "changes": [{"path": "content.title", "before": "Before", "after": "After",
                                          "add": false, "remove": false}],
                             "compacted": false}],
                 "compacted": false, "message": null}
                """.formatted(fx.id(), r, page, uid)));
        perform(get("/api/v1/projects/{key}/revisions/{r}", fx.key(), r), fx).andExpect(jsonPath("$.compacted").value(false));
        perform(get("/api/v1/projects/{key}/revisions", fx.key()), fx)
                .andExpect(jsonPath("$[?(@.compacted == true)]", empty()));
        perform(get("/api/v1/projects/{key}/assets/{uuid}/versions/{r}", fx.key(), page, r - 1), fx)
                .andExpect(jsonPath("$.compacted").value(false));
        perform(get("/api/v1/projects/{key}/preview/pages/{uuid}?revision={r}", fx.key(), page, r - 1), fx)
                .andExpect(header().doesNotExist("X-SF-Compacted"));
        perform(get("/api/v1/projects/{key}", fx.key()), fx).andExpect(jsonPath("$.compactedThrough").isEmpty());
    }

    // ------------------------------------------------------------------
    // Fixture
    // ------------------------------------------------------------------

    private Scenario compactedScenario() {
        Fx fx = fixture("chist");
        UUID p = page(fx, "pp", null);
        long pCreated = history.head(fx.id());
        title(fx, p, "P1");
        UUID q = page(fx, "qq", "Q1");
        releases.release(List.of(ReleaseItem.of(q)), fx.ctx());
        title(fx, p, "P2");
        long batch = new TransactionTemplate(transactionManager).execute(status -> {
            Revision open = revisionService.beginBatch(fx.id(), ChangeType.UPDATE, "batch", fx.user().getId());
            RevisionContext joined = RevisionContext.joining(open, fx.user().getId(), "batch");
            titleIn(fx, p, "P3", joined);
            titleIn(fx, q, "Q2", joined);
            return open.getRevisionId();
        });
        long p4 = title(fx, p, "P4");
        long dayEnd = history.head(fx.id());
        long p5 = title(fx, p, "P5");
        title(fx, q, "Q3");
        long head = history.head(fx.id());
        history.backdate(fx.id(), 1, dayEnd, DAY_1);
        history.backdate(fx.id(), dayEnd + 1, head, DAY_1.plus(Duration.ofDays(1)));
        assertThat(compactor.compact(fx.id(), DAY_1.plus(Duration.ofDays(60)), false, null).versionsRemoved())
                .isEqualTo(5); // P: created, P1, P2, P3; Q: created
        return new Scenario(fx, p, q, pCreated, batch, p4, p5, head);
    }

    private Fx fixture(String prefix) {
        int n = SEQ.incrementAndGet();
        AppUser user = users.create(prefix + n, prefix + n + "@example.com", "Compacted", "secret-password");
        Project project = projects.create(new CreateProjectRequest(prefix + n, prefix + n, null, "compacted"), user.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), user.getId(), "compacted reads");
        TemplateView template = templates.create(new CreateTemplateCommand(project.getId(), AssetType.PAGE_TEMPLATE, "Page",
                CDL, Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"), null, false, Map.of()), ctx);
        return new Fx(project, user, jwt.issueAccessToken(users.findById(user.getId()).orElseThrow()), template);
    }

    private UUID page(Fx fx, String name, String title) {
        AssetVersionView page = pages.create(new CreatePageCommand(name, null, fx.template().uuid()), fx.ctx());
        if (title != null) {
            title(fx, page.uuid(), title);
        }
        return page.uuid();
    }

    private long title(Fx fx, UUID page, String title) {
        return titleIn(fx, page, title, fx.ctx());
    }

    private long titleIn(Fx fx, UUID page, String title, RevisionContext ctx) {
        AssetVersionView current = assets.requireCurrent(fx.id(), page);
        ObjectNode payload = current.payload().deepCopy();
        payload.withObject("content").put("title", title);
        return pages.update(page, payload, current.validFromRevision(), ctx).validFromRevision();
    }

    private void template(Fx fx, String html) {
        TemplateView now = templates.get(fx.id(), fx.template().uuid());
        templates.update(fx.template().uuid(), new UpdateTemplateCommand(now.displayName(), CDL, Map.of("html", html), null,
                false, Map.of(), false, Map.of()), now.validFromRevision(), fx.ctx());
    }

    private String preview(Fx fx, UUID page, long revision) throws Exception {
        return perform(get("/api/v1/projects/{key}/preview/pages/{uuid}?revision={r}", fx.key(), page, revision), fx)
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    private static JsonNode entry(JsonNode diff, UUID uuid) {
        for (JsonNode asset : diff.path("assets")) {
            if (asset.path("uuid").asText().equals(uuid.toString())) {
                return asset;
            }
        }
        throw new AssertionError("no diff entry for " + uuid + ": " + diff);
    }

    private ResultActions perform(MockHttpServletRequestBuilder request, Fx fx) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + fx.token()));
    }

    private JsonNode json(ResultActions result) throws Exception {
        return mapper.readTree(result.andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }
}
