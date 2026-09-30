package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.dataset.CreateDatasetCommand;
import com.acme.staticforge.asset.dataset.CreateRecordCommand;
import com.acme.staticforge.asset.dataset.CreateRecordSetCommand;
import com.acme.staticforge.asset.dataset.DatasetService;
import com.acme.staticforge.asset.dataset.DatasetView;
import com.acme.staticforge.asset.dataset.RecordDetail;
import com.acme.staticforge.asset.dataset.RecordService;
import com.acme.staticforge.asset.dataset.RecordSetService;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.globals.CreateGlobalSetCommand;
import com.acme.staticforge.asset.globals.GlobalSetService;
import com.acme.staticforge.asset.globals.GlobalSetView;
import com.acme.staticforge.asset.navigation.CreatePageReferenceCommand;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.navigation.PageReferenceTargetKind;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.common.L10nValues;
import com.acme.staticforge.preview.PreviewTokenService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.ContentView;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.template.query.RecordSetQuery;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Preview renders the draft by default and the release state with {@code ?view=published}; share links and links
 * inside the preview keep their view; a revision preview's navigation is the navigation of that revision (M27.2.3).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PreviewViewIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static final Pattern SHARE_TOKEN = Pattern.compile("preview/share\\?t=([A-Za-z0-9_.-]+)");

    @Autowired MockMvc mvc;
    @Autowired JwtService jwtService;
    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired AssetRepository assetRepository;
    @Autowired FolderService folderService;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired GlobalSetService globalSetService;
    @Autowired DatasetService datasetService;
    @Autowired RecordSetService recordSetService;
    @Autowired RecordService recordService;
    @Autowired ReleaseService releaseService;
    @Autowired PreviewTokenService previewTokenService;
    @Autowired RevisionRepository revisionRepository;
    @Autowired ReleaseFixtures releaseFixtures;

    private final ObjectMapper mapper = new ObjectMapper();

    private record Fixture(Project project, AppUser user, RevisionContext ctx, String token) {

        long projectId() {
            return project.getId();
        }

        String base() {
            return "/api/v1/projects/" + project.getKey() + "/preview";
        }
    }

    private Fixture newFixture(String prefix) {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(prefix + n, prefix + n + "@example.com", "Preview", "secret-password");
        Project project = projectService.create(new CreateProjectRequest(prefix + n, prefix + n, null, "preview"), user.getId());
        return new Fixture(project, user, RevisionContext.of(project.getId(), user.getId(), "preview"), jwtService.issueAccessToken(user));
    }

    @Test
    @DisplayName("the draft view shows unreleased edits of the page, a record and a global set; the published view doesn't")
    void draftAndPublishedViews() throws Exception {
        Fixture fx = newFixture("pvviews");
        GlobalSetView site = globalSetService.create(
                new CreateGlobalSetCommand(fx.projectId(), null, "Site", CdlSources.split("content { editor text title { label \"T\" } }")), fx.ctx());
        site = globalSetService.updateValues(site.uuid(), mapper.readTree("{\"title\":\"Acme\"}"), site.revision(), fx.ctx());
        DatasetView team = datasetService.create(
                new CreateDatasetCommand(fx.projectId(), null, "Team", CdlSources.split("content { editor text name { label \"Name\" } }"), "name", null),
                fx.ctx());
        AssetVersionView folder = folderService.create(null, "Team", FolderScope.CONTENT, fx.ctx());
        UUID set = recordSetService.create(new CreateRecordSetCommand(
                fx.projectId(), folder.uuid(), team.uuid(), "all", "All", RecordSetQuery.ALL), fx.ctx()).uuid();
        RecordDetail ada = recordService.create(
                new CreateRecordCommand(fx.projectId(), set, mapper.readTree("{\"name\":\"Ada\"}")), fx.ctx()).record();
        TemplateView template = template(fx, "Page", "content { editor text title { label \"Title\" } }",
                "<h1>$CMS_VALUE(title)$</h1><p>$CMS_VALUE(record:" + ada.uid() + ".name)$</p>"
                        + "<footer>$CMS_VALUE(CMS_GLOBAL.site.title)$</footer>");
        UUID about = page(fx, template, "about");
        setTitle(fx, about, "About v1");
        releaseFixtures.releaseAll(fx.projectId());

        setTitle(fx, about, "About v2");
        recordService.update(ada.uuid(), mapper.readTree("{\"name\":\"Ada L.\"}"), ada.revision(), fx.ctx());
        globalSetService.updateValues(site.uuid(), mapper.readTree("{\"title\":\"Acme Inc.\"}"), site.revision(), fx.ctx());

        assertThat(preview(fx, about, "")).isEqualTo("<h1>About v2</h1><p>Ada L.</p><footer>Acme Inc.</footer>");
        assertThat(preview(fx, about, "&view=published")).isEqualTo("<h1>About v1</h1><p>Ada</p><footer>Acme</footer>");
        mvc.perform(get(fx.base() + "/pages/" + about).header("Authorization", "Bearer " + fx.token()))
                .andExpect(header().string("X-SF-View", "draft"))
                .andExpect(header().string("X-SF-Release-Status", "CHANGED"));
        mvc.perform(get(fx.base() + "/pages/" + about + "?view=published").header("Authorization", "Bearer " + fx.token()))
                .andExpect(header().string("X-SF-View", "published"))
                .andExpect(header().doesNotExist("X-SF-Release-Status"));
    }

    @Test
    @DisplayName("the published view of a page released nowhere is 404 SF-DOM-0155; its draft renders")
    void aNewPageIsNotPublished() throws Exception {
        Fixture fx = newFixture("pvnew");
        TemplateView template = template(fx, "Page", "content { editor text title { label \"Title\" } }", "<h1>$CMS_VALUE(title)$</h1>");
        UUID fresh = page(fx, template, "fresh");
        setTitle(fx, fresh, "Fresh");

        assertThat(preview(fx, fresh, "")).isEqualTo("<h1>Fresh</h1>");
        mvc.perform(get(fx.base() + "/pages/" + fresh + "?view=published").header("Authorization", "Bearer " + fx.token()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SF-DOM-0155"));
        mvc.perform(get(fx.base() + "/pages/" + fresh + "?view=nonsense").header("Authorization", "Bearer " + fx.token()))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("the published view of each language shows the version released in it")
    void publishedPerLanguage() throws Exception {
        Fixture fx = newFixture("pvl10n");
        projectService.updateLocales(fx.project().getKey(), LocaleConfig.of(
                List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English")), "de", Map.of(), false),
                true, fx.ctx());
        TemplateView template = template(fx, "Page", "content { editor text title { label \"Title\" localizable } }",
                "<h1>$CMS_VALUE(title)$</h1>");
        UUID about = page(fx, template, "about");
        setTitles(fx, about, Map.of("de", "Ueber v1", "en", "About v1"));
        releaseFixtures.releaseAll(fx.projectId());
        setTitles(fx, about, Map.of("de", "Ueber v2", "en", "About v2"));
        release(fx, ReleaseItem.of(about, "en"));

        assertThat(preview(fx, about, "&view=published&locale=en")).isEqualTo("<h1>About v2</h1>");
        assertThat(preview(fx, about, "&view=published&locale=de")).isEqualTo("<h1>Ueber v1</h1>");
        assertThat(preview(fx, about, "&locale=de")).isEqualTo("<h1>Ueber v2</h1>");
    }

    @Test
    @DisplayName("a revision preview renders the navigation of that revision")
    void revisionPreviewNavigation() throws Exception {
        Fixture fx = newFixture("pvnav");
        TemplateView template = template(fx, "Page", "", "<nav>$CMS_NAVIGATION(nav:root)$</nav>");
        UUID home = page(fx, template, "home");
        UUID news = page(fx, template, "news");
        reference(fx, "Home link", home);
        long before = revisionRepository.findHeadRevisionId(fx.projectId()).orElseThrow();
        reference(fx, "News link", news);

        String now = preview(fx, home, "&rewriteLinks=false");
        String then = preview(fx, home, "&rewriteLinks=false&revision=" + before);
        assertThat(now).contains(">news<");
        assertThat(then).contains(">home<").doesNotContain(">news<");
    }

    @Test
    @DisplayName("share links keep the view they were created in; links inside a published preview stay published")
    void shareLinksKeepTheirView() throws Exception {
        Fixture fx = newFixture("pvshare");
        TemplateView template = template(fx, "Page", "content { editor text title { label \"Title\" } }",
                "<h1>$CMS_VALUE(title)$</h1>");
        UUID news = page(fx, template, "news");
        TemplateView linker = template(fx, "Linker", "content { editor text title { label \"Title\" } }",
                "<h1>$CMS_VALUE(title)$</h1><a href=\"$CMS_REF(page:news)$\">news</a>");
        UUID about = page(fx, linker, "about");
        setTitle(fx, about, "About v1");
        releaseFixtures.releaseAll(fx.projectId());

        JsonNode link = mapper.readTree(mvc.perform(get(fx.base() + "/pages/" + about + "/share?view=published")
                        .header("Authorization", "Bearer " + fx.token()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        setTitle(fx, about, "About v2"); // a new draft after the link was made

        String shared = mvc.perform(get(link.path("url").asText())).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(shared).contains("<h1>About v1</h1>");
        // The page link inside it opens the linked page in the published view too.
        Matcher inner = SHARE_TOKEN.matcher(shared);
        assertThat(inner.find()).isTrue();
        assertThat(previewTokenService.verifyShareToken(inner.group(1)).view()).isEqualTo(ContentView.Kind.PUBLISHED);

        // A token without the view claim (issued before M27) renders the draft.
        String legacy = previewTokenService.issueShareToken(about, null, "html", fx.project().getKey());
        assertThat(mvc.perform(get(fx.base() + "/share?t=" + legacy)).andReturn().getResponse().getContentAsString())
                .contains("<h1>About v2</h1>");
        assertThat(previewTokenService.verifyShareToken(legacy).view()).isEqualTo(ContentView.Kind.DRAFT);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private String preview(Fixture fx, UUID page, String query) throws Exception {
        return mvc.perform(get(fx.base() + "/pages/" + page + "?channel=html" + query).header("Authorization", "Bearer " + fx.token()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    private TemplateView template(Fixture fx, String name, String cdl, String html) {
        return templateService.create(
                new CreateTemplateCommand(fx.projectId(), AssetType.PAGE_TEMPLATE, name, CdlSources.split(cdl), Map.of("html", html), null, false,
                        Map.of("html", "{folder}{uid}.{ext}")),
                fx.ctx());
    }

    private UUID page(Fixture fx, TemplateView template, String name) {
        return pageService.create(new CreatePageCommand(name, null, template.uuid()), fx.ctx()).uuid();
    }

    private void setTitle(Fixture fx, UUID page, String title) {
        AssetVersionView current = assetService.requireCurrent(fx.projectId(), page);
        ObjectNode payload = current.payload().deepCopy();
        payload.withObject("content").put("title", title);
        pageService.update(page, payload, current.validFromRevision(), fx.ctx());
    }

    private void setTitles(Fixture fx, UUID page, Map<String, String> titles) {
        AssetVersionView current = assetService.requireCurrent(fx.projectId(), page);
        ObjectNode payload = current.payload().deepCopy();
        ObjectNode wrapper = L10nValues.empty();
        titles.forEach((locale, text) -> wrapper.withObject("/values").set(locale, JsonNodeFactory.instance.textNode(text)));
        payload.withObject("content").set("title", wrapper);
        pageService.update(page, payload, current.validFromRevision(), fx.ctx());
    }

    private void reference(Fixture fx, String name, UUID page) {
        UUID navigationRoot = assetRepository
                .findByProjectIdAndAssetTypeAndUid(fx.projectId(), AssetType.FOLDER, FolderScope.NAVIGATION_ROOT_UID)
                .map(Asset::getUuid)
                .orElseThrow();
        pageReferenceService.create(
                new CreatePageReferenceCommand(name, navigationRoot, PageReferenceTargetKind.PAGE, page, null), fx.ctx());
    }

    private void release(Fixture fx, ReleaseItem... items) {
        releaseService.release(Arrays.asList(items), RevisionContext.of(fx.projectId(), null, "test release"));
    }
}
