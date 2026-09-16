package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
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
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * Server-side content validation on page saves (spec §10.5, M16.5.2): structural findings are
 * rejected with a field-addressed {@code 422 SF-API-0422}, completeness findings save and come
 * back as advisory {@code issues}, and a body's {@code allow} list is enforced on section add/move.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PageContentValidationApiIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired UserService userService;
    @Autowired JwtService jwtService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;

    @Test
    void numberEditorHoldingTextIsRejectedWithTheEditorPath() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView page = fx.page();
        ObjectNode payload = pagePayload(page);
        payload.putObject("content").put("title", "Hello").put("count", "abc");

        savePage(fx, page, payload)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-API-0422"))
                .andExpect(jsonPath("$.issues.length()").value(1))
                .andExpect(jsonPath("$.issues[0].path").value("content.count"))
                .andExpect(jsonPath("$.issues[0].code").value("type"))
                .andExpect(jsonPath("$.issues[0].kind").value("STRUCTURAL"));

        assertThat(assetService.requireCurrent(fx.project().getId(), page.uuid()).validFromRevision())
                .isEqualTo(page.validFromRevision());
    }

    @Test
    void emptyRequiredEditorSavesAndIsReportedAsAdvisoryIssue() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView page = fx.page();
        ObjectNode payload = pagePayload(page);
        payload.putObject("content").put("title", "").put("count", 3);

        savePage(fx, page, payload)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.count").value(3))
                .andExpect(jsonPath("$.issues[?(@.path == 'content.title')].code").value("required"))
                .andExpect(jsonPath("$.issues[?(@.path == 'content.title')].kind").value("COMPLETENESS"))
                .andExpect(jsonPath("$.issues[?(@.path == 'content.title')].severity").value("ERROR"));
    }

    @Test
    void addingASectionOutsideTheBodyAllowListIsRejected() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView page = fx.page();

        addSection(fx, page, "sidebar", fx.banner().uuid())
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-API-0422"))
                .andExpect(jsonPath("$.issues[0].path").value("bodies.sidebar[0].templateRef"))
                .andExpect(jsonPath("$.issues[0].code").value("allow"));

        addSection(fx, page, "sidebar", fx.teaser().uuid())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bodies.sidebar.length()").value(1));
    }

    @Test
    void movingASectionIntoABodyThatDoesNotAllowItIsRejected() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView page = fx.page();
        JsonNode added = readJson(addSection(fx, page, "main", fx.banner().uuid()).andExpect(status().isOk()));
        String instanceId = added.path("bodies").path("main").get(0).path("instanceId").asText();
        long revision = added.path("revision").asLong();

        // Same page, main (allow *) -> sidebar (allow teaser only).
        moveSection(fx, page.uuid(), revision, page.uuid(), "main", instanceId)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.issues[0].path").value("bodies.sidebar[0].templateRef"))
                .andExpect(jsonPath("$.issues[0].code").value("allow"));

        // Another page's sidebar rejects it too, and the source page keeps its section.
        AssetVersionView other = fx.newPage("Other");
        moveSection(fx, other.uuid(), other.validFromRevision(), page.uuid(), "main", instanceId)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.issues[0].code").value("allow"));
        assertThat(assetService.requireCurrent(fx.project().getId(), page.uuid()).payload()
                .path("bodies").path("main").size()).isEqualTo(1);
    }

    @Test
    void structuralErrorInACatalogCardNestedTwoLevelsDeepIsRejectedWithTheNestedPath() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView page = fx.page();
        String teaser = fx.teaser().uuid().toString();
        String banner = fx.banner().uuid().toString();
        ObjectNode payload = pagePayload(page);
        payload.putObject("content").put("title", "Hello");
        payload.set("bodies", objectMapper.readTree("""
                {"main":[{"instanceId":"s1","templateRef":"%s","content":{
                  "headline":"Outer",
                  "cards":{"type":"CATALOG","cards":[{"instanceId":"c1","templateRef":"%s","content":{
                    "headline":"Inner",
                    "cards":{"type":"CATALOG","cards":[{"instanceId":"c2","templateRef":"%s","content":{"height":"tall"}}]}
                  }}]}
                }}],
                 "sidebar":[]}
                """.formatted(teaser, teaser, banner)));

        savePage(fx, page, payload)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.issues.length()").value(1))
                .andExpect(jsonPath("$.issues[0].path")
                        .value("bodies.main[0].content.cards.cards[0].content.cards.cards[0].content.height"))
                .andExpect(jsonPath("$.issues[0].code").value("type"));
    }

    @Test
    void sectionOperationsDoNotRejectUntouchedLegacyContent() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView page = fx.page();
        // Content written before validation existed, bypassing the page service.
        ObjectNode legacy = (ObjectNode) page.payload().deepCopy();
        legacy.putObject("content").put("count", "not a number");
        AssetVersionView stored = assetService.update(
                page.uuid(), new com.acme.staticforge.asset.UpdateAssetCommand(page.displayName(), legacy),
                page.validFromRevision(), fx.ctx());

        addSection(fx, stored, "sidebar", fx.teaser().uuid())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.issues[?(@.path == 'content.count')].kind").value("STRUCTURAL"));
    }

    private ResultActions savePage(Fixture fx, AssetVersionView page, JsonNode payload) throws Exception {
        return mvc.perform(put("/api/v1/projects/" + fx.project().getKey() + "/pages/" + page.uuid())
                .header("Authorization", "Bearer " + fx.token())
                .header("If-Match", "\"rev-" + page.validFromRevision() + "\"")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(payload)));
    }

    private ResultActions addSection(Fixture fx, AssetVersionView page, String body, UUID templateUuid) throws Exception {
        long revision = assetService.requireCurrent(fx.project().getId(), page.uuid()).validFromRevision();
        return mvc.perform(post("/api/v1/projects/" + fx.project().getKey() + "/pages/" + page.uuid()
                        + "/bodies/" + body + "/sections")
                .header("Authorization", "Bearer " + fx.token())
                .header("If-Match", "\"rev-" + revision + "\"")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"templateUuid\":\"" + templateUuid + "\"}"));
    }

    private ResultActions moveSection(
            Fixture fx, UUID targetUuid, long targetRevision, UUID sourceUuid, String sourceBody, String instanceId)
            throws Exception {
        return mvc.perform(post("/api/v1/projects/" + fx.project().getKey() + "/pages/" + targetUuid
                        + "/bodies/sidebar/sections/move")
                .header("Authorization", "Bearer " + fx.token())
                .header("If-Match", "\"rev-" + targetRevision + "\"")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"sourcePageUuid":"%s","sourceBody":"%s","instanceId":"%s"}
                        """.formatted(sourceUuid, sourceBody, instanceId)));
    }

    private JsonNode readJson(ResultActions result) throws Exception {
        return objectMapper.readTree(result.andReturn().getResponse().getContentAsString());
    }

    private static ObjectNode pagePayload(AssetVersionView page) {
        return (ObjectNode) page.payload().deepCopy();
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser admin = userService.create(
                "cv-admin-" + n, "cv-admin-" + n + "@example.com", "Content Validation " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("contentval_" + n, "Content Validation " + n, null, null), admin.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), admin.getId(), "test");

        TemplateView teaser = templateService.create(new CreateTemplateCommand(
                project.getId(), AssetType.SECTION_TEMPLATE, "Teaser " + n,
                "content { editor text headline { required } editor catalog cards { } }",
                Map.of("html", "<div>$CMS_VALUE(headline)$$CMS_VALUE(cards)$</div>"), null, false, null), ctx);
        TemplateView banner = templateService.create(new CreateTemplateCommand(
                project.getId(), AssetType.SECTION_TEMPLATE, "Banner " + n,
                "content { editor number height { } }",
                Map.of("html", "<div>$CMS_VALUE(height)$</div>"), null, false, null), ctx);
        TemplateView pageTemplate = templateService.create(new CreateTemplateCommand(
                project.getId(), AssetType.PAGE_TEMPLATE, "Page " + n,
                """
                content {
                  editor text title { required }
                  editor number count { }
                }
                bodies {
                  body main    { allow ["*"] }
                  body sidebar { allow ["%s"] }
                }
                """.formatted(teaser.uid()),
                Map.of("html", "<h1>$CMS_VALUE(title)$ $CMS_VALUE(count)$</h1>"), null, false, null), ctx);
        return new Fixture(project, admin, ctx, pageTemplate, teaser, banner);
    }

    private final class Fixture {
        private final Project project;
        private final AppUser admin;
        private final RevisionContext ctx;
        private final TemplateView pageTemplate;
        private final TemplateView teaser;
        private final TemplateView banner;

        Fixture(Project project, AppUser admin, RevisionContext ctx, TemplateView pageTemplate, TemplateView teaser,
                TemplateView banner) {
            this.project = project;
            this.admin = admin;
            this.ctx = ctx;
            this.pageTemplate = pageTemplate;
            this.teaser = teaser;
            this.banner = banner;
        }

        Project project() {
            return project;
        }

        RevisionContext ctx() {
            return ctx;
        }

        TemplateView teaser() {
            return teaser;
        }

        TemplateView banner() {
            return banner;
        }

        AssetVersionView page() {
            return newPage("Home");
        }

        AssetVersionView newPage(String name) {
            return pageService.create(new CreatePageCommand(name + " " + SEQ.incrementAndGet(), null, pageTemplate.uuid()), ctx);
        }

        String token() {
            return jwtService.issueAccessToken(admin);
        }
    }
}
