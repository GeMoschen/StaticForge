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
import com.acme.staticforge.template.cdl.CdlSources;
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
    @Autowired com.acme.staticforge.scheduler.ScheduleService scheduleService;
    @Autowired com.acme.staticforge.generate.GenerationTargetRepository targetRepository;
    @Autowired SchedulerFixtures schedulerFixtures;

    @Test
    void analyzeMissingTemplateReferenceReturns200WithBlockingConflictAndNoWrites() throws Exception {
        Fixture source = newFixture("an_tmpl_src");
        TemplateView pageTemplate = templateService.create(
                new CreateTemplateCommand(
                        source.project().getId(),
                        AssetType.PAGE_TEMPLATE,
                        "Landing",
                        CdlSources.split("content { editor text title { required } }"),
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
                        CdlSources.split("content { editor text title { required } }"),
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
                .andExpect(jsonPath("$.conflicts[?(@.type == 'MISSING_TEMPLATE_REFERENCE' && @.blocksImport == true)]")
                        .exists());

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

    /**
     * Release state in the analysis (M27.5.1): a protocol 8 archive reports {@code releaseState} and the requested
     * {@code releaseMode}; a protocol 7 archive reports {@code DRAFT} whatever was asked, with an {@code INFO} entry
     * that neither blocks nor warns.
     */
    @Test
    void analysisReportsTheReleaseStateAndTheModeThatApplies() throws Exception {
        Fixture source = newFixture("an_rel_src");
        byte[] current = exportImportService.exportProject(source.project().getId());
        byte[] protocol7 = ArchiveFixtures.zipResourceDirectory("exportimport/protocol-7-no-release-state");
        Fixture target = newFixture("an_rel_tgt");

        mvc.perform(multipart("/api/v1/projects/" + target.project().getKey() + "/import/analyze")
                        .file(new MockMultipartFile("file", "archive.zip", "application/zip", current))
                        .param("releaseMode", "DRAFT")
                        .header("Authorization", "Bearer " + target.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.releaseState").value(true))
                .andExpect(jsonPath("$.releaseMode").value("DRAFT"));

        mvc.perform(multipart("/api/v1/projects/" + target.project().getKey() + "/import/analyze")
                        .file(new MockMultipartFile("file", "archive.zip", "application/zip", protocol7))
                        .header("Authorization", "Bearer " + target.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.releaseState").value(false))
                .andExpect(jsonPath("$.releaseMode").value("DRAFT"))
                .andExpect(jsonPath("$.hasBlocking").value(false))
                .andExpect(jsonPath("$.conflicts[?(@.type == 'ARCHIVE_WITHOUT_RELEASE_STATE')].severity")
                        .value(org.hamcrest.Matchers.contains("INFO")));

        mvc.perform(multipart("/api/v1/projects/" + target.project().getKey() + "/import")
                        .file(new MockMultipartFile("file", "archive.zip", "application/zip", protocol7))
                        .param("releaseMode", "KEEP")
                        .header("Authorization", "Bearer " + target.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.releasedCount").value(0));
    }

    /**
     * Schedules over HTTP (M27.8.1): the analysis counts the archive's schedules and warns about each one that won't be
     * imported as it is; {@code importSchedules=false} leaves them out; the result counts the imported ones and carries
     * the commit-time warnings.
     */
    @Test
    void schedulesAreCountedImportedAndLeftOutOnRequest() throws Exception {
        Fixture source = newFixture("an_sch_src");
        long sourceId = source.project().getId();
        var target = targetRepository.save(new com.acme.staticforge.generate.GenerationTarget(
                sourceId, "default", com.acme.staticforge.generate.TargetType.FILESYSTEM, new ObjectMapper().createObjectNode(),
                true));
        ObjectNode params = new ObjectMapper().createObjectNode().put("mode", "FULL").put("targetId", target.getId());
        scheduleService.create(sourceId, new com.acme.staticforge.scheduler.ScheduleService.Command(
                "GENERATION", java.time.Instant.now().plus(java.time.Duration.ofDays(2)), null, null, null, null, null, null,
                params), source.user().getId());
        byte[] archive = exportImportService.exportProject(sourceId);
        Fixture skipping = newFixture("an_sch_skip");
        Fixture importing = newFixture("an_sch_tgt");
        try {
            mvc.perform(multipart("/api/v1/projects/" + importing.project().getKey() + "/import/analyze")
                            .file(new MockMultipartFile("file", "archive.zip", "application/zip", archive))
                            .header("Authorization", "Bearer " + importing.token()))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.scheduleCount").value(1))
                    .andExpect(jsonPath("$.conflicts[?(@.type == 'SCHEDULE_OWNER_REPLACED')].severity")
                            .value(org.hamcrest.Matchers.contains("WARNING")));

            mvc.perform(multipart("/api/v1/projects/" + skipping.project().getKey() + "/import")
                            .file(new MockMultipartFile("file", "archive.zip", "application/zip", archive))
                            .param("importSchedules", "false")
                            .header("Authorization", "Bearer " + skipping.token()))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.importedScheduleCount").value(0))
                    .andExpect(jsonPath("$.scheduleWarnings").isEmpty());

            mvc.perform(multipart("/api/v1/projects/" + importing.project().getKey() + "/import")
                            .file(new MockMultipartFile("file", "archive.zip", "application/zip", archive))
                            .header("Authorization", "Bearer " + importing.token()))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.importedScheduleCount").value(1))
                    .andExpect(jsonPath("$.updatedScheduleCount").value(0))
                    .andExpect(jsonPath("$.scheduleWarnings[0].type").value("SCHEDULE_OWNER_REPLACED"));
        } finally {
            schedulerFixtures.retire(sourceId);
            schedulerFixtures.retire(importing.project().getId());
        }
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
