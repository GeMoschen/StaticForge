package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * The library's multi-file Download (M35.19): {@code POST /media/download} answers one ZIP of the named files in the
 * order asked for, with the files' own names (a taken name gets {@code -2} before its extension), readable by a
 * {@code VIEWER}, refusing an empty list, an unknown file and a request without a session.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class MediaDownloadIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired MockMvc mvc;
    @Autowired UserService userService;
    @Autowired JwtService jwtService;
    @Autowired ProjectService projectService;
    @Autowired MediaService mediaService;

    @Test
    @DisplayName("Several files come as one ZIP with their own names, a viewer may download, a taken name is numbered")
    void severalFilesComeAsOneZip() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView first = text(fx, "notes.txt", "first");
        AssetVersionView second = text(fx, "notes.txt", "second");
        AssetVersionView third = text(fx, "readme.md", "third");

        ResultActions result = download(fx.viewer(), fx, List.of(first.uuid(), second.uuid(), third.uuid()), "Products / Coffee");
        result.andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CONTENT_TYPE, "application/zip"))
                .andExpect(header().string(HttpHeaders.CONTENT_DISPOSITION, org.hamcrest.Matchers.containsString("Products%20_%20Coffee.zip")));

        Map<String, String> entries = unzip(result.andReturn().getResponse().getContentAsByteArray());
        assertThat(entries.keySet()).containsExactly("notes.txt", "notes-2.txt", "readme.md");
        assertThat(entries).containsEntry("notes.txt", "first").containsEntry("notes-2.txt", "second").containsEntry("readme.md", "third");
    }

    @Test
    @DisplayName("A file named twice is in the ZIP once; no name falls back to media.zip")
    void aRepeatedFileIsOnceAndTheNameFallsBack() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView only = text(fx, "only.txt", "x");

        ResultActions result = download(fx.editor(), fx, List.of(only.uuid(), only.uuid()), null);
        result.andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CONTENT_DISPOSITION, org.hamcrest.Matchers.containsString("media.zip")));
        assertThat(unzip(result.andReturn().getResponse().getContentAsByteArray()).keySet()).containsExactly("only.txt");
    }

    @Test
    @DisplayName("No files, an unknown file and a missing session are refused")
    void refusals() throws Exception {
        Fixture fx = newFixture();
        download(fx.viewer(), fx, List.of(), "x").andExpect(status().isBadRequest());
        download(fx.viewer(), fx, List.of(UUID.randomUUID()), "x").andExpect(status().isNotFound());
        mvc.perform(post(url(fx))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"uuids\":[\"" + UUID.randomUUID() + "\"]}"))
                .andExpect(status().isUnauthorized());
    }

    private ResultActions download(AppUser user, Fixture fx, List<UUID> uuids, String name) throws Exception {
        StringBuilder body = new StringBuilder("{\"uuids\":[");
        for (int i = 0; i < uuids.size(); i++) {
            body.append(i > 0 ? "," : "").append('"').append(uuids.get(i)).append('"');
        }
        body.append("]").append(name == null ? "" : ",\"name\":\"" + name + "\"").append("}");
        return mvc.perform(post(url(fx))
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + jwtService.issueAccessToken(user))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body.toString()));
    }

    private static Map<String, String> unzip(byte[] zip) throws Exception {
        Map<String, String> entries = new LinkedHashMap<>();
        try (ZipInputStream in = new ZipInputStream(new ByteArrayInputStream(zip))) {
            for (ZipEntry entry = in.getNextEntry(); entry != null; entry = in.getNextEntry()) {
                entries.put(entry.getName(), new String(in.readAllBytes(), StandardCharsets.UTF_8));
            }
        }
        return entries;
    }

    private AssetVersionView text(Fixture fx, String name, String content) {
        return mediaService.upload(fx.id(), null, name, null, content.getBytes(StandardCharsets.UTF_8), fx.ctx());
    }

    private static String url(Fixture fx) {
        return "/api/v1/projects/" + fx.project().getKey() + "/media/download";
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser admin = userService.create("dl-admin-" + n, "dl-admin-" + n + "@example.com", "Download Admin " + n, "secret-password");
        Project project = projectService.create(new CreateProjectRequest("mediadl_" + n, "Media Download " + n, null, null), admin.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), admin.getId(), "test");
        AppUser editor = userService.create("dl-editor-" + n, "dl-editor-" + n + "@example.com", "Download Editor " + n, "secret-password");
        projectService.setMemberRole(project.getKey(), editor.getId(), ProjectRole.EDITOR, ctx);
        AppUser viewer = userService.create("dl-viewer-" + n, "dl-viewer-" + n + "@example.com", "Download Viewer " + n, "secret-password");
        projectService.setMemberRole(project.getKey(), viewer.getId(), ProjectRole.VIEWER, ctx);
        return new Fixture(project, admin, editor, viewer);
    }

    private record Fixture(Project project, AppUser admin, AppUser editor, AppUser viewer) {
        long id() {
            return project.getId();
        }

        RevisionContext ctx() {
            return RevisionContext.of(project.getId(), admin.getId(), "test");
        }
    }
}
