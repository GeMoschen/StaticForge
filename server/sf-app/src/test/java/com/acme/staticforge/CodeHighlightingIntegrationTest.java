package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.channel.OutputChannel;
import com.acme.staticforge.channel.UpdateChannelRequest;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.exportimport.ImportOptions;
import com.acme.staticforge.exportimport.ProjectExportImportService;
import com.acme.staticforge.project.CodeHighlighting;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BiFunction;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * Code highlighting settings (M33 follow-up): the project's overrides ({@code PUT /projects/{key}/code-highlighting},
 * part of the project detail), a channel's {@code settings.highlightAs}, and both travelling in a protocol-12 archive.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CodeHighlightingIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;
    @Autowired UserService users;
    @Autowired ProjectService projects;
    @Autowired ChannelService channels;
    @Autowired ProjectExportImportService exportImport;
    @Autowired RevisionRepository revisions;
    @Autowired ObjectMapper mapper;

    private record Fixture(Project project, RevisionContext ctx, String adminToken) {
        String key() {
            return project.getKey();
        }

        long id() {
            return project.getId();
        }
    }

    @Test
    void anAdminSetsTheOverridesAndEveryMemberReadsThem() throws Exception {
        Fixture fx = fixture("chset");
        long before = revisionCount(fx);

        putOverrides(fx, fx.adminToken(), "{\"extensions\":{\".TPL\":\"html\"},\"mimeTypes\":{\"text/x-conf\":\"YAML\"}}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.codeHighlighting.extensions.tpl").value("HTML"))
                .andExpect(jsonPath("$.codeHighlighting.mimeTypes['text/x-conf']").value("YAML"));
        assertThat(revisionCount(fx)).isEqualTo(before + 1);

        // The same overrides again change nothing.
        putOverrides(fx, fx.adminToken(), "{\"extensions\":{\"tpl\":\"HTML\"},\"mimeTypes\":{\"text/x-conf\":\"YAML\"}}")
                .andExpect(status().isOk());
        assertThat(revisionCount(fx)).isEqualTo(before + 1);

        perform(get("/api/v1/projects/{key}", fx.key()), member(fx, ProjectRole.VIEWER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.codeHighlighting.extensions.tpl").value("HTML"));

        putOverrides(fx, fx.adminToken(), "{\"extensions\":{},\"mimeTypes\":{}}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.codeHighlighting.extensions").isEmpty());
        assertThat(projects.requireByKey(fx.key()).getCodeHighlighting()).isNull();
    }

    @Test
    void badEntriesAreRejectedOneMessageEach() throws Exception {
        Fixture fx = fixture("chbad");

        putOverrides(fx, fx.adminToken(), "{\"extensions\":{\"t/pl\":\"HTML\",\"md\":\"COBOL\"},\"mimeTypes\":{\"nope\":\"JSON\"}}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("SF-API-0400"))
                .andExpect(jsonPath("$.errors", hasSize(3)));
        assertThat(projects.requireByKey(fx.key()).getCodeHighlighting()).isNull();
    }

    @Test
    void onlyProjectAdminsChangeTheOverrides() throws Exception {
        Fixture fx = fixture("chrole");

        putOverrides(fx, member(fx, ProjectRole.DEVELOPER), "{\"extensions\":{\"tpl\":\"HTML\"},\"mimeTypes\":{}}")
                .andExpect(status().isForbidden());
    }

    @Test
    void aChannelsHighlightAsIsValidated() throws Exception {
        Fixture fx = fixture("chchan");
        OutputChannel html = html(fx);

        channels.update("html", request(html, "MARKDOWN"), fx.ctx());
        assertThat(html(fx).getSettings().path("highlightAs").asText()).isEqualTo("MARKDOWN");

        assertThatThrownBy(() -> channels.update("html", request(html, "COBOL"), fx.ctx()))
                .isInstanceOf(SfException.class);
        perform(put("/api/v1/projects/{key}/channels/html", fx.key())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of(
                                "name", html.getName(),
                                "fileExtension", html.getFileExtension(),
                                "defaultEscaping", html.getDefaultEscaping(),
                                "enabled", true,
                                "isDefault", html.isDefaultChannel(),
                                "position", html.getPosition(),
                                "settings", Map.of("highlightAs", "cobol")))),
                        fx.adminToken())
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[*].field", hasItem("settings.highlightAs")));
    }

    @Test
    void aRoundTripKeepsOverridesAndChannelSetting() throws IOException {
        Fixture source = fixture("chsrc");
        projects.updateCodeHighlighting(
                source.key(), new CodeHighlighting(Map.of("tpl", "HTML"), Map.of("text/x-conf", "YAML")), source.ctx());
        channels.update("html", request(html(source), "XML"), source.ctx());
        byte[] archive = exportImport.exportProject(source.id());
        assertThat(entry(archive, "settings.json")).contains("\"codeHighlighting\"");

        Fixture target = fixture("chdst");
        exportImport.importProject(target.id(), archive, target.ctx(), ImportOptions.DEFAULT);

        assertThat(CodeHighlighting.fromJson(projects.requireByKey(target.key()).getCodeHighlighting()))
                .isEqualTo(new CodeHighlighting(Map.of("tpl", "HTML"), Map.of("text/x-conf", "YAML")));
    }

    @Test
    void aTargetsOwnOverridesAreKept() throws IOException {
        Fixture source = fixture("chkeep");
        projects.updateCodeHighlighting(source.key(), new CodeHighlighting(Map.of("tpl", "HTML"), Map.of()), source.ctx());
        byte[] archive = exportImport.exportProject(source.id());
        Fixture target = fixture("chkeepdst");
        projects.updateCodeHighlighting(target.key(), new CodeHighlighting(Map.of("tpl", "XML"), Map.of()), target.ctx());

        exportImport.importProject(target.id(), archive, target.ctx(), ImportOptions.DEFAULT);

        assertThat(CodeHighlighting.fromJson(projects.requireByKey(target.key()).getCodeHighlighting()).extensions())
                .containsEntry("tpl", "XML");
    }

    @Test
    void aProtocol11ArchiveImportsWithoutOverrides() throws IOException {
        Fixture source = fixture("chold");
        projects.updateCodeHighlighting(source.key(), new CodeHighlighting(Map.of("tpl", "HTML"), Map.of()), source.ctx());
        byte[] archive = rewrite(exportImport.exportProject(source.id()), (name, text) -> name.equals("manifest.json")
                ? text.replaceAll("\"protocolVersion\":\\d+", "\"protocolVersion\":11")
                : text);

        Fixture target = fixture("chold-dst");
        exportImport.importProject(target.id(), archive, target.ctx(), ImportOptions.DEFAULT);

        assertThat(projects.requireByKey(target.key()).getCodeHighlighting()).isNull();
    }

    // ------------------------------------------------------------------

    private OutputChannel html(Fixture fx) {
        return channels.list(fx.id()).stream().filter(c -> c.getKey().equals("html")).findFirst().orElseThrow();
    }

    private UpdateChannelRequest request(OutputChannel channel, String highlightAs) {
        ObjectNode settings = channel.getSettings() != null && channel.getSettings().isObject()
                ? channel.getSettings().deepCopy()
                : mapper.createObjectNode();
        settings.put("highlightAs", highlightAs);
        return new UpdateChannelRequest(
                channel.getName(), channel.getFileExtension(), null, channel.getDefaultEscaping(), channel.isEnabled(),
                channel.isDefaultChannel(), channel.getPosition(), settings);
    }

    private long revisionCount(Fixture fx) {
        return revisions.findByProjectIdOrderByRevisionIdDesc(fx.id()).size();
    }

    private Fixture fixture(String prefix) {
        int n = SEQ.incrementAndGet();
        AppUser admin = users.create(prefix + n, prefix + n + "@example.com", "Admin", "secret-password");
        Project project = projects.create(
                new CreateProjectRequest(prefix.replace("-", "") + n, prefix + n, null, "code highlighting"),
                admin.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), admin.getId(), "code highlighting");
        return new Fixture(project, ctx, jwt.issueAccessToken(users.findById(admin.getId()).orElseThrow()));
    }

    private String member(Fixture fx, ProjectRole role) {
        int n = SEQ.incrementAndGet();
        AppUser user = users.create("chm" + n + role.name().toLowerCase(), "chm" + n + "@example.com", "Member",
                "secret-password");
        projects.setMemberRole(fx.key(), user.getId(), role, fx.ctx());
        return jwt.issueAccessToken(users.findById(user.getId()).orElseThrow());
    }

    private ResultActions putOverrides(Fixture fx, String token, String body) throws Exception {
        return perform(put("/api/v1/projects/{key}/code-highlighting", fx.key())
                .contentType(MediaType.APPLICATION_JSON)
                .content(body), token);
    }

    private ResultActions perform(
            org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request, String token)
            throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + token));
    }

    private static Map<String, byte[]> entries(byte[] archive) throws IOException {
        Map<String, byte[]> out = new LinkedHashMap<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archive))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                out.put(entry.getName(), zip.readAllBytes());
            }
        }
        return out;
    }

    private static String entry(byte[] archive, String name) throws IOException {
        byte[] bytes = entries(archive).get(name);
        if (bytes == null) {
            throw new AssertionError("No archive entry " + name);
        }
        return new String(bytes, StandardCharsets.UTF_8);
    }

    private static byte[] rewrite(byte[] archive, BiFunction<String, String, String> edit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(out)) {
            for (Map.Entry<String, byte[]> e : entries(archive).entrySet()) {
                byte[] bytes = e.getValue();
                if (e.getKey().endsWith(".json")) {
                    bytes = edit.apply(e.getKey(), new String(bytes, StandardCharsets.UTF_8)).getBytes(StandardCharsets.UTF_8);
                }
                zip.putNextEntry(new ZipEntry(e.getKey()));
                zip.write(bytes);
                zip.closeEntry();
            }
        }
        return out.toByteArray();
    }
}
