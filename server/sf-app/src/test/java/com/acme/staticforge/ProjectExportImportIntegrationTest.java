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
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.media.BlobRepository;
import com.acme.staticforge.asset.media.MediaBinary;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.navigation.CreatePageReferenceCommand;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.navigation.PageReferenceTargetKind;
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
import com.acme.staticforge.exportimport.ExportManifest;
import com.acme.staticforge.exportimport.ExportSelection;
import com.acme.staticforge.exportimport.ExportedAsset;
import com.acme.staticforge.exportimport.ExportedSettings;
import com.acme.staticforge.exportimport.ImportConflict;
import com.acme.staticforge.exportimport.ImportOptions;
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
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Comparator;
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
 * imported assets always preserve their source UUID — a same-type collision overwrites the
 * existing target asset in place (the import always wins) rather than minting a substitute
 * UUID, while a different-type collision blocks the whole import — that {@code payload.origin}
 * provenance is always recorded (plus {@code origin.overwrite} specifically on the overwrite
 * path), and that UUID references remain resolvable in every branch.
 */
@SpringBootTest
@ActiveProfiles("test")
class ProjectExportImportIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final ObjectMapper MAPPER = new ObjectMapper().registerModule(new JavaTimeModule());

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
    @Autowired FolderService folderService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired com.acme.staticforge.asset.AssetVersionRepository assetVersionRepository;

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
        ImportResult result = exportImportService.importProject(target.project().getId(), archive, target.ctx(), ImportOptions.DEFAULT);

        assertThat(result.sourceProjectKey()).isEqualTo(source.project().getKey());
        // media, section template, page template, page — the hidden root and the two fixed,
        // protected "Page Templates" / "Section Templates" folders (spec M13.1.2) are never
        // counted here, since import resolves all three onto the target's own existing
        // folders instead of creating duplicates (spec M13.2.2).
        assertThat(result.importedAssetCount()).isEqualTo(4);
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
     * Overwrite branch: re-importing an archive back into its own source project means every
     * one of its UUIDs already exists there, as the exact same type — a same-type collision
     * the import always wins on, overwriting the existing asset's content in place rather than
     * minting a substitute UUID (the old, pre-M15.x behavior). No asset is duplicated and every
     * reference remains trivially resolvable, since no UUID ever changes.
     */
    @Test
    void reimportingIntoTheSourceProjectOverwritesExistingAssetsInPlace() {
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
        ImportResult result = exportImportService.importProject(source.project().getId(), archive, source.ctx(), ImportOptions.DEFAULT);

        // Nothing is newly created — page template and page are both overwritten in place; the
        // two fixed template folders (spec M13.1.2) resolve onto the project's own existing
        // copies as before, never created either way.
        assertThat(result.importedAssetCount()).isEqualTo(0);
        assertThat(result.updatedAssetCount()).isEqualTo(2);

        Map<String, UUID> pageTemplatesAfter = uidsByType(source.project().getId(), AssetType.PAGE_TEMPLATE);
        Map<String, UUID> pagesAfter = uidsByType(source.project().getId(), AssetType.PAGE);
        // No duplicate was created under a fresh uuid — exactly the original asset, overwritten.
        assertThat(pageTemplatesAfter).hasSize(1).containsValue(pageTemplate.uuid());
        assertThat(pagesAfter).hasSize(1).containsValue(page.uuid());

        AssetVersionView overwrittenPage = assetService.requireCurrent(source.project().getId(), page.uuid());
        assertThat(overwrittenPage.validFromRevision()).isGreaterThan(page.validFromRevision());
        JsonNode origin = overwrittenPage.payload().path("origin");
        assertThat(origin.path("overwrite").asBoolean()).isTrue();
        // References remain resolvable trivially — the template's uuid never changed.
        assertThat(overwrittenPage.payload().path("templateRef").asText()).isEqualTo(pageTemplate.uuid().toString());
    }

    /**
     * Partial collision: when only SOME of an archive's UUIDs already exist in the target
     * project, each asset is handled independently — a freshly-created asset and an
     * overwritten-in-place asset must still resolve correctly against each other afterward.
     */
    @Test
    void partialCollisionOverwritesOnlyTheCollidingAssetAndCreatesTheOther() {
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
        // access, mirroring how M9.2.2's cross-project-collision test forces a collision), as the
        // SAME type (PAGE) the archive declares — a same-type collision overwrites, it doesn't
        // block. The template's uuid is left free, so it takes the create branch while the page
        // takes the overwrite branch.
        assetRepository.save(new Asset(
                page.uuid(), target.project().getId(), AssetType.PAGE, "pre-existing-collision",
                java.time.Instant.now(), target.user().getId()));

        ImportResult result = exportImportService.importProject(target.project().getId(), archive, target.ctx(), ImportOptions.DEFAULT);
        // page template created new; page overwritten in place. The two fixed template folders
        // (spec M13.1.2) resolve onto the target project's own existing copies as always.
        assertThat(result.importedAssetCount()).isEqualTo(1);
        assertThat(result.updatedAssetCount()).isEqualTo(1);

        Map<String, UUID> targetPageTemplates = uidsByType(target.project().getId(), AssetType.PAGE_TEMPLATE);
        UUID importedTemplateUuid = targetPageTemplates.get("landing");
        assertThat(importedTemplateUuid).isEqualTo(pageTemplate.uuid()); // preserved: no collision

        // The page keeps its original uuid — overwritten in place, not remapped — and its uid is
        // untouched by the import (Asset.uid is identity, changed only via explicit rename), so
        // it's still "pre-existing-collision" here, not re-derived from the archive's "home".
        AssetVersionView overwrittenPage = assetService.requireCurrent(target.project().getId(), page.uuid());
        assertThat(overwrittenPage.uid()).isEqualTo("pre-existing-collision");
        assertThat(overwrittenPage.payload().path("origin").path("overwrite").asBoolean()).isTrue();
        // Cross-reference resolution: the overwritten page's templateRef must still point at the
        // preserved template's (unchanged) uuid.
        assertThat(overwrittenPage.payload().path("templateRef").asText()).isEqualTo(importedTemplateUuid.toString());
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
                source.project().getId(), new ExportSelection(allUuids, true, true, Set.of()));
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
                source.project().getId(), new ExportSelection(Set.of(subFolder.uuid()), false, false, Set.of()));

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
                source.project().getId(), new ExportSelection(Set.of(page.uuid()), false, false, Set.of()));

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
                source.project().getId(), new ExportSelection(null, false, false, Set.of())))
                .isInstanceOf(SfException.class);

        assertThatThrownBy(() -> exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(Set.of(), false, false, Set.of())))
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
        channelService.create(
                new CreateChannelRequest("markdown", "Markdown", "md", "text/markdown", "MARKDOWN", true, false, 1, null, null),
                source.ctx());
        generationTargetRepository.save(new GenerationTarget(
                source.project().getId(), "Local Filesystem", TargetType.FILESYSTEM, MAPPER.createObjectNode(), true));

        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(rootFolderUuid(source), false, false, Set.of()));

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
                source.project().getId(), new ExportSelection(rootFolderUuid(source), false, true, Set.of()));

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
        channelService.create(
                new CreateChannelRequest("markdown", "Markdown", "md", "text/markdown", "MARKDOWN", true, false, 1, null, null),
                source.ctx());
        generationTargetRepository.save(new GenerationTarget(
                source.project().getId(), "Local Filesystem", TargetType.FILESYSTEM, MAPPER.createObjectNode(), true));

        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(rootFolderUuid(source), true, true, Set.of()));

        // Target project already has a colliding "markdown" channel with a different name —
        // it must survive the import unchanged.
        Fixture collidingTarget = newFixture("exp_set_imp_coll", "Export Settings Import Colliding Target");
        channelService.create(
                new CreateChannelRequest("markdown", "Pre-existing Markdown", "md", "text/markdown", "MARKDOWN", true, false, 1, null, null),
                collidingTarget.ctx());

        assertThatCode(() -> exportImportService.importProject(collidingTarget.project().getId(), archive, collidingTarget.ctx(), ImportOptions.DEFAULT))
                .doesNotThrowAnyException();

        OutputChannel unchanged = outputChannelRepository
                .findByProjectIdAndKey(collidingTarget.project().getId(), "markdown")
                .orElseThrow();
        assertThat(unchanged.getName()).isEqualTo("Pre-existing Markdown");

        // Target project with no colliding keys actually gets the channel/target created.
        Fixture freshTarget = newFixture("exp_set_imp_fresh", "Export Settings Import Fresh Target");
        exportImportService.importProject(freshTarget.project().getId(), archive, freshTarget.ctx(), ImportOptions.DEFAULT);

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
                source.project().getId(), new ExportSelection(Set.of(page.uuid()), false, false, Set.of()));

        Fixture target = newFixture("conf_tmpl_tgt", "Conflict Missing Template Target");
        ConflictReport report = exportImportService.analyzeImport(target.project().getId(), archive, ImportOptions.DEFAULT);

        List<ImportConflict> templateConflicts = report.conflicts().stream()
                .filter(c -> c.type() == ConflictType.MISSING_TEMPLATE_REFERENCE)
                .toList();
        assertThat(templateConflicts).hasSize(1);
        assertThat(templateConflicts.get(0).severity()).isEqualTo(ConflictSeverity.BLOCKING);
        assertThat(templateConflicts.get(0).elementUuid()).isEqualTo(page.uuid().toString());
        assertThat(report.hasBlocking()).isTrue();
    }

    /**
     * Same-project re-import: every asset in an archive analyzed against its own source project
     * must surface as DUPLICATE_UUID, since every one of those UUIDs already exists there as the
     * same type — but this is a warning, not a blocking conflict, since the import always wins
     * by overwriting rather than being refused.
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

        ConflictReport report = exportImportService.analyzeImport(source.project().getId(), archive, ImportOptions.DEFAULT);
        List<ImportConflict> duplicateConflicts = report.conflicts().stream()
                .filter(c -> c.type() == ConflictType.DUPLICATE_UUID)
                .toList();
        assertThat(duplicateConflicts).hasSize(assets.size());
        assertThat(duplicateConflicts).allSatisfy(
                c -> assertThat(c.severity()).isEqualTo(ConflictSeverity.WARNING));
        assertThat(report.hasBlocking()).isFalse();
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
        ConflictReport report = exportImportService.analyzeImport(target.project().getId(), archive, ImportOptions.DEFAULT);

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
                source.project().getId(), new ExportSelection(Set.of(page.uuid()), false, false, Set.of()));

        Fixture target = newFixture("conf_nowrite_tgt", "Conflict No Write Target");
        long countBefore = assetService.search(
                        new AssetQuery(target.project().getId(), null, null, null), PageRequest.of(0, 200))
                .getTotalElements();

        ConflictReport report = exportImportService.analyzeImport(target.project().getId(), archive, ImportOptions.DEFAULT);
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
                source.project().getId(), new ExportSelection(Set.of(page.uuid()), false, false, Set.of()));

        Fixture target = newFixture("conf_refuse_tgt", "Conflict Refuse Target");
        long countBefore = assetService.search(
                        new AssetQuery(target.project().getId(), null, null, null), PageRequest.of(0, 200))
                .getTotalElements();

        assertThatThrownBy(() -> exportImportService.importProject(target.project().getId(), archive, target.ctx(), ImportOptions.DEFAULT))
                .isInstanceOf(SfException.class)
                .satisfies(e -> assertThat(((SfException) e).getStatus()).isEqualTo(409));

        long countAfter = assetService.search(
                        new AssetQuery(target.project().getId(), null, null, null), PageRequest.of(0, 200))
                .getTotalElements();
        assertThat(countAfter).isEqualTo(countBefore);
    }

    // ---- M11.1.1 Navigation coverage ----

    /**
     * Navigation folder selection (feature `full-store-coverage`, `M11.1.1`): a NAVIGATION-scope
     * folder tree behaves exactly like the PAGES-store folder-selection test above — picking a
     * subfolder pulls in its own live descendants (here, a {@code PAGE_REFERENCE}) plus its
     * ancestor chain up to the root, but nothing from a sibling folder's subtree.
     */
    @Test
    void exportSelectionOfANavigationFolderIncludesAncestorsAndDescendantsOnly() {
        Fixture source = newFixture("nav_folder", "Navigation Folder Selection");
        AssetVersionView navRoot = navRoot(source);
        AssetVersionView topFolder = folderService.create(navRoot.uuid(), "Top", null, source.ctx());
        AssetVersionView subFolder = folderService.create(topFolder.uuid(), "Sub", null, source.ctx());
        AssetVersionView targetPage = assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.PAGE, "Target Page", null,
                        MAPPER.createObjectNode(), null),
                source.ctx());
        AssetVersionView refInSub = pageReferenceService.create(
                new CreatePageReferenceCommand(
                        "Sub Ref", subFolder.uuid(), PageReferenceTargetKind.PAGE, targetPage.uuid(), null),
                source.ctx());
        AssetVersionView siblingFolder = folderService.create(topFolder.uuid(), "Sibling", null, source.ctx());
        AssetVersionView refInSibling = pageReferenceService.create(
                new CreatePageReferenceCommand(
                        "Sibling Ref", siblingFolder.uuid(), PageReferenceTargetKind.PAGE, targetPage.uuid(), null),
                source.ctx());

        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(Set.of(subFolder.uuid()), false, false, Set.of()));

        Set<String> uuids = parseAssets(archive).stream().map(ExportedAsset::uuid).collect(Collectors.toSet());
        assertThat(uuids).contains(
                subFolder.uuid().toString(), refInSub.uuid().toString(),
                topFolder.uuid().toString(), navRoot.uuid().toString());
        assertThat(uuids).doesNotContain(siblingFolder.uuid().toString(), refInSibling.uuid().toString());
    }

    /**
     * Lone {@code PAGE_REFERENCE} selection + round-trip (feature `full-store-coverage`,
     * `M11.1.1`): selecting a single reference (not its target page) exports the reference and
     * its ancestor folder chain but not the target page. On import, {@code UuidRemapper.remap}
     * leaves any textual value that isn't a key of the remap map untouched (verified directly
     * in {@code ExportImportLogicTest#remapLeavesUnknownValuesUntouched}) — since the target
     * page's UUID was never part of the archive, the imported reference's {@code
     * target.assetUuid} must still read the original, now-foreign, source page UUID unchanged.
     */
    @Test
    void exportOfALonePageReferenceRoundTripsUnresolvedTargetUuidUnchanged() {
        Fixture source = newFixture("nav_ref", "Navigation Lone Reference");
        AssetVersionView targetPage = assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.PAGE, "Target Page", null,
                        MAPPER.createObjectNode(), null),
                source.ctx());
        AssetVersionView navRoot = navRoot(source);
        AssetVersionView pageRef = pageReferenceService.create(
                new CreatePageReferenceCommand(
                        "Lone Ref", navRoot.uuid(), PageReferenceTargetKind.PAGE, targetPage.uuid(), null),
                source.ctx());

        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(Set.of(pageRef.uuid()), false, false, Set.of()));

        Set<String> uuids = parseAssets(archive).stream().map(ExportedAsset::uuid).collect(Collectors.toSet());
        assertThat(uuids).contains(pageRef.uuid().toString());
        assertThat(uuids).doesNotContain(targetPage.uuid().toString());

        Fixture target = newFixture("nav_ref_tgt", "Navigation Lone Reference Target");
        exportImportService.importProject(target.project().getId(), archive, target.ctx(), ImportOptions.DEFAULT);

        Map<String, UUID> targetRefs = uidsByType(target.project().getId(), AssetType.PAGE_REFERENCE);
        UUID importedRefUuid = targetRefs.values().stream().findFirst().orElseThrow();
        AssetVersionView importedRef = assetService.requireCurrent(target.project().getId(), importedRefUuid);
        assertThat(importedRef.payload().path("target").path("assetUuid").asText())
                .isEqualTo(targetPage.uuid().toString());
    }

    // ---- M11.1.2 Template coverage ----

    /**
     * Lone template selection (feature `full-store-coverage`, `M11.1.2`; folder wiring per
     * spec M13.1.3): a {@code parentFolderUuid}-less {@code PAGE_TEMPLATE} create now resolves
     * to the project's fixed "Page Templates" folder rather than the hidden root directly (the
     * hidden root still exists one level further up, as every project's ultimate ancestor).
     * Selecting a single template therefore exports exactly three assets: the template itself,
     * its "Page Templates" folder, and that folder's own hidden-root ancestor.
     */
    @Test
    void exportSelectionOfALoneTemplateExportsOnlyThatAssetAndItsAncestorFolders() {
        Fixture source = newFixture("tmpl_lone", "Template Lone Selection");
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

        byte[] archive = exportImportService.exportSelection(
                source.project().getId(),
                new ExportSelection(Set.of(pageTemplate.uuid()), false, false, Set.of()));

        List<ExportedAsset> assets = parseAssets(archive);
        assertThat(assets).hasSize(4);
        assertThat(assets).extracting(ExportedAsset::uuid).contains(pageTemplate.uuid().toString());
        List<ExportedAsset> folders = assets.stream().filter(a -> "FOLDER".equals(a.type())).toList();
        assertThat(folders).hasSize(3);
        assertThat(folders).extracting(ExportedAsset::uid)
                .containsExactlyInAnyOrder("root", "templates_root", "page_templates");
    }

    /**
     * Template + referencing page selection and import remap (feature `full-store-coverage`,
     * `M11.1.2`): exporting a PAGE_TEMPLATE together with a PAGE that references it via {@code
     * templateAssetId} must export both, and importing into a fresh project must remap the
     * page's template reference to the newly-imported template's UUID.
     */
    @Test
    void exportOfTemplateAndReferencingPageRemapsTemplateReferenceOnImport() {
        Fixture source = newFixture("tmpl_page", "Template Plus Page Selection");
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
                source.project().getId(),
                new ExportSelection(Set.of(pageTemplate.uuid(), page.uuid()), false, false, Set.of()));

        Fixture target = newFixture("tmpl_page_tgt", "Template Plus Page Target");
        exportImportService.importProject(target.project().getId(), archive, target.ctx(), ImportOptions.DEFAULT);

        Map<String, UUID> targetPageTemplates = uidsByType(target.project().getId(), AssetType.PAGE_TEMPLATE);
        Map<String, UUID> targetPages = uidsByType(target.project().getId(), AssetType.PAGE);
        UUID importedTemplateUuid = targetPageTemplates.get("landing");
        UUID importedPageUuid = targetPages.get("home");

        AssetVersionView importedPage = assetService.requireCurrent(target.project().getId(), importedPageUuid);
        assertThat(importedPage.payload().path("templateRef").asText()).isEqualTo(importedTemplateUuid.toString());

        Asset importedPageAsset = assetRepository.findByProjectIdAndUuid(target.project().getId(), importedPageUuid)
                .orElseThrow();
        AssetVersion persistedVersion = assetVersionRepository
                .findByAssetIdAndValidToRevisionIsNull(importedPageAsset.getId())
                .orElseThrow();
        assertThat(persistedVersion.getTemplateAssetId()).isEqualTo(
                assetRepository.findByProjectIdAndUuid(target.project().getId(), importedTemplateUuid)
                        .orElseThrow()
                        .getId());
    }

    /**
     * Page-without-template conflict detection (feature `full-store-coverage`, `M11.1.2`):
     * selecting only the PAGE (not its template) and analyzing against a fresh target project
     * still produces the pre-existing MISSING_TEMPLATE_REFERENCE conflict — templates aren't
     * special-cased out of `M10.2`'s conflict detection.
     */
    @Test
    void selectingOnlyThePageWithoutItsTemplateStillFlagsMissingTemplateReference() {
        Fixture source = newFixture("tmpl_missing", "Template Missing Reference Selection");
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

        Fixture target = newFixture("tmpl_missing_tgt", "Template Missing Reference Target");
        ConflictReport report = exportImportService.analyzeImport(target.project().getId(), archive, ImportOptions.DEFAULT);

        List<ImportConflict> templateConflicts = report.conflicts().stream()
                .filter(c -> c.type() == ConflictType.MISSING_TEMPLATE_REFERENCE)
                .toList();
        assertThat(templateConflicts).hasSize(1);
        assertThat(templateConflicts.get(0).severity()).isEqualTo(ConflictSeverity.BLOCKING);
    }

    // ---- M11.1.3 fullStores ----

    /**
     * {@code fullStores} selects every live asset of a scope (feature `full-store-export`,
     * `M11.1.3`): {@code fullStores={PAGES}} with empty {@code assetUuids} exports every live
     * PAGES asset, and nothing from MEDIA/NAVIGATION.
     */
    @Test
    void fullStoresExportsEveryLiveAssetOfThatScopeAndNothingElse() {
        Fixture source = newFixture("full_pages", "Full Store Pages Selection");
        AssetVersionView pagesFolder = folderService.create(null, "Docs", FolderScope.PAGES, source.ctx());
        AssetVersionView page = assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.PAGE, "Home", pagesFolder.uuid(),
                        MAPPER.createObjectNode(), null),
                source.ctx());
        byte[] png = solidPng(4, 4, Color.BLUE);
        AssetVersionView media = mediaService.upload(
                source.project().getId(), null, "pic.png", "image/png", png, source.ctx());
        AssetVersionView navRoot = navRoot(source);
        AssetVersionView pageRefTarget = assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.PAGE, "Ref Target", null,
                        MAPPER.createObjectNode(), null),
                source.ctx());
        AssetVersionView pageRef = pageReferenceService.create(
                new CreatePageReferenceCommand(
                        "A Ref", navRoot.uuid(), PageReferenceTargetKind.PAGE, pageRefTarget.uuid(), null),
                source.ctx());

        byte[] archive = exportImportService.exportSelection(
                source.project().getId(),
                new ExportSelection(Set.of(), false, false, Set.of(FolderScope.PAGES)));

        Set<String> uuids = parseAssets(archive).stream().map(ExportedAsset::uuid).collect(Collectors.toSet());
        // pageRefTarget is a live PAGE sitting directly at the project's hidden root (no
        // PAGES-scope folder wraps it — see PathService.ROOT_UID's Context in
        // 003-store-root-selection.md) — still "every live PAGES asset" per this task's
        // acceptance criteria, so fullStores={PAGES} must pick it up exactly like pagesFolder/page.
        assertThat(uuids).contains(
                pagesFolder.uuid().toString(), page.uuid().toString(), pageRefTarget.uuid().toString());
        assertThat(uuids).doesNotContain(
                media.uuid().toString(), navRoot.uuid().toString(), pageRef.uuid().toString());
    }

    /**
     * {@code fullStores} unions cleanly with an explicit pick from a different scope (feature
     * `full-store-export`, `M11.1.3`): combining {@code fullStores={PAGES}} with an explicit
     * MEDIA pick produces every PAGES asset plus the picked MEDIA asset, with no duplicates.
     */
    @Test
    void fullStoresCombinesWithAnExplicitPickFromAnotherScope() {
        Fixture source = newFixture("full_union", "Full Store Union Selection");
        AssetVersionView pagesFolder = folderService.create(null, "Docs", FolderScope.PAGES, source.ctx());
        AssetVersionView page = assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.PAGE, "Home", pagesFolder.uuid(),
                        MAPPER.createObjectNode(), null),
                source.ctx());
        byte[] png = solidPng(4, 4, Color.GREEN);
        AssetVersionView media = mediaService.upload(
                source.project().getId(), null, "pic.png", "image/png", png, source.ctx());

        byte[] archive = exportImportService.exportSelection(
                source.project().getId(),
                new ExportSelection(Set.of(media.uuid()), false, false, Set.of(FolderScope.PAGES)));

        List<ExportedAsset> assets = parseAssets(archive);
        Set<String> uuids = assets.stream().map(ExportedAsset::uuid).collect(Collectors.toSet());
        assertThat(uuids).contains(pagesFolder.uuid().toString(), page.uuid().toString(), media.uuid().toString());
        // No duplicates: parseAssets returns a plain list, deserialized from assets.json which is
        // itself keyed on a Set<Long> membership check on the export side — a duplicate would show
        // up as a size mismatch against the deduplicated uuid set.
        assertThat(assets).hasSize(uuids.size());
    }

    /**
     * Empty-selection rejection still fires with {@code fullStores} also empty/null (feature
     * `full-store-export`, `M11.1.3`): extends {@code exportSelectionRejectsAnEmptySelection}.
     */
    @Test
    void exportSelectionRejectsAnEmptySelectionEvenWithFullStoresEmptyOrNull() {
        Fixture source = newFixture("full_empty", "Full Store Empty Selection");

        assertThatThrownBy(() -> exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(null, false, false, null)))
                .isInstanceOf(SfException.class);

        assertThatThrownBy(() -> exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(Set.of(), false, false, Set.of())))
                .isInstanceOf(SfException.class);
    }

    // ---- M11.2.1 explicit provenance ----

    /**
     * Explicit vs. ancestor-only provenance (feature `selection-provenance`, `M11.2.1`): a deep
     * leaf pick must be recorded {@code explicit=true} while every ancestor folder pulled in only
     * to keep the {@code parentFolderUuid} chain intact must be recorded {@code explicit=false}.
     */
    @Test
    void deepLeafPickIsExplicitAndItsAncestorFoldersAreNot() {
        Fixture source = newFixture("prov_leaf", "Provenance Leaf Selection");
        AssetVersionView topFolder = assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.FOLDER, "Top", null,
                        MAPPER.createObjectNode(), null),
                source.ctx());
        AssetVersionView subFolder = assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.FOLDER, "Sub", topFolder.uuid(),
                        MAPPER.createObjectNode(), null),
                source.ctx());
        AssetVersionView leafPage = assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.PAGE, "Leaf", subFolder.uuid(),
                        MAPPER.createObjectNode(), null),
                source.ctx());

        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(Set.of(leafPage.uuid()), false, false, Set.of()));

        Map<String, ExportedAsset> byUuid = parseAssets(archive).stream()
                .collect(Collectors.toMap(ExportedAsset::uuid, a -> a));
        assertThat(byUuid.get(leafPage.uuid().toString()).isExplicit()).isTrue();
        assertThat(byUuid.get(subFolder.uuid().toString()).isExplicit()).isFalse();
        assertThat(byUuid.get(topFolder.uuid().toString()).isExplicit()).isFalse();
    }

    /**
     * {@code exportProject} marks everything explicit (feature `selection-provenance`,
     * `M11.2.1`): its "everything" selection already includes every current asset UUID among
     * the picks, so nothing can land in the ancestors-only set — this should fall out for free,
     * verified empirically here.
     */
    @Test
    void exportProjectMarksEveryAssetExplicit() {
        Fixture source = newFixture("prov_all", "Provenance Export Project");
        AssetVersionView folder = assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.FOLDER, "Docs", null,
                        MAPPER.createObjectNode(), null),
                source.ctx());
        assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.PAGE, "Home", folder.uuid(),
                        MAPPER.createObjectNode(), null),
                source.ctx());

        byte[] archive = exportImportService.exportProject(source.project().getId());

        assertThat(parseAssets(archive)).allSatisfy(a -> assertThat(a.isExplicit()).isTrue());
    }

    /**
     * {@code fullStores} picks are explicit (feature `selection-provenance`, `M11.2.1`): a
     * top-level folder pulled in via {@code fullStores} is unioned into the picks argument
     * before {@code resolveIncludedAssetIds} runs, so it must be recorded {@code explicit=true},
     * not treated as an ancestor.
     */
    @Test
    void fullStoresPickedTopLevelFolderIsExplicit() {
        Fixture source = newFixture("prov_full", "Provenance Full Store Selection");
        AssetVersionView pagesFolder = folderService.create(null, "Docs", FolderScope.PAGES, source.ctx());

        byte[] archive = exportImportService.exportSelection(
                source.project().getId(),
                new ExportSelection(Set.of(), false, false, Set.of(FolderScope.PAGES)));

        Map<String, ExportedAsset> byUuid = parseAssets(archive).stream()
                .collect(Collectors.toMap(ExportedAsset::uuid, a -> a));
        assertThat(byUuid.get(pagesFolder.uuid().toString()).isExplicit()).isTrue();
    }

    /**
     * Pre-M11 archive backward compatibility (feature `selection-provenance`, `M11.2.1`): an
     * {@code assets.json} with no {@code explicit} key at all (simulated here by hand-building
     * one, since {@code ExportedAsset} has no {@code @JsonCreator} and relies on default Jackson
     * record binding) must still import without error, with {@link ExportedAsset#isExplicit()}
     * reading {@code true} for every such asset — this matters most for `M11.2.2`'s
     * {@code skipExistingImplicit}, which must never treat a pre-M11 archive's assets as
     * implicit.
     */
    @Test
    void preM11ArchiveWithNoExplicitKeyImportsWithEveryAssetTreatedAsExplicit() throws Exception {
        Fixture source = newFixture("prov_legacy", "Provenance Legacy Archive Source");
        AssetVersionView page = assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.PAGE, "Home", null,
                        MAPPER.createObjectNode(), null),
                source.ctx());
        byte[] archive = exportImportService.exportProject(source.project().getId());

        byte[] legacyArchive = rewriteAssetsJsonWithoutExplicitField(archive);

        List<ExportedAsset> reparsed = parseAssets(legacyArchive);
        assertThat(reparsed).isNotEmpty();
        assertThat(reparsed).allSatisfy(a -> {
            assertThat(a.explicit()).isNull();
            assertThat(a.isExplicit()).isTrue();
        });

        Fixture target = newFixture("prov_legacy_tgt", "Provenance Legacy Archive Target");
        assertThatCode(() -> exportImportService.importProject(
                        target.project().getId(), legacyArchive, target.ctx(), ImportOptions.DEFAULT))
                .doesNotThrowAnyException();
        assertThat(uidsByType(target.project().getId(), AssetType.PAGE)).containsKey(page.uid());
    }

    // ---- M11.2.2 skipExistingImplicit ----

    /**
     * {@code skipExistingImplicit=true} reuses an already-existing implicit ancestor folder
     * (feature `selection-provenance`, `M11.2.2`): importing an archive whose implicit ancestor
     * folder already exists (same UUID) in the target project creates zero duplicate folders and
     * correctly parents the explicit descendant under the existing folder.
     */
    @Test
    void skipExistingImplicitReusesAnAlreadyExistingImplicitFolderAndParentsDescendantsUnderIt() {
        Fixture source = newFixture("skip_on_src", "Skip Existing Implicit On Source");
        AssetVersionView topFolder = assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.FOLDER, "Top", null,
                        MAPPER.createObjectNode(), null),
                source.ctx());
        AssetVersionView leafPage = assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.PAGE, "Leaf", topFolder.uuid(),
                        MAPPER.createObjectNode(), null),
                source.ctx());
        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(Set.of(leafPage.uuid()), false, false, Set.of()));

        Fixture target = newFixture("skip_on_tgt", "Skip Existing Implicit On Target");
        // Force the archive's implicit ancestor folder to already exist (same uuid) in the
        // target project — mirrors how other tests in this file force a collision via direct
        // repository access, but here (unlike the plain collision tests) the skip path actually
        // reads the existing asset's current version to recover its real folderPath, so a
        // matching AssetVersion row is required too (asset_version.valid_from_revision has no FK
        // to the revision table, so an arbitrary revision id is fine for this direct insert).
        Asset preExistingTop = assetRepository.save(new Asset(
                topFolder.uuid(), target.project().getId(), AssetType.FOLDER, "pre-existing-top",
                java.time.Instant.now(), target.user().getId()));
        AssetVersion preExistingTopVersion = new AssetVersion(
                preExistingTop.getId(), 0L, "Pre-existing Top", MAPPER.createObjectNode(),
                target.user().getId(), java.time.Instant.now());
        preExistingTopVersion.setFolderPath("/pre-existing-top/");
        assetVersionRepository.save(preExistingTopVersion);
        long folderCountBefore = assetService.search(
                        new AssetQuery(target.project().getId(), AssetType.FOLDER, null, null), PageRequest.of(0, 200))
                .getTotalElements();

        ImportResult result = exportImportService.importProject(
                target.project().getId(), archive, target.ctx(), new ImportOptions(true));

        long folderCountAfter = assetService.search(
                        new AssetQuery(target.project().getId(), AssetType.FOLDER, null, null), PageRequest.of(0, 200))
                .getTotalElements();
        assertThat(folderCountAfter).isEqualTo(folderCountBefore);
        assertThat(result.importedAssetCount()).isEqualTo(1); // only the explicit leaf page

        Map<String, UUID> targetPages = uidsByType(target.project().getId(), AssetType.PAGE);
        UUID importedPageUuid = targetPages.get("leaf");
        AssetVersionView importedPage = assetService.requireCurrent(target.project().getId(), importedPageUuid);
        Asset importedPageAsset = assetRepository.findByProjectIdAndUuid(target.project().getId(), importedPageUuid)
                .orElseThrow();
        AssetVersion importedPageVersion = assetVersionRepository
                .findByAssetIdAndValidToRevisionIsNull(importedPageAsset.getId())
                .orElseThrow();
        Asset existingTopFolder = assetRepository.findByProjectIdAndUuid(target.project().getId(), topFolder.uuid())
                .orElseThrow();
        assertThat(importedPageVersion.getFolderId()).isEqualTo(existingTopFolder.getId());
    }

    /**
     * {@code skipExistingImplicit=false} (the default): the same archive/collision setup as the
     * test above, but with the option off, the colliding implicit folder is overwritten in place
     * (the import always wins) rather than being reused untouched.
     */
    @Test
    void skipExistingImplicitOffOverwritesTheCollidingImplicitFolder() {
        Fixture source = newFixture("skip_off_src", "Skip Existing Implicit Off Source");
        AssetVersionView topFolder = assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.FOLDER, "Top", null,
                        MAPPER.createObjectNode(), null),
                source.ctx());
        AssetVersionView leafPage = assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.PAGE, "Leaf", topFolder.uuid(),
                        MAPPER.createObjectNode(), null),
                source.ctx());
        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(Set.of(leafPage.uuid()), false, false, Set.of()));

        Fixture target = newFixture("skip_off_tgt", "Skip Existing Implicit Off Target");
        assetRepository.save(new Asset(
                topFolder.uuid(), target.project().getId(), AssetType.FOLDER, "pre-existing-top",
                java.time.Instant.now(), target.user().getId()));

        ImportResult result = exportImportService.importProject(
                target.project().getId(), archive, target.ctx(), ImportOptions.DEFAULT);

        // The implicit folder is overwritten in place (not created); the explicit leaf page is
        // created new.
        assertThat(result.importedAssetCount()).isEqualTo(1);
        assertThat(result.updatedAssetCount()).isEqualTo(1);
        Map<String, UUID> targetPages = uidsByType(target.project().getId(), AssetType.PAGE);
        UUID importedPageUuid = targetPages.get("leaf");
        AssetVersionView importedPage = assetService.requireCurrent(target.project().getId(), importedPageUuid);
        JsonNode origin = importedPage.payload().path("origin");
        // The page itself didn't collide, so it carries no overwrite marker — but its *parent
        // folder* did collide and was overwritten, keeping the original uuid.
        assertThat(origin.path("overwrite").isMissingNode()).isTrue();
        Asset overwrittenFolder =
                assetRepository.findByProjectIdAndUuid(target.project().getId(), topFolder.uuid()).orElseThrow();
        AssetVersionView overwrittenFolderVersion =
                assetService.requireCurrent(target.project().getId(), overwrittenFolder.getUuid());
        assertThat(overwrittenFolderVersion.payload().path("origin").path("overwrite").asBoolean()).isTrue();
    }

    /**
     * An explicit asset is never eligible for the skip path (feature `selection-provenance`,
     * `M11.2.2`): even with {@code skipExistingImplicit=true}, a collision on an asset the
     * caller explicitly picked must still be overwritten in place exactly as it would be with
     * the option off — "skip" only ever applies to implicit (ancestor-only) collisions.
     */
    @Test
    void skipExistingImplicitNeverSkipsAnExplicitlyPickedCollidingAsset() {
        Fixture source = newFixture("skip_explicit_src", "Skip Existing Implicit Explicit Source");
        AssetVersionView page = assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.PAGE, "Home", null,
                        MAPPER.createObjectNode(), null),
                source.ctx());
        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(Set.of(page.uuid()), false, false, Set.of()));

        Fixture target = newFixture("skip_explicit_tgt", "Skip Existing Implicit Explicit Target");
        assetRepository.save(new Asset(
                page.uuid(), target.project().getId(), AssetType.PAGE, "pre-existing-collision",
                java.time.Instant.now(), target.user().getId()));

        ImportResult result = exportImportService.importProject(
                target.project().getId(), archive, target.ctx(), new ImportOptions(true));

        assertThat(result.importedAssetCount()).isEqualTo(0);
        assertThat(result.updatedAssetCount()).isEqualTo(1);
        AssetVersionView overwrittenPage = assetService.requireCurrent(target.project().getId(), page.uuid());
        assertThat(overwrittenPage.payload().path("origin").path("overwrite").asBoolean()).isTrue();
    }

    /**
     * {@code analyzeImport} conflict visibility follows {@code skipExistingImplicit} (feature
     * `selection-provenance`, `M11.2.2`): with the option ON, the DUPLICATE_UUID conflict for the
     * implicit colliding asset is no longer reported; with the option OFF, it is reported exactly
     * as before.
     */
    @Test
    void analyzeImportHidesDuplicateUuidForImplicitAssetOnlyWhenSkipExistingImplicitIsOn() {
        Fixture source = newFixture("skip_analyze_src", "Skip Existing Implicit Analyze Source");
        AssetVersionView topFolder = assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.FOLDER, "Top", null,
                        MAPPER.createObjectNode(), null),
                source.ctx());
        AssetVersionView leafPage = assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.PAGE, "Leaf", topFolder.uuid(),
                        MAPPER.createObjectNode(), null),
                source.ctx());
        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(Set.of(leafPage.uuid()), false, false, Set.of()));

        Fixture target = newFixture("skip_analyze_tgt", "Skip Existing Implicit Analyze Target");
        assetRepository.save(new Asset(
                topFolder.uuid(), target.project().getId(), AssetType.FOLDER, "pre-existing-top",
                java.time.Instant.now(), target.user().getId()));

        ConflictReport reportOn = exportImportService.analyzeImport(
                target.project().getId(), archive, new ImportOptions(true));
        assertThat(reportOn.conflicts().stream()
                .filter(c -> c.type() == ConflictType.DUPLICATE_UUID
                        && topFolder.uuid().toString().equals(c.elementUuid())))
                .isEmpty();

        ConflictReport reportOff = exportImportService.analyzeImport(
                target.project().getId(), archive, ImportOptions.DEFAULT);
        assertThat(reportOff.conflicts().stream()
                .filter(c -> c.type() == ConflictType.DUPLICATE_UUID
                        && topFolder.uuid().toString().equals(c.elementUuid())))
                .hasSize(1);
    }

    /**
     * Regression: {@code ImportOptions.DEFAULT} (i.e. {@code skipExistingImplicit=false}) still
     * overwrites — never skips — a same-type collision, explicit or not — re-runs {@code
     * partialCollisionOverwritesOnlyTheCollidingAssetAndCreatesTheOther}'s scenario explicitly
     * through {@code ImportOptions.DEFAULT} and checks the same outcome.
     */
    @Test
    void importOptionsDefaultOverwritesExistingCollisionScenario() {
        Fixture source = newFixture("skip_regress_src", "Skip Existing Implicit Regression Source");
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

        Fixture target = newFixture("skip_regress_tgt", "Skip Existing Implicit Regression Target");
        assetRepository.save(new Asset(
                page.uuid(), target.project().getId(), AssetType.PAGE, "pre-existing-collision",
                java.time.Instant.now(), target.user().getId()));

        ImportResult result = exportImportService.importProject(
                target.project().getId(), archive, target.ctx(), ImportOptions.DEFAULT);
        // page template created new; the colliding page overwritten in place. The two fixed
        // template folders (spec M13.1.2) resolve onto the target project's own existing copies
        // as always.
        assertThat(result.importedAssetCount()).isEqualTo(1);
        assertThat(result.updatedAssetCount()).isEqualTo(1);

        AssetVersionView overwrittenPage = assetService.requireCurrent(target.project().getId(), page.uuid());
        assertThat(overwrittenPage.payload().path("origin").path("overwrite").asBoolean()).isTrue();
    }

    // ---- M13.2.1 Template folder coverage ----

    /**
     * Template folder selection (feature `template-store-folders`, `M13.2.1`): picking a
     * subfolder nested a few levels under the fixed "Page Templates" folder pulls in its own
     * live descendants (further sub-subfolders and templates) plus its ancestor chain up to the
     * root (which includes the fixed "Page Templates" folder itself), but nothing from a sibling
     * subtree — mirrors {@code exportSelectionOfAFolderIncludesAncestorsAndDescendantsOnly} and
     * {@code exportSelectionOfANavigationFolderIncludesAncestorsAndDescendantsOnly} for the new
     * {@code TEMPLATES} scope.
     */
    @Test
    void exportSelectionOfATemplateFolderIncludesAncestorsAndDescendantsOnly() {
        Fixture source = newFixture("tmplfld_sel", "Template Folder Selection");
        UUID pageTemplatesUuid = fixedFolderUuid(source, FolderScope.PAGE_TEMPLATES_UID);

        AssetVersionView marketing = folderService.create(pageTemplatesUuid, "Marketing", null, source.ctx());
        AssetVersionView campaigns = folderService.create(marketing.uuid(), "Campaigns", null, source.ctx());
        TemplateView nestedTemplate = createPageTemplate(source, "Spring Landing", campaigns.uuid());

        AssetVersionView sibling = folderService.create(pageTemplatesUuid, "Sibling", null, source.ctx());
        TemplateView siblingTemplate = createPageTemplate(source, "Other Landing", sibling.uuid());

        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(Set.of(marketing.uuid()), false, false, Set.of()));

        Set<String> uuids = parseAssets(archive).stream().map(ExportedAsset::uuid).collect(Collectors.toSet());
        assertThat(uuids).contains(
                marketing.uuid().toString(), campaigns.uuid().toString(), nestedTemplate.uuid().toString(),
                pageTemplatesUuid.toString());
        assertThat(uuids).doesNotContain(sibling.uuid().toString(), siblingTemplate.uuid().toString());
    }

    /**
     * {@code fullStores={TEMPLATES}} exports every live template and template-folder in the
     * project (feature `template-store-folders`, `M13.2.1`), including both fixed folders and
     * everything nested under them, and nothing from the PAGES/MEDIA/NAVIGATION stores — mirrors
     * {@code fullStoresExportsEveryLiveAssetOfThatScopeAndNothingElse} for the new scope.
     */
    @Test
    void fullStoresTemplatesExportsEveryLiveTemplateAndTemplateFolderAndNothingElse() {
        Fixture source = newFixture("full_tmpl", "Full Store Templates Selection");
        UUID pageTemplatesUuid = fixedFolderUuid(source, FolderScope.PAGE_TEMPLATES_UID);
        UUID sectionTemplatesUuid = fixedFolderUuid(source, FolderScope.SECTION_TEMPLATES_UID);
        AssetVersionView sub = folderService.create(pageTemplatesUuid, "Sub", null, source.ctx());
        TemplateView pageTemplate = createPageTemplate(source, "Landing", sub.uuid());
        TemplateView sectionTemplate = createSectionTemplate(source, "Teaser", null);

        AssetVersionView pagesFolder = folderService.create(null, "Docs", FolderScope.PAGES, source.ctx());
        AssetVersionView page = assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.PAGE, "Home", pagesFolder.uuid(),
                        MAPPER.createObjectNode(), null),
                source.ctx());
        byte[] png = solidPng(4, 4, Color.MAGENTA);
        AssetVersionView media = mediaService.upload(
                source.project().getId(), null, "pic.png", "image/png", png, source.ctx());
        AssetVersionView navRoot = navRoot(source);
        AssetVersionView pageRef = pageReferenceService.create(
                new CreatePageReferenceCommand(
                        "A Ref", navRoot.uuid(), PageReferenceTargetKind.PAGE, page.uuid(), null),
                source.ctx());

        byte[] archive = exportImportService.exportSelection(
                source.project().getId(),
                new ExportSelection(Set.of(), false, false, Set.of(FolderScope.TEMPLATES)));

        Set<String> uuids = parseAssets(archive).stream().map(ExportedAsset::uuid).collect(Collectors.toSet());
        assertThat(uuids).contains(
                pageTemplatesUuid.toString(), sectionTemplatesUuid.toString(), sub.uuid().toString(),
                pageTemplate.uuid().toString(), sectionTemplate.uuid().toString());
        assertThat(uuids).doesNotContain(
                pagesFolder.uuid().toString(), page.uuid().toString(), media.uuid().toString(),
                navRoot.uuid().toString(), pageRef.uuid().toString());
    }

    /**
     * {@code fullStores={TEMPLATES}} unions cleanly with an explicit pick from a different store
     * (feature `template-store-folders`, `M13.2.1`): combining {@code fullStores={TEMPLATES}}
     * with an explicit PAGES folder pick produces every TEMPLATES asset plus the picked PAGES
     * subtree, with no duplicates — mirrors {@code fullStoresCombinesWithAnExplicitPickFromAnotherScope}.
     */
    @Test
    void fullStoresTemplatesCombinesWithAnExplicitPickFromAnotherStore() {
        Fixture source = newFixture("full_tmpl_union", "Full Store Templates Union Selection");
        UUID sectionTemplatesUuid = fixedFolderUuid(source, FolderScope.SECTION_TEMPLATES_UID);
        TemplateView sectionTemplate = createSectionTemplate(source, "Teaser", null);

        AssetVersionView pagesFolder = folderService.create(null, "Docs", FolderScope.PAGES, source.ctx());
        AssetVersionView page = assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.PAGE, "Home", pagesFolder.uuid(),
                        MAPPER.createObjectNode(), null),
                source.ctx());

        byte[] archive = exportImportService.exportSelection(
                source.project().getId(),
                new ExportSelection(Set.of(pagesFolder.uuid()), false, false, Set.of(FolderScope.TEMPLATES)));

        List<ExportedAsset> assets = parseAssets(archive);
        Set<String> uuids = assets.stream().map(ExportedAsset::uuid).collect(Collectors.toSet());
        assertThat(uuids).contains(
                sectionTemplatesUuid.toString(), sectionTemplate.uuid().toString(),
                pagesFolder.uuid().toString(), page.uuid().toString());
        // No duplicates.
        assertThat(assets).hasSize(uuids.size());
    }

    /**
     * A page referencing a template inside a NON-selected template folder still produces the
     * existing {@code MISSING_TEMPLATE_REFERENCE} conflict on {@code analyzeImport} (feature
     * `template-store-folders`, `M13.2.1`, mirroring `M11.1.2`'s already-established behavior for
     * the flat pre-folder case): folders must not accidentally auto-include a referenced
     * template just because it happens to live in a folder that isn't itself selected.
     */
    @Test
    void pageReferencingTemplateInNonSelectedTemplateFolderStillFlagsMissingTemplateReference() {
        Fixture source = newFixture("tmplfld_missing", "Template Folder Missing Reference Selection");
        UUID pageTemplatesUuid = fixedFolderUuid(source, FolderScope.PAGE_TEMPLATES_UID);
        AssetVersionView nested = folderService.create(pageTemplatesUuid, "Nested", null, source.ctx());
        TemplateView pageTemplate = createPageTemplate(source, "Landing", nested.uuid());

        ObjectNode pagePayload = MAPPER.createObjectNode();
        pagePayload.put("templateRef", pageTemplate.uuid().toString());
        pagePayload.putObject("content");
        AssetVersionView page = assetService.create(
                new CreateAssetCommand(
                        source.project().getId(), AssetType.PAGE, "Home", null, pagePayload, pageTemplate.uuid()),
                source.ctx());

        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(Set.of(page.uuid()), false, false, Set.of()));

        Set<String> uuids = parseAssets(archive).stream().map(ExportedAsset::uuid).collect(Collectors.toSet());
        assertThat(uuids).doesNotContain(
                pageTemplate.uuid().toString(), nested.uuid().toString(), pageTemplatesUuid.toString());

        Fixture target = newFixture("tmplfld_missing_tgt", "Template Folder Missing Reference Target");
        ConflictReport report = exportImportService.analyzeImport(target.project().getId(), archive, ImportOptions.DEFAULT);

        List<ImportConflict> templateConflicts = report.conflicts().stream()
                .filter(c -> c.type() == ConflictType.MISSING_TEMPLATE_REFERENCE)
                .toList();
        assertThat(templateConflicts).hasSize(1);
        assertThat(templateConflicts.get(0).severity()).isEqualTo(ConflictSeverity.BLOCKING);
        assertThat(templateConflicts.get(0).elementUuid()).isEqualTo(page.uuid().toString());
    }

    // ---- M13.2.2 fixed folder import identity ----

    /**
     * Exporting a project's whole {@code TEMPLATES} store and importing it BACK into the SAME
     * project (feature `template-store-folders`, `M13.2.2`) must resolve the archive's two fixed
     * folders onto the target project's OWN existing fixed folders instead of creating
     * duplicates: exactly one FOLDER with uid {@code page_templates} and one with uid {@code
     * section_templates} must exist afterward, with every template overwritten in place (since
     * every uuid in the archive already exists in this project, as the same type) still nested
     * correctly beneath the existing fixed folders.
     */
    @Test
    void reimportingWholeTemplatesStoreIntoSameProjectResolvesOntoExistingFixedFoldersWithNoDuplicates() {
        Fixture source = newFixture("fixedfld_same", "Fixed Folder Same Project Reimport");
        UUID pageTemplatesUuid = fixedFolderUuid(source, FolderScope.PAGE_TEMPLATES_UID);
        UUID sectionTemplatesUuid = fixedFolderUuid(source, FolderScope.SECTION_TEMPLATES_UID);
        AssetVersionView sub = folderService.create(pageTemplatesUuid, "Sub", null, source.ctx());
        TemplateView pageTemplate = createPageTemplate(source, "Landing", sub.uuid());
        TemplateView sectionTemplate = createSectionTemplate(source, "Teaser", null);

        byte[] archive = exportImportService.exportSelection(
                source.project().getId(),
                new ExportSelection(Set.of(), false, false, Set.of(FolderScope.TEMPLATES)));

        exportImportService.importProject(source.project().getId(), archive, source.ctx(), ImportOptions.DEFAULT);

        List<Asset> pageTemplateFolders = assetRepository.findAll().stream()
                .filter(a -> a.getProjectId() == source.project().getId()
                        && a.getAssetType() == AssetType.FOLDER
                        && FolderScope.PAGE_TEMPLATES_UID.equals(a.getUid()))
                .toList();
        List<Asset> sectionTemplateFolders = assetRepository.findAll().stream()
                .filter(a -> a.getProjectId() == source.project().getId()
                        && a.getAssetType() == AssetType.FOLDER
                        && FolderScope.SECTION_TEMPLATES_UID.equals(a.getUid()))
                .toList();
        assertThat(pageTemplateFolders).hasSize(1);
        assertThat(pageTemplateFolders.get(0).getUuid()).isEqualTo(pageTemplatesUuid);
        assertThat(sectionTemplateFolders).hasSize(1);
        assertThat(sectionTemplateFolders.get(0).getUuid()).isEqualTo(sectionTemplatesUuid);

        // Every re-imported template collided with itself (same uuid, same project) and was
        // overwritten in place — no duplicate was created, and each still lives under the SAME
        // fixed folder / subfolder structure it started in.
        Map<String, UUID> pageTemplatesAfter = uidsByType(source.project().getId(), AssetType.PAGE_TEMPLATE);
        Map<String, UUID> sectionTemplatesAfter = uidsByType(source.project().getId(), AssetType.SECTION_TEMPLATE);
        assertThat(pageTemplatesAfter).hasSize(1).containsValue(pageTemplate.uuid());
        assertThat(sectionTemplatesAfter).hasSize(1).containsValue(sectionTemplate.uuid());
        AssetVersionView overwrittenPageTemplate =
                assetService.requireCurrent(source.project().getId(), pageTemplate.uuid());
        assertThat(overwrittenPageTemplate.payload().path("origin").path("overwrite").asBoolean()).isTrue();
        assertThat(overwrittenPageTemplate.folderPath()).startsWith(
                assetService.requireCurrent(source.project().getId(), pageTemplatesUuid).folderPath());
    }

    /**
     * Importing that same whole-{@code TEMPLATES}-store archive into a DIFFERENT (fresh) project
     * (feature `template-store-folders`, `M13.2.2`) also resolves onto THAT project's own fixed
     * folders, not new ones — the fixed-folder identity resolution is project-local, not
     * archive-uuid-based.
     */
    @Test
    void importingWholeTemplatesStoreIntoADifferentProjectResolvesOntoThatProjectsOwnFixedFolders() {
        Fixture source = newFixture("fixedfld_diff_src", "Fixed Folder Different Project Source");
        UUID sourcePageTemplatesUuid = fixedFolderUuid(source, FolderScope.PAGE_TEMPLATES_UID);
        TemplateView pageTemplate = createPageTemplate(source, "Landing", null);
        TemplateView sectionTemplate = createSectionTemplate(source, "Teaser", null);

        byte[] archive = exportImportService.exportSelection(
                source.project().getId(),
                new ExportSelection(Set.of(), false, false, Set.of(FolderScope.TEMPLATES)));

        Fixture target = newFixture("fixedfld_diff_tgt", "Fixed Folder Different Project Target");
        UUID targetPageTemplatesUuid = fixedFolderUuid(target, FolderScope.PAGE_TEMPLATES_UID);
        UUID targetSectionTemplatesUuid = fixedFolderUuid(target, FolderScope.SECTION_TEMPLATES_UID);
        assertThat(targetPageTemplatesUuid).isNotEqualTo(sourcePageTemplatesUuid);

        exportImportService.importProject(target.project().getId(), archive, target.ctx(), ImportOptions.DEFAULT);

        List<Asset> pageTemplateFolders = assetRepository.findAll().stream()
                .filter(a -> a.getProjectId() == target.project().getId()
                        && a.getAssetType() == AssetType.FOLDER
                        && FolderScope.PAGE_TEMPLATES_UID.equals(a.getUid()))
                .toList();
        assertThat(pageTemplateFolders).hasSize(1);
        assertThat(pageTemplateFolders.get(0).getUuid()).isEqualTo(targetPageTemplatesUuid);

        Map<String, UUID> targetPageTemplates = uidsByType(target.project().getId(), AssetType.PAGE_TEMPLATE);
        Map<String, UUID> targetSectionTemplates = uidsByType(target.project().getId(), AssetType.SECTION_TEMPLATE);
        assertThat(targetPageTemplates).containsKey("landing");
        assertThat(targetSectionTemplates).containsKey("teaser");
        AssetVersionView importedPageTemplate =
                assetService.requireCurrent(target.project().getId(), targetPageTemplates.get("landing"));
        assertThat(importedPageTemplate.folderId()).isEqualTo(
                assetRepository.findByProjectIdAndUuid(target.project().getId(), targetPageTemplatesUuid)
                        .orElseThrow().getId());
    }

    /**
     * The imported fixed folders remain {@code protected: true} after import (feature
     * `template-store-folders`, `M13.2.2`) even when the archive's own copy of the fixed folder
     * carries a divergent payload — the target's own payload always wins, since the fixed
     * folders are resolved (not created/overwritten) on import.
     */
    @Test
    void importedFixedFoldersRemainProtectedEvenWhenArchiveCopyDiffers() {
        Fixture source = newFixture("fixedfld_protect_src", "Fixed Folder Protected Source");
        createPageTemplate(source, "Landing", null);
        byte[] archive = exportImportService.exportSelection(
                source.project().getId(),
                new ExportSelection(Set.of(), false, false, Set.of(FolderScope.TEMPLATES)));

        // Hypothetically tamper with the archive's own "Page Templates" folder copy to NOT be
        // protected, simulating a divergent/corrupted source copy — the target's payload must
        // still win regardless, since the fixed-folder asset itself is never written by import.
        byte[] tampered = rewriteExportedAssetPayloadField(
                archive, FolderScope.PAGE_TEMPLATES_UID, "protected", false);

        Fixture target = newFixture("fixedfld_protect_tgt", "Fixed Folder Protected Target");
        exportImportService.importProject(target.project().getId(), tampered, target.ctx(), ImportOptions.DEFAULT);

        UUID targetPageTemplatesUuid = fixedFolderUuid(target, FolderScope.PAGE_TEMPLATES_UID);
        AssetVersionView targetFolder = assetService.requireCurrent(target.project().getId(), targetPageTemplatesUuid);
        assertThat(targetFolder.payload().path("protected").asBoolean()).isTrue();
    }

    // ---- M14.1 per-asset archive format ----

    /**
     * Entry-count shape (task {@code M14.1.1}/{@code M14.1.2}): exporting a fixture project
     * with a known number of live assets produces exactly that many {@code assets/<uuid>.json}
     * entries and zero {@code assets.json} entry — asserted on the archive's raw ZIP entry
     * names (via {@link #zipEntryNames}), not on reparsed content, since {@code parseAssets}
     * still only understands the pre-M14 single-file shape at this point in the epic.
     */
    @Test
    void exportProducesOnePerAssetEntryAndNoCombinedAssetsJsonEntry() {
        Fixture source = newFixture("m141_count", "M14.1 Per Asset Entry Count");
        AssetVersionView folder = assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.FOLDER, "Docs", null,
                        MAPPER.createObjectNode(), null),
                source.ctx());
        assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.PAGE, "Home", folder.uuid(),
                        MAPPER.createObjectNode(), null),
                source.ctx());

        // Every currently-live asset — not just "Docs"/"Home" — is expected in the archive:
        // exportProject means "everything", and a fresh project already auto-carries its own
        // hidden root, navigation root and the two fixed template-store folders (spec M8.1.2,
        // M13.1.2) before this fixture's own two assets are added. Read the live count directly
        // from the same snapshot exportSelection itself reads from, rather than hand-counting.
        int expectedLiveAssetCount = assetVersionRepository.findCurrentSnapshot(source.project().getId()).size();

        byte[] archive = exportImportService.exportProject(source.project().getId());
        Set<String> entries = zipEntryNames(archive);

        Set<String> assetEntries =
                entries.stream().filter(name -> name.startsWith("assets/")).collect(Collectors.toSet());
        assertThat(assetEntries).hasSize(expectedLiveAssetCount);
        assertThat(assetEntries).allSatisfy(name -> assertThat(name).endsWith(".json"));
        assertThat(entries).doesNotContain("assets.json");
    }

    /**
     * Field-for-field content (task {@code M14.1.2}): one specific asset's own {@code
     * assets/<uuid>.json} entry, read directly via {@code ZipInputStream} +
     * {@code objectMapper.readValue(bytes, ExportedAsset.class)} (never via {@code
     * parseAssets}), deserializes to an {@link ExportedAsset} matching every field a freshly
     * created asset is known to hold — including {@code explicit}/{@code isExplicit()}
     * provenance for both the explicitly-picked leaf and its implicitly-included ancestor
     * folder, mirroring {@code deepLeafPickIsExplicitAndItsAncestorFoldersAreNot}.
     */
    @Test
    void perAssetEntryDeserializesToExpectedExportedAssetFields() {
        Fixture source = newFixture("m141_fields", "M14.1 Per Asset Entry Fields");
        AssetVersionView topFolder = assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.FOLDER, "Top", null,
                        MAPPER.createObjectNode(), null),
                source.ctx());
        ObjectNode payload = MAPPER.createObjectNode();
        payload.putObject("content").put("headline", "Hello");
        AssetVersionView leafPage = assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.PAGE, "Leaf", topFolder.uuid(),
                        payload, null),
                source.ctx());

        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(Set.of(leafPage.uuid()), false, false, Set.of()));

        ExportedAsset leafEntry = readAssetEntry(archive, leafPage.uuid());
        assertThat(leafEntry.uuid()).isEqualTo(leafPage.uuid().toString());
        assertThat(leafEntry.type()).isEqualTo("PAGE");
        assertThat(leafEntry.uid()).isEqualTo(leafPage.uid());
        assertThat(leafEntry.displayName()).isEqualTo("Leaf");
        assertThat(leafEntry.parentFolderUuid()).isEqualTo(topFolder.uuid().toString());
        assertThat(leafEntry.folderPath()).isEqualTo(leafPage.folderPath());
        assertThat(leafEntry.templateUuid()).isNull();
        assertThat(leafEntry.payload().path("content").path("headline").asText()).isEqualTo("Hello");
        assertThat(leafEntry.mimeType()).isNull();
        assertThat(leafEntry.sizeBytes()).isNull();
        assertThat(leafEntry.isExplicit()).isTrue();

        ExportedAsset ancestorEntry = readAssetEntry(archive, topFolder.uuid());
        assertThat(ancestorEntry.uuid()).isEqualTo(topFolder.uuid().toString());
        assertThat(ancestorEntry.type()).isEqualTo("FOLDER");
        assertThat(ancestorEntry.displayName()).isEqualTo("Top");
        assertThat(ancestorEntry.isExplicit()).isFalse();
    }

    /**
     * {@code manifest.json}'s {@code protocolVersion} reads {@code 3} after this change (task
     * {@code M14.1.1}) — the structural shape change from one combined {@code assets.json} to
     * many {@code assets/<uuid>.json} entries is a protocol bump, not an additive field.
     */
    @Test
    void manifestReportsProtocolVersionThree() {
        Fixture source = newFixture("m141_manifest", "M14.1 Manifest Protocol Version");
        byte[] archive = exportImportService.exportProject(source.project().getId());

        ExportManifest manifest = parseManifest(archive);
        assertThat(manifest.protocolVersion()).isEqualTo(3);
    }

    /**
     * {@code settings.json} and every {@code blobs/<sha256>} entry are unaffected by the
     * per-asset archive layout change (task {@code M14.1.2}) — reuses the same
     * settings-export (feature `selective-export`, `M10.1.2`) and media-blob-export
     * (feature `cross-project-import-identity`, `M9.3`) fixtures/assertions already
     * established elsewhere in this file rather than inventing a new fixture shape.
     */
    @Test
    void settingsAndBlobEntriesAreUnaffectedByThePerAssetAssetLayout() {
        Fixture source = newFixture("m141_settings", "M14.1 Settings And Blobs Unaffected");
        channelService.create(
                new CreateChannelRequest("markdown", "Markdown", "md", "text/markdown", "MARKDOWN", true, false, 1, null, null),
                source.ctx());
        generationTargetRepository.save(new GenerationTarget(
                source.project().getId(), "Local Filesystem", TargetType.FILESYSTEM, MAPPER.createObjectNode(), true));
        byte[] png = solidPng(4, 4, Color.ORANGE);
        AssetVersionView media = mediaService.upload(
                source.project().getId(), null, "pic.png", "image/png", png, source.ctx());
        String sha = media.payload().path("blobSha256").asText();

        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(Set.of(media.uuid()), true, true, Set.of()));

        Set<String> entries = zipEntryNames(archive);
        assertThat(entries).contains("settings.json", "blobs/" + sha);

        ExportedSettings settings = parseSettings(archive);
        assertThat(settings.channels().stream().anyMatch(c -> "markdown".equals(c.key()))).isTrue();
        assertThat(settings.targets().stream().anyMatch(t -> "Local Filesystem".equals(t.name()))).isTrue();

        byte[] blobBytes = readBlobEntry(archive, sha);
        assertThat(blobBytes).isNotEmpty();
    }

    // ---- M14.2 backward-compatible import ----

    /**
     * The highest-value test in this epic (task {@code M14.2.2}, mirroring the "prove it,
     * don't assume it" bar {@code M9.3.2}/{@code M11.2.1} already held their own backward-compat
     * claims to): a hand-repacked pre-{@code M14} archive — the same source project's own
     * exported asset data, collapsed from {@code M14.1}'s per-file {@code assets/<uuid>.json}
     * shape back into the legacy single {@code assets.json} entry ({@code
     * ExportArchive(2, assets)}, {@link #repackAsLegacyAssetsJson}) — imports with results
     * identical to importing that same source project's normally-exported (per-file) archive
     * into a separate fresh target project: same asset/blob counts, same folder structure, same
     * {@code explicit} provenance, same {@code origin} provenance recorded on import. Proves
     * {@code readArchive}'s two shape branches ({@code M14.2.1}) are genuinely equivalent, not
     * just that neither one throws.
     */
    @Test
    void legacyRepackedArchiveImportsIdenticallyToPerFileArchive() throws Exception {
        Fixture source = newFixture("m142_legacy", "M14.2 Legacy Archive Source");

        AssetVersionView folder = assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.FOLDER, "Docs", null,
                        MAPPER.createObjectNode(), null),
                source.ctx());

        byte[] png = solidPng(64, 64, Color.BLUE);
        AssetVersionView media = mediaService.upload(
                source.project().getId(), null, "photo.png", "image/png", png, source.ctx());

        TemplateView pageTemplate = createPageTemplate(source, "Landing", null);
        ObjectNode pagePayload = MAPPER.createObjectNode();
        pagePayload.put("templateRef", pageTemplate.uuid().toString());
        ObjectNode content = pagePayload.putObject("content");
        ObjectNode hero = content.putObject("heroImage");
        hero.put("type", "MEDIA_REF");
        hero.put("uuid", media.uuid().toString());
        assetService.create(
                new CreateAssetCommand(source.project().getId(), AssetType.PAGE, "Home", folder.uuid(),
                        pagePayload, pageTemplate.uuid()),
                source.ctx());

        byte[] perFileArchive = exportImportService.exportProject(source.project().getId());
        assertThat(zipEntryNames(perFileArchive)).doesNotContain("assets.json");

        byte[] legacyArchive = repackAsLegacyAssetsJson(perFileArchive);
        Set<String> legacyEntries = zipEntryNames(legacyArchive);
        assertThat(legacyEntries).contains("assets.json");
        assertThat(legacyEntries).noneMatch(name -> name.startsWith("assets/"));
        // Every non-asset entry (manifest.json, blobs/*) passes through byte-for-byte unchanged.
        assertThat(legacyEntries)
                .containsAll(zipEntryNames(perFileArchive).stream()
                        .filter(name -> !name.startsWith("assets/"))
                        .collect(Collectors.toSet()));

        assertThat(parseAssets(legacyArchive)).allSatisfy(a -> assertThat(a.isExplicit()).isTrue());

        Fixture perFileTarget = newFixture("m142_legacy_pf", "M14.2 Per-File Target");
        Fixture legacyTarget = newFixture("m142_legacy_lg", "M14.2 Legacy Target");

        ImportResult perFileResult = exportImportService.importProject(
                perFileTarget.project().getId(), perFileArchive, perFileTarget.ctx(), ImportOptions.DEFAULT);
        ImportResult legacyResult = exportImportService.importProject(
                legacyTarget.project().getId(), legacyArchive, legacyTarget.ctx(), ImportOptions.DEFAULT);

        assertThat(legacyResult.sourceProjectKey()).isEqualTo(perFileResult.sourceProjectKey());
        assertThat(legacyResult.importedAssetCount()).isEqualTo(perFileResult.importedAssetCount());
        assertThat(legacyResult.importedBlobCount()).isEqualTo(perFileResult.importedBlobCount());

        for (AssetType type : List.of(AssetType.FOLDER, AssetType.PAGE, AssetType.MEDIA, AssetType.PAGE_TEMPLATE)) {
            assertThat(uidsByType(legacyTarget.project().getId(), type).keySet())
                    .as("uids of type %s", type)
                    .isEqualTo(uidsByType(perFileTarget.project().getId(), type).keySet());
        }

        UUID perFilePageUuid = uidsByType(perFileTarget.project().getId(), AssetType.PAGE).get("home");
        UUID legacyPageUuid = uidsByType(legacyTarget.project().getId(), AssetType.PAGE).get("home");
        // Same source UUID preservation in both (neither fresh target project has seen it before).
        assertThat(legacyPageUuid).isEqualTo(perFilePageUuid);

        AssetVersionView perFilePage = assetService.requireCurrent(perFileTarget.project().getId(), perFilePageUuid);
        AssetVersionView legacyPage = assetService.requireCurrent(legacyTarget.project().getId(), legacyPageUuid);
        // Same folder structure.
        assertThat(legacyPage.folderPath()).isEqualTo(perFilePage.folderPath());
        // Same cross-reference resolution (heroImage/templateRef remapped identically).
        assertThat(legacyPage.payload().path("templateRef").asText())
                .isEqualTo(perFilePage.payload().path("templateRef").asText());
        assertThat(legacyPage.payload().path("content").path("heroImage").path("uuid").asText())
                .isEqualTo(perFilePage.payload().path("content").path("heroImage").path("uuid").asText());
        // Same origin provenance (import bulk-revision machinery, spec §6.1/§7.2).
        assertThat(legacyPage.payload().path("origin").path("from").asText())
                .isEqualTo(perFilePage.payload().path("origin").path("from").asText());
        assertThat(legacyPage.payload().path("origin").path("sourceProjectKey").asText())
                .isEqualTo(perFilePage.payload().path("origin").path("sourceProjectKey").asText());
        assertThat(legacyPage.payload().path("origin").path("sourceUuid").isMissingNode())
                .as("no collision occurred in either fresh target project")
                .isTrue();

        UUID perFileMediaUuid = uidsByType(perFileTarget.project().getId(), AssetType.MEDIA).get("photo_png");
        UUID legacyMediaUuid = uidsByType(legacyTarget.project().getId(), AssetType.MEDIA).get("photo_png");
        assertThat(legacyMediaUuid).isEqualTo(perFileMediaUuid);
        AssetVersionView perFileMedia = assetService.requireCurrent(perFileTarget.project().getId(), perFileMediaUuid);
        AssetVersionView legacyMedia = assetService.requireCurrent(legacyTarget.project().getId(), legacyMediaUuid);
        assertThat(legacyMedia.payload().path("blobSha256").asText())
                .isEqualTo(perFileMedia.payload().path("blobSha256").asText());
    }

    private ExportedAsset readAssetEntry(byte[] archiveBytes, UUID assetUuid) {
        String entryName = "assets/" + assetUuid + ".json";
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archiveBytes))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (entryName.equals(entry.getName())) {
                    return MAPPER.readValue(zip.readAllBytes(), ExportedAsset.class);
                }
            }
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
        throw new IllegalStateException(entryName + " entry not found in archive");
    }

    private ExportManifest parseManifest(byte[] archiveBytes) {
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archiveBytes))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if ("manifest.json".equals(entry.getName())) {
                    return MAPPER.readValue(zip.readAllBytes(), ExportManifest.class);
                }
            }
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
        throw new IllegalStateException("manifest.json entry not found in archive");
    }

    private byte[] readBlobEntry(byte[] archiveBytes, String sha256) {
        String entryName = "blobs/" + sha256;
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archiveBytes))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (entryName.equals(entry.getName())) {
                    return zip.readAllBytes();
                }
            }
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
        throw new IllegalStateException(entryName + " entry not found in archive");
    }

    private byte[] rewriteExportedAssetPayloadField(
            byte[] archiveBytes, String assetUid, String field, boolean value) {
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archiveBytes));
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                java.util.zip.ZipOutputStream zipOut = new java.util.zip.ZipOutputStream(out)) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                byte[] bytes = zip.readAllBytes();
                if ("assets.json".equals(entry.getName())) {
                    com.fasterxml.jackson.databind.node.ArrayNode assetsArray =
                            (com.fasterxml.jackson.databind.node.ArrayNode) MAPPER.readTree(bytes).get("assets");
                    for (JsonNode assetNode : assetsArray) {
                        if (assetUid.equals(assetNode.path("uid").asText())) {
                            ((ObjectNode) assetNode.get("payload")).put(field, value);
                        }
                    }
                    ObjectNode rewritten = MAPPER.createObjectNode();
                    rewritten.put("protocolVersion", MAPPER.readTree(bytes).get("protocolVersion").asInt());
                    rewritten.set("assets", assetsArray);
                    bytes = MAPPER.writeValueAsBytes(rewritten);
                }
                zipOut.putNextEntry(new ZipEntry(entry.getName()));
                zipOut.write(bytes);
                zipOut.closeEntry();
            }
            zipOut.finish();
            return out.toByteArray();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private UUID fixedFolderUuid(Fixture fixture, String uid) {
        return assetRepository.findByProjectIdAndAssetTypeAndUid(fixture.project().getId(), AssetType.FOLDER, uid)
                .orElseThrow()
                .getUuid();
    }

    private TemplateView createPageTemplate(Fixture fixture, String name, UUID parentFolderUuid) {
        return templateService.create(
                new CreateTemplateCommand(
                        fixture.project().getId(),
                        AssetType.PAGE_TEMPLATE,
                        name,
                        "content { editor text title { required } }",
                        Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"),
                        null,
                        false,
                        null,
                        parentFolderUuid),
                fixture.ctx());
    }

    private TemplateView createSectionTemplate(Fixture fixture, String name, UUID parentFolderUuid) {
        return templateService.create(
                new CreateTemplateCommand(
                        fixture.project().getId(),
                        AssetType.SECTION_TEMPLATE,
                        name,
                        "content { editor text headline { required } }",
                        Map.of("html", "<h2>$CMS_VALUE(headline)$</h2>"),
                        null,
                        false,
                        null,
                        parentFolderUuid),
                fixture.ctx());
    }

    /**
     * Strips the {@code explicit} field from every asset entry, simulating a pre-{@code M11}
     * archive that predates the field entirely (feature {@code selection-provenance}, {@code
     * M11.2.1}). Handles both archive shapes so it keeps working regardless of which one the
     * source archive it's given actually is: a legacy single {@code assets.json} (rewritten
     * in place, same as before {@code M14}), or one or more {@code assets/<uuid>.json} entries
     * ({@code M14.1}+, the shape every current exporter writes — {@code exportProject} calls
     * in this file now always produce this shape, so this branch is the one that actually runs
     * today). Deliberately NOT converted to the legacy single-file shape: that's a different
     * concern ({@code M14.2.2}'s own {@link #repackAsLegacyAssetsJson}, dedicated to proving
     * shape backward-compatibility) from this helper's job of testing the {@code explicit}
     * field's own backward compatibility.
     */
    private byte[] rewriteAssetsJsonWithoutExplicitField(byte[] archiveBytes) throws Exception {
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archiveBytes));
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                java.util.zip.ZipOutputStream zipOut = new java.util.zip.ZipOutputStream(out)) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                byte[] bytes = zip.readAllBytes();
                String name = entry.getName();
                if ("assets.json".equals(name)) {
                    com.fasterxml.jackson.databind.node.ArrayNode assetsArray =
                            (com.fasterxml.jackson.databind.node.ArrayNode)
                                    MAPPER.readTree(bytes).get("assets");
                    for (JsonNode assetNode : assetsArray) {
                        ((ObjectNode) assetNode).remove("explicit");
                    }
                    ObjectNode rewritten = MAPPER.createObjectNode();
                    rewritten.put("protocolVersion", MAPPER.readTree(bytes).get("protocolVersion").asInt());
                    rewritten.set("assets", assetsArray);
                    bytes = MAPPER.writeValueAsBytes(rewritten);
                } else if (name.startsWith("assets/")) {
                    ObjectNode assetNode = (ObjectNode) MAPPER.readTree(bytes);
                    assetNode.remove("explicit");
                    bytes = MAPPER.writeValueAsBytes(assetNode);
                }
                zipOut.putNextEntry(new ZipEntry(name));
                zipOut.write(bytes);
                zipOut.closeEntry();
            }
            zipOut.finish();
            return out.toByteArray();
        }
    }

    /**
     * Legacy-shape repack (task {@code M14.2.2}): collapses a freshly-exported archive's
     * {@code assets/<uuid>.json} entries back into a single {@code assets.json} entry holding
     * {@code ExportArchive(2, assets)} — protocol version 2, the last version that ever wrote
     * this shape — passing every other entry ({@code manifest.json}, {@code settings.json},
     * {@code blobs/*}) through byte-for-byte unchanged. Mirrors {@link
     * #rewriteAssetsJsonWithoutExplicitField}'s read-loop/rewrite-on-match/{@code
     * ZipOutputStream} pass-through structure, narrowly scoped to reversing exactly what {@code
     * M14.1.1} changed (per-file to single array) — not a generic protocol-version converter.
     */
    private byte[] repackAsLegacyAssetsJson(byte[] archiveBytes) throws Exception {
        List<ExportedAsset> collected = new ArrayList<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archiveBytes));
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                java.util.zip.ZipOutputStream zipOut = new java.util.zip.ZipOutputStream(out)) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                String name = entry.getName();
                byte[] bytes = zip.readAllBytes();
                if (name.startsWith("assets/")) {
                    collected.add(MAPPER.readValue(bytes, ExportedAsset.class));
                    continue;
                }
                zipOut.putNextEntry(new ZipEntry(name));
                zipOut.write(bytes);
                zipOut.closeEntry();
            }
            collected.sort(Comparator.comparing(ExportedAsset::uuid));
            zipOut.putNextEntry(new ZipEntry("assets.json"));
            zipOut.write(MAPPER.writeValueAsBytes(new ExportArchive(2, collected)));
            zipOut.closeEntry();
            zipOut.finish();
            return out.toByteArray();
        }
    }

    /** A fresh top-level `NAVIGATION` folder — nothing is pre-provisioned any more, so each test
     * that needs one creates its own. */
    private AssetVersionView navRoot(Fixture fx) {
        return folderService.create(null, "Nav Root " + SEQ.incrementAndGet(), FolderScope.NAVIGATION, fx.ctx());
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

    /**
     * Shape-aware test helper (task {@code M14.2.2}): reads either archive shape {@code
     * readArchive} itself now accepts — a single legacy {@code assets.json} entry
     * (pre-{@code M14}, {@code protocolVersion <= 2}), or one or more {@code
     * assets/<uuid>.json} entries ({@code M14.1}+, the shape every current exporter actually
     * writes) — into the same {@code List<ExportedAsset>} shape, mirroring {@code
     * ProjectExportImportServiceImpl#readArchive}'s own two-accumulator/per-file-wins logic so
     * every existing call site keeps exercising real, current export behavior.
     */
    private List<ExportedAsset> parseAssets(byte[] archiveBytes) {
        List<ExportedAsset> legacyAssets = null;
        List<ExportedAsset> perFileAssets = null;
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archiveBytes))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                String name = entry.getName();
                if ("assets.json".equals(name)) {
                    legacyAssets =
                            new ArrayList<>(MAPPER.readValue(zip.readAllBytes(), ExportArchive.class).assets());
                } else if (name.startsWith("assets/")) {
                    if (perFileAssets == null) {
                        perFileAssets = new ArrayList<>();
                    }
                    perFileAssets.add(MAPPER.readValue(zip.readAllBytes(), ExportedAsset.class));
                }
            }
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
        // Zero asset entries of either shape is a legitimately empty archive (e.g. a
        // channels-only selection), not an error — mirrors readArchive's own tolerance.
        List<ExportedAsset> assets =
                perFileAssets != null ? perFileAssets : legacyAssets != null ? legacyAssets : new ArrayList<>();
        assets.sort(Comparator.comparing(ExportedAsset::uuid));
        return assets;
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
