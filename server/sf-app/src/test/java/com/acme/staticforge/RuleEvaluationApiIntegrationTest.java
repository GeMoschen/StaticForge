package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * {@code POST /rules/evaluate} (M33.5): the {@code edit} scope on an unsaved value — findings of every level, fills and
 * field states; {@code ref} reads drafts; {@code locale} limits the languages; messages follow
 * {@code Accept-Language}; viewers may evaluate, strangers see nothing; rate limited on the draft-check budget.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class RuleEvaluationApiIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static final String CDL = """
            content {
              editor text title { localizable }
              editor text slug { }
              editor text category { }
              editor text teaser { }
              editor text locked { }
              editor media image { }
            }
            rules {
              rule "no-tbd" on title {
                level error  scope [edit]
                assert "value != 'TBD'"
                message { en "Replace the placeholder title" de "Platzhaltertitel ersetzen" }
                locales all
              }
              rule "short-title" on title {
                level warning  scope [edit]
                assert "length(value) <= 12"
                message { en "Keep titles short ({length})" }
                locales all
              }
              rule "note" on category {
                level info  scope [edit]
                assert "value != 'legacy'"
                message { en "Legacy category" }
              }
              rule "tip" on teaser {
                level hint  scope [edit]
                assert "!isEmpty(value)"
                message { en "A teaser helps" }
              }
              rule "alt-text" on image {
                level warning  scope [edit]
                assert "!isEmpty(ref(value).meta.alt)"
                message { en "The selected image has no alt text" }
              }
              state teaser { requiredWhen "category == 'news'" }
              state locked { readOnlyWhen "category == 'frozen'" }
              fill slug { value "slugify(title)"  mode empty  on [edit] }
            }
            """;

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired UserService userService;
    @Autowired JwtService jwtService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;
    @Autowired MediaService mediaService;

    @Test
    void findingsOfEveryLevelFillsAndStatesForTheUnsavedValue() throws Exception {
        Fixture fx = newFixture(false);
        AssetVersionView page = fx.page();
        // The stored draft is fine; the unsaved value is what counts.
        ObjectNode request = pageRequest(fx, page, """
                {"title":"TBD","category":"news","locked":"x"}""");

        JsonNode result = readJson(evaluate(fx, fx.token(), request).andExpect(status().isOk()));
        assertThat(ruleSeverity(result, "no-tbd")).isEqualTo("ERROR");
        assertThat(ruleSeverity(result, "tip")).isEqualTo("HINT");
        assertThat(result.path("fills")).anySatisfy(fill -> {
            assertThat(fill.path("path").asText()).isEqualTo("content.slug");
            assertThat(fill.path("value").asText()).isEqualTo("tbd");
        });
        assertThat(result.path("fieldStates")).anySatisfy(state -> {
            assertThat(state.path("path").asText()).isEqualTo("content.teaser");
            assertThat(state.path("required").asBoolean()).isTrue();
        });

        JsonNode other = readJson(evaluate(fx, fx.token(), pageRequest(fx, page, """
                {"title":"A rather long title","category":"legacy"}""")).andExpect(status().isOk()));
        assertThat(ruleSeverity(other, "short-title")).isEqualTo("WARNING");
        assertThat(ruleSeverity(other, "note")).isEqualTo("INFO");
        assertThat(ruleSeverity(other, "no-tbd")).isNull();

        JsonNode frozen = readJson(evaluate(fx, fx.token(), pageRequest(fx, page, """
                {"title":"Hi","category":"frozen","teaser":"t"}""")).andExpect(status().isOk()));
        assertThat(frozen.path("fieldStates")).anySatisfy(state -> {
            assertThat(state.path("path").asText()).isEqualTo("content.locked");
            assertThat(state.path("readOnly").asBoolean()).isTrue();
        });

        // Nothing was stored.
        assertThat(assetService.requireCurrent(fx.project().getId(), page.uuid()).validFromRevision())
                .isEqualTo(page.validFromRevision());
    }

    @Test
    void messagesFollowTheUiLanguage() throws Exception {
        Fixture fx = newFixture(false);
        ObjectNode request = pageRequest(fx, fx.page(), "{\"title\":\"TBD\"}");

        evaluate(fx, fx.token(), request, "de")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.findings[?(@.rule == 'no-tbd')].message").value("Platzhaltertitel ersetzen"));
        evaluate(fx, fx.token(), request, "en")
                .andExpect(jsonPath("$.findings[?(@.rule == 'no-tbd')].message").value("Replace the placeholder title"));
    }

    @Test
    void refReadsTheDraftOfTheReferencedMedium() throws Exception {
        Fixture fx = newFixture(false);
        AssetVersionView page = fx.page();
        AssetVersionView described = mediaService.upload(
                fx.project().getId(), null, "a.png", "image/png", "A logo", null, png(), fx.ctx());
        AssetVersionView bare = mediaService.upload(
                fx.project().getId(), null, "b.png", "image/png", null, null, png(), fx.ctx());

        // Neither medium is released: only their drafts exist.
        JsonNode withAlt = readJson(evaluate(fx, fx.token(), pageRequest(fx, page, mediaContent(described)))
                .andExpect(status().isOk()));
        assertThat(ruleSeverity(withAlt, "alt-text")).isNull();

        JsonNode withoutAlt = readJson(evaluate(fx, fx.token(), pageRequest(fx, page, mediaContent(bare)))
                .andExpect(status().isOk()));
        assertThat(ruleSeverity(withoutAlt, "alt-text")).isEqualTo("WARNING");
    }

    @Test
    void localeLimitsTheLanguagesEvaluated() throws Exception {
        Fixture fx = newFixture(true);
        AssetVersionView page = fx.page();
        String content = """
                {"title":{"type":"L10N","values":{"de":"Hallo","en":"TBD","fr":"TBD"}}}""";

        JsonNode all = readJson(evaluate(fx, fx.token(), pageRequest(fx, page, content)).andExpect(status().isOk()));
        assertThat(localesOf(all, "no-tbd")).containsExactlyInAnyOrder("en", "fr");

        ObjectNode onlyEn = pageRequest(fx, page, content);
        onlyEn.put("locale", "en");
        JsonNode en = readJson(evaluate(fx, fx.token(), onlyEn).andExpect(status().isOk()));
        assertThat(localesOf(en, "no-tbd")).containsExactly("en");

        ObjectNode onlyDe = pageRequest(fx, page, content);
        onlyDe.put("locale", "de");
        JsonNode de = readJson(evaluate(fx, fx.token(), onlyDe).andExpect(status().isOk()));
        assertThat(localesOf(de, "no-tbd")).isEmpty();

        ObjectNode unknown = pageRequest(fx, page, content);
        unknown.put("locale", "xx");
        evaluate(fx, fx.token(), unknown).andExpect(status().isBadRequest());
    }

    @Test
    void recordsSectionsAndPropertySetsByDefinitionUid() throws Exception {
        Fixture fx = newFixture(false);
        TemplateView section = templateService.create(new CreateTemplateCommand(
                fx.project().getId(), AssetType.SECTION_TEMPLATE, "Teaser " + SEQ.incrementAndGet(),
                CdlSources.split("""
                content { editor text headline { } }
                rules { rule "headline" on headline { level warning scope [edit] assert "!isEmpty(value)" message { en "Headline!" } } }
                """),
                Map.of("html", "<div>$CMS_VALUE(headline)$</div>"), null, false, null), fx.ctx());

        ObjectNode request = objectMapper.createObjectNode();
        request.put("kind", "SECTION").put("templateUid", section.uid());
        request.putObject("content");
        evaluate(fx, fx.token(), request)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.findings[?(@.rule == 'headline')].path").value("content.headline"));

        ObjectNode missing = objectMapper.createObjectNode();
        missing.put("kind", "RECORD").put("datasetUid", "nope");
        evaluate(fx, fx.token(), missing).andExpect(status().isNotFound());

        ObjectNode badKind = objectMapper.createObjectNode();
        badKind.put("kind", "WAT");
        evaluate(fx, fx.token(), badKind).andExpect(status().isBadRequest());
    }

    @Test
    void viewersMayEvaluateStrangersSeeNothing() throws Exception {
        Fixture fx = newFixture(false);
        ObjectNode request = pageRequest(fx, fx.page(), "{\"title\":\"Hi\"}");
        AppUser viewer = newUser("re-viewer");
        projectService.setMemberRole(fx.project().getKey(), viewer.getId(), ProjectRole.VIEWER, fx.ctx());
        AppUser stranger = newUser("re-stranger");

        evaluate(fx, jwtService.issueAccessToken(viewer), request).andExpect(status().isOk());
        evaluate(fx, jwtService.issueAccessToken(stranger), request).andExpect(status().isNotFound());
    }

    @Test
    void evaluationsShareTheDraftCheckRateLimit() throws Exception {
        Fixture fx = newFixture(false);
        ObjectNode request = pageRequest(fx, fx.page(), "{\"title\":\"Hi\"}");
        AppUser user = newUser("re-limit");
        projectService.setMemberRole(fx.project().getKey(), user.getId(), ProjectRole.VIEWER, fx.ctx());
        String token = jwtService.issueAccessToken(user);

        List<Integer> statuses = new ArrayList<>();
        for (int i = 0; i < 61; i++) {
            statuses.add(evaluate(fx, token, request).andReturn().getResponse().getStatus());
        }
        assertThat(statuses.subList(0, 60)).containsOnly(200);
        assertThat(statuses.get(60)).isEqualTo(429);
    }

    @Test
    void aTypicalPageEvaluatesWellUnderFiftyMilliseconds() throws Exception {
        Fixture fx = newFixture(false);
        ObjectNode request = pageRequest(fx, fx.page(), """
                {"title":"A rather long title","category":"news","teaser":"t","locked":"x"}""");
        for (int i = 0; i < 5; i++) {
            evaluate(fx, fx.token(), request).andExpect(status().isOk());
        }
        long[] times = new long[21];
        for (int i = 0; i < times.length; i++) {
            long start = System.nanoTime();
            evaluate(fx, fx.token(), request).andExpect(status().isOk());
            times[i] = System.nanoTime() - start;
        }
        Arrays.sort(times);
        assertThat(times[times.length / 2] / 1_000_000).isLessThan(50);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private ResultActions evaluate(Fixture fx, String token, JsonNode body) throws Exception {
        return evaluate(fx, token, body, "en");
    }

    private ResultActions evaluate(Fixture fx, String token, JsonNode body, String language) throws Exception {
        return mvc.perform(post("/api/v1/projects/" + fx.project().getKey() + "/rules/evaluate")
                .header("Authorization", "Bearer " + token)
                .header("Accept-Language", language)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body)));
    }

    private ObjectNode pageRequest(Fixture fx, AssetVersionView page, String content) throws Exception {
        ObjectNode request = objectMapper.createObjectNode();
        request.put("kind", "PAGE");
        request.put("assetUuid", page.uuid().toString());
        request.put("templateUid", fx.pageTemplate().uid());
        request.set("content", objectMapper.readTree(content));
        return request;
    }

    private static String mediaContent(AssetVersionView media) {
        return "{\"title\":\"Hi\",\"image\":{\"type\":\"MEDIA_REF\",\"uuid\":\"" + media.uuid() + "\"}}";
    }

    private static String ruleSeverity(JsonNode result, String rule) {
        for (JsonNode finding : result.path("findings")) {
            if (rule.equals(finding.path("rule").asText())) {
                return finding.path("severity").asText();
            }
        }
        return null;
    }

    private static List<String> localesOf(JsonNode result, String rule) {
        List<String> locales = new ArrayList<>();
        result.path("findings").forEach(finding -> {
            if (rule.equals(finding.path("rule").asText())) {
                locales.add(finding.path("locale").asText());
            }
        });
        return locales;
    }

    private JsonNode readJson(ResultActions result) throws Exception {
        return objectMapper.readTree(result.andReturn().getResponse().getContentAsString());
    }

    private AppUser newUser(String prefix) {
        int n = SEQ.incrementAndGet();
        return userService.create(prefix + "-" + n, prefix + "-" + n + "@example.com", prefix + " " + n, "secret-password");
    }

    private static byte[] png() {
        BufferedImage image = new BufferedImage(4, 4, BufferedImage.TYPE_INT_RGB);
        try (ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            ImageIO.write(image, "png", out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private Fixture newFixture(boolean localized) {
        int n = SEQ.incrementAndGet();
        AppUser admin = newUser("re-admin");
        Project project = projectService.create(
                new CreateProjectRequest("ruleeval_" + n, "Rule Evaluation " + n, null, null), admin.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), admin.getId(), "test");
        if (localized) {
            projectService.updateLocales(project.getKey(), LocaleConfig.of(
                    List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English"),
                            new ProjectLocale("fr", "Français")),
                    "de", Map.of(), false), true, ctx);
        }
        TemplateView pageTemplate = templateService.create(new CreateTemplateCommand(
                project.getId(), AssetType.PAGE_TEMPLATE, "Page " + n, CdlSources.split(CDL),
                Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"), null, false, null), ctx);
        return new Fixture(project, admin, ctx, pageTemplate);
    }

    private final class Fixture {
        private final Project project;
        private final AppUser admin;
        private final RevisionContext ctx;
        private final TemplateView pageTemplate;

        Fixture(Project project, AppUser admin, RevisionContext ctx, TemplateView pageTemplate) {
            this.project = project;
            this.admin = admin;
            this.ctx = ctx;
            this.pageTemplate = pageTemplate;
        }

        Project project() {
            return project;
        }

        RevisionContext ctx() {
            return ctx;
        }

        TemplateView pageTemplate() {
            return pageTemplate;
        }

        AssetVersionView page() {
            return pageService.create(
                    new CreatePageCommand("Home " + SEQ.incrementAndGet(), null, pageTemplate.uuid()), ctx);
        }

        String token() {
            return jwtService.issueAccessToken(admin);
        }
    }
}
