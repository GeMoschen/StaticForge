package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
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
import com.acme.staticforge.common.L10nValues;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.release.ReleaseStatusService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.search.SearchHit;
import com.acme.staticforge.search.SearchIndexer;
import com.acme.staticforge.search.SearchService;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.AppUserRepository;
import com.acme.staticforge.user.SystemRole;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Duration;
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
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** The release, Changes and diff endpoints, the {@code release} block on asset views and the search facet (M27.1.3). */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ReleaseApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static final String CDL = """
            content {
              editor text headline { label "Headline" localizable }
              editor text sku      { label "SKU" }
            }
            """;

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;
    @Autowired UserService users;
    @Autowired AppUserRepository appUsers;
    @Autowired ProjectService projects;
    @Autowired AssetService assets;
    @Autowired PageService pages;
    @Autowired TemplateService templates;
    @Autowired ReleaseService releases;
    @Autowired SearchService search;
    @Autowired SearchIndexer indexer;
    @SpyBean ReleaseStatusService statuses;

    private record Fixture(Project project, AppUser admin, RevisionContext ctx, TemplateView template, boolean localized) {
        long id() {
            return project.getId();
        }

        String key() {
            return project.getKey();
        }
    }

    // ------------------------------------------------------------------
    // Roles, archive, validation
    // ------------------------------------------------------------------

    @Test
    @DisplayName("viewers read and plan, editors may not release, developers may")
    void roles() throws Exception {
        Fixture fx = fixture("rapi-role", false);
        UUID page = page(fx, "Home", c -> c.put("sku", "A"));
        String viewer = member(fx, ProjectRole.VIEWER);
        String editor = member(fx, ProjectRole.EDITOR);
        String developer = member(fx, ProjectRole.DEVELOPER);
        String body = items(page);

        perform(post("/api/v1/projects/{key}/releases/plan", fx.key()).contentType(MediaType.APPLICATION_JSON).content(body), viewer)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].status").value("NEW"));
        perform(get("/api/v1/projects/{key}/changes", fx.key()), viewer).andExpect(status().isOk());
        for (String path : List.of("", "/unpublish", "/discard")) {
            perform(post("/api/v1/projects/{key}/releases" + path, fx.key()).contentType(MediaType.APPLICATION_JSON).content(body), editor)
                    .andExpect(status().isForbidden());
        }
        perform(post("/api/v1/projects/{key}/releases", fx.key()).contentType(MediaType.APPLICATION_JSON).content(body), developer)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.revision").isNumber())
                .andExpect(jsonPath("$.applied", hasSize(1)));
    }

    @Test
    @DisplayName("an archived project refuses release, unpublish and discard, and still plans")
    void archived() throws Exception {
        Fixture fx = fixture("rapi-arch", false);
        UUID page = page(fx, "Home", c -> c.put("sku", "A"));
        projects.archive(fx.key(), fx.ctx());
        // Archived projects are hidden from members: only an instance admin reaches them, read-only.
        AppUser instanceAdmin =
                users.create("ia" + SEQ.incrementAndGet(), "ia" + SEQ.get() + "@example.com", "IA", "secret-password");
        instanceAdmin.setSystemRole(SystemRole.INSTANCE_ADMIN);
        String token = jwt.issueAccessToken(appUsers.save(instanceAdmin));

        for (String path : List.of("", "/unpublish", "/discard")) {
            perform(post("/api/v1/projects/{key}/releases" + path, fx.key()).contentType(MediaType.APPLICATION_JSON).content(items(page)), token)
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("SF-DOM-0141"));
        }
        perform(post("/api/v1/projects/{key}/releases/plan", fx.key()).contentType(MediaType.APPLICATION_JSON).content(items(page)), token)
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("validation errors answer 422 with their code")
    void validation() throws Exception {
        Fixture fx = fixture("rapi-val", false);
        UUID page = page(fx, "Home", c -> c.put("sku", "A"));
        String token = jwt.issueAccessToken(fx.admin());

        release(fx, token, "{\"items\": []}").andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("SF-DOM-0153"));
        release(fx, token, items(UUID.randomUUID())).andExpect(jsonPath("$.code").value("SF-DOM-0151"));
        release(fx, token, items(fx.template().uuid())).andExpect(jsonPath("$.code").value("SF-DOM-0151"));
        perform(post("/api/v1/projects/{key}/releases/discard", fx.key()).contentType(MediaType.APPLICATION_JSON).content(items(page)), token)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-DOM-0152"));
        perform(get("/api/v1/projects/{key}/changes?status=BOGUS", fx.key()), token).andExpect(status().isBadRequest());
        perform(get("/api/v1/projects/{key}/changes?size=201", fx.key()), token).andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("release takes the kept dependencies along in one revision")
    void includeDependencies() throws Exception {
        Fixture fx = fixture("rapi-deps", false);
        UUID target = page(fx, "Target", c -> c.put("sku", "T"));
        UUID linking = page(fx, "Linking", c -> c.put("sku", "L"));
        String token = jwt.issueAccessToken(fx.admin());

        release(fx, token, "{\"items\": [{\"assetUuid\": \"" + linking + "\"}], \"includeDependencies\": [{\"assetUuid\": \""
                        + target + "\"}], \"comment\": \"launch\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.applied[*].uuid", containsInAnyOrder(linking.toString(), target.toString())));
    }

    // ------------------------------------------------------------------
    // Changes list, counts, diff
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the Changes list filters, pages, sorts and counts every status in two locales")
    void changesList() throws Exception {
        Fixture fx = fixture("rapi-chg", true);
        UUID published = page(fx, "Aa published", c -> c.put("sku", "P"));
        UUID changed = page(fx, "Bb changed", c -> c.put("sku", "C"));
        UUID unpublished = page(fx, "Cc unpublished", c -> c.put("sku", "U"));
        UUID deleted = page(fx, "Dd deleted", c -> c.put("sku", "D"));
        releases.release(List.of(ReleaseItem.of(published), ReleaseItem.of(changed), ReleaseItem.of(unpublished),
                ReleaseItem.of(deleted)), fx.ctx());
        UUID fresh = page(fx, "Ee new", c -> c.put("sku", "N"));
        edit(fx, changed, c -> c.set("headline", L10nValues.with(c.get("headline"), "en", text("Changed"))));
        releases.unpublish(List.of(ReleaseItem.of(unpublished, "de")), fx.ctx());
        assets.softDelete(deleted, true, fx.ctx());
        String token = jwt.issueAccessToken(fx.admin());

        perform(get("/api/v1/projects/{key}/changes?size=50", fx.key()), token)
                .andExpect(status().isOk())
                // new: 2 locales, changed: en only, unpublished: de only, deleted: 2 locales
                .andExpect(jsonPath("$.totalElements").value(6))
                .andExpect(jsonPath("$.rows[*].uuid", not(hasItem(published.toString()))));
        perform(get("/api/v1/projects/{key}/changes?status=CHANGED", fx.key()), token)
                .andExpect(jsonPath("$.rows", hasSize(1)))
                .andExpect(jsonPath("$.rows[0].uuid").value(changed.toString()))
                .andExpect(jsonPath("$.rows[0].locale").value("en"));
        perform(get("/api/v1/projects/{key}/changes?locale=de&status=UNPUBLISHED&status=DELETION_PENDING", fx.key()), token)
                .andExpect(jsonPath("$.rows[*].uuid", containsInAnyOrder(unpublished.toString(), deleted.toString())));
        perform(get("/api/v1/projects/{key}/changes?q=ee&type=PAGE", fx.key()), token)
                .andExpect(jsonPath("$.rows[*].uuid", containsInAnyOrder(fresh.toString(), fresh.toString())));
        perform(get("/api/v1/projects/{key}/changes?size=2&page=1&sort=displayName,asc", fx.key()), token)
                .andExpect(jsonPath("$.rows", hasSize(2)))
                .andExpect(jsonPath("$.totalPages").value(3))
                .andExpect(jsonPath("$.rows[0].displayName").value("Dd deleted"));
        perform(get("/api/v1/projects/{key}/changes/count", fx.key()), token)
                .andExpect(jsonPath("$.NEW").value(2))
                .andExpect(jsonPath("$.CHANGED").value(1))
                .andExpect(jsonPath("$.UNPUBLISHED").value(1))
                .andExpect(jsonPath("$.DELETION_PENDING").value(2))
                .andExpect(jsonPath("$.total").value(6));
    }

    @Test
    @DisplayName("a localized change shows only in its locale's diff; a rename in every locale")
    void diff() throws Exception {
        Fixture fx = fixture("rapi-diff", true);
        UUID page = page(fx, "Parka", c -> c.put("sku", "A"));
        releases.release(List.of(ReleaseItem.of(page)), fx.ctx());
        edit(fx, page, c -> c.set("headline", L10nValues.with(c.get("headline"), "en", text("The new parka"))));
        String token = jwt.issueAccessToken(fx.admin());

        perform(get("/api/v1/projects/{key}/changes/{uuid}/diff?locale=en", fx.key(), page), token)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CHANGED"))
                .andExpect(jsonPath("$.changes[*].path", hasItem("payload.content.headline")));
        perform(get("/api/v1/projects/{key}/changes/{uuid}/diff?locale=de", fx.key(), page), token)
                .andExpect(jsonPath("$.status").value("PUBLISHED"))
                .andExpect(jsonPath("$.changes", hasSize(0)));

        assets.changeUid(page, "parka_" + SEQ.incrementAndGet(), fx.ctx());
        for (String locale : List.of("de", "en")) {
            perform(get("/api/v1/projects/{key}/changes/{uuid}/diff?locale=" + locale, fx.key(), page), token)
                    .andExpect(jsonPath("$.changes[*].path", hasItem("uid")));
        }
    }

    // ------------------------------------------------------------------
    // DTOs and search
    // ------------------------------------------------------------------

    @Test
    @DisplayName("asset views carry the release block; the pages list asks for it once, not per page")
    void releaseBlockOnViews() throws Exception {
        Fixture fx = fixture("rapi-dto", true);
        UUID first = page(fx, "First", c -> c.put("sku", "1"));
        for (int i = 0; i < 11; i++) {
            page(fx, "Page " + i, c -> c.put("sku", "x"));
        }
        releases.release(List.of(ReleaseItem.of(first, "de")), fx.ctx());
        String token = jwt.issueAccessToken(fx.admin());

        perform(get("/api/v1/projects/{key}/pages/{uuid}", fx.key(), first), token)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.release.de.status").value("PUBLISHED"))
                .andExpect(jsonPath("$.release.de.releasedRevision").isNumber())
                .andExpect(jsonPath("$.release.en.status").value("NEW"))
                .andExpect(jsonPath("$.scheduled", hasSize(0)));

        clearInvocations(statuses);
        perform(get("/api/v1/projects/{key}/pages", fx.key()), token)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(12)))
                .andExpect(jsonPath("$[*].release.de.status", hasItem("PUBLISHED")));
        verify(statuses, times(1)).ofUuids(anyLong(), any());
        verify(statuses, never()).ofAsset(anyLong(), any());

        perform(get("/api/v1/projects/{key}/assets/{uuid}", fx.key(), fx.template().uuid()), token)
                .andExpect(jsonPath("$.release").doesNotExist());
    }

    @Test
    @DisplayName("search with releaseStatus=CHANGED finds an edited published page and not an unchanged one")
    void searchFacet() throws Exception {
        Fixture fx = fixture("rapi-search", false);
        UUID edited = page(fx, "Lighthouse edited", c -> c.put("sku", "A"));
        UUID unchanged = page(fx, "Lighthouse unchanged", c -> c.put("sku", "B"));
        releases.release(List.of(ReleaseItem.of(edited), ReleaseItem.of(unchanged)), fx.ctx());
        edit(fx, edited, c -> c.put("sku", "A2"));
        assertThat(indexer.awaitIdle(Duration.ofSeconds(60))).isTrue();

        List<UUID> changed = search.search(fx.id(), "lighthouse", null, null, 0, 20, null, null, List.of("CHANGED"))
                .hits().hits().stream().map(SearchHit::uuid).toList();
        List<UUID> published = search.search(fx.id(), "lighthouse", null, null, 0, 20, null, null, List.of("PUBLISHED"))
                .hits().hits().stream().map(SearchHit::uuid).toList();

        assertThat(changed).containsExactly(edited);
        assertThat(published).containsExactly(unchanged);
        perform(get("/api/v1/projects/{key}/search?q=lighthouse&releaseStatus=CHANGED", fx.key()), jwt.issueAccessToken(fx.admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[*].uuid", containsInAnyOrder(edited.toString())));
    }

    @Test
    @DisplayName("an edit through the page endpoints after a release reads CHANGED; an English-only edit leaves German published")
    void apiEditsAfterReleaseMarkTheChangedLocales() throws Exception {
        Fixture fx = fixture("rapi-edit", true);
        UUID page = page(fx, "Home", c -> {
            c.set("headline", L10nValues.with(L10nValues.wrap(text("Startseite"), "de"), "en", text("Home")));
            c.put("sku", "A");
        });
        releases.release(List.of(ReleaseItem.of(page, "de"), ReleaseItem.of(page, "en")), fx.ctx());
        String token = jwt.issueAccessToken(fx.admin());
        String url = "/api/v1/projects/{key}/pages/{uuid}";
        assertThat(pageStatuses(fx, page, token)).containsExactly("de:PUBLISHED", "en:PUBLISHED");

        // A merge-patch of the English headline only.
        String revision = etag(perform(get(url, fx.key(), page), token));
        perform(patch(url + "/content", fx.key(), page).header("If-Match", revision)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\":{\"headline\":{\"type\":\"L10N\",\"values\":{\"en\":\"Homepage\"}}}}"), token)
                .andExpect(status().isOk());
        assertThat(pageStatuses(fx, page, token)).containsExactly("de:PUBLISHED", "en:CHANGED");

        // A whole-page PUT that only changes the English headline.
        ObjectNode payload = (ObjectNode) assets.requireCurrent(fx.id(), page).payload().deepCopy();
        ObjectNode content = (ObjectNode) payload.get("content");
        content.set("headline", L10nValues.with(content.get("headline"), "en", text("Homepage 2")));
        revision = etag(perform(get(url, fx.key(), page), token));
        perform(put(url, fx.key(), page).header("If-Match", revision)
                        .contentType(MediaType.APPLICATION_JSON).content(payload.toString()), token)
                .andExpect(status().isOk());
        assertThat(pageStatuses(fx, page, token)).containsExactly("de:PUBLISHED", "en:CHANGED");

        // A shared field changes every locale.
        revision = etag(perform(get(url, fx.key(), page), token));
        perform(patch(url + "/content", fx.key(), page).header("If-Match", revision)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"content\":{\"sku\":\"B\"}}"), token)
                .andExpect(status().isOk());
        assertThat(pageStatuses(fx, page, token)).containsExactly("de:CHANGED", "en:CHANGED");
    }

    private List<String> pageStatuses(Fixture fx, UUID page, String token) throws Exception {
        JsonNode release = json(perform(get("/api/v1/projects/{key}/pages/{uuid}", fx.key(), page), token)).get("release");
        List<String> out = new java.util.ArrayList<>();
        release.fields().forEachRemaining(e -> out.add(e.getKey() + ":" + e.getValue().path("status").asText()));
        return out;
    }

    private static String etag(ResultActions actions) throws Exception {
        return actions.andReturn().getResponse().getHeader("ETag");
    }

    private JsonNode json(ResultActions actions) throws Exception {
        return new com.fasterxml.jackson.databind.ObjectMapper()
                .readTree(actions.andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8));
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private Fixture fixture(String prefix, boolean localized) {
        int n = SEQ.incrementAndGet();
        AppUser admin = users.create(prefix + n, prefix + n + "@example.com", "Admin", "secret-password");
        Project project = projects.create(new CreateProjectRequest(prefix + n, prefix + n, null, "release api"), admin.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), admin.getId(), "release api");
        if (localized) {
            projects.updateLocales(project.getKey(),
                    LocaleConfig.of(List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English")), "de", Map.of(), false),
                    true, ctx);
        }
        TemplateView template = templates.create(new CreateTemplateCommand(
                project.getId(), AssetType.PAGE_TEMPLATE, "Article", CdlSources.split(CDL), Map.of("html", "<h1>$CMS_VALUE(headline)$</h1>"),
                null, false, Map.of()), ctx);
        return new Fixture(project, admin, ctx, template, localized);
    }

    private String member(Fixture fx, ProjectRole role) {
        int n = SEQ.incrementAndGet();
        AppUser user = users.create("m" + n + role.name().toLowerCase(), "m" + n + "@example.com", "Member", "secret-password");
        projects.setMemberRole(fx.key(), user.getId(), role, fx.ctx());
        return jwt.issueAccessToken(users.findById(user.getId()).orElseThrow());
    }

    private UUID page(Fixture fx, String name, Consumer<ObjectNode> content) {
        UUID page = pages.create(new CreatePageCommand(name, null, fx.template().uuid()), fx.ctx()).uuid();
        edit(fx, page, c -> {
            c.set("headline", fx.localized() ? L10nValues.wrap(text(name), "de") : text(name));
            content.accept(c);
        });
        return page;
    }

    private void edit(Fixture fx, UUID page, Consumer<ObjectNode> edit) {
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

    private static String items(UUID uuid) {
        return "{\"items\": [{\"assetUuid\": \"" + uuid + "\"}]}";
    }

    private ResultActions release(Fixture fx, String token, String body) throws Exception {
        return perform(post("/api/v1/projects/{key}/releases", fx.key()).contentType(MediaType.APPLICATION_JSON).content(body), token);
    }

    private ResultActions perform(MockHttpServletRequestBuilder request, String token) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + token));
    }
}
