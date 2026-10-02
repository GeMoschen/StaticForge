package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.common.L10nValues;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.AppUserRepository;
import com.acme.staticforge.user.UserService;
import com.acme.staticforge.user.UserStatus;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The history API additions (M35.12): author and item names and touched languages on revisions, the database-side
 * filters with {@code X-Total-Count}, asset history paging, the project restore comment and the asset diff.
 *
 * <p>Statements are counted on the test's thread only ({@link ThreadStatementCounter}).
 */
@SpringBootTest(properties =
        "spring.jpa.properties.hibernate.session_factory.statement_inspector=com.acme.staticforge.ThreadStatementCounter")
@AutoConfigureMockMvc
@ActiveProfiles("test")
class RevisionHistoryApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final String CDL = """
            content {
              editor text headline { label "Headline" localizable }
              editor text sku      { label "SKU" }
            }
            """;

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired JwtService jwt;
    @Autowired UserService users;
    @Autowired AppUserRepository appUsers;
    @Autowired ProjectService projects;
    @Autowired AssetService assets;
    @Autowired PageService pages;
    @Autowired TemplateService templates;
    @Autowired RevisionRepository revisions;
    @Autowired PlatformTransactionManager transactionManager;

    private record Fx(Project project, AppUser admin, TemplateView template, String token) {
        long id() {
            return project.getId();
        }

        String key() {
            return project.getKey();
        }

        RevisionContext ctx() {
            return RevisionContext.of(project.getId(), admin.getId(), "history api");
        }

        RevisionContext ctx(AppUser by) {
            return RevisionContext.of(project.getId(), by.getId(), "history api");
        }
    }

    // ------------------------------------------------------------------
    // Names and languages
    // ------------------------------------------------------------------

    @Test
    @DisplayName("revisions carry the author's name and, per summary item, its name and the languages changed")
    void namesAndLocales() throws Exception {
        Fx fx = fixture("hist-names");
        UUID page = page(fx, "Start page");
        long created = head(fx);
        edit(fx, page, c -> c.set("headline", L10nValues.with(c.get("headline"), "en", text("Home"))));
        long englishOnly = head(fx);
        edit(fx, page, c -> c.put("sku", "B-1"));
        long shared = head(fx);

        JsonNode list = list(fx, "?size=100");
        JsonNode edit = byId(list, englishOnly);
        assertThat(edit.path("createdByName").asText()).isEqualTo("Admin Person");
        JsonNode item = edit.path("summary").path("assets").get(0);
        assertThat(item.path("name").asText()).isEqualTo("Start page");
        assertThat(strings(item.path("locales"))).containsExactly("en");
        assertThat(strings(byId(list, shared).path("summary").path("assets").get(0).path("locales"))).isEmpty();
        assertThat(strings(byId(list, created).path("summary").path("assets").get(0).path("locales")))
                .containsExactly("de");
        // The single read is completed the same way.
        perform(get("/api/v1/projects/{key}/revisions/{r}", fx.key(), englishOnly), fx)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.summary.assets[0].name").value("Start page"))
                .andExpect(jsonPath("$.summary.assets[0].locales[0]").value("en"));
    }

    @Test
    @DisplayName("old revisions without stored names still render: name and languages come from the item's versions")
    void oldRevisionsAreDerived() throws Exception {
        Fx fx = fixture("hist-old");
        UUID page = page(fx, "Legacy page");
        edit(fx, page, c -> c.set("headline", L10nValues.with(c.get("headline"), "en", text("Old"))));
        long englishOnly = head(fx);
        long created = englishOnly - 2;
        stripNames(fx);

        JsonNode list = list(fx, "?size=100");
        JsonNode item = byId(list, englishOnly).path("summary").path("assets").get(0);
        assertThat(item.path("name").asText()).isEqualTo("Legacy page");
        assertThat(strings(item.path("locales"))).containsExactly("en");
        assertThat(byId(list, created).path("summary").path("assets").size()).isGreaterThan(0);
        // Nothing was written back: the stored summary is still without names.
        Revision stored = revisions.findByProjectIdAndRevisionId(fx.id(), englishOnly).orElseThrow();
        assertThat(stored.getSummary().path("assets").get(0).has("name")).isFalse();
    }

    @Test
    @DisplayName("a removed or unknown author has no name")
    void removedAuthorHasNoName() throws Exception {
        Fx fx = fixture("hist-gone");
        AppUser other = users.create("gone" + SEQ.incrementAndGet(), "gone" + SEQ.get() + "@example.com", "Gone Person", "secret-password");
        projects.setMemberRole(fx.key(), other.getId(), ProjectRole.EDITOR, fx.ctx());
        UUID page = page(fx, "Doc");
        AssetVersionView current = assets.requireCurrent(fx.id(), page);
        ObjectNode payload = (ObjectNode) current.payload().deepCopy();
        ((ObjectNode) payload.get("content")).put("sku", "X");
        pages.update(page, payload, current.validFromRevision(), fx.ctx(other));
        long byOther = head(fx);

        assertThat(byId(list(fx, "?size=100"), byOther).path("createdByName").asText()).isEqualTo("Gone Person");
        AppUser account = appUsers.findById(other.getId()).orElseThrow();
        account.setStatus(UserStatus.DELETED);
        account.setDisplayName("Deleted user");
        appUsers.save(account);

        JsonNode list = list(fx, "?size=100");
        assertThat(byId(list, byOther).path("createdBy").asLong()).isEqualTo(other.getId());
        assertThat(byId(list, byOther).path("createdByName").isNull()).isTrue();
        perform(get("/api/v1/projects/{key}/assets/{uuid}/history", fx.key(), page), fx)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].changedByName").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$[1].changedByName").value("Admin Person"));
    }

    @Test
    @DisplayName("listing 30 revisions runs the same statements as listing 5")
    void queryCountIsConstant() throws Exception {
        Fx fx = fixture("hist-count");
        List<UUID> all = new ArrayList<>();
        for (int i = 0; i < 12; i++) {
            all.add(page(fx, "Page " + i));
        }
        for (UUID page : all) {
            edit(fx, page, c -> c.set("headline", L10nValues.with(c.get("headline"), "en", text("E"))));
        }
        list(fx, "?size=5"); // warm the project's caches

        long five = selects(() -> listQuietly(fx, "?size=5"));
        long forty = selects(() -> listQuietly(fx, "?size=30"));

        assertThat(forty).isEqualTo(five);
        assertThat(five).isLessThan(15);
    }

    // ------------------------------------------------------------------
    // Filters, paging, total
    // ------------------------------------------------------------------

    @Test
    @DisplayName("changeType, from and to filter in the query; paging a filtered list is correct across pages")
    void filtersPageCorrectly() throws Exception {
        Fx fx = fixture("hist-filter");
        UUID target = page(fx, "Target");
        pause();
        Instant mark = Instant.now();
        pause();
        List<Long> updates = new ArrayList<>();
        for (int i = 0; i < 7; i++) {
            int n = i;
            edit(fx, target, c -> c.put("sku", "v" + n));
            updates.add(head(fx));
        }
        pause();
        Instant end = Instant.now();
        pause();
        page(fx, "Late one");

        // The UPDATE revisions, 3 per page, newest first: no gaps, no duplicates, the total counts them all.
        List<Revision> stored = revisions.findByProjectIdOrderByRevisionIdDesc(fx.id());
        List<Long> expected = stored.stream()
                .filter(r -> r.getChangeType() == ChangeType.UPDATE)
                .map(Revision::getRevisionId)
                .toList();
        assertThat(expected).containsAll(updates);
        List<Long> seen = new ArrayList<>();
        for (int p = 0; p * 3 < expected.size(); p++) {
            JsonNode body = body(perform(get("/api/v1/projects/{key}/revisions?changeType=UPDATE&size=3&page=" + p, fx.key()), fx)
                    .andExpect(status().isOk())
                    .andExpect(header().string("X-Total-Count", String.valueOf(expected.size()))));
            assertThat(body).hasSize(Math.min(3, expected.size() - p * 3));
            body.forEach(r -> {
                assertThat(r.path("changeType").asText()).isEqualTo("UPDATE");
                seen.add(r.path("revisionId").asLong());
            });
        }
        assertThat(seen).containsExactlyElementsOf(expected);

        // from is inclusive, to is exclusive: the window holds exactly the seven updates.
        ResultActions window = perform(get("/api/v1/projects/{key}/revisions?from={f}&to={t}&size=2", fx.key(), mark, end), fx)
                .andExpect(header().string("X-Total-Count", "7"));
        assertThat(body(window)).hasSize(2);
        // The last page is created after `end`: a page is two revisions (create, headline).
        perform(get("/api/v1/projects/{key}/revisions?from={f}&size=100", fx.key(), end), fx)
                .andExpect(header().string("X-Total-Count", "2"));
        long beforeMark = stored.stream().filter(r -> r.getCreatedAt().isBefore(mark)).count();
        perform(get("/api/v1/projects/{key}/revisions?to={t}&size=1", fx.key(), mark), fx)
                .andExpect(header().string("X-Total-Count", String.valueOf(beforeMark)));
        perform(get("/api/v1/projects/{key}/revisions?changeType=DELETE", fx.key()), fx)
                .andExpect(header().string("X-Total-Count", "0"))
                .andExpect(jsonPath("$").isEmpty());
        // The unfiltered total counts everything; the page is just a slice of it.
        perform(get("/api/v1/projects/{key}/revisions?size=2", fx.key()), fx)
                .andExpect(header().string("X-Total-Count", String.valueOf(count(fx))))
                .andExpect(jsonPath("$.length()").value(2));
    }

    @Test
    @DisplayName("changeType takes several values, repeated or comma-separated; an unknown one is a 400")
    void changeTypeMultiValue() throws Exception {
        Fx fx = fixture("hist-types");
        UUID page = page(fx, "Doc");
        edit(fx, page, c -> c.put("sku", "1"));

        perform(get("/api/v1/projects/{key}/revisions?changeType=CREATE&changeType=UPDATE&size=100", fx.key()), fx)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.changeType=='CREATE')]").isNotEmpty())
                .andExpect(jsonPath("$[?(@.changeType=='UPDATE')]").isNotEmpty());
        JsonNode update = body(perform(get("/api/v1/projects/{key}/revisions?changeType=update,MOVE&size=100", fx.key()), fx));
        assertThat(update).isNotEmpty().allMatch(r -> List.of("UPDATE", "MOVE").contains(r.path("changeType").asText()));
        perform(get("/api/v1/projects/{key}/revisions?changeType=UPDATE,NOPE", fx.key()), fx)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.field").value("changeType"));
        perform(get("/api/v1/projects/{key}/revisions?from=yesterday", fx.key()), fx).andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("assetUuid filters in the query too: a page of the touching revisions is full and counted")
    void assetFilterPages() throws Exception {
        Fx fx = fixture("hist-asset");
        UUID target = page(fx, "Target");
        UUID noise = page(fx, "Noise");
        for (int i = 0; i < 4; i++) {
            int n = i;
            edit(fx, target, c -> c.put("sku", "t" + n));
            edit(fx, noise, c -> c.put("sku", "n" + n));
        }

        // Target: create, headline and 4 edits = 6 revisions, although more than 12 revisions lie between them.
        JsonNode first = body(perform(get("/api/v1/projects/{key}/revisions?assetUuid={a}&size=3", fx.key(), target), fx)
                .andExpect(header().string("X-Total-Count", "6")));
        JsonNode second = body(perform(get("/api/v1/projects/{key}/revisions?assetUuid={a}&size=3&page=1", fx.key(), target), fx));
        assertThat(first).hasSize(3);
        assertThat(second).hasSize(3);
        perform(get("/api/v1/projects/{key}/revisions?assetUuid={a}", fx.key(), UUID.randomUUID()), fx)
                .andExpect(header().string("X-Total-Count", "0"));
    }

    @Test
    @DisplayName("q matches the comment and the item names, case-insensitively and across pages; old revisions by comment")
    void search() throws Exception {
        Fx fx = fixture("hist-q");
        UUID alpha = page(fx, "Alpha Landing");
        UUID beta = page(fx, "Beta 100%_page");
        for (int i = 0; i < 3; i++) {
            int n = i;
            edit(fx, alpha, c -> c.put("sku", "a" + n));
        }
        edit(fx, beta, c -> c.put("sku", "b"));

        // create, headline and 3 edits touch "Alpha Landing".
        perform(get("/api/v1/projects/{key}/revisions?q=aLpHa lAnd&size=2", fx.key()), fx)
                .andExpect(header().string("X-Total-Count", "5"))
                .andExpect(jsonPath("$.length()").value(2));
        // LIKE wildcards in the text are literal.
        perform(get("/api/v1/projects/{key}/revisions?q={q}", fx.key(), "100%_pa"), fx)
                .andExpect(header().string("X-Total-Count", "3"));
        perform(get("/api/v1/projects/{key}/revisions?q={q}", fx.key(), "%"), fx)
                .andExpect(header().string("X-Total-Count", "3"));
        perform(get("/api/v1/projects/{key}/revisions?q={q}", fx.key(), "0_p"), fx)
                .andExpect(header().string("X-Total-Count", "0")); // "_" is not a wildcard: "0%_p" is what is stored
        // The comment ("history api") matches every revision.
        perform(get("/api/v1/projects/{key}/revisions?q=HISTORY API&size=1", fx.key()), fx)
                .andExpect(header().string("X-Total-Count", String.valueOf(count(fx))));
        perform(get("/api/v1/projects/{key}/revisions?q=nothing-like-this", fx.key()), fx)
                .andExpect(header().string("X-Total-Count", "0"));

        // A revision written before names were recorded matches on its comment only.
        stripNames(fx);
        perform(get("/api/v1/projects/{key}/revisions?q=alpha", fx.key()), fx)
                .andExpect(header().string("X-Total-Count", "0"));
        perform(get("/api/v1/projects/{key}/revisions?q=history", fx.key()), fx)
                .andExpect(header().string("X-Total-Count", String.valueOf(count(fx))));
    }

    // ------------------------------------------------------------------
    // Asset history and diff
    // ------------------------------------------------------------------

    @Test
    @DisplayName("asset history is complete by default, pages on request and always reports the total")
    void assetHistoryPaging() throws Exception {
        Fx fx = fixture("hist-ah");
        UUID page = page(fx, "Doc");
        for (int i = 0; i < 4; i++) {
            int n = i;
            edit(fx, page, c -> c.put("sku", "v" + n));
        }
        String url = "/api/v1/projects/{key}/assets/{uuid}/history";

        JsonNode all = body(perform(get(url, fx.key(), page), fx).andExpect(header().string("X-Total-Count", "6")));
        assertThat(all).hasSize(6); // create + initial headline edit + 4 edits
        assertThat(all.get(0).path("changedByName").asText()).isEqualTo("Admin Person");
        List<Long> revisionsSeen = new ArrayList<>();
        for (int p = 0; p < 3; p++) {
            JsonNode slice = body(perform(get(url + "?size=4&page=" + p, fx.key(), page), fx)
                    .andExpect(header().string("X-Total-Count", "6")));
            slice.forEach(e -> revisionsSeen.add(e.path("revision").asLong()));
        }
        assertThat(revisionsSeen).containsExactlyElementsOf(
                java.util.stream.StreamSupport.stream(all.spliterator(), false).map(e -> e.path("revision").asLong()).toList());
        perform(get(url + "?size=0", fx.key(), page), fx).andExpect(status().isBadRequest());
        perform(get(url + "?page=-1", fx.key(), page), fx).andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("the asset diff compares its content at two revisions, defaults to now, and 404s unknown ones")
    void assetDiff() throws Exception {
        Fx fx = fixture("hist-diff");
        UUID page = page(fx, "Doc");
        long before = head(fx);
        edit(fx, page, c -> c.put("sku", "NEW"));
        String url = "/api/v1/projects/{key}/assets/{uuid}/diff?from=" + before;

        perform(get(url, fx.key(), page), fx)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.uuid").value(page.toString()))
                .andExpect(jsonPath("$.type").value("PAGE"))
                .andExpect(jsonPath("$.action").value("UPDATE"))
                .andExpect(jsonPath("$.compacted").value(false))
                .andExpect(jsonPath("$.changes[0].path").value("content.sku"))
                .andExpect(jsonPath("$.changes[0].after").value("NEW"));
        perform(get(url + "&to=" + before, fx.key(), page), fx)
                .andExpect(jsonPath("$.changes.length()").value(0));
        perform(get(url, fx.key(), UUID.randomUUID()), fx).andExpect(status().isNotFound());
        perform(get("/api/v1/projects/{key}/assets/{uuid}/diff?from=999999", fx.key(), page), fx).andExpect(status().isNotFound());
        perform(get(url + "&to=999999", fx.key(), page), fx).andExpect(status().isNotFound());
        perform(get("/api/v1/projects/{key}/assets/{uuid}/diff", fx.key(), page), fx).andExpect(status().isBadRequest());
    }

    // ------------------------------------------------------------------
    // Project restore comment
    // ------------------------------------------------------------------

    @Test
    @DisplayName("project restore takes an optional comment: default text, a custom one, 400 when over 500 characters")
    void restoreComment() throws Exception {
        Fx fx = fixture("hist-restore");
        UUID page = page(fx, "Doc");
        long target = head(fx);
        edit(fx, page, c -> c.put("sku", "later"));

        restore(fx, "{\"toRevision\": " + target + "}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.comment").value("Project restore to " + target))
                .andExpect(jsonPath("$.changeType").value("RESTORE"))
                .andExpect(jsonPath("$.createdByName").value("Admin Person"));
        restore(fx, "{\"toRevision\": " + target + ", \"comment\": \"  \"}")
                .andExpect(jsonPath("$.comment").value("Project restore to " + target));
        restore(fx, "{\"toRevision\": " + target + ", \"comment\": \"  Back before the redesign \"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.comment").value("Back before the redesign"));
        restore(fx, "{\"toRevision\": " + target + ", \"comment\": \"" + "x".repeat(500) + "\"}")
                .andExpect(status().isOk());

        long headBefore = head(fx);
        restore(fx, "{\"toRevision\": " + target + ", \"comment\": \"" + "x".repeat(501) + "\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.field").value("comment"));
        assertThat(head(fx)).isEqualTo(headBefore); // refused before anything was written
    }

    @Test
    @DisplayName("project restore is still admin only")
    void restoreNeedsAdmin() throws Exception {
        Fx fx = fixture("hist-restore-role");
        page(fx, "Doc");
        AppUser editor = users.create("ed" + SEQ.incrementAndGet(), "ed" + SEQ.get() + "@example.com", "Ed", "secret-password");
        projects.setMemberRole(fx.key(), editor.getId(), ProjectRole.EDITOR, fx.ctx());
        Fx asEditor = new Fx(fx.project(), editor, fx.template(), jwt.issueAccessToken(users.findById(editor.getId()).orElseThrow()));

        restore(asEditor, "{\"toRevision\": 1, \"comment\": \"nope\"}").andExpect(status().isForbidden());
    }

    // ------------------------------------------------------------------
    // Fixture
    // ------------------------------------------------------------------

    private Fx fixture(String prefix) {
        int n = SEQ.incrementAndGet();
        AppUser admin = users.create(prefix + n, prefix + n + "@example.com", "Admin Person", "secret-password");
        Project project = projects.create(new CreateProjectRequest(prefix + n, prefix + n, null, "history api"), admin.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), admin.getId(), "history api");
        projects.updateLocales(project.getKey(),
                LocaleConfig.of(List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English")), "de", Map.of(), false),
                true, ctx);
        TemplateView template = templates.create(new CreateTemplateCommand(
                project.getId(), AssetType.PAGE_TEMPLATE, "Article", CdlSources.split(CDL),
                Map.of("html", "<h1>$CMS_VALUE(headline)$</h1>"), null, false, Map.of()), ctx);
        return new Fx(project, admin, template, jwt.issueAccessToken(users.findById(admin.getId()).orElseThrow()));
    }

    /** A page named {@code name} whose German headline is set; its create and first edit are two revisions. */
    private UUID page(Fx fx, String name) {
        UUID page = pages.create(new CreatePageCommand(name, null, fx.template().uuid()), fx.ctx()).uuid();
        edit(fx, page, c -> c.set("headline", L10nValues.wrap(text(name), "de")));
        return page;
    }

    private void edit(Fx fx, UUID page, Consumer<ObjectNode> edit) {
        AssetVersionView current = assets.requireCurrent(fx.id(), page);
        ObjectNode payload = (ObjectNode) current.payload().deepCopy();
        ObjectNode content = payload.has("content") && payload.get("content").isObject()
                ? (ObjectNode) payload.get("content")
                : payload.putObject("content");
        edit.accept(content);
        pages.update(page, payload, current.validFromRevision(), fx.ctx());
    }

    private static JsonNode text(String value) {
        return JsonNodeFactory.instance.textNode(value);
    }

    private long head(Fx fx) {
        return revisions.findHeadRevisionId(fx.id()).orElseThrow();
    }

    /** Every revision of the project: the counter is gapless from 1. */
    private long count(Fx fx) {
        return head(fx);
    }

    /** Rewrites every summary as an older version of the code wrote it: no names, no search text. */
    private void stripNames(Fx fx) {
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            for (Revision revision : revisions.findByProjectIdOrderByRevisionIdDesc(fx.id())) {
                JsonNode summary = revision.getSummary().deepCopy();
                summary.path("assets").forEach(entry -> ((ObjectNode) entry).remove(List.of("name", "locales")));
                revision.setSummary(summary);
                revision.setSearchText(null);
                revisions.save(revision);
            }
        });
    }

    private static void pause() throws InterruptedException {
        Thread.sleep(15);
    }

    private long selects(Runnable call) {
        return ThreadStatementCounter.during(call).selects();
    }

    private void listQuietly(Fx fx, String query) {
        try {
            list(fx, query);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private JsonNode list(Fx fx, String query) throws Exception {
        return body(perform(get("/api/v1/projects/{key}/revisions" + query, fx.key()), fx).andExpect(status().isOk()));
    }

    private ResultActions restore(Fx fx, String body) throws Exception {
        return perform(post("/api/v1/projects/{key}/restore", fx.key())
                .contentType("application/json").content(body), fx);
    }

    private static JsonNode byId(JsonNode list, long revisionId) {
        for (JsonNode r : list) {
            if (r.path("revisionId").asLong() == revisionId) {
                return r;
            }
        }
        throw new AssertionError("revision " + revisionId + " not in " + list);
    }

    private static List<String> strings(JsonNode array) {
        List<String> out = new ArrayList<>();
        array.forEach(n -> out.add(n.asText()));
        return out;
    }

    private JsonNode body(ResultActions result) throws Exception {
        return mapper.readTree(result.andReturn().getResponse().getContentAsString());
    }

    private ResultActions perform(MockHttpServletRequestBuilder request, Fx fx) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + fx.token()));
    }
}
