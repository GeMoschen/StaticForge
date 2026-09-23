package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetQuery;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.channel.CreateChannelRequest;
import com.acme.staticforge.exportimport.ExportSelection;
import com.acme.staticforge.exportimport.ProjectExportImportService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * {@code POST .../import/analyze} and the commit-path conflict guard on {@code POST .../import}
 * (feature {@code import-conflicts}, {@code M10.2.3}). Mirrors the MockMvc + {@code JwtService}
 * bearer-token pattern used by {@code ProjectExportSelectionApiTest}, combined with the
 * service-layer conflict-producing fixtures established in {@code
 * ProjectExportImportIntegrationTest} (missing-template-reference / settings-key-collision
 * scenarios).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ProjectImportAnalyzeApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Autowired MockMvc mvc;
    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired TemplateService templateService;
    @Autowired ChannelService channelService;
    @Autowired ProjectExportImportService exportImportService;
    @Autowired JwtService jwtService;

    @Test
    void analyzeMissingTemplateReferenceReturns200WithBlockingConflictAndNoWrites() throws Exception {
        Fixture source = newFixture("an_tmpl_src");
        TemplateView pageTemplate = templateService.create(
                new CreateTemplateCommand(
                        source.project().getId(),
                        AssetType.PAGE_TEMPLATE,
                        "Landing",
                        "content { editor text title { required } }",
                        Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"),
                        null,
                        false,
                        null),
                source.ctx());
        ObjectNode pagePayload = MAPPER.createObjectNode();
        pagePayload.put("templateRef", pageTemplate.uuid().toString());
        pagePayload.putObject("content");
        AssetVersionView page = assetService.create(
                new CreateAssetCommand(
                        source.project().getId(), AssetType.PAGE, "Home", null, pagePayload, pageTemplate.uuid()),
                source.ctx());
        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(Set.of(page.uuid()), false, false, Set.of()));

        Fixture target = newFixture("an_tmpl_tgt");
        long countBefore = assetCount(target);

        mvc.perform(multipart("/api/v1/projects/" + target.project().getKey() + "/import/analyze")
                        .file(new MockMultipartFile("file", "archive.zip", "application/zip", archive))
                        .header("Authorization", "Bearer " + target.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.hasBlocking").value(true))
                .andExpect(jsonPath("$.blocksImport").value(true))
                .andExpect(jsonPath("$.conflicts[?(@.type == 'MISSING_TEMPLATE_REFERENCE' && @.blocksImport == true)]").exists());

        assertThat(assetCount(target)).isEqualTo(countBefore);
    }

    @Test
    void commitImportOnArchiveWithBlockingConflictReturns409WithConflictsAndNoWrites() throws Exception {
        Fixture source = newFixture("an_409_src");
        TemplateView pageTemplate = templateService.create(
                new CreateTemplateCommand(
                        source.project().getId(),
                        AssetType.PAGE_TEMPLATE,
                        "Landing",
                        "content { editor text title { required } }",
                        Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"),
                        null,
                        false,
                        null),
                source.ctx());
        ObjectNode pagePayload = MAPPER.createObjectNode();
        pagePayload.put("templateRef", pageTemplate.uuid().toString());
        pagePayload.putObject("content");
        AssetVersionView page = assetService.create(
                new CreateAssetCommand(
                        source.project().getId(), AssetType.PAGE, "Home", null, pagePayload, pageTemplate.uuid()),
                source.ctx());
        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(Set.of(page.uuid()), false, false, Set.of()));

        Fixture target = newFixture("an_409_tgt");
        long countBefore = assetCount(target);

        mvc.perform(multipart("/api/v1/projects/" + target.project().getKey() + "/import")
                        .file(new MockMultipartFile("file", "archive.zip", "application/zip", archive))
                        .header("Authorization", "Bearer " + target.token()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-API-0409"))
                .andExpect(jsonPath("$.conflicts[?(@.type == 'MISSING_TEMPLATE_REFERENCE')]").exists());

        assertThat(assetCount(target)).isEqualTo(countBefore);
    }

    @Test
    void commitImportWithOnlyWarningConflictSucceedsAsBefore() throws Exception {
        Fixture source = newFixture("an_warn_src");
        channelService.create(
                new CreateChannelRequest("markdown", "Markdown", "md", "text/markdown", "MARKDOWN", true, false, 1, null, null),
                source.ctx());
        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(Set.of(), true, false, Set.of()));

        Fixture target = newFixture("an_warn_tgt");
        channelService.create(
                new CreateChannelRequest("markdown", "Pre-existing Markdown", "md", "text/markdown", "MARKDOWN", true, false, 1, null, null),
                target.ctx());

        mvc.perform(multipart("/api/v1/projects/" + target.project().getKey() + "/import")
                        .file(new MockMultipartFile("file", "archive.zip", "application/zip", archive))
                        .header("Authorization", "Bearer " + target.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sourceProjectKey").value(source.project().getKey()));
    }

    /**
     * A pre-M25 archive (M25.4.1): its records outside a record set are {@code BLOCKING} conflicts that reject only
     * themselves — {@code hasBlocking} but not {@code blocksImport} — so committing succeeds without them.
     */
    @Test
    void recordsOutsideARecordSetBlockOnlyThemselvesAndTheImportCommits() throws Exception {
        byte[] archive = ArchiveFixtures.zipResourceDirectory("exportimport/protocol-6-records-outside-sets");
        Fixture target = newFixture("an_p6_tgt");

        mvc.perform(multipart("/api/v1/projects/" + target.project().getKey() + "/import/analyze")
                        .file(new MockMultipartFile("file", "archive.zip", "application/zip", archive))
                        .header("Authorization", "Bearer " + target.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.hasBlocking").value(true))
                .andExpect(jsonPath("$.blocksImport").value(false))
                .andExpect(jsonPath("$.conflicts[?(@.type == 'RECORD_OUTSIDE_RECORD_SET')].severity")
                        .value(org.hamcrest.Matchers.contains("BLOCKING", "BLOCKING", "BLOCKING")))
                .andExpect(jsonPath("$.conflicts[?(@.type == 'RECORD_OUTSIDE_RECORD_SET')].blocksImport")
                        .value(org.hamcrest.Matchers.contains(false, false, false)));

        mvc.perform(multipart("/api/v1/projects/" + target.project().getKey() + "/import")
                        .file(new MockMultipartFile("file", "archive.zip", "application/zip", archive))
                        .header("Authorization", "Bearer " + target.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.importedAssetCount").value(4));
    }

    private long assetCount(Fixture fixture) {
        return assetService.search(
                        new AssetQuery(fixture.project().getId(), null, null, null), PageRequest.of(0, 200))
                .getTotalElements();
    }

    private Fixture newFixture(String key) {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(
                key + "-user-" + n, key + "-user-" + n + "@example.com", key + " User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest(key + n, key + n, null, null), user.getId());
        String token = jwtService.issueAccessToken(user);
        return new Fixture(project, user, token);
    }

    private record Fixture(Project project, AppUser user, String token) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "import-analyze-api test");
        }
    }
}
