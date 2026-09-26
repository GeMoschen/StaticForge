package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.exportimport.ExportArchive;
import com.acme.staticforge.exportimport.ExportedAsset;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.ByteArrayInputStream;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * {@code POST .../export/selection} REST endpoint (feature `selective-export`, `M10.1.3`).
 * Mirrors the MockMvc + {@code JwtService} bearer-token pattern used by
 * {@code ProjectApiIntegrationTests}; unzips the raw response body the same way
 * {@code ProjectExportImportIntegrationTest} does at the service layer.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ProjectExportSelectionApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Autowired MockMvc mvc;
    @Autowired UserService userService;
    @Autowired com.acme.staticforge.project.ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired JwtService jwtService;
    @Autowired com.acme.staticforge.scheduler.ScheduleService scheduleService;
    @Autowired com.acme.staticforge.generate.GenerationTargetRepository targetRepository;
    @Autowired SchedulerFixtures schedulerFixtures;

    @Test
    void selectionOfAFolderReturnsZipContainingExactlyThatSubtree() throws Exception {
        Fixture fixture = newFixture("exp_sel_folder");

        AssetVersionView topFolder = assetService.create(
                new CreateAssetCommand(fixture.project().getId(), AssetType.FOLDER, "Top", null,
                        MAPPER.createObjectNode(), null),
                fixture.ctx());
        AssetVersionView pageInFolder = assetService.create(
                new CreateAssetCommand(fixture.project().getId(), AssetType.PAGE, "Nested Page", topFolder.uuid(),
                        MAPPER.createObjectNode(), null),
                fixture.ctx());
        AssetVersionView siblingFolder = assetService.create(
                new CreateAssetCommand(fixture.project().getId(), AssetType.FOLDER, "Sibling", null,
                        MAPPER.createObjectNode(), null),
                fixture.ctx());
        AssetVersionView pageInSibling = assetService.create(
                new CreateAssetCommand(fixture.project().getId(), AssetType.PAGE, "Sibling Page",
                        siblingFolder.uuid(), MAPPER.createObjectNode(), null),
                fixture.ctx());

        ObjectNode requestBody = MAPPER.createObjectNode();
        requestBody.putArray("assetUuids").add(topFolder.uuid().toString());
        requestBody.put("includeChannels", false);
        requestBody.put("includeGenerationTargets", false);
        String body = requestBody.toString();

        MvcResult result = mvc.perform(post("/api/v1/projects/" + fixture.project().getKey() + "/export/selection")
                        .header("Authorization", "Bearer " + fixture.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .header().string("Content-Type", "application/zip"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .header().string("Content-Disposition",
                                "attachment; filename=\"" + fixture.project().getKey() + ".zip\""))
                .andReturn();

        List<ExportedAsset> assets = parseAssets(result.getResponse().getContentAsByteArray());
        Set<String> uuids = assets.stream().map(ExportedAsset::uuid).collect(Collectors.toSet());
        assertThat(uuids).contains(topFolder.uuid().toString(), pageInFolder.uuid().toString());
        assertThat(uuids).doesNotContain(siblingFolder.uuid().toString(), pageInSibling.uuid().toString());
    }

    /**
     * Acceptance criterion M10.1.3 says a channels-only selection with no asset UUIDs
     * returns a ZIP with "only manifest.json + settings.json, no assets.json entries" — and
     * since {@code M14.1} changed the exporter to write one {@code assets/<uuid>.json} entry
     * per exported asset instead of a single combined {@code assets.json}, an empty asset
     * selection now literally produces zero {@code assets/} entries and no {@code
     * assets.json} entry at all (there is no longer a single file to write "empty"): the
     * ZIP's own entry list doubles as its own index (spec note, {@code M14} README), so an
     * empty selection has nothing to index. {@code parseAssets} treats "no asset entries of
     * either shape" the same way {@code readArchive} now does — as a legitimately empty list,
     * not an error.
     */
    @Test
    void channelsOnlySelectionWithNoAssetsReturnsEmptyAssetsArrayAndSettings() throws Exception {
        Fixture fixture = newFixture("exp_sel_chan");

        ObjectNode requestBody = MAPPER.createObjectNode();
        requestBody.putArray("assetUuids");
        requestBody.put("includeChannels", true);
        requestBody.put("includeGenerationTargets", false);
        String body = requestBody.toString();

        MvcResult result = mvc.perform(post("/api/v1/projects/" + fixture.project().getKey() + "/export/selection")
                        .header("Authorization", "Bearer " + fixture.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn();

        byte[] archive = result.getResponse().getContentAsByteArray();
        Set<String> entryNames = zipEntryNames(archive);
        assertThat(entryNames).contains("manifest.json", "settings.json");
        assertThat(entryNames).noneMatch(name -> name.equals("assets.json") || name.startsWith("assets/"));
        assertThat(parseAssets(archive)).isEmpty();
    }

    /** {@code includeSchedules} (M27.8.1) alone is a selection: the archive carries the project's generation schedules. */
    @Test
    void schedulesOnlySelectionCarriesTheSchedules() throws Exception {
        Fixture fixture = newFixture("exp_sel_sched");
        long projectId = fixture.project().getId();
        var target = targetRepository.save(new com.acme.staticforge.generate.GenerationTarget(
                projectId, "default", com.acme.staticforge.generate.TargetType.FILESYSTEM, MAPPER.createObjectNode(), true));
        ObjectNode params = MAPPER.createObjectNode().put("mode", "FULL").put("targetId", target.getId());
        var schedule = scheduleService.create(projectId, new com.acme.staticforge.scheduler.ScheduleService.Command(
                "GENERATION", java.time.Instant.now().plus(java.time.Duration.ofDays(2)), null, null, null, null, null, null,
                params), fixture.user().getId());
        try {
            ObjectNode requestBody = MAPPER.createObjectNode();
            requestBody.putArray("assetUuids");
            requestBody.put("includeSchedules", true);

            MvcResult result = mvc.perform(post("/api/v1/projects/" + fixture.project().getKey() + "/export/selection")
                            .header("Authorization", "Bearer " + fixture.token())
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(requestBody.toString()))
                    .andExpect(status().isOk())
                    .andReturn();

            assertThat(zipEntryNames(result.getResponse().getContentAsByteArray()))
                    .contains("manifest.json", "schedules/" + schedule.getUuid() + ".json")
                    .noneMatch(name -> name.startsWith("assets/"));
        } finally {
            schedulerFixtures.retire(projectId);
        }
    }

    @Test
    void malformedEmptySelectionReturns422WithProblemDetailBody() throws Exception {
        Fixture fixture = newFixture("exp_sel_empty");

        String body = "{\"assetUuids\":[],\"includeChannels\":false,\"includeGenerationTargets\":false}";

        mvc.perform(post("/api/v1/projects/" + fixture.project().getKey() + "/export/selection")
                        .header("Authorization", "Bearer " + fixture.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.content()
                        .contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.status").value(422))
                .andExpect(jsonPath("$.code").value("SF-API-0422"))
                .andExpect(jsonPath("$.detail").value("Export selection is empty — nothing to export."));
    }

    @Test
    void invalidUuidInSelectionReturns400() throws Exception {
        Fixture fixture = newFixture("exp_sel_badid");

        String body = "{\"assetUuids\":[\"not-a-uuid\"],\"includeChannels\":false,\"includeGenerationTargets\":false}";

        mvc.perform(post("/api/v1/projects/" + fixture.project().getKey() + "/export/selection")
                        .header("Authorization", "Bearer " + fixture.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.code").value("SF-API-0400"));
    }

    private Set<String> zipEntryNames(byte[] archiveBytes) throws Exception {
        Set<String> names = new java.util.HashSet<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archiveBytes))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                names.add(entry.getName());
            }
        }
        return names;
    }

    /**
     * Shape-aware (task {@code M14.2.2}): reads either the legacy single {@code assets.json}
     * entry or one-or-more {@code assets/<uuid>.json} entries ({@code M14.1}+, the shape every
     * current exporter writes), mirroring {@code
     * ProjectExportImportServiceImpl#readArchive}'s own two-accumulator/per-file-wins logic.
     * Zero asset entries of either shape is a legitimately empty archive (e.g. a channels-only
     * selection), not an error.
     */
    private List<ExportedAsset> parseAssets(byte[] archiveBytes) throws Exception {
        List<ExportedAsset> legacyAssets = null;
        List<ExportedAsset> perFileAssets = null;
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archiveBytes))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                String name = entry.getName();
                if ("assets.json".equals(name)) {
                    legacyAssets =
                            new java.util.ArrayList<>(MAPPER.readValue(zip.readAllBytes(), ExportArchive.class).assets());
                } else if (name.startsWith("assets/")) {
                    if (perFileAssets == null) {
                        perFileAssets = new java.util.ArrayList<>();
                    }
                    perFileAssets.add(MAPPER.readValue(zip.readAllBytes(), ExportedAsset.class));
                }
            }
        }
        return perFileAssets != null ? perFileAssets : legacyAssets != null ? legacyAssets : List.of();
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
            return RevisionContext.of(project().getId(), user().getId(), "export-selection-api test");
        }
    }
}
