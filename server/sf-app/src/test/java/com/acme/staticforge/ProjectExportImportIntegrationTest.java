package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetQuery;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetSummary;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.media.BlobRepository;
import com.acme.staticforge.asset.media.MediaBinary;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.exportimport.ImportResult;
import com.acme.staticforge.exportimport.ProjectExportImportService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Project export → import round-trip (spec §26.5, §6.1, feature `cross-project-import-identity`,
 * `M9.3`). Verifies that assets, media and templates survive an export/import cycle, that
 * imported assets preserve their source UUID by default (minting a fresh UUIDv7 only when that
 * UUID already exists in the target project), that {@code payload.origin} provenance is always
 * recorded (plus {@code origin.sourceUuid} specifically on the collision path), and that UUID
 * references are remapped consistently onto the imported assets in every branch.
 */
@SpringBootTest
@ActiveProfiles("test")
class ProjectExportImportIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired MediaService mediaService;
    @Autowired TemplateService templateService;
    @Autowired ProjectExportImportService exportImportService;
    @Autowired BlobRepository blobRepository;
    @Autowired AssetRepository assetRepository;

    @Test
    void roundTripPreservesAssetsAndMediaRemapsUuidsAndAddsProvenance() {
        Fixture source = newFixture("exp_src", "Export Source");

        byte[] png = solidPng(320, 200, Color.RED);
        AssetVersionView media = mediaService.upload(
                source.project().getId(), null, "hero.png", "image/png", png, source.ctx());
        String sourceMediaSha = media.payload().path("blobSha256").asText();
        byte[] sourceBinary = mediaService.binary(source.project().getId(), media.uuid(), null).bytes();
        int sourceVariantCount = media.payload().path("variants").size();

        TemplateView sectionTemplate = templateService.create(
                new CreateTemplateCommand(
                        source.project().getId(),
                        AssetType.SECTION_TEMPLATE,
                        "Teaser",
                        "content { editor text headline { required } }",
                        Map.of("html", "<h1>$CMS_VALUE(headline)$</h1>"),
                        null,
                        false,
                        null),
                source.ctx());
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
        ObjectNode content = pagePayload.putObject("content");
        ObjectNode hero = content.putObject("heroImage");
        hero.put("type", "MEDIA_REF");
        hero.put("uuid", media.uuid().toString());
        pagePayload.putObject("bodies").putArray("main").add(renderSection(sectionTemplate.uuid()));
        AssetVersionView page = assetService.create(
                new CreateAssetCommand(
                        source.project().getId(), AssetType.PAGE, "Home", null, pagePayload, pageTemplate.uuid()),
                source.ctx());

        byte[] archive = exportImportService.exportProject(source.project().getId());
        assertThat(archive).isNotEmpty();

        Fixture target = newFixture("exp_tgt", "Export Target");
        ImportResult result = exportImportService.importProject(target.project().getId(), archive, target.ctx());

        assertThat(result.sourceProjectKey()).isEqualTo(source.project().getKey());
        // media, section template, page template, page, plus the auto-created navigation
        // root folder every project now carries (spec §17, `M8.1.2`).
        assertThat(result.importedAssetCount()).isEqualTo(5);
        assertThat(result.importedBlobCount()).isEqualTo(1 + sourceVariantCount);

        Map<String, UUID> targetMedia = uidsByType(target.project().getId(), AssetType.MEDIA);
        Map<String, UUID> targetSections = uidsByType(target.project().getId(), AssetType.SECTION_TEMPLATE);
        Map<String, UUID> targetPageTemplates = uidsByType(target.project().getId(), AssetType.PAGE_TEMPLATE);
        Map<String, UUID> targetPages = uidsByType(target.project().getId(), AssetType.PAGE);

        assertThat(targetMedia).containsKey("hero_png");
        assertThat(targetSections).containsKey("teaser");
        assertThat(targetPageTemplates).containsKey("landing");
        assertThat(targetPages).containsKey("home");

        UUID importedPageUuid = targetPages.get("home");
        UUID importedMediaUuid = targetMedia.get("hero_png");
        UUID importedSectionUuid = targetSections.get("teaser");
        UUID importedPageTemplateUuid = targetPageTemplates.get("landing");

        // Importing into a project that has never seen these UUIDs preserves them exactly
        // (feature cross-project-import-identity, M9.3.1) — this is the common case, not a
        // universal "import always mints a new UUID" truth.
        assertThat(importedPageUuid).isEqualTo(page.uuid());
        assertThat(importedMediaUuid).isEqualTo(media.uuid());

        AssetVersionView importedPage = assetService.requireCurrent(target.project().getId(), importedPageUuid);
        JsonNode origin = importedPage.payload().path("origin");
        assertThat(origin.path("from").asText()).isEqualTo("import");
        assertThat(origin.path("sourceProjectKey").asText()).isEqualTo(source.project().getKey());
        assertThat(origin.path("importedAt").asText()).isNotBlank();
        assertThat(origin.path("sourceUuid").isMissingNode())
                .as("no collision occurred, so no sourceUuid re-keying marker should be written")
                .isTrue();

        assertThat(importedPage.payload().path("templateRef").asText()).isEqualTo(importedPageTemplateUuid.toString());
        assertThat(importedPage.payload().path("content").path("heroImage").path("uuid").asText())
                .isEqualTo(importedMediaUuid.toString());
        assertThat(importedPage.payload().path("bodies").path("main").get(0).path("templateRef").asText())
                .isEqualTo(importedSectionUuid.toString());

        AssetVersionView importedMedia = assetService.requireCurrent(target.project().getId(), importedMediaUuid);
        assertThat(importedMedia.payload().path("blobSha256").asText()).isEqualTo(sourceMediaSha);
        assertThat(blobRepository.findById(sourceMediaSha)).isPresent();
        MediaBinary binary = mediaService.binary(target.project().getId(), importedMediaUuid, null);
        assertThat(binary.bytes()).containsExactly(sourceBinary);
    }

    /**
     * Collision branch (feature cross-project-import-identity, M9.3.1): re-importing an archive
     * back into its own source project means every one of its UUIDs already exists there, so
     * every imported asset must get a fresh UUIDv7 (today's pre-M9.3.1 behavior, unchanged for
     * this specific case) and internal references must remap consistently onto the new UUIDs.
     */
    @Test
    void reimportingIntoTheSourceProjectMintsFreshUuidsAndRemapsReferences() {
        Fixture source = newFixture("exp_re", "Reimport Source");

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

        byte[] archive = exportImportService.exportProject(source.project().getId());
        ImportResult result = exportImportService.importProject(source.project().getId(), archive, source.ctx());

        // The count of assets created is independent of which branch each one took.
        assertThat(result.importedAssetCount()).isEqualTo(3); // page template, page, nav root

        Map<String, UUID> pageTemplatesAfter = uidsByType(source.project().getId(), AssetType.PAGE_TEMPLATE);
        Map<String, UUID> pagesAfter = uidsByType(source.project().getId(), AssetType.PAGE);
        // uidGenerator re-derives a fresh, non-colliding uid for the re-imported copies, so both
        // the original and the reimported asset now coexist under different uids.
        UUID reimportedTemplateUuid = pageTemplatesAfter.values().stream()
                .filter(uuid -> !uuid.equals(pageTemplate.uuid()))
                .findFirst()
                .orElseThrow();
        UUID reimportedPageUuid =
                pagesAfter.values().stream().filter(uuid -> !uuid.equals(page.uuid())).findFirst().orElseThrow();

        assertThat(reimportedPageUuid).isNotEqualTo(page.uuid());
        assertThat(reimportedPageUuid.version()).isEqualTo(7);
        assertThat(reimportedTemplateUuid).isNotEqualTo(pageTemplate.uuid());
        assertThat(reimportedTemplateUuid.version()).isEqualTo(7);

        AssetVersionView reimportedPage = assetService.requireCurrent(source.project().getId(), reimportedPageUuid);
        JsonNode origin = reimportedPage.payload().path("origin");
        assertThat(origin.path("sourceUuid").asText()).isEqualTo(page.uuid().toString());
        // The reimported page's templateRef must point at the reimported template's NEW uuid,
        // not the original — the collision path still remaps references consistently.
        assertThat(reimportedPage.payload().path("templateRef").asText()).isEqualTo(reimportedTemplateUuid.toString());
    }

    /**
     * Partial collision (feature cross-project-import-identity, M9.3.1, the hazard called out in
     * that task's notes): when only SOME of an archive's UUIDs already exist in the target
     * project, each asset is handled independently — a preserved-UUID asset and a
     * remapped-UUID asset must still resolve correctly against each other afterward.
     */
    @Test
    void partialCollisionPreservesSomeAssetsAndRemapsOthersWithReferencesStillResolving() {
        Fixture source = newFixture("exp_pc_src", "Partial Collision Source");
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
        byte[] archive = exportImportService.exportProject(source.project().getId());

        Fixture target = newFixture("exp_pc_tgt", "Partial Collision Target");
        // Force only the PAGE's uuid to already exist in the target project (direct repository
        // access, mirroring how M9.2.2's cross-project-collision test forces a collision) — the
        // template's uuid is left free, so it takes the preserve branch while the page takes the
        // collision branch.
        assetRepository.save(new Asset(
                page.uuid(), target.project().getId(), AssetType.FOLDER, "pre-existing-collision",
                java.time.Instant.now(), target.user().getId()));

        ImportResult result = exportImportService.importProject(target.project().getId(), archive, target.ctx());
        assertThat(result.importedAssetCount()).isEqualTo(3); // page template, page, nav root

        Map<String, UUID> targetPageTemplates = uidsByType(target.project().getId(), AssetType.PAGE_TEMPLATE);
        UUID importedTemplateUuid = targetPageTemplates.get("landing");
        assertThat(importedTemplateUuid).isEqualTo(pageTemplate.uuid()); // preserved: no collision

        Map<String, UUID> targetPages = uidsByType(target.project().getId(), AssetType.PAGE);
        UUID importedPageUuid = targetPages.get("home");
        assertThat(importedPageUuid).isNotEqualTo(page.uuid()); // remapped: collided with the forced pre-existing row

        AssetVersionView importedPage = assetService.requireCurrent(target.project().getId(), importedPageUuid);
        assertThat(importedPage.payload().path("origin").path("sourceUuid").asText())
                .isEqualTo(page.uuid().toString());
        // Cross-reference resolution: the remapped page's templateRef must still point at the
        // preserved template's (unchanged) uuid.
        assertThat(importedPage.payload().path("templateRef").asText()).isEqualTo(importedTemplateUuid.toString());
    }

    private static ObjectNode renderSection(UUID sectionTemplateUuid) {
        ObjectNode section = MAPPER.createObjectNode();
        section.put("instanceId", UUID.randomUUID().toString());
        section.put("templateRef", sectionTemplateUuid.toString());
        ObjectNode sectionContent = section.putObject("content");
        sectionContent.put("headline", "Hi");
        return section;
    }

    private Map<String, UUID> uidsByType(long projectId, AssetType type) {
        return assetService.search(new AssetQuery(projectId, type, null, null), PageRequest.of(0, 200)).stream()
                .collect(Collectors.toMap(AssetSummary::uid, AssetSummary::uuid));
    }

    private static byte[] solidPng(int width, int height, Color color) {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        g.setColor(color);
        g.fillRect(0, 0, width, height);
        g.dispose();
        try {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            ImageIO.write(image, "png", bos);
            return bos.toByteArray();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private Fixture newFixture(String key, String name) {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(
                key + "-user-" + n, key + "-user-" + n + "@example.com", name + " User " + n, "secret-password");
        Project project = projectService.create(new CreateProjectRequest(key + n, name, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "export-import test");
        }
    }
}
