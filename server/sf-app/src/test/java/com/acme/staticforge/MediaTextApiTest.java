package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * The processed text media endpoints over HTTP (M18.1.1, M18.1.2, M18.2.1): {@code PUT /process},
 * {@code GET}/{@code PUT /text}, {@code POST /text/validate} and the new {@code replace} response,
 * with the store protocol every media write shares ({@code ETag}, required {@code If-Match},
 * {@code 409} on a stale one, {@code 422} carrying {@code diagnostics}) and the role split: reads
 * are {@code VIEWER}, writes and validation {@code EDITOR}. The media size cap is lowered to 4KB so
 * the oversized-text case stays small.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestPropertySource(properties = "sf.media.max-upload-size=4KB")
class MediaTextApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired UserService userService;
    @Autowired JwtService jwtService;
    @Autowired ProjectService projectService;
    @Autowired MediaService mediaService;

    @Test
    void mediaViewsReportTextEditabilityAndTheFlag() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView css = upload(fx, "site.css", "a{}");
        AssetVersionView png = mediaService.upload(fx.project().getId(), null, "a.png", null, png(), fx.ctx());

        mvc.perform(put(media(fx, css) + "/process").header(HttpHeaders.AUTHORIZATION, bearer(editorToken(fx)))
                        .header(HttpHeaders.IF_MATCH, etag(css.validFromRevision()))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"processCms\":true}"))
                .andExpect(status().isOk())
                .andExpect(header().exists(HttpHeaders.ETAG))
                .andExpect(jsonPath("$.media.processCms").value(true))
                .andExpect(jsonPath("$.media.textEditable").value(true))
                .andExpect(jsonPath("$.warnings").isEmpty())
                .andExpect(jsonPath("$.processCmsCleared").value(false));

        mvc.perform(get("/api/v1/projects/" + fx.project().getKey() + "/media")
                        .header(HttpHeaders.AUTHORIZATION, bearer(viewerToken(fx))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.uid == 'site_css')].processCms").value(true))
                .andExpect(jsonPath("$.content[?(@.uid == 'a_png')].processCms").value(false));

        mvc.perform(put(media(fx, png) + "/process").header(HttpHeaders.AUTHORIZATION, bearer(editorToken(fx)))
                        .header(HttpHeaders.IF_MATCH, etag(png.validFromRevision()))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"processCms\":true}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void theProcessToggleCarriesCompileErrorsAndWarnings() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView css = upload(fx, "site.css", "a{color:$CMS_VALUE(global:site.brandColor)$}");

        mvc.perform(put(media(fx, css) + "/process").header(HttpHeaders.AUTHORIZATION, bearer(editorToken(fx)))
                        .header(HttpHeaders.IF_MATCH, etag(css.validFromRevision()))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"processCms\":true}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-API-0422"))
                .andExpect(jsonPath("$.diagnostics[0].code").value(DiagnosticCodes.OCTL_UNRESOLVABLE_REF))
                .andExpect(jsonPath("$.diagnostics[0].line").value(1));

        AssetVersionView js = upload(fx, "app.js", "x = $$('a');");
        mvc.perform(put(media(fx, js) + "/process").header(HttpHeaders.AUTHORIZATION, bearer(editorToken(fx)))
                        .header(HttpHeaders.IF_MATCH, etag(js.validFromRevision()))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"processCms\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.warnings[0].code").value(DiagnosticCodes.OCTL_TEXT_MEDIA_DOLLAR_ESCAPE))
                .andExpect(jsonPath("$.warnings[0].severity").value("WARNING"))
                .andExpect(jsonPath("$.warnings[0].column").value(5));
    }

    @Test
    void textRoundTripsWithEtagsAndIfMatch() throws Exception {
        Fixture fx = newFixture();
        String content = "\uFEFFa {\r\n  color: red;\n}\n";
        AssetVersionView css = upload(fx, "site.css", content);

        JsonNode read = json(mvc.perform(get(media(fx, css) + "/text").header(HttpHeaders.AUTHORIZATION, bearer(viewerToken(fx))))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, etag(css.validFromRevision())))
                .andExpect(jsonPath("$.mimeType").value("text/css"))
                .andExpect(jsonPath("$.utf8").value(true))
                .andExpect(jsonPath("$.revision").value(css.validFromRevision())));
        assertThat(read.path("text").asText()).isEqualTo(content);

        String edited = read.path("text").asText().replace("red", "blue");
        JsonNode saved = json(mvc.perform(put(media(fx, css) + "/text").header(HttpHeaders.AUTHORIZATION, bearer(editorToken(fx)))
                        .header(HttpHeaders.IF_MATCH, etag(css.validFromRevision()))
                        .contentType(MediaType.APPLICATION_JSON).content(body(Map.of("text", edited))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.media.mimeType").value("text/css")));
        long newRevision = saved.path("media").path("revision").asLong();
        assertThat(newRevision).isGreaterThan(css.validFromRevision());

        JsonNode reread = json(mvc.perform(get(media(fx, css) + "/text").header(HttpHeaders.AUTHORIZATION, bearer(viewerToken(fx))))
                .andExpect(header().string(HttpHeaders.ETAG, etag(newRevision))));
        assertThat(reread.path("text").asText()).isEqualTo(edited);

        mvc.perform(get(media(fx, css) + "/text?revision=" + css.validFromRevision())
                        .header(HttpHeaders.AUTHORIZATION, bearer(viewerToken(fx))))
                .andExpect(jsonPath("$.text").value(content));
    }

    @Test
    void writesNeedIfMatchAnEditorAndAFreshRevision() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView css = upload(fx, "site.css", "a{}");
        String body = body(Map.of("text", "b{}"));

        mvc.perform(put(media(fx, css) + "/text").header(HttpHeaders.AUTHORIZATION, bearer(editorToken(fx)))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isPreconditionFailed());
        mvc.perform(put(media(fx, css) + "/text").header(HttpHeaders.AUTHORIZATION, bearer(viewerToken(fx)))
                        .header(HttpHeaders.IF_MATCH, etag(css.validFromRevision()))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isForbidden());
        mvc.perform(post(media(fx, css) + "/text/validate").header(HttpHeaders.AUTHORIZATION, bearer(viewerToken(fx)))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isForbidden());
        mvc.perform(put(media(fx, css) + "/text").header(HttpHeaders.AUTHORIZATION, bearer(editorToken(fx)))
                        .header(HttpHeaders.IF_MATCH, etag(css.validFromRevision() - 1))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-API-0409"));
    }

    @Test
    void oversizedTextIsTheUploadSizeError() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView css = upload(fx, "site.css", "a{}");

        mvc.perform(put(media(fx, css) + "/text").header(HttpHeaders.AUTHORIZATION, bearer(editorToken(fx)))
                        .header(HttpHeaders.IF_MATCH, etag(css.validFromRevision()))
                        .contentType(MediaType.APPLICATION_JSON).content(body(Map.of("text", "a".repeat(5000)))))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.code").value("SF-MEDIA-0413"));
    }

    @Test
    void binaryMediaHasNoText() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView png = mediaService.upload(fx.project().getId(), null, "a.png", null, png(), fx.ctx());

        mvc.perform(get(media(fx, png) + "/text").header(HttpHeaders.AUTHORIZATION, bearer(viewerToken(fx))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void validateReturnsDiagnosticsForDraftText() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView css = upload(fx, "site.css", "a{}");

        mvc.perform(post(media(fx, css) + "/text/validate").header(HttpHeaders.AUTHORIZATION, bearer(editorToken(fx)))
                        .contentType(MediaType.APPLICATION_JSON).content(body(Map.of("text", "a{}\n$CMS_BODY(x)$"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.diagnostics[0].code").value(DiagnosticCodes.OCTL_NOT_ALLOWED_IN_TEXT_MEDIA))
                .andExpect(jsonPath("$.diagnostics[0].line").value(2))
                .andExpect(jsonPath("$.diagnostics[0].column").value(1));
        assertThat(mediaService.require(fx.project().getId(), css.uuid()).validFromRevision())
                .isEqualTo(css.validFromRevision());
    }

    @Test
    void replaceReportsAClearedFlag() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView uploaded = upload(fx, "site.css", "a{}");
        AssetVersionView css = mediaService.setProcessCms(uploaded.uuid(), true, uploaded.validFromRevision(), fx.ctx()).media();

        mvc.perform(multipart(media(fx, css) + "/replace")
                        .file(new MockMultipartFile("file", "site.png", "image/png", png()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(editorToken(fx))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.processCmsCleared").value(true))
                .andExpect(jsonPath("$.media.processCms").value(false))
                .andExpect(jsonPath("$.media.textEditable").value(false));
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private AssetVersionView upload(Fixture fx, String name, String text) {
        return mediaService.upload(fx.project().getId(), null, name, null, text.getBytes(StandardCharsets.UTF_8), fx.ctx());
    }

    private static String media(Fixture fx, AssetVersionView media) {
        return "/api/v1/projects/" + fx.project().getKey() + "/media/" + media.uuid();
    }

    private static String etag(long revision) {
        return "\"rev-" + revision + "\"";
    }

    private static String bearer(String token) {
        return "Bearer " + token;
    }

    private String body(Object value) throws Exception {
        return objectMapper.writeValueAsString(value);
    }

    private JsonNode json(ResultActions actions) throws Exception {
        return objectMapper.readTree(actions.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
    }

    private static byte[] png() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(4, 4, BufferedImage.TYPE_INT_RGB), "png", out);
        return out.toByteArray();
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser admin = userService.create(
                "m18api-admin-" + n, "m18api-admin-" + n + "@example.com", "M18 Api Admin " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("m18apip_" + n, "M18 Api Project " + n, null, null), admin.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), admin.getId(), "test");
        AppUser editor = userService.create(
                "m18api-editor-" + n, "m18api-editor-" + n + "@example.com", "M18 Api Editor " + n, "secret-password");
        projectService.setMemberRole(project.getKey(), editor.getId(), ProjectRole.EDITOR, ctx);
        AppUser viewer = userService.create(
                "m18api-viewer-" + n, "m18api-viewer-" + n + "@example.com", "M18 Api Viewer " + n, "secret-password");
        projectService.setMemberRole(project.getKey(), viewer.getId(), ProjectRole.VIEWER, ctx);
        return new Fixture(project, admin, editor, viewer);
    }

    private record Fixture(Project project, AppUser admin, AppUser editor, AppUser viewer) {
        RevisionContext ctx() {
            return RevisionContext.of(project.getId(), admin.getId(), "test");
        }
    }

    private String editorToken(Fixture fx) {
        return jwtService.issueAccessToken(fx.editor());
    }

    private String viewerToken(Fixture fx) {
        return jwtService.issueAccessToken(fx.viewer());
    }
}
