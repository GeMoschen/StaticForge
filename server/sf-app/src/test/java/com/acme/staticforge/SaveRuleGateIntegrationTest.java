package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.content.ContentIssue;
import com.acme.staticforge.asset.dataset.CreateDatasetCommand;
import com.acme.staticforge.asset.dataset.CreateRecordCommand;
import com.acme.staticforge.asset.dataset.DatasetService;
import com.acme.staticforge.asset.dataset.DatasetView;
import com.acme.staticforge.asset.dataset.RecordService;
import com.acme.staticforge.asset.dataset.RecordSetService;
import com.acme.staticforge.asset.dataset.RecordWriteResult;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.globals.CreateGlobalSetCommand;
import com.acme.staticforge.asset.globals.GlobalSetService;
import com.acme.staticforge.asset.globals.GlobalSetView;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
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
 * The save rule gate (M33.4) on every asset kind with rules: a save-scope {@code error} rejects the save — PUT (which
 * autosave is), PATCH, a record or property set write — with {@code 422 SF-API-0422} and the findings; warnings and
 * infos save and come back; {@code save} fills write ({@code mode empty} only into an empty field, {@code mode always}
 * over a typed value, noted {@code read-only}); a field read-only on the stored version keeps its value, noted; a
 * structural finding still rejects first.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SaveRuleGateIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    /** Editors and rules shared by the page template, the dataset and the property set. */
    private static final String CDL = """
            content {
              editor text title { }
              editor text slug { }
              editor text path { }
              editor text category { }
              editor text locked { }
              editor number count { }
            }
            rules {
              rule "no-tbd" on title {
                level error  scope [save]
                assert "value != 'TBD'"
                message { en "Replace the placeholder title" }
              }
              rule "short-title" on title {
                level warning  scope [edit, save]
                assert "length(value) <= 12"
                message { en "Keep titles short ({length})" }
              }
              rule "count-note" on count {
                level info  scope [edit, save]
                assert "value == null || value < 100"
                message { en "That is a lot" }
              }
              state locked { readOnlyWhen "category == 'frozen'" }
              fill slug { value "slugify(title)"  mode empty  on [save] }
              fill path { value "'/x/' + slug"  mode always  on [save] }
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
    @Autowired DatasetService datasetService;
    @Autowired RecordService recordService;
    @Autowired RecordSetService recordSetService;
    @Autowired GlobalSetService globalSetService;
    @Autowired FolderService folderService;

    // ------------------------------------------------------------------
    // Pages
    // ------------------------------------------------------------------

    @Test
    void pageSaveScopeErrorRejectsPutAndPatchAndStoresNothing() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView page = fx.page();

        savePage(fx, page, content(page, "{\"title\":\"TBD\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-API-0422"))
                .andExpect(jsonPath("$.issues[?(@.rule == 'no-tbd')].path").value("content.title"))
                .andExpect(jsonPath("$.issues[?(@.rule == 'no-tbd')].severity").value("ERROR"))
                .andExpect(jsonPath("$.issues[?(@.rule == 'no-tbd')].message").value("Replace the placeholder title"));

        mvc.perform(patch("/api/v1/projects/" + fx.project().getKey() + "/pages/" + page.uuid() + "/content")
                        .header("Authorization", "Bearer " + fx.token())
                        .header("If-Match", "\"rev-" + page.validFromRevision() + "\"")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\":{\"title\":\"TBD\"}}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.issues[?(@.rule == 'no-tbd')].path").value("content.title"));

        assertThat(assetService.requireCurrent(fx.project().getId(), page.uuid()).validFromRevision())
                .isEqualTo(page.validFromRevision());
    }

    @Test
    void pageWarningsAndInfosSaveAndAreReturnedAndShownAfterReload() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView page = fx.page();

        savePage(fx, page, content(page, "{\"title\":\"A rather long title\",\"count\":500}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.title").value("A rather long title"))
                .andExpect(jsonPath("$.issues[?(@.rule == 'short-title')].severity").value("WARNING"))
                .andExpect(jsonPath("$.issues[?(@.rule == 'short-title')].message").value("Keep titles short (19)"))
                .andExpect(jsonPath("$.issues[?(@.rule == 'count-note')].severity").value("INFO"));

        mvc.perform(get("/api/v1/projects/" + fx.project().getKey() + "/pages/" + page.uuid())
                        .header("Authorization", "Bearer " + fx.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.issues[?(@.rule == 'short-title')].severity").value("WARNING"))
                .andExpect(jsonPath("$.issues[?(@.rule == 'count-note')].severity").value("INFO"));
    }

    @Test
    void pageSaveFillsWriteEmptyFieldsAndAlwaysFieldsWithAReadOnlyNote() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView page = fx.page();

        JsonNode saved = readJson(savePage(fx, page, content(page, "{\"title\":\"Hello World\"}"))
                .andExpect(status().isOk()));
        assertThat(saved.path("content").path("slug").asText()).isEqualTo("hello-world");
        assertThat(saved.path("content").path("path").asText()).isEqualTo("/x/hello-world");
        assertThat(codesAt(saved, "content.path")).doesNotContain("read-only");

        AssetVersionView current = assetService.requireCurrent(fx.project().getId(), page.uuid());
        JsonNode again = readJson(savePage(fx, current,
                        content(current, "{\"title\":\"Hello World\",\"slug\":\"custom\",\"path\":\"/typed\"}"))
                .andExpect(status().isOk()));
        assertThat(again.path("content").path("slug").asText()).isEqualTo("custom");
        assertThat(again.path("content").path("path").asText()).isEqualTo("/x/custom");
        assertThat(codesAt(again, "content.path")).contains("read-only");

        assertThat(assetService.requireCurrent(fx.project().getId(), page.uuid()).payload()
                .path("content").path("path").asText()).isEqualTo("/x/custom");
    }

    @Test
    void pageFieldReadOnlyOnTheStoredVersionKeepsItsValue() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView page = fx.page();
        savePage(fx, page, content(page, "{\"title\":\"Hi\",\"category\":\"frozen\",\"locked\":\"a\"}"))
                .andExpect(status().isOk());

        AssetVersionView current = assetService.requireCurrent(fx.project().getId(), page.uuid());
        JsonNode saved = readJson(savePage(fx, current,
                        content(current, "{\"title\":\"Hi\",\"category\":\"open\",\"locked\":\"b\"}"))
                .andExpect(status().isOk()));
        assertThat(saved.path("content").path("locked").asText()).isEqualTo("a");
        assertThat(saved.path("content").path("category").asText()).isEqualTo("open");
        assertThat(codesAt(saved, "content.locked")).contains("read-only");

        // No longer frozen: the next change goes through.
        AssetVersionView unfrozen = assetService.requireCurrent(fx.project().getId(), page.uuid());
        JsonNode changed = readJson(savePage(fx, unfrozen,
                        content(unfrozen, "{\"title\":\"Hi\",\"category\":\"open\",\"locked\":\"b\"}"))
                .andExpect(status().isOk()));
        assertThat(changed.path("content").path("locked").asText()).isEqualTo("b");
        assertThat(codesAt(changed, "content.locked")).doesNotContain("read-only");
    }

    @Test
    void pageStructuralFindingRejectsBeforeTheRules() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView page = fx.page();

        savePage(fx, page, content(page, "{\"title\":\"TBD\",\"count\":\"abc\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.issues.length()").value(1))
                .andExpect(jsonPath("$.issues[0].code").value("type"))
                .andExpect(jsonPath("$.issues[0].kind").value("STRUCTURAL"));
    }

    // ------------------------------------------------------------------
    // Records
    // ------------------------------------------------------------------

    @Test
    void recordSaveScopeErrorRejectsCreateAndUpdate() {
        Fixture fx = newFixture();
        DatasetView dataset = fx.dataset();
        UUID set = new RecordSetFixtures(recordSetService).setFor(fx.project().getId(), dataset.uuid(), null, fx.ctx());

        assertThatThrownBy(() -> recordService.create(
                        new CreateRecordCommand(fx.project().getId(), set, json("{\"title\":\"TBD\"}")), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> {
                    assertThat(ex.getStatus()).isEqualTo(422);
                    assertThat(issues(ex)).anySatisfy(issue -> {
                        assertThat(issue.rule()).isEqualTo("no-tbd");
                        assertThat(issue.path()).isEqualTo("content.title");
                    });
                });

        RecordWriteResult created = recordService.create(
                new CreateRecordCommand(fx.project().getId(), set, json("{\"title\":\"Hi\"}")), fx.ctx());
        assertThatThrownBy(() -> recordService.update(
                        created.record().uuid(), json("{\"title\":\"TBD\"}"), created.record().revision(), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(422));
    }

    @Test
    void recordFillsReadOnlyAndWarningsComeBackWithTheWrite() {
        Fixture fx = newFixture();
        DatasetView dataset = fx.dataset();
        UUID set = new RecordSetFixtures(recordSetService).setFor(fx.project().getId(), dataset.uuid(), null, fx.ctx());

        RecordWriteResult created = recordService.create(new CreateRecordCommand(fx.project().getId(), set,
                json("{\"title\":\"A rather long title\",\"category\":\"frozen\",\"locked\":\"a\"}")), fx.ctx());
        assertThat(created.record().content().path("slug").asText()).isEqualTo("a-rather-long-title");
        assertThat(created.record().content().path("path").asText()).isEqualTo("/x/a-rather-long-title");
        assertThat(created.issues()).anySatisfy(issue -> {
            assertThat(issue.rule()).isEqualTo("short-title");
            assertThat(issue.severity()).isEqualTo(Severity.WARNING);
        });

        RecordWriteResult updated = recordService.update(created.record().uuid(),
                json("{\"title\":\"Short\",\"slug\":\"s\",\"category\":\"frozen\",\"locked\":\"b\"}"),
                created.record().revision(), fx.ctx());
        assertThat(updated.record().content().path("locked").asText()).isEqualTo("a");
        assertThat(updated.record().content().path("path").asText()).isEqualTo("/x/s");
        assertThat(updated.issues()).anySatisfy(issue -> {
            assertThat(issue.code()).isEqualTo("read-only");
            assertThat(issue.path()).isEqualTo("content.locked");
            assertThat(issue.severity()).isEqualTo(Severity.INFO);
        });
        assertThat(updated.issues()).noneMatch(issue -> "short-title".equals(issue.rule()));
    }

    @Test
    void recordStructuralFindingRejectsBeforeTheRules() {
        Fixture fx = newFixture();
        DatasetView dataset = fx.dataset();
        UUID set = new RecordSetFixtures(recordSetService).setFor(fx.project().getId(), dataset.uuid(), null, fx.ctx());

        assertThatThrownBy(() -> recordService.create(new CreateRecordCommand(
                        fx.project().getId(), set, json("{\"title\":\"TBD\",\"count\":\"abc\"}")), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(issues(ex))
                        .extracting(ContentIssue::code).containsExactly("type"));
    }

    // ------------------------------------------------------------------
    // Property sets
    // ------------------------------------------------------------------

    @Test
    void propertySetSaveScopeErrorRejectsAndFillsAndReadOnlyApply() throws Exception {
        Fixture fx = newFixture();
        GlobalSetView site = fx.globalSet();

        assertThatThrownBy(() -> globalSetService.updateValues(
                        site.uuid(), json("{\"title\":\"TBD\"}"), site.revision(), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> {
                    assertThat(ex.getStatus()).isEqualTo(422);
                    assertThat(issues(ex)).extracting(ContentIssue::rule).contains("no-tbd");
                });

        GlobalSetView saved = globalSetService.updateValues(site.uuid(),
                json("{\"title\":\"Site\",\"category\":\"frozen\",\"locked\":\"a\"}"), site.revision(), fx.ctx());
        assertThat(saved.content().path("slug").asText()).isEqualTo("site");
        assertThat(saved.content().path("path").asText()).isEqualTo("/x/site");

        // Over HTTP: the read-only note joins the edit outcome in the response.
        mvc.perform(put("/api/v1/projects/" + fx.project().getKey() + "/globals/" + site.uuid() + "/content")
                        .header("Authorization", "Bearer " + fx.token())
                        .header("If-Match", "\"rev-" + saved.revision() + "\"")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\":{\"title\":\"A rather long title\",\"category\":\"frozen\",\"locked\":\"b\"}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.locked").value("a"))
                .andExpect(jsonPath("$.issues[?(@.code == 'read-only')].path").value("content.locked"))
                .andExpect(jsonPath("$.issues[?(@.rule == 'short-title')].severity").value("WARNING"));
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private ResultActions savePage(Fixture fx, AssetVersionView page, JsonNode payload) throws Exception {
        return mvc.perform(put("/api/v1/projects/" + fx.project().getKey() + "/pages/" + page.uuid())
                .header("Authorization", "Bearer " + fx.token())
                .header("If-Match", "\"rev-" + page.validFromRevision() + "\"")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(payload)));
    }

    private ObjectNode content(AssetVersionView page, String content) {
        ObjectNode payload = (ObjectNode) page.payload().deepCopy();
        payload.set("content", json(content));
        return payload;
    }

    private JsonNode json(String text) {
        try {
            return objectMapper.readTree(text);
        } catch (Exception e) {
            throw new IllegalArgumentException(e);
        }
    }

    private JsonNode readJson(ResultActions result) throws Exception {
        return objectMapper.readTree(result.andReturn().getResponse().getContentAsString());
    }

    private static List<String> codesAt(JsonNode view, String path) {
        List<String> codes = new java.util.ArrayList<>();
        view.path("issues").forEach(issue -> {
            if (path.equals(issue.path("path").asText())) {
                codes.add(issue.path("code").asText());
            }
        });
        return codes;
    }

    @SuppressWarnings("unchecked")
    private static List<ContentIssue> issues(SfException ex) {
        return (List<ContentIssue>) ex.getProblem().getExtensions().get("issues");
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser admin = userService.create(
                "srg-admin-" + n, "srg-admin-" + n + "@example.com", "Save Rules " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("saverules_" + n, "Save Rules " + n, null, null), admin.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), admin.getId(), "test");
        TemplateView pageTemplate = templateService.create(new CreateTemplateCommand(
                project.getId(), AssetType.PAGE_TEMPLATE, "Page " + n, CDL,
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

        AssetVersionView page() {
            return pageService.create(
                    new CreatePageCommand("Home " + SEQ.incrementAndGet(), null, pageTemplate.uuid()), ctx);
        }

        DatasetView dataset() {
            return datasetService.create(
                    new CreateDatasetCommand(project.getId(), null, "Items " + SEQ.incrementAndGet(), CDL, null, null), ctx);
        }

        GlobalSetView globalSet() {
            AssetVersionView folder = folderService.create(null, "Branding " + SEQ.incrementAndGet(), FolderScope.GLOBALS, ctx);
            return globalSetService.create(new CreateGlobalSetCommand(project.getId(), folder.uuid(), "Site", CDL), ctx);
        }

        String token() {
            return jwtService.issueAccessToken(admin);
        }
    }
}
