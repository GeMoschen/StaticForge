package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.search.SearchDocument;
import com.acme.staticforge.search.SearchIndexer;
import com.acme.staticforge.search.SearchService;
import com.acme.staticforge.search.SearchStatus;
import com.acme.staticforge.search.extract.ExtractionContext;
import com.acme.staticforge.search.extract.IndexableAsset;
import com.acme.staticforge.search.extract.PageTextExtractor;
import com.acme.staticforge.search.extract.SearchTextExtractor;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * {@code GET /search}, {@code GET /search/status} and {@code POST /search/reindex} (M23.3.1, M23.2.2): ranking,
 * filters and facets, paging, safe input handling, authorization and project isolation, snippets, and a rebuild that
 * keeps queries answering from the previous index until its swap.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SearchApiTest {

    /** Holds a rebuild inside extraction while a gate is armed, so a test can act during a reindex. */
    @TestConfiguration
    static class GateConfiguration {
        static final AtomicReference<CountDownLatch> RELEASE = new AtomicReference<>();
        static final AtomicReference<CountDownLatch> ENTERED = new AtomicReference<>();

        @Bean
        @Order(Ordered.HIGHEST_PRECEDENCE)
        SearchTextExtractor gatedPageExtractor() {
            PageTextExtractor pages = new PageTextExtractor();
            return new SearchTextExtractor() {
                @Override
                public boolean supports(AssetType type) {
                    return type == AssetType.PAGE;
                }

                @Override
                public Optional<SearchDocument> extract(IndexableAsset asset, ExtractionContext context) {
                    CountDownLatch release = RELEASE.get();
                    if (release != null && asset.displayName().startsWith("Gate")) {
                        ENTERED.get().countDown();
                        try {
                            release.await(30, TimeUnit.SECONDS);
                        } catch (InterruptedException e) {
                            Thread.currentThread().interrupt();
                        }
                    }
                    return pages.extract(asset, context);
                }
            };
        }
    }

    private static final ObjectMapper JSON = new ObjectMapper();

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;
    @Autowired UserService users;
    @Autowired ProjectService projects;
    @Autowired AssetService assets;
    @Autowired TemplateService templates;
    @Autowired MediaService media;
    @Autowired SearchService search;
    @SpyBean SearchIndexer indexer;

    private SearchFixtures fixtures;

    @BeforeEach
    void setUp() {
        fixtures = new SearchFixtures(users, projects, assets, templates, search, indexer);
    }

    /** A project with a content page, a page named after the search word, a section template and a media file. */
    private record Site(
            SearchFixtures.Fixture fx, String token, UUID contentPage, UUID uidPage, UUID teaser, UUID photo) {}

    private Site site(String prefix) {
        SearchFixtures.Fixture fx = fixtures.project(prefix);
        TemplateView template = fixtures.pageTemplate(fx, "Article");
        AssetVersionView contentPage = fixtures.page(
                fx, "Harbour guide", template.uuid(), "Welcome", "<p>The <strong>lighthouse</strong> keeper's guide</p>");
        AssetVersionView uidPage = fixtures.page(fx, "Lighthouse", template.uuid(), "Tower", "<p>Stone tower</p>");
        TemplateView teaser = fixtures.sectionTemplate(
                fx, "Teaser", "content {\n  editor text headline { label \"Headline\" }\n}", "<h2>$CMS_VALUE(headline)$</h2>");
        AssetVersionView photo = media.upload(
                fx.projectId(), null, "coast.txt", null, "text".getBytes(StandardCharsets.UTF_8), fx.ctx());
        media.updateMetadata(photo.uuid(), "A lighthouse at dusk", null, null, null, null, photo.validFromRevision(), fx.ctx());
        fixtures.awaitIndexed();
        return new Site(fx, jwt.issueAccessToken(fx.user()), contentPage.uuid(), uidPage.uuid(), teaser.uuid(), photo.uuid());
    }

    private ResultActions perform(MockHttpServletRequestBuilder request, String token) throws Exception {
        return mvc.perform(token == null ? request : request.header("Authorization", "Bearer " + token));
    }

    /** {@code params} as {@code name=value&…} with raw (unencoded) values. */
    private ResultActions query(Site site, String params) throws Exception {
        MockHttpServletRequestBuilder request = get("/api/v1/projects/" + site.fx().key() + "/search");
        for (String pair : params.split("&")) {
            if (pair.isEmpty()) {
                continue;
            }
            int eq = pair.indexOf('=');
            request.param(pair.substring(0, eq), pair.substring(eq + 1));
        }
        return perform(request, site.token());
    }

    private static JsonNode body(ResultActions result) throws Exception {
        return JSON.readTree(result.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
    }

    private static List<String> uuids(JsonNode body) {
        List<String> out = new ArrayList<>();
        body.path("content").forEach(hit -> out.add(hit.path("uuid").asText()));
        return out;
    }

    @Test
    void contentWordsUidsPrefixesAndPhrasesMatch() throws Exception {
        Site site = site("rank");

        JsonNode word = body(query(site, "q=lighthouse").andExpect(status().isOk()));
        assertThat(uuids(word)).contains(site.contentPage().toString(), site.uidPage().toString(), site.photo().toString());
        assertThat(uuids(word).indexOf(site.uidPage().toString()))
                .as("the exact uid match ranks above content-only matches")
                .isLessThan(uuids(word).indexOf(site.contentPage().toString()));
        assertThat(word.path("content").get(0).path("matchedIn").asText()).isEqualTo("UID");

        JsonNode prefix = body(query(site, "q=tea").andExpect(status().isOk()));
        assertThat(uuids(prefix)).contains(site.teaser().toString());

        JsonNode phrase = body(query(site, "q=\"keeper's guide\"").andExpect(status().isOk()));
        assertThat(uuids(phrase)).containsExactly(site.contentPage().toString());
        JsonNode wrongOrder = body(query(site, "q=\"guide keeper's\"").andExpect(status().isOk()));
        assertThat(uuids(wrongOrder)).isEmpty();

        JsonNode revisions = body(query(site, "q=lighthouse"));
        assertThat(revisions.path("indexedRevision").asLong()).isEqualTo(revisions.path("latestRevision").asLong());
    }

    @Test
    void typeFilterKeepsTheFacetCountsOfOtherTypes() throws Exception {
        Site site = site("facet");

        JsonNode all = body(query(site, "q=lighthouse").andExpect(status().isOk()));
        assertThat(all.path("facets").path("types").path("PAGE").asLong()).isEqualTo(2);
        assertThat(all.path("facets").path("types").path("MEDIA").asLong()).isEqualTo(1);

        JsonNode mediaOnly = body(query(site, "q=lighthouse&type=MEDIA").andExpect(status().isOk()));
        assertThat(uuids(mediaOnly)).containsExactly(site.photo().toString());
        assertThat(mediaOnly.path("page").path("totalElements").asLong()).isEqualTo(1);
        assertThat(mediaOnly.path("facets").path("types").path("PAGE").asLong()).isEqualTo(2);
        assertThat(mediaOnly.path("facets").path("types").path("MEDIA").asLong()).isEqualTo(1);

        JsonNode both = body(query(site, "q=lighthouse&type=MEDIA&type=page").andExpect(status().isOk()));
        assertThat(both.path("page").path("totalElements").asLong()).isEqualTo(3);
    }

    @Test
    void folderPrefixFiltersHits() throws Exception {
        Site site = site("folder");
        String mediaFolder = assets.requireCurrent(site.fx().projectId(), site.photo()).folderPath();

        JsonNode inFolder = body(query(site, "q=lighthouse&folder=" + mediaFolder).andExpect(status().isOk()));
        assertThat(uuids(inFolder)).containsExactly(site.photo().toString());
    }

    @Test
    void pagingEnvelope() throws Exception {
        Site site = site("paging");

        JsonNode second = body(query(site, "q=lighthouse&size=1&page=1").andExpect(status().isOk()));
        assertThat(second.path("content")).hasSize(1);
        JsonNode page = second.path("page");
        assertThat(page.path("number").asInt()).isEqualTo(1);
        assertThat(page.path("size").asInt()).isEqualTo(1);
        assertThat(page.path("totalElements").asLong()).isEqualTo(3);
        assertThat(page.path("totalPages").asInt()).isEqualTo(3);
        assertThat(page.path("totalIsLowerBound").asBoolean()).isFalse();

        JsonNode beyond = body(query(site, "q=lighthouse&size=10&page=5").andExpect(status().isOk()));
        assertThat(beyond.path("content")).isEmpty();
    }

    @Test
    void invalidParametersAreProblems() throws Exception {
        Site site = site("invalid");
        for (String params : List.of(
                "q=lighthouse&size=101", "q=", "q=  ", "", "q=lighthouse&sort=displayName", "q=lighthouse&type=BOGUS",
                "q=lighthouse&page=-1", "q=" + "x".repeat(201))) {
            query(site, params)
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("SF-SEARCH-0400"));
        }
        query(site, "q=lighthouse&sort=relevance").andExpect(status().isOk());
    }

    @Test
    void adversarialInputNeverFails() throws Exception {
        Site site = site("adversarial");
        List<String> inputs = List.of(
                "\"", "*", "?", "title:foo", "AND OR NOT", "\\", "x".repeat(10_000), "light*", "~lighthouse^10",
                "(lighthouse", "lighthouse)", "[a TO z]", "/regex/", "\"unbalanced lighthouse", "😀 مرحبا á̂",
                "--", "+-&&||!(){}[]^\"~*?:\\/", "uid_lower:lighthouse", "a b c d e f g h i j k l m n o p q r s t u v w x y z "
                        .repeat(3));
        for (String input : inputs) {
            int code = perform(get("/api/v1/projects/" + site.fx().key() + "/search").param("q", input), site.token())
                    .andReturn()
                    .getResponse()
                    .getStatus();
            assertThat(code).as("status for %s", input.length() > 40 ? input.substring(0, 40) + "…" : input).isIn(200, 400);
        }
        JsonNode unbalanced = body(perform(
                get("/api/v1/projects/" + site.fx().key() + "/search").param("q", "\"unbalanced lighthouse"), site.token()));
        assertThat(uuids(unbalanced)).isEmpty();
        JsonNode fieldSyntax = body(perform(
                get("/api/v1/projects/" + site.fx().key() + "/search").param("q", "title:lighthouse"), site.token()));
        assertThat(uuids(fieldSyntax)).isEmpty();
    }

    @Test
    void snippetsArePlainTextWithHighlightRangesInBounds() throws Exception {
        Site site = site("snippet");

        JsonNode result = body(query(site, "q=lighthouse&type=PAGE"));
        JsonNode hit = null;
        for (JsonNode candidate : result.path("content")) {
            if (candidate.path("uuid").asText().equals(site.contentPage().toString())) {
                hit = candidate;
            }
        }
        assertThat(hit).isNotNull();
        String snippet = hit.path("snippet").asText();
        assertThat(snippet).contains("lighthouse keeper's guide").doesNotContain("<", ">");
        assertThat(hit.path("matchedIn").asText()).isEqualTo("CONTENT");
        assertThat(hit.path("highlights")).isNotEmpty();
        for (JsonNode range : hit.path("highlights")) {
            int start = range.path("start").asInt();
            int end = range.path("end").asInt();
            assertThat(start).isBetween(0, snippet.length());
            assertThat(end).isBetween(start + 1, snippet.length());
            assertThat(snippet.substring(start, end)).isEqualToIgnoringCase("lighthouse");
        }
    }

    @Test
    void searchIsProjectScopedAndAuthorized() throws Exception {
        Site first = site("scope-a");
        Site second = site("scope-b");

        assertThat(uuids(body(query(first, "q=keeper")))).containsExactly(first.contentPage().toString());
        assertThat(uuids(body(query(second, "q=keeper")))).containsExactly(second.contentPage().toString());
        // A member of one project asking for the other gets 404 (§8.4).
        perform(get("/api/v1/projects/" + second.fx().key() + "/search?q=keeper"), first.token())
                .andExpect(status().isNotFound());

        AppUser viewer = users.create("search-viewer-" + UUID.randomUUID(), UUID.randomUUID() + "@example.com", "Viewer",
                "secret-password");
        projects.setMemberRole(first.fx().key(), viewer.getId(), ProjectRole.VIEWER, first.fx().ctx());
        perform(get("/api/v1/projects/" + first.fx().key() + "/search?q=keeper"), jwt.issueAccessToken(viewer))
                .andExpect(status().isOk());
        perform(get("/api/v1/projects/" + first.fx().key() + "/search?q=keeper"), null)
                .andExpect(status().isUnauthorized());
    }

    @Test
    void unavailableIndexIs503() throws Exception {
        Site site = site("down");
        doReturn(new SearchStatus(null, 5, 5, SearchStatus.State.UNAVAILABLE, null))
                .when(indexer)
                .status(eq(site.fx().projectId()));

        query(site, "q=lighthouse")
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("SF-SEARCH-0503"));
        perform(post("/api/v1/projects/" + site.fx().key() + "/search/reindex"), site.token())
                .andExpect(status().isServiceUnavailable());
    }

    @Test
    void statusAndReindexAuthorization() throws Exception {
        Site site = site("status");
        String url = "/api/v1/projects/" + site.fx().key() + "/search";

        JsonNode status = body(perform(get(url + "/status"), site.token()).andExpect(status().isOk()));
        assertThat(status.path("state").asText()).isEqualTo("READY");
        assertThat(status.path("lag").asLong()).isZero();
        assertThat(status.path("indexedRevision").asLong()).isEqualTo(status.path("latestRevision").asLong());

        for (ProjectRole role : List.of(ProjectRole.VIEWER, ProjectRole.EDITOR, ProjectRole.DEVELOPER)) {
            AppUser member = users.create("search-" + role + "-" + UUID.randomUUID(), UUID.randomUUID() + "@example.com",
                    role.name(), "secret-password");
            projects.setMemberRole(site.fx().key(), member.getId(), role, site.fx().ctx());
            String token = jwt.issueAccessToken(member);
            perform(get(url + "/status"), token).andExpect(status().isOk());
            perform(post(url + "/reindex"), token).andExpect(status().isForbidden());
        }
        AppUser outsider = users.create("search-outsider-" + UUID.randomUUID(), UUID.randomUUID() + "@example.com", "Outsider",
                "secret-password");
        perform(post(url + "/reindex"), jwt.issueAccessToken(outsider)).andExpect(status().isNotFound());
        perform(get(url + "/status"), jwt.issueAccessToken(outsider)).andExpect(status().isNotFound());
    }

    @Test
    void queriesKeepAnsweringFromThePreviousIndexUntilTheRebuildSwaps() throws Exception {
        Site site = site("reindex");
        TemplateView template = fixtures.pageTemplate(site.fx(), "Gate template");
        AssetVersionView gatePage = fixtures.page(site.fx(), "Gate page", template.uuid(), "Intro", "<p>alpha wording</p>");
        fixtures.awaitIndexed();
        String url = "/api/v1/projects/" + site.fx().key() + "/search";

        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch entered = new CountDownLatch(1);
        GateConfiguration.ENTERED.set(entered);
        GateConfiguration.RELEASE.set(release);
        try {
            JsonNode accepted = body(perform(post(url + "/reindex"), site.token()).andExpect(status().isAccepted()));
            assertThat(accepted.path("state").asText()).isEqualTo("REBUILDING");
            assertThat(entered.await(30, TimeUnit.SECONDS)).as("the rebuild reached the gate").isTrue();

            // An edit during the rebuild: its sync waits behind the rebuild, the old index keeps answering.
            fixtures.edit(site.fx(), gatePage.uuid(), payload -> payload.withObject("content")
                    .putObject("body").put("format", "html").put("value", "<p>beta wording</p>"));
            assertThat(uuids(body(query(site, "q=alpha").andExpect(status().isOk())))).containsExactly(gatePage.uuid().toString());
            assertThat(uuids(body(query(site, "q=beta").andExpect(status().isOk())))).isEmpty();
            assertThat(body(perform(get(url + "/status"), site.token())).path("state").asText()).isEqualTo("REBUILDING");

            perform(post(url + "/reindex"), site.token())
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("SF-SEARCH-0409"));
        } finally {
            GateConfiguration.RELEASE.set(null);
            release.countDown();
        }

        fixtures.awaitIndexed();
        assertThat(uuids(body(query(site, "q=beta")))).containsExactly(gatePage.uuid().toString());
        assertThat(uuids(body(query(site, "q=alpha")))).isEmpty();
        JsonNode after = body(perform(get(url + "/status"), site.token()));
        assertThat(after.path("state").asText()).isEqualTo("READY");
        assertThat(after.path("lastRebuildAt").isNull()).isFalse();
    }
}
