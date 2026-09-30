package com.acme.staticforge;

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
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * {@code M20.2.1} + {@code M20.4.1} over HTTP: the template read model (abstract, derived parent, ancestors, effective
 * definition), the page template list's {@code abstract} flag, the {@code abstract} request field, the
 * {@code SF-DOM-0122} shape, and context-aware OCTL validation.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class TemplateInheritanceApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final String BASE_CDL = "content { editor text title { label \"Title\" } } bodies { body main { allow [\"*\"] } }";

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired UserService userService;
    @Autowired JwtService jwtService;
    @Autowired ProjectService projectService;
    @Autowired TemplateService templateService;
    @Autowired PageService pageService;

    @Test
    void templateDetailAndListExposeInheritance() throws Exception {
        Fixture fx = newFixture();
        TemplateView base = template(fx, "Base", BASE_CDL, "$CMS_VALUE(title)$$CMS_BODY(main)$$CMS_BLOCK(c)$$CMS_END_BLOCK$", true);
        TemplateView child = template(fx, "Child", "content { editor text summary { label \"S\" } }",
                "$CMS_EXTENDS(page_template:" + base.uid() + ")$$CMS_BLOCK(c)$$CMS_VALUE(summary)$$CMS_END_BLOCK$", false);

        mvc.perform(get(url(fx, "/page-templates/" + child.uuid())).header("Authorization", fx.bearer()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.abstract").value(false))
                .andExpect(jsonPath("$.parentTemplateRef").value(base.uuid().toString()))
                .andExpect(jsonPath("$.ancestors[0].uid").value(base.uid()))
                .andExpect(jsonPath("$.compiledDefinition.editors.length()").value(1))
                .andExpect(jsonPath("$.effectiveDefinition.editors[*].name").value(Matchers.contains("title", "summary")))
                .andExpect(jsonPath("$.effectiveDefinition.bodies[0].name").value("main"))
                .andExpect(jsonPath("$.inheritedFrom.editors.title").value(base.uid()))
                .andExpect(jsonPath("$.inheritedFrom.bodies.main").value(base.uid()));

        mvc.perform(get(url(fx, "/page-templates")).header("Authorization", fx.bearer()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.uid == '" + base.uid() + "')].abstract").value(Matchers.contains(true)))
                .andExpect(jsonPath("$.content[?(@.uid == '" + child.uid() + "')].abstract").value(Matchers.contains(false)))
                .andExpect(jsonPath("$.content[?(@.uid == '" + child.uid() + "')].parentTemplateRef")
                        .value(Matchers.contains(base.uuid().toString())));
    }

    @Test
    void theAbstractFlagIsWrittenOverHttpAndRefusedForATemplateInUse() throws Exception {
        Fixture fx = newFixture();
        TemplateView base = template(fx, "Base", BASE_CDL, "$CMS_VALUE(title)$$CMS_BODY(main)$", false);
        pageService.create(new CreatePageCommand("Uses it", null, base.uuid()), fx.ctx());

        String body = objectMapper.writeValueAsString(Map.of(
                "displayName", "Base",
                "contentCdl", CdlSources.split(BASE_CDL).content(),
                "bodiesCdl", CdlSources.split(BASE_CDL).bodies(),
                "channelSources", Map.of("html", "$CMS_VALUE(title)$$CMS_BODY(main)$"),
                "abstract", true));
        mvc.perform(put(url(fx, "/page-templates/" + base.uuid()))
                        .header("Authorization", fx.bearer())
                        .header("If-Match", "\"rev-" + base.validFromRevision() + "\"")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-DOM-0122"))
                .andExpect(jsonPath("$.pageCount").value(1))
                .andExpect(jsonPath("$.pageUids.length()").value(1))
                .andExpect(jsonPath("$.pageUuids.length()").value(1));

        String created = mvc.perform(post(url(fx, "/page-templates"))
                        .header("Authorization", fx.bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "displayName", "Layout", "contentCdl", "", "channelSources", Map.of(), "abstract", true))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.abstract").value(true))
                .andReturn().getResponse().getContentAsString();
        String layoutUuid = objectMapper.readTree(created).path("uuid").asText();

        mvc.perform(post(url(fx, "/pages"))
                        .header("Authorization", fx.bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("displayName", "Nope", "templateUuid", layoutUuid))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-DOM-0123"));
    }

    @Test
    void validationWithATemplateUuidUsesTheChainReferencesAndUnsavedCdl() throws Exception {
        Fixture fx = newFixture();
        TemplateView base = template(fx, "Base", BASE_CDL, "$CMS_VALUE(title)$$CMS_BODY(main)$$CMS_BLOCK(c)$$CMS_END_BLOCK$", true);
        TemplateView child = template(fx, "Child", "", "$CMS_EXTENDS(page_template:" + base.uid() + ")$", false);
        TemplateView solo = template(fx, "Solo", "", "solo", false);
        String usesParentEditor = "$CMS_EXTENDS(page_template:" + base.uid() + ")$$CMS_BLOCK(c)$$CMS_VALUE(title)$$CMS_END_BLOCK$";

        validate(fx, usesParentEditor, child.uuid().toString(), null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.diagnostics[?(@.code == '" + DiagnosticCodes.OCTL_UNKNOWN_EDITOR + "')]").isEmpty())
                .andExpect(jsonPath("$.diagnostics[?(@.severity == 'ERROR')]").isEmpty());

        // The same editor on a template without the parent is unknown.
        validate(fx, "$CMS_VALUE(title)$", solo.uuid().toString(), null)
                .andExpect(jsonPath("$.diagnostics[?(@.code == '" + DiagnosticCodes.OCTL_UNKNOWN_EDITOR + "')]").isNotEmpty());

        // Unsaved CDL counts: an editor only just declared is known.
        validate(fx, "$CMS_VALUE(fresh)$", solo.uuid().toString(), "content { editor text fresh { label \"F\" } }")
                .andExpect(jsonPath("$.diagnostics[?(@.severity == 'ERROR')]").isEmpty());

        // A typo'd override warns with a suggestion.
        validate(fx, "$CMS_EXTENDS(page_template:" + base.uid() + ")$$CMS_BLOCK(cc)$x$CMS_END_BLOCK$", child.uuid().toString(), null)
                .andExpect(jsonPath("$.diagnostics[?(@.code == '" + DiagnosticCodes.OCTL_UNKNOWN_BLOCK_OVERRIDE + "')]").isNotEmpty());

        // Making the base extend its own child is a cycle.
        validate(fx, "$CMS_EXTENDS(page_template:" + child.uid() + ")$", base.uuid().toString(), null)
                .andExpect(jsonPath("$.diagnostics[?(@.code == '" + DiagnosticCodes.OCTL_INHERITANCE_CYCLE + "')]").isNotEmpty());

        // Without templateUuid the source compiles on its own, as before.
        validate(fx, "$CMS_VALUE(title)$", null, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.diagnostics").isEmpty());
    }

    // ------------------------------------------------------------------

    private ResultActions validate(Fixture fx, String source, String templateUuid, String cdl) throws Exception {
        Map<String, Object> body = new java.util.HashMap<>();
        body.put("source", source);
        body.put("channelKey", "html");
        body.put("templateUuid", templateUuid);
        if (cdl != null) {
            CdlSources sections = CdlSources.split(cdl);
            body.put("contentCdl", sections.content());
            body.put("bodiesCdl", sections.bodies());
            body.put("rulesCdl", sections.rules());
        }
        return mvc.perform(post(url(fx, "/octl/validate"))
                .header("Authorization", fx.bearer())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body)));
    }

    private TemplateView template(Fixture fx, String name, String cdl, String html, boolean abstractTemplate) {
        return templateService.create(new CreateTemplateCommand(
                fx.project().getId(), AssetType.PAGE_TEMPLATE, name, CdlSources.split(cdl), Map.of("html", html), null, false, null, null,
                abstractTemplate), fx.ctx());
    }

    private static String url(Fixture fx, String path) {
        return "/api/v1/projects/" + fx.project().getKey() + path;
    }

    private record Fixture(Project project, AppUser user, String token) {
        RevisionContext ctx() {
            return RevisionContext.of(project.getId(), user.getId(), "inheritance api");
        }

        String bearer() {
            return "Bearer " + token;
        }
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create("inh-api-" + n, "inh-api-" + n + "@example.com", "Inheritance API " + n, "secret-password");
        Project project = projectService.create(new CreateProjectRequest("inhapi_" + n, "Inheritance API " + n, null, null), user.getId());
        return new Fixture(project, user, jwtService.issueAccessToken(user));
    }
}
