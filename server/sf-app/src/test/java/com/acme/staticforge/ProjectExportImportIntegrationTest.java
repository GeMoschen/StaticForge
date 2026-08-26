package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetQuery;
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
 * Project export → import round-trip (spec §26.5, §6.1). Verifies that assets, media and
 * templates survive an export/import cycle, that imported assets receive fresh UUIDv7s
 * plus {@code payload.origin} provenance, and that UUID references are remapped onto the
 * imported assets.
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

    @Test
    void roundTripPreservesAssetsAndMediaRemapsUuidsAndAddsProvenance() {
        Fixture source = newFixture("exp_src", "Export Source");

        byte[] png = solidPng(320, 200, Color.RED);
        AssetVersionView media = mediaService.upload(
                source.project().getId(), null, "hero.png", "image/png", png, source.ctx());
        String sourceMediaSha = media.payload().path("blobSha256").asText();
        byte[] sourceBinary = mediaService.binary(media.uuid(), null).bytes();
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

        assertThat(importedPageUuid).isNotEqualTo(page.uuid());
        assertThat(importedPageUuid.version()).isEqualTo(7);
        assertThat(importedMediaUuid).isNotEqualTo(media.uuid());

        AssetVersionView importedPage = assetService.requireCurrent(importedPageUuid);
        JsonNode origin = importedPage.payload().path("origin");
        assertThat(origin.path("from").asText()).isEqualTo("import");
        assertThat(origin.path("sourceProjectKey").asText()).isEqualTo(source.project().getKey());
        assertThat(origin.path("importedAt").asText()).isNotBlank();

        assertThat(importedPage.payload().path("templateRef").asText()).isEqualTo(importedPageTemplateUuid.toString());
        assertThat(importedPage.payload().path("content").path("heroImage").path("uuid").asText())
                .isEqualTo(importedMediaUuid.toString());
        assertThat(importedPage.payload().path("bodies").path("main").get(0).path("templateRef").asText())
                .isEqualTo(importedSectionUuid.toString());

        AssetVersionView importedMedia = assetService.requireCurrent(importedMediaUuid);
        assertThat(importedMedia.payload().path("blobSha256").asText()).isEqualTo(sourceMediaSha);
        assertThat(blobRepository.findById(sourceMediaSha)).isPresent();
        MediaBinary binary = mediaService.binary(importedMediaUuid, null);
        assertThat(binary.bytes()).containsExactly(sourceBinary);
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
