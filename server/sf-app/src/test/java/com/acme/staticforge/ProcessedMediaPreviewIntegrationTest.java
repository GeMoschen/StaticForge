package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.globals.CreateGlobalSetCommand;
import com.acme.staticforge.asset.globals.GlobalSetService;
import com.acme.staticforge.asset.globals.GlobalSetView;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.preview.PreviewTokenService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Processed text media in preview (M18.3.2): the page preview links a processed stylesheet through a
 * media share URL that serves the <em>rendered</em> file at the preview's revision, with its own media
 * links rewritten to working share URLs; {@code /binary} keeps serving the source and
 * {@code ?rendered=true} gives editors the output; a broken file degrades to its source plus
 * {@code X-SF-Render-Error} instead of failing the preview.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ProcessedMediaPreviewIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final Pattern HREF = Pattern.compile("href=\"([^\"]+)\"");
    private static final Pattern CSS_URL = Pattern.compile("url\\(([^)]+)\\)");

    @Autowired MockMvc mvc;
    @Autowired UserService userService;
    @Autowired JwtService jwtService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired MediaService mediaService;
    @Autowired TemplateService templateService;
    @Autowired PageService pageService;
    @Autowired GlobalSetService globalSetService;
    @Autowired PreviewTokenService previewTokenService;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void thePagePreviewLoadsTheRenderedStylesheetAndItsFontThroughShareUrls() throws Exception {
        Fixture fx = newFixture();
        siteSet(fx, "#c00");
        byte[] bg = png();
        mediaService.upload(fx.project().getId(), null, "bg.png", null, bg, fx.ctx());
        processed(fx, upload(fx, "main.css", "a{color:$CMS_VALUE(global:site.brandColor)$;background:url($CMS_REF(media:bg_png)$)}"));
        AssetVersionView home = page(fx, "<link rel=\"stylesheet\" href=\"$CMS_REF(media:main_css)$\">");

        String html = preview(fx, home, null);
        String cssUrl = first(HREF, html);
        assertThat(cssUrl).contains("/media/").contains("/share?t=");

        MockHttpServletResponse css = fetch(cssUrl);
        assertThat(css.getStatus()).isEqualTo(200);
        assertThat(css.getContentType()).startsWith("text/css");
        assertThat(css.getHeader(HttpHeaders.CACHE_CONTROL)).isEqualTo("no-store");
        assertThat(css.getHeader("X-SF-Render-Error")).isNull();
        String body = css.getContentAsString(StandardCharsets.UTF_8);
        assertThat(body).startsWith("a{color:#c00;background:url(");
        String bgUrl = first(CSS_URL, body);
        assertThat(bgUrl).contains("/share?t=");
        assertThat(fetch(bgUrl).getContentAsByteArray()).isEqualTo(bg);
    }

    @Test
    void timeTravelPreviewRendersTheStylesheetWithThatRevisionsValues() throws Exception {
        Fixture fx = newFixture();
        GlobalSetView site = siteSet(fx, "#c00");
        processed(fx, upload(fx, "main.css", "a{color:$CMS_VALUE(global:site.brandColor)$}"));
        AssetVersionView home = page(fx, "<link href=\"$CMS_REF(media:main_css)$\">");
        long before = assetService.requireCurrent(fx.project().getId(), home.uuid()).validFromRevision();
        ObjectNode values = ((ObjectNode) site.content().deepCopy()).put("brandColor", "#00c");
        globalSetService.updateValues(site.uuid(), values, site.revision(), fx.ctx());

        assertThat(fetch(first(HREF, preview(fx, home, null))).getContentAsString(StandardCharsets.UTF_8))
                .isEqualTo("a{color:#00c}");
        assertThat(fetch(first(HREF, preview(fx, home, before))).getContentAsString(StandardCharsets.UTF_8))
                .isEqualTo("a{color:#c00}");
    }

    @Test
    void binaryServesTheSourceAndRenderedTrueTheOutputForEditors() throws Exception {
        Fixture fx = newFixture();
        siteSet(fx, "#c00");
        String source = "a{color:$CMS_VALUE(global:site.brandColor)$}";
        AssetVersionView css = processed(fx, upload(fx, "main.css", source));
        AssetVersionView plain = upload(fx, "plain.css", "b{}");

        assertThat(mvc.perform(get(media(fx, css) + "/binary").header(HttpHeaders.AUTHORIZATION, bearer(fx.viewer())))
                        .andExpect(status().isOk())
                        .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8))
                .isEqualTo(source);
        assertThat(mvc.perform(get(media(fx, css) + "/binary?rendered=true").header(HttpHeaders.AUTHORIZATION, bearer(fx.editor())))
                        .andExpect(status().isOk())
                        .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                        .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8))
                .isEqualTo("a{color:#c00}");
        mvc.perform(get(media(fx, css) + "/binary?rendered=true").header(HttpHeaders.AUTHORIZATION, bearer(fx.viewer())))
                .andExpect(status().isForbidden());
        mvc.perform(get(media(fx, plain) + "/binary?rendered=true").header(HttpHeaders.AUTHORIZATION, bearer(fx.editor())))
                .andExpect(status().isBadRequest());
    }

    @Test
    void unprocessedMediaIsServedExactlyAsBefore() throws Exception {
        Fixture fx = newFixture();
        byte[] json = "{\"a\": \"$CMS_VALUE(x)$\"}".getBytes(StandardCharsets.UTF_8);
        AssetVersionView media = mediaService.upload(fx.project().getId(), null, "data.json", null, json, fx.ctx());
        String token = previewTokenService.issueMediaShareToken(media.uuid(), null, fx.project().getKey());

        MockHttpServletResponse response = fetch(media(fx, media) + "/share?t=" + token);

        assertThat(response.getContentAsByteArray()).isEqualTo(json);
        assertThat(response.getContentType()).isEqualTo("application/json");
        assertThat(response.getHeader(HttpHeaders.CONTENT_DISPOSITION)).startsWith("attachment");
        assertThat(response.getHeader(HttpHeaders.CACHE_CONTROL)).isNotEqualTo("no-store");
    }

    @Test
    void aTokenForOneFileCannotRenderAnother() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView a = processed(fx, upload(fx, "a.css", "a{}"));
        AssetVersionView b = processed(fx, upload(fx, "b.css", "b{}"));
        String tokenForA = previewTokenService.issueMediaShareToken(a.uuid(), null, fx.project().getKey());

        assertThat(fetch(media(fx, b) + "/share?t=" + tokenForA).getStatus()).isEqualTo(401);
    }

    @Test
    void aBrokenFileDegradesToItsSourceInPreviewAndIsA422ForTheDrawer() throws Exception {
        Fixture fx = newFixture();
        GlobalSetView site = siteSet(fx, "#c00");
        String source = "a{color:$CMS_VALUE(global:site.brandColor)$}";
        AssetVersionView css = processed(fx, upload(fx, "main.css", source));
        assetService.changeUid(site.uuid(), "brand", fx.ctx());
        String token = previewTokenService.issueMediaShareToken(css.uuid(), null, fx.project().getKey());

        MockHttpServletResponse shared = fetch(media(fx, css) + "/share?t=" + token);
        assertThat(shared.getStatus()).isEqualTo(200);
        assertThat(shared.getContentAsString(StandardCharsets.UTF_8)).isEqualTo(source);
        assertThat(shared.getHeader("X-SF-Render-Error")).startsWith(DiagnosticCodes.OCTL_UNRESOLVABLE_REF + " 1:");

        mvc.perform(get(media(fx, css) + "/binary?rendered=true").header(HttpHeaders.AUTHORIZATION, bearer(fx.editor())))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.diagnostics[0].code").value(DiagnosticCodes.OCTL_UNRESOLVABLE_REF));
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private String preview(Fixture fx, AssetVersionView page, Long revision) throws Exception {
        String url = "/api/v1/projects/" + fx.project().getKey() + "/preview/pages/" + page.uuid()
                + (revision == null ? "" : "?revision=" + revision);
        return mvc.perform(get(url).header(HttpHeaders.AUTHORIZATION, bearer(fx.viewer())))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    /** Fetches an absolute preview URL without credentials, like the browser inside the preview frame. */
    private MockHttpServletResponse fetch(String url) throws Exception {
        String path = url.startsWith("http") ? url.substring(url.indexOf("/api/")) : url;
        return mvc.perform(get(path.replace("&amp;", "&"))).andReturn().getResponse();
    }

    private static String first(Pattern pattern, String text) {
        Matcher matcher = pattern.matcher(text);
        assertThat(matcher.find()).as("%s in %s", pattern, text).isTrue();
        return matcher.group(1);
    }

    private GlobalSetView siteSet(Fixture fx, String brandColor) {
        GlobalSetView site = globalSetService.create(new CreateGlobalSetCommand(fx.project().getId(), null, "Site",
                "content { editor text brandColor { label \"Brand color\" } }"), fx.ctx());
        return globalSetService.updateValues(
                site.uuid(), mapper.createObjectNode().put("brandColor", brandColor), site.revision(), fx.ctx());
    }

    private AssetVersionView upload(Fixture fx, String name, String text) {
        return mediaService.upload(fx.project().getId(), null, name, null, text.getBytes(StandardCharsets.UTF_8), fx.ctx());
    }

    private AssetVersionView processed(Fixture fx, AssetVersionView media) {
        return mediaService.setProcessCms(media.uuid(), true, media.validFromRevision(), fx.ctx()).media();
    }

    private AssetVersionView page(Fixture fx, String html) {
        TemplateView template = templateService.create(new CreateTemplateCommand(
                fx.project().getId(), AssetType.PAGE_TEMPLATE, "Home Template", "", Map.of("html", html), null, false,
                Map.of("html", "{displayNameSlug}.{ext}")), fx.ctx());
        return pageService.create(new CreatePageCommand("Home", null, template.uuid()), fx.ctx());
    }

    private static String media(Fixture fx, AssetVersionView media) {
        return "/api/v1/projects/" + fx.project().getKey() + "/media/" + media.uuid();
    }

    private String bearer(AppUser user) {
        return "Bearer " + jwtService.issueAccessToken(user);
    }

    private static byte[] png() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(4, 4, BufferedImage.TYPE_INT_RGB), "png", out);
        return out.toByteArray();
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser admin = userService.create(
                "m18prev-admin-" + n, "m18prev-admin-" + n + "@example.com", "M18 Preview Admin " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("m18prevp_" + n, "M18 Preview Project " + n, null, null), admin.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), admin.getId(), "test");
        AppUser editor = userService.create(
                "m18prev-editor-" + n, "m18prev-editor-" + n + "@example.com", "M18 Preview Editor " + n, "secret-password");
        projectService.setMemberRole(project.getKey(), editor.getId(), ProjectRole.EDITOR, ctx);
        AppUser viewer = userService.create(
                "m18prev-viewer-" + n, "m18prev-viewer-" + n + "@example.com", "M18 Preview Viewer " + n, "secret-password");
        projectService.setMemberRole(project.getKey(), viewer.getId(), ProjectRole.VIEWER, ctx);
        return new Fixture(project, admin, editor, viewer);
    }

    private record Fixture(Project project, AppUser admin, AppUser editor, AppUser viewer) {
        RevisionContext ctx() {
            return RevisionContext.of(project.getId(), admin.getId(), "test");
        }
    }
}
