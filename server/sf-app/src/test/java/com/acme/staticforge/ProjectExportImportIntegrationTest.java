package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

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
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.channel.CreateChannelRequest;
import com.acme.staticforge.channel.OutputChannel;
import com.acme.staticforge.channel.OutputChannelRepository;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.exportimport.ConflictReport;
import com.acme.staticforge.exportimport.ConflictSeverity;
import com.acme.staticforge.exportimport.ConflictType;
import com.acme.staticforge.exportimport.ExportArchive;
import com.acme.staticforge.exportimport.ExportSelection;
import com.acme.staticforge.exportimport.ExportedAsset;
import com.acme.staticforge.exportimport.ExportedSettings;
import com.acme.staticforge.exportimport.ImportConflict;
import com.acme.staticforge.exportimport.ImportResult;
import com.acme.staticforge.exportimport.ProjectExportImportService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.TargetType;
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
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
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
    @Autowired ChannelService channelService;
    @Autowired OutputChannelRepository outputChannelRepository;
    @Autowired GenerationTargetRepository generationTargetRepository;

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

    /**
     * Byte-identical regression (feature `selective-export`, `M10.1.1`): {@code
     * exportProject} is now a thin delegation to {@code exportSelection} with a selection
     * meaning "everything" (every current asset UUID, both settings flags {@code true}),
     * so its content must match calling {@code exportSelection} that way directly.
     * Compares parsed content rather than raw bytes since {@code manifest.exportedAt}
     * (and ZIP entry timestamps) legitimately differ between two separate calls.
     */
    @Test
    void exportProjectMatchesExportSelectionOfEverything() {
        Fixture source = newFixture("exp_stable", "Export Stability");
        assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.FOLDER, "Docs", null,
                        MAPPER.createObjectNode(), null),
                source.ctx());

        byte[] wholeProject = exportImportService.exportProject(source.project().getId());
        List<ExportedAsset> wholeProjectAssets = parseAssets(wholeProject);
        Set<UUID> allUuids = wholeProjectAssets.stream().map(a -> UUID.fromString(a.uuid())).collect(Collectors.toSet());

        byte[] everythingSelected = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(allUuids, true, true));
        List<ExportedAsset> everythingSelectedAssets = parseAssets(everythingSelected);

        assertThat(everythingSelectedAssets).containsExactlyInAnyOrderElementsOf(wholeProjectAssets);
    }

    /**
     * Folder selection (feature `selective-export`, `M10.1.1`): picking a subfolder pulls
     * in its own live descendants plus its ancestor chain up to the root, but nothing
     * outside that subtree.
     */
    @Test
    void exportSelectionOfAFolderIncludesAncestorsAndDescendantsOnly() {
        Fixture source = newFixture("exp_folder", "Export Folder Selection");
        AssetVersionView topFolder = assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.FOLDER, "Top", null,
                        MAPPER.createObjectNode(), null),
                source.ctx());
        AssetVersionView subFolder = assetService.create(
                new CreateAssetCommand(
                        source.project().getId(), AssetType.FOLDER, "Sub", topFolder.uuid(),
                        MAPPER.createObjectNode(), null),
                source.ctx());
        AssetVersionView pageInSub = assetService.create(
                new CreateAssetCommand(
                        source.project().getId(), AssetType.PAGE, "Nested Page", subFolder.uuid(),
                        MAPPER.createObjectNode(), null),
                source.ctx());
        AssetVersionView siblingFolder = assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.FOLDER, "Sibling", null,
                        MAPPER.createObjectNode(), null),
                source.ctx());
        AssetVersionView pageInSibling = assetService.create(
                new CreateAssetCommand(
                        source.project().getId(), AssetType.PAGE, "Sibling Page", siblingFolder.uuid(),
                        MAPPER.createObjectNode(), null),
                source.ctx());

        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(Set.of(subFolder.uuid()), false, false));

        Set<String> uuids = parseAssets(archive).stream().map(ExportedAsset::uuid).collect(Collectors.toSet());
        assertThat(uuids).contains(subFolder.uuid().toString(), pageInSub.uuid().toString(), topFolder.uuid().toString());
        assertThat(uuids).doesNotContain(siblingFolder.uuid().toString(), pageInSibling.uuid().toString());
    }

    /**
     * Single non-folder asset selection (feature `selective-export`, `M10.1.1`): selecting
     * just a page exports the page and its ancestor folder chain, but never auto-includes
     * the page's own template reference — that's left for `M10.2`'s conflict detection to
     * surface on import, not this task's job to silently pull in.
     */
    @Test
    void exportSelectionOfASingleAssetExcludesItsTemplate() {
        Fixture source = newFixture("exp_single", "Export Single Asset Selection");
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
        AssetVersionView folder = assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.FOLDER, "Pages", null,
                        MAPPER.createObjectNode(), null),
                source.ctx());
        ObjectNode pagePayload = MAPPER.createObjectNode();
        pagePayload.put("templateRef", pageTemplate.uuid().toString());
        pagePayload.putObject("content");
        AssetVersionView page = assetService.create(
                new CreateAssetCommand(
                        source.project().getId(), AssetType.PAGE, "Home", folder.uuid(), pagePayload,
                        pageTemplate.uuid()),
                source.ctx());

        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(Set.of(page.uuid()), false, false));

        Set<String> uuids = parseAssets(archive).stream().map(ExportedAsset::uuid).collect(Collectors.toSet());
        assertThat(uuids).contains(page.uuid().toString(), folder.uuid().toString());
        assertThat(uuids).doesNotContain(pageTemplate.uuid().toString());
    }

    /**
     * Empty selection rejection (feature `selective-export`, `M10.1.1`): no assets picked
     * and no project-level settings selected means nothing to export, which is rejected
     * rather than silently producing an empty archive.
     */
    @Test
    void exportSelectionRejectsAnEmptySelection() {
        Fixture source = newFixture("exp_empty", "Export Empty Selection");

        assertThatThrownBy(() -> exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(null, false, false)))
                .isInstanceOf(SfException.class);

        assertThatThrownBy(() -> exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(Set.of(), false, false)))
                .isInstanceOf(SfException.class);
    }

    /**
     * No settings.json when both flags off (feature `selective-export`, `M10.1.2`): a
     * project with channels/targets still produces an archive with no settings entry at
     * all when neither flag is set — whole-project exports of projects without settings
     * selected stay identical to today's asset-only output.
     */
    @Test
    void exportWithBothSettingsFlagsOffOmitsSettingsEntry() {
        Fixture source = newFixture("exp_set_off", "Export Settings Off");
        channelService.create(source.project().getId(),
                new CreateChannelRequest("markdown", "Markdown", "md", "text/markdown", "MARKDOWN", true, false, 1, null, null),
                source.user().getId(), null);
        generationTargetRepository.save(new GenerationTarget(
                source.project().getId(), "Local Filesystem", TargetType.FILESYSTEM, MAPPER.createObjectNode(), true));

        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(rootFolderUuid(source), false, false));

        assertThat(zipEntryNames(archive)).doesNotContain("settings.json");
    }

    /**
     * Redaction (feature `selective-export`, `M10.1.2`): a generation target's config
     * carrying a {@code secretAccessKey} field must never appear in the exported
     * settings.json — the key is removed entirely, not just blanked — while other fields
     * survive untouched.
     */
    @Test
    void exportRedactsSensitiveGenerationTargetConfigFields() {
        Fixture source = newFixture("exp_set_redact", "Export Settings Redaction");
        ObjectNode config = MAPPER.createObjectNode();
        config.put("bucket", "my-bucket");
        config.put("region", "eu-central-1");
        config.put("secretAccessKey", "shhh-do-not-export-me");
        generationTargetRepository.save(new GenerationTarget(
                source.project().getId(), "S3 Target", TargetType.S3, config, false));

        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(rootFolderUuid(source), false, true));

        ExportedSettings settings = parseSettings(archive);
        assertThat(settings.targets()).hasSize(1);
        JsonNode exportedConfig = settings.targets().get(0).config();
        assertThat(exportedConfig.has("secretAccessKey")).isFalse();
        assertThat(exportedConfig.path("bucket").asText()).isEqualTo("my-bucket");
        assertThat(exportedConfig.path("region").asText()).isEqualTo("eu-central-1");
    }

    /**
     * Import skip-on-collision (feature `selective-export`, `M10.1.2`): importing settings
     * into a project that already has a channel with the same key must not throw and must
     * leave the existing channel untouched; importing into a project with no colliding
     * keys must actually create the channel/target.
     */
    @Test
    void importSkipsCollidingChannelsAndTargetsWithoutErrorAndCreatesNonColliding() {
        Fixture source = newFixture("exp_set_imp_src", "Export Settings Import Source");
        channelService.create(source.project().getId(),
                new CreateChannelRequest("markdown", "Markdown", "md", "text/markdown", "MARKDOWN", true, false, 1, null, null),
                source.user().getId(), null);
        generationTargetRepository.save(new GenerationTarget(
                source.project().getId(), "Local Filesystem", TargetType.FILESYSTEM, MAPPER.createObjectNode(), true));

        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(rootFolderUuid(source), true, true));

        // Target project already has a colliding "markdown" channel with a different name —
        // it must survive the import unchanged.
        Fixture collidingTarget = newFixture("exp_set_imp_coll", "Export Settings Import Colliding Target");
        channelService.create(collidingTarget.project().getId(),
                new CreateChannelRequest("markdown", "Pre-existing Markdown", "md", "text/markdown", "MARKDOWN", true, false, 1, null, null),
                collidingTarget.user().getId(), null);

        assertThatCode(() -> exportImportService.importProject(collidingTarget.project().getId(), archive, collidingTarget.ctx()))
                .doesNotThrowAnyException();

        OutputChannel unchanged = outputChannelRepository
                .findByProjectIdAndKey(collidingTarget.project().getId(), "markdown")
                .orElseThrow();
        assertThat(unchanged.getName()).isEqualTo("Pre-existing Markdown");

        // Target project with no colliding keys actually gets the channel/target created.
        Fixture freshTarget = newFixture("exp_set_imp_fresh", "Export Settings Import Fresh Target");
        exportImportService.importProject(freshTarget.project().getId(), archive, freshTarget.ctx());

        assertThat(outputChannelRepository.findByProjectIdAndKey(freshTarget.project().getId(), "markdown"))
                .isPresent();
        assertThat(generationTargetRepository.findByProjectId(freshTarget.project().getId()).stream()
                .map(GenerationTarget::getName))
                .contains("Local Filesystem");
    }

    /**
     * Missing template reference (feature `import-conflicts`, `M10.2.2`): a selective
     * export that deliberately excludes the page's template (`M10.1.1`'s
     * exportSelectionOfASingleAssetExcludesItsTemplate scenario) must be flagged as a
     * single BLOCKING MISSING_TEMPLATE_REFERENCE conflict when analyzed against a target
     * project that has never seen that template UUID either.
     */
    @Test
    void analyzeImportFlagsMissingTemplateReferenceAsBlocking() {
        Fixture source = newFixture("conf_tmpl_src", "Conflict Missing Template Source");
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
                source.project().getId(), new ExportSelection(Set.of(page.uuid()), false, false));

        Fixture target = newFixture("conf_tmpl_tgt", "Conflict Missing Template Target");
        ConflictReport report = exportImportService.analyzeImport(target.project().getId(), archive);

        List<ImportConflict> templateConflicts = report.conflicts().stream()
                .filter(c -> c.type() == ConflictType.MISSING_TEMPLATE_REFERENCE)
                .toList();
        assertThat(templateConflicts).hasSize(1);
        assertThat(templateConflicts.get(0).severity()).isEqualTo(ConflictSeverity.BLOCKING);
        assertThat(templateConflicts.get(0).elementUuid()).isEqualTo(page.uuid().toString());
        assertThat(report.hasBlocking()).isTrue();
    }

    /**
     * Same-project re-import (feature `import-conflicts`, `M10.2.2`): every asset in an
     * archive analyzed against its own source project must surface as DUPLICATE_UUID,
     * since every one of those UUIDs already exists there.
     */
    @Test
    void analyzeImportFlagsDuplicateUuidForEveryAssetWhenReimportedIntoSourceProject() {
        Fixture source = newFixture("conf_dup_src", "Conflict Duplicate Source");
        assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.FOLDER, "Docs", null,
                        MAPPER.createObjectNode(), null),
                source.ctx());

        byte[] archive = exportImportService.exportProject(source.project().getId());
        List<ExportedAsset> assets = parseAssets(archive);

        ConflictReport report = exportImportService.analyzeImport(source.project().getId(), archive);
        List<ImportConflict> duplicateConflicts = report.conflicts().stream()
                .filter(c -> c.type() == ConflictType.DUPLICATE_UUID)
                .toList();
        assertThat(duplicateConflicts).hasSize(assets.size());
        assertThat(report.hasBlocking()).isTrue();
    }

    /**
     * Never-seen target project (feature `import-conflicts`, `M10.2.2`, the case `M9`
     * exists to enable): analyzing the same archive against a brand-new project that has
     * never touched these UUIDs must produce zero DUPLICATE_UUID conflicts.
     */
    @Test
    void analyzeImportHasNoDuplicateUuidConflictsAgainstAFreshProject() {
        Fixture source = newFixture("conf_nodup_src", "Conflict No Duplicate Source");
        assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.FOLDER, "Docs", null,
                        MAPPER.createObjectNode(), null),
                source.ctx());
        byte[] archive = exportImportService.exportProject(source.project().getId());

        Fixture target = newFixture("conf_nodup_tgt", "Conflict No Duplicate Target");
        ConflictReport report = exportImportService.analyzeImport(target.project().getId(), archive);

        assertThat(report.conflicts().stream().filter(c -> c.type() == ConflictType.DUPLICATE_UUID)).isEmpty();
    }

    /**
     * No writes during analyze (feature `import-conflicts`, `M10.2.2`): calling
     * analyzeImport, even against an archive/target combination that produces conflicts,
     * must not change the target project's asset count.
     */
    @Test
    void analyzeImportPerformsNoWrites() {
        Fixture source = newFixture("conf_nowrite_src", "Conflict No Write Source");
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
                source.project().getId(), new ExportSelection(Set.of(page.uuid()), false, false));

        Fixture target = newFixture("conf_nowrite_tgt", "Conflict No Write Target");
        long countBefore = assetService.search(
                        new AssetQuery(target.project().getId(), null, null, null), PageRequest.of(0, 200))
                .getTotalElements();

        ConflictReport report = exportImportService.analyzeImport(target.project().getId(), archive);
        assertThat(report.hasBlocking()).isTrue();

        long countAfter = assetService.search(
                        new AssetQuery(target.project().getId(), null, null, null), PageRequest.of(0, 200))
                .getTotalElements();
        assertThat(countAfter).isEqualTo(countBefore);
    }

    /**
     * importProject refuses a blocking conflict (feature `import-conflicts`, `M10.2.2`):
     * calling importProject directly with an archive that has a missing-template conflict
     * must throw rather than silently importing, and the target project's asset count must
     * be unchanged afterward (transaction rolled back).
     */
    @Test
    void importProjectRefusesArchiveWithBlockingConflict() {
        Fixture source = newFixture("conf_refuse_src", "Conflict Refuse Source");
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
                source.project().getId(), new ExportSelection(Set.of(page.uuid()), false, false));

        Fixture target = newFixture("conf_refuse_tgt", "Conflict Refuse Target");
        long countBefore = assetService.search(
                        new AssetQuery(target.project().getId(), null, null, null), PageRequest.of(0, 200))
                .getTotalElements();

        assertThatThrownBy(() -> exportImportService.importProject(target.project().getId(), archive, target.ctx()))
                .isInstanceOf(SfException.class)
                .satisfies(e -> assertThat(((SfException) e).getStatus()).isEqualTo(409));

        long countAfter = assetService.search(
                        new AssetQuery(target.project().getId(), null, null, null), PageRequest.of(0, 200))
                .getTotalElements();
        assertThat(countAfter).isEqualTo(countBefore);
    }

    private Set<UUID> rootFolderUuid(Fixture fixture) {
        return assetService.search(new AssetQuery(fixture.project().getId(), AssetType.FOLDER, null, null), PageRequest.of(0, 200))
                .stream()
                .map(AssetSummary::uuid)
                .collect(Collectors.toSet());
    }

    private Set<String> zipEntryNames(byte[] archiveBytes) {
        Set<String> names = new java.util.HashSet<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archiveBytes))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                names.add(entry.getName());
            }
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
        return names;
    }

    private ExportedSettings parseSettings(byte[] archiveBytes) {
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archiveBytes))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if ("settings.json".equals(entry.getName())) {
                    return MAPPER.readValue(zip.readAllBytes(), ExportedSettings.class);
                }
            }
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
        throw new IllegalStateException("settings.json entry not found in archive");
    }

    private List<ExportedAsset> parseAssets(byte[] archiveBytes) {
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archiveBytes))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if ("assets.json".equals(entry.getName())) {
                    return MAPPER.readValue(zip.readAllBytes(), ExportArchive.class).assets();
                }
            }
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
        throw new IllegalStateException("assets.json entry not found in archive");
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
