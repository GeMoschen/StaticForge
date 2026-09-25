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
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.globals.CreateGlobalSetCommand;
import com.acme.staticforge.asset.globals.GlobalSetService;
import com.acme.staticforge.asset.globals.GlobalSetView;
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
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetLocations;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.AssetDiff;
import com.acme.staticforge.revision.DiffService;
import com.acme.staticforge.revision.FieldChange;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionDiff;
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
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

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

    /** The CDL of the running Globals example: a required text plus a media the values point at. */
    private static final String GLOBAL_SET_CDL =
            """
            content {
              editor text title { label "Site title" required }
              editor media logo { label "Logo" }
            }
            """;

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
    @Autowired GlobalSetService globalSetService;
    @Autowired DiffService diffService;
    @Autowired com.acme.staticforge.asset.dataset.DatasetService datasetService;
    @Autowired com.acme.staticforge.asset.dataset.RecordService recordService;
    @Autowired com.acme.staticforge.asset.dataset.RecordSetService recordSetService;
    @Autowired com.acme.staticforge.asset.AssetReferenceRepository assetReferenceRepository;
    @Autowired com.acme.staticforge.asset.page.PageService pageService;
    @Autowired GenerationService generationService;
    @Autowired ReleaseFixtures releaseFixtures;

    /** Where the M25 round trip's FULL generations write (generated output of source and target is compared). */
    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-export-import-test");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

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
     * Imported target output folders: an invalid {@code config.path}, or one that overlaps an
     * existing target's or an earlier imported target's folder, is reported as a
     * TARGET_PATH_COLLISION warning and imported without {@code path} (other config kept), so it
     * publishes to its collision-free {@code target-{id}} default. Valid, non-clashing paths survive.
     */
    @Test
    void importDropsInvalidOrClashingTargetPathsAndReportsThem() {
        Fixture source = newFixture("imp_tgt_path_src", "Import Target Path Source");
        long sourceId = source.project().getId();
        generationTargetRepository.save(new GenerationTarget(sourceId, "Live", TargetType.FILESYSTEM, targetConfig("site", null), true));
        generationTargetRepository.save(new GenerationTarget(sourceId, "Nested", TargetType.FILESYSTEM, targetConfig("site/staging", null), false));
        generationTargetRepository.save(new GenerationTarget(sourceId, "Broken", TargetType.ZIP, targetConfig("../escape", null), false));
        generationTargetRepository.save(new GenerationTarget(sourceId, "Mirror", TargetType.FILESYSTEM, targetConfig("MIRROR", "https://mirror.example.com"), false));
        generationTargetRepository.save(new GenerationTarget(sourceId, "Plain", TargetType.FILESYSTEM, targetConfig(null, null), false));
        byte[] archive = exportImportService.exportSelection(
                sourceId, new ExportSelection(rootFolderUuid(source), true, true, Set.of()));

        Fixture target = newFixture("imp_tgt_path_dst", "Import Target Path Destination");
        long targetId = target.project().getId();
        generationTargetRepository.save(new GenerationTarget(targetId, "Existing", TargetType.FILESYSTEM, targetConfig("mirror", null), true));

        ConflictReport report = exportImportService.analyzeImport(targetId, archive, ImportOptions.DEFAULT);
        List<ImportConflict> pathConflicts = report.conflicts().stream()
                .filter(c -> c.type() == ConflictType.TARGET_PATH_COLLISION)
                .toList();
        assertThat(pathConflicts).extracting(ImportConflict::elementLabel).containsExactlyInAnyOrder("Nested", "Broken", "Mirror");
        assertThat(pathConflicts).allMatch(c -> c.severity() == ConflictSeverity.WARNING);
        assertThat(pathConflicts.stream().filter(c -> c.elementLabel().equals("Mirror")).findFirst().orElseThrow().detail())
                .contains("'Existing'");
        assertThat(report.hasBlocking()).isFalse();

        exportImportService.importProject(targetId, archive, target.ctx(), ImportOptions.DEFAULT);

        Map<String, GenerationTarget> imported = generationTargetRepository.findByProjectId(targetId).stream()
                .collect(Collectors.toMap(GenerationTarget::getName, t -> t));
        assertThat(imported.get("Live").getConfig().path("path").asText()).isEqualTo("site");
        assertThat(imported.get("Nested").getConfig().has("path")).isFalse();
        assertThat(imported.get("Broken").getConfig().has("path")).isFalse();
        assertThat(imported.get("Mirror").getConfig().has("path")).isFalse();
        assertThat(imported.get("Mirror").getConfig().path("baseUrl").asText()).isEqualTo("https://mirror.example.com");
        assertThat(imported.get("Existing").getConfig().path("path").asText()).isEqualTo("mirror");
        // The destination already had a default; the imported "Live" must not become a second one.
        assertThat(imported.values().stream().filter(GenerationTarget::isDefaultTarget).map(GenerationTarget::getName))
                .containsExactly("Existing");
    }

    private static ObjectNode targetConfig(String path, String baseUrl) {
        ObjectNode config = MAPPER.createObjectNode();
        if (path != null) {
            config.put("path", path);
        }
        if (baseUrl != null) {
            config.put("baseUrl", baseUrl);
        }
        return config;
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
                .filter(a -> java.util.Objects.equals(a.getProjectId(), source.project().getId())
                        && a.getAssetType() == AssetType.FOLDER
                        && FolderScope.PAGE_TEMPLATES_UID.equals(a.getUid()))
                .toList();
        List<Asset> sectionTemplateFolders = assetRepository.findAll().stream()
                .filter(a -> java.util.Objects.equals(a.getProjectId(), source.project().getId())
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
                .filter(a -> java.util.Objects.equals(a.getProjectId(), target.project().getId())
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
     * {@code manifest.json}'s {@code protocolVersion} reads {@code 5}. It went to {@code 3} in
     * {@code M14.1.1} for the structural shape change from one combined {@code assets.json} to
     * many {@code assets/<uuid>.json} entries, to {@code 4} in {@code M17.1.3} because an
     * archive may now carry {@code GLOBAL_SET} assets — an importer that predates them would fail
     * inside {@code AssetType.valueOf} part-way through, whereas a version mismatch is reported as
     * a clean conflict — and to {@code 5} in {@code M19.1.3} for {@code DATASET}/{@code RECORD}.
     */
    @Test
    void manifestReportsTheCurrentProtocolVersion() {
        Fixture source = newFixture("m141_manifest", "M14.1 Manifest Protocol Version");
        byte[] archive = exportImportService.exportProject(source.project().getId());

        ExportManifest manifest = parseManifest(archive);
        // Bumped to 6 by M24.5.1 (the project's content languages in settings.json), to 7 by M25.4.1 (record sets),
        // to 8 by M27.5.1 (release state).
        assertThat(manifest.protocolVersion()).isEqualTo(ProjectExportImportService.PROTOCOL_VERSION);
        assertThat(manifest.protocolVersion()).isEqualTo(8);
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

    // ---- M17.1.3 Globals store coverage ----

    /**
     * Full-Globals-store round trip (`M17.1.3`): {@code fullStores={GLOBALS}} behaves like every
     * other store — every live set and folder of the scope travels, nested ones keep their place,
     * and a set's schema, values and uid come back unchanged. Both halves are deliberately run:
     * importing into a FRESH project and back into the SOURCE project must each resolve the
     * archive's {@code globals_root} onto the target's own fixed root rather than minting a second
     * one, which is what {@code findFixedFolderByUid} was extended for.
     */
    @Test
    void fullGlobalsStoreRoundTripsIntoAFreshProjectAndBackIntoItsOwn() {
        Fixture source = newFixture("glb_full", "Globals Full Store Source");
        AssetVersionView branding = folderService.create(null, "Branding", FolderScope.GLOBALS, source.ctx());
        AssetVersionView logo = mediaService.upload(
                source.project().getId(), null, "logo.png", "image/png", solidPng(32, 32, Color.BLUE), source.ctx());

        GlobalSetView site = globalSetService.create(
                new CreateGlobalSetCommand(source.project().getId(), null, "Site", GLOBAL_SET_CDL), source.ctx());
        ObjectNode siteValues = MAPPER.createObjectNode();
        siteValues.put("title", "Acme Outdoor");
        siteValues.putObject("logo").put("type", "MEDIA_REF").put("uuid", logo.uuid().toString());
        globalSetService.updateValues(site.uuid(), siteValues, site.revision(), source.ctx());

        GlobalSetView theme = globalSetService.create(
                new CreateGlobalSetCommand(
                        source.project().getId(), branding.uuid(), "Theme",
                        "content { editor text accent { label \"Accent\" } }"),
                source.ctx());
        globalSetService.updateValues(
                theme.uuid(), MAPPER.createObjectNode().put("accent", "#ff6600"), theme.revision(), source.ctx());

        // The media is picked explicitly alongside the store, so the referenced-logo case is a
        // clean round trip here; the unselected-media case is the next test's subject.
        byte[] archive = exportImportService.exportSelection(
                source.project().getId(),
                new ExportSelection(Set.of(logo.uuid()), false, false, Set.of(FolderScope.GLOBALS)));
        Set<String> exported = parseAssets(archive).stream().map(ExportedAsset::uuid).collect(Collectors.toSet());
        assertThat(exported).contains(
                site.uuid().toString(), theme.uuid().toString(), branding.uuid().toString(),
                fixedFolderUuid(source, FolderScope.GLOBALS_ROOT_UID).toString());

        Fixture target = newFixture("glb_full_tgt", "Globals Full Store Target");
        UUID targetGlobalsRoot = fixedFolderUuid(target, FolderScope.GLOBALS_ROOT_UID);
        exportImportService.importProject(target.project().getId(), archive, target.ctx(), ImportOptions.DEFAULT);

        assertThat(globalsRoots(target.project().getId()))
                .extracting(Asset::getUuid)
                .as("the archive's root resolved onto the target's own, pre-existing one")
                .containsExactly(targetGlobalsRoot);

        GlobalSetView importedSite =
                globalSetService.find(target.project().getId(), site.uuid(), null).orElseThrow();
        assertThat(importedSite.uid()).isEqualTo("site");
        assertThat(importedSite.contentDefinition()).isEqualTo(GLOBAL_SET_CDL);
        assertThat(importedSite.content().path("title").asText()).isEqualTo("Acme Outdoor");
        assertThat(importedSite.content().path("logo").path("uuid").asText()).isEqualTo(logo.uuid().toString());
        assertThat(importedSite.folderPath()).isEqualTo("/" + FolderScope.GLOBALS_ROOT_UID + "/");

        GlobalSetView importedTheme =
                globalSetService.find(target.project().getId(), theme.uuid(), null).orElseThrow();
        assertThat(importedTheme.uid()).isEqualTo("theme");
        assertThat(importedTheme.content().path("accent").asText()).isEqualTo("#ff6600");
        assertThat(importedTheme.folderPath())
                .as("a set in a nested Globals folder keeps its place")
                .isEqualTo(assetService.requireCurrent(target.project().getId(), branding.uuid()).folderPath())
                .startsWith("/" + FolderScope.GLOBALS_ROOT_UID + "/");

        // Back into the source project: every uuid collides with itself, so every set is
        // overwritten in place and the project still has exactly one Globals root.
        UUID sourceGlobalsRoot = fixedFolderUuid(source, FolderScope.GLOBALS_ROOT_UID);
        exportImportService.importProject(source.project().getId(), archive, source.ctx(), ImportOptions.DEFAULT);
        assertThat(globalsRoots(source.project().getId())).extracting(Asset::getUuid).containsExactly(sourceGlobalsRoot);
        assertThat(uidsByType(source.project().getId(), AssetType.GLOBAL_SET).keySet())
                .containsExactlyInAnyOrder("site", "theme");
        GlobalSetView reimportedSite =
                globalSetService.find(source.project().getId(), site.uuid(), null).orElseThrow();
        assertThat(reimportedSite.contentDefinition()).isEqualTo(GLOBAL_SET_CDL);
        assertThat(reimportedSite.content().path("title").asText()).isEqualTo("Acme Outdoor");
        assertThat(reimportedSite.folderPath()).isEqualTo("/" + FolderScope.GLOBALS_ROOT_UID + "/");
    }

    // ------------------------------------------------------------------
    // M19.1.3 — datasets and records
    // ------------------------------------------------------------------

    private static final String TEAM_CDL = "content {\n"
            + "  editor text name { label \"Name\" }\n"
            + "  editor text role { label \"Role\" }\n"
            + "  editor reference mentor { label \"Mentor\" dataset \"team\" }\n"
            + "}";

    /**
     * The Content store round trip ({@code M19.1.3}): a dataset and three records in nested Content
     * folders move into an empty project with payloads, the dataset link (payload and
     * {@code template_asset_id}), folder paths and reference edges intact.
     */
    @Test
    void contentStoreRoundTripsWithDatasetLinksFoldersAndReferences() {
        Fixture source = newFixture("m19_content", "M19 Content Source");
        com.acme.staticforge.asset.dataset.DatasetView team = datasetService.create(
                new com.acme.staticforge.asset.dataset.CreateDatasetCommand(
                        source.project().getId(), null, "Team", TEAM_CDL, "name", "People"),
                source.ctx());
        AssetVersionView people = folderService.create(null, "People", FolderScope.CONTENT, source.ctx());
        AssetVersionView leads = folderService.create(people.uuid(), "Leads", FolderScope.CONTENT, source.ctx());
        var ada = createRecord(source, team, leads.uuid(), "{\"name\":\"Ada\",\"role\":\"lead\"}");
        var bob = createRecord(source, team, people.uuid(),
                "{\"name\":\"Bob\",\"mentor\":{\"type\":\"ASSET_REF\",\"uuid\":\"" + ada.uuid() + "\",\"assetType\":\"RECORD\"}}");
        var cy = createRecord(source, team, null, "{\"name\":\"Cy\"}");

        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(Set.of(), false, false, Set.of(FolderScope.CONTENT)));
        assertThat(readAssetEntry(archive, team.uuid()).isExplicit())
                .as("the dataset of exported records rides along implicitly")
                .isFalse();
        assertThat(readAssetEntry(archive, bob.uuid()).templateUuid()).isEqualTo(team.uuid().toString());

        Fixture target = newFixture("m19_content_tgt", "M19 Content Target");
        exportImportService.importProject(target.project().getId(), archive, target.ctx(), ImportOptions.DEFAULT);

        long targetId = target.project().getId();
        var importedTeam = datasetService.find(targetId, team.uuid(), null).orElseThrow();
        assertThat(importedTeam.folderPath()).isEqualTo("/templates_root/datasets/");
        assertThat(importedTeam.titleEditor()).isEqualTo("name");
        assertThat(importedTeam.recordCount()).isEqualTo(3);
        var importedBob = recordService.find(targetId, bob.uuid(), null).orElseThrow();
        assertThat(importedBob.datasetUuid()).isEqualTo(team.uuid());
        assertThat(importedBob.recordSetUuid()).as("records keep their record set (M25)").isEqualTo(bob.recordSetUuid());
        assertThat(importedBob.folderPath()).isEqualTo("/people/");
        assertThat(importedBob.content().path("mentor").path("uuid").asText()).isEqualTo(ada.uuid().toString());
        assertThat(recordService.find(targetId, ada.uuid(), null).orElseThrow().folderPath()).isEqualTo("/people/leads/");
        assertThat(recordService.find(targetId, cy.uuid(), null).orElseThrow().folderPath()).isEqualTo("/");

        long teamId = assetRepository.findByProjectIdAndUuid(targetId, team.uuid()).orElseThrow().getId();
        assertThat(assetVersionRepository.findCurrentRecordsOfDataset(targetId, teamId))
                .extracting(v -> v.getAsset().getUuid())
                .containsExactlyInAnyOrder(ada.uuid(), bob.uuid(), cy.uuid());
        long bobId = assetRepository.findByProjectIdAndUuid(targetId, bob.uuid()).orElseThrow().getId();
        long adaId = assetRepository.findByProjectIdAndUuid(targetId, ada.uuid()).orElseThrow().getId();
        assertThat(assetReferenceRepository.findByFromAssetIdAndValidToRevisionIsNull(bobId))
                .extracting(com.acme.staticforge.asset.AssetReference::getKind, com.acme.staticforge.asset.AssetReference::getToAssetId)
                .containsExactlyInAnyOrder(
                        org.assertj.core.groups.Tuple.tuple(com.acme.staticforge.asset.ReferenceKind.TEMPLATE, teamId),
                        org.assertj.core.groups.Tuple.tuple(com.acme.staticforge.asset.ReferenceKind.CONTENT_REF, adaId));
        assertThat(assetRepository.findAll().stream()
                        .filter(a -> java.util.Objects.equals(a.getProjectId(), targetId) && FolderScope.CONTENT_ROOT_UID.equals(a.getUid())))
                .as("the archive's Content root remapped onto the target's own")
                .hasSize(1);
    }

    /**
     * Exporting one record includes its record set and dataset as implicit picks (M19.1.3, M25.4.1);
     * importing back into a project that already has them with "skip existing implicit" leaves both
     * untouched and puts the record into the existing set.
     */
    @Test
    void aSingleRecordExportCarriesItsSetAndDatasetImplicitly() {
        Fixture source = newFixture("m19_single", "M19 Single Record Source");
        var team = datasetService.create(
                new com.acme.staticforge.asset.dataset.CreateDatasetCommand(source.project().getId(), null, "Team", TEAM_CDL, null, null),
                source.ctx());
        var ada = createRecord(source, team, null, "{\"name\":\"Ada\"}");

        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(Set.of(ada.uuid()), false, false, Set.of()));
        assertThat(readAssetEntry(archive, ada.uuid()).isExplicit()).isTrue();
        assertThat(readAssetEntry(archive, ada.uuid()).parentFolderUuid()).isEqualTo(ada.recordSetUuid().toString());
        assertThat(readAssetEntry(archive, ada.recordSetUuid()).isExplicit()).as("the record's set is implicit").isFalse();
        assertThat(readAssetEntry(archive, ada.recordSetUuid()).templateUuid()).isEqualTo(team.uuid().toString());
        assertThat(readAssetEntry(archive, team.uuid()).isExplicit()).isFalse();
        assertThat(parseAssets(archive).stream().map(ExportedAsset::uid))
                .contains(FolderScope.DATASETS_UID, FolderScope.TEMPLATES_ROOT_UID, FolderScope.CONTENT_ROOT_UID);

        long datasetRevision = datasetService.find(source.project().getId(), team.uuid(), null).orElseThrow().revision();
        long setRevision = recordSetService.find(source.project().getId(), ada.recordSetUuid(), null).orElseThrow().revision();
        ImportOptions skip = new ImportOptions(true);
        assertThat(exportImportService.analyzeImport(source.project().getId(), archive, skip).conflicts())
                .extracting(ImportConflict::elementUuid)
                .doesNotContain(team.uuid().toString(), ada.recordSetUuid().toString());
        exportImportService.importProject(source.project().getId(), archive, source.ctx(), skip);
        assertThat(datasetService.find(source.project().getId(), team.uuid(), null).orElseThrow().revision())
                .as("the implicit, existing dataset was skipped, not overwritten")
                .isEqualTo(datasetRevision);
        assertThat(recordSetService.find(source.project().getId(), ada.recordSetUuid(), null).orElseThrow().revision())
                .as("the implicit, existing record set was skipped, not overwritten")
                .isEqualTo(setRevision);
        assertThat(recordService.find(source.project().getId(), ada.uuid(), null).orElseThrow().recordSetUuid())
                .isEqualTo(ada.recordSetUuid());

        Fixture fresh = newFixture("m19_single_tgt", "M19 Single Record Target");
        exportImportService.importProject(fresh.project().getId(), archive, fresh.ctx(), skip);
        assertThat(recordService.find(fresh.project().getId(), ada.uuid(), null).orElseThrow().datasetUid()).isEqualTo("team");
    }

    /**
     * A record whose dataset is neither in the archive nor in the target is {@code RECORD_DATASET_MISSING}, its
     * set {@code RECORD_SET_DATASET_MISSING} (M25.4.1) — both block the import.
     */
    @Test
    void aRecordAndItsSetWithoutTheirDatasetAreBlockingConflicts() {
        Fixture source = newFixture("m19_missing", "M19 Missing Dataset Source");
        var team = datasetService.create(
                new com.acme.staticforge.asset.dataset.CreateDatasetCommand(source.project().getId(), null, "Team", TEAM_CDL, null, null),
                source.ctx());
        var ada = createRecord(source, team, null, "{\"name\":\"Ada\"}");
        byte[] archive = withoutEntry(
                exportImportService.exportSelection(
                        source.project().getId(), new ExportSelection(Set.of(ada.uuid()), false, false, Set.of())),
                "assets/" + team.uuid() + ".json");

        Fixture target = newFixture("m19_missing_tgt", "M19 Missing Dataset Target");
        ConflictReport report = exportImportService.analyzeImport(target.project().getId(), archive, ImportOptions.DEFAULT);
        assertThat(report.conflicts())
                .filteredOn(c -> c.type() == ConflictType.RECORD_DATASET_MISSING
                        || c.type() == ConflictType.RECORD_SET_DATASET_MISSING)
                .extracting(ImportConflict::type, ImportConflict::elementUuid, ImportConflict::severity)
                .containsExactlyInAnyOrder(
                        org.assertj.core.groups.Tuple.tuple(
                                ConflictType.RECORD_DATASET_MISSING, ada.uuid().toString(), ConflictSeverity.BLOCKING),
                        org.assertj.core.groups.Tuple.tuple(
                                ConflictType.RECORD_SET_DATASET_MISSING, ada.recordSetUuid().toString(), ConflictSeverity.BLOCKING));
        assertThat(report.blocksImport()).isTrue();
        assertThat(report.conflicts()).noneMatch(c -> c.type() == ConflictType.MISSING_TEMPLATE_REFERENCE);
        assertThatThrownBy(() -> exportImportService.importProject(
                        target.project().getId(), archive, target.ctx(), ImportOptions.DEFAULT))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(409));

        // The same archive into the source project, where the dataset exists: no conflict, and the
        // record links to the existing dataset.
        assertThat(exportImportService.analyzeImport(source.project().getId(), archive, ImportOptions.DEFAULT).conflicts())
                .noneMatch(c -> c.type() == ConflictType.RECORD_DATASET_MISSING
                        || c.type() == ConflictType.RECORD_SET_DATASET_MISSING);
        exportImportService.importProject(source.project().getId(), archive, source.ctx(), ImportOptions.DEFAULT);
        long teamId = assetRepository.findByProjectIdAndUuid(source.project().getId(), team.uuid()).orElseThrow().getId();
        assertThat(assetVersionRepository.findCurrentRecordsOfDataset(source.project().getId(), teamId))
                .extracting(v -> v.getAsset().getUuid())
                .containsExactly(ada.uuid());
    }

    /** Record and dataset diffs are the generic payload diff: content fields and the CDL source. */
    @Test
    void recordAndDatasetDiffsShowTheChangedFields() {
        Fixture source = newFixture("m19_diff", "M19 Diff");
        var team = datasetService.create(
                new com.acme.staticforge.asset.dataset.CreateDatasetCommand(source.project().getId(), null, "Team", TEAM_CDL, null, null),
                source.ctx());
        var ada = createRecord(source, team, null, "{\"name\":\"Ada\",\"role\":\"dev\"}");
        var updated = recordService.update(ada.uuid(), json("{\"name\":\"Ada\",\"role\":\"lead\"}"), ada.revision(), source.ctx()).record();

        AssetDiff recordDiff = onlyAssetDiff(diffService.diff(source.project().getId(), updated.revision()));
        assertThat(recordDiff.type()).isEqualTo("RECORD");
        assertThat(recordDiff.changes()).extracting(FieldChange::path).containsExactly("content.role");

        var retyped = datasetService.update(team.uuid(),
                new com.acme.staticforge.asset.dataset.UpdateDatasetCommand("Team", TEAM_CDL.replace("\"Role\"", "\"Position\""), null, null),
                team.revision(), source.ctx());
        AssetDiff datasetDiff = onlyAssetDiff(diffService.diff(source.project().getId(), retyped.revision()));
        assertThat(datasetDiff.type()).isEqualTo("DATASET");
        assertThat(datasetDiff.changes()).extracting(FieldChange::path).contains("contentDefinition");
    }

    // ------------------------------------------------------------------
    // M25.4.1 — record sets in archives
    // ------------------------------------------------------------------

    private static final String SET_TEAM_CDL =
            """
            content {
              editor text name { label "Name" required }
              editor select role { label "Role" options [ { value "lead", label "Lead" }, { value "dev", label "Developer" } ] }
              editor date joined { label "Joined" }
            }
            """;

    private static final String SET_RECORD_HTML = "<li>$CMS_VALUE(name)$ ($CMS_VALUE(_index)$/$CMS_VALUE(_count)$)</li>";
    private static final String SET_RECORD_MD = "- $CMS_VALUE(name)$ ($CMS_VALUE(role)$)\n";
    private static final String SET_PAGE_CDL =
            "content { editor reference featured { label \"Featured\" assetTypes [RECORD_SET] dataset \"team\" } }";
    private static final String SET_PAGE_HTML =
            "<section>$CMS_VALUE(recordset:leads)$</section><p>$CMS_VALUE(recordset:leads._count)$</p>"
                    + "<div>$CMS_VALUE(featured)$</div>"
                    + "<ol>$CMS_FOR(m : featured, sort=\"-name\", limit=1)$<li>$CMS_VALUE(m.name)$</li>$CMS_END_FOR$</ol>";
    private static final String SET_PAGE_MD = "# Team\n\n$CMS_VALUE(recordset:leads)$\n$CMS_VALUE(featured)$";

    /** The checked-in pre-M25 archive: dataset {@code team}, records Ada and Bob in Content folder People, Cy in the root. */
    private static final String PROTOCOL_6_ARCHIVE = "exportimport/protocol-6-records-outside-sets";

    private static final UUID FIXTURE_ADA = UUID.fromString("3db03ec7-d871-4926-a16e-de386a051e34");
    private static final UUID FIXTURE_BOB = UUID.fromString("7273d992-3c17-4a18-bddb-01ed37c79f2e");
    private static final UUID FIXTURE_CY = UUID.fromString("40ee4399-d72e-431a-a9c2-2f9c3855aaf3");
    private static final UUID FIXTURE_TEAM = UUID.fromString("d5ebd057-7f51-4a70-87ac-4ed885780831");
    private static final UUID FIXTURE_PEOPLE = UUID.fromString("ac5685e3-8aa5-4c25-b978-baae20dc37cd");
    private static final UUID FIXTURE_PAGE = UUID.fromString("f6722bba-368d-45b3-b521-5e1c74bfe159");

    /**
     * The acceptance round trip: dataset {@code team} with an html and a md record template, sets {@code leads}
     * ({@code People/Leads}, query) and {@code staff} ({@code People}, query), five records, and a page rendering
     * {@code recordset:leads} and its {@code featured} reference editor → {@code staff} — into an empty project.
     * Payloads, queries, dataset links, parents, folder paths and reference rows survive; FULL generation of both
     * projects writes identical files.
     */
    @Test
    void recordSetsRoundTripIntoAnEmptyProjectAndGenerateIdenticalOutput() throws Exception {
        Fixture source = newFixture("m25_rt", "M25 Round Trip Source");
        long sourceId = source.project().getId();
        SetSite site = setSite(source);

        byte[] archive = exportImportService.exportProject(sourceId);
        Fixture target = newFixture("m25_rt_tgt", "M25 Round Trip Target");
        long targetId = target.project().getId();
        assertThat(exportImportService.analyzeImport(targetId, archive, ImportOptions.DEFAULT).conflicts())
                .as("nothing blocks, no set query is flagged")
                .noneMatch(c -> c.severity() == ConflictSeverity.BLOCKING || c.type() == ConflictType.RECORD_SET_QUERY_INVALID);
        exportImportService.importProject(targetId, archive, target.ctx(), ImportOptions.DEFAULT);

        var sourceTeam = datasetService.find(sourceId, site.team(), null).orElseThrow();
        var importedTeam = datasetService.find(targetId, site.team(), null).orElseThrow();
        assertThat(importedTeam.channelTemplates()).as("record templates travel in the payload").isEqualTo(sourceTeam.channelTemplates());
        assertThat(importedTeam.channelTemplates().path("md").path("source").asText()).isEqualTo(SET_RECORD_MD);
        assertThat(importedTeam.recordCount()).isEqualTo(5);

        for (UUID set : List.of(site.leads(), site.staff())) {
            var before = recordSetService.find(sourceId, set, null).orElseThrow();
            var after = recordSetService.find(targetId, set, null).orElseThrow();
            assertThat(after)
                    .extracting(v -> v.uid(), v -> v.displayName(), v -> v.datasetUuid(), v -> v.folderUuid(), v -> v.folderPath(),
                            v -> v.query(), v -> v.queryValid(), v -> v.recordCount())
                    .containsExactly(before.uid(), before.displayName(), before.datasetUuid(), before.folderUuid(),
                            before.folderPath(), before.query(), true, before.recordCount());
        }
        assertThat(recordSetService.find(targetId, site.leads(), null).orElseThrow().folderPath()).isEqualTo("/people/leads/");
        for (UUID record : site.records()) {
            var before = recordService.find(sourceId, record, null).orElseThrow();
            var after = recordService.find(targetId, record, null).orElseThrow();
            assertThat(after)
                    .extracting(v -> v.uid(), v -> v.datasetUuid(), v -> v.recordSetUuid(), v -> v.folderUuid(), v -> v.folderPath(),
                            v -> v.content())
                    .containsExactly(before.uid(), before.datasetUuid(), before.recordSetUuid(), before.folderUuid(),
                            before.folderPath(), before.content());
        }
        long pageId = assetRepository.findByProjectIdAndUuid(targetId, site.page()).orElseThrow().getId();
        long staffId = assetRepository.findByProjectIdAndUuid(targetId, site.staff()).orElseThrow().getId();
        assertThat(assetReferenceRepository.findByFromAssetIdAndValidToRevisionIsNull(pageId))
                .as("the page's reference editor still points at the set")
                .anySatisfy(ref -> {
                    assertThat(ref.getKind()).isEqualTo(com.acme.staticforge.asset.ReferenceKind.CONTENT_REF);
                    assertThat(ref.getToAssetId()).isEqualTo(staffId);
                });

        Map<String, String> sourceOutput = generatedFiles(source);
        assertThat(sourceOutput.get("team.html"))
                .isEqualTo("<section><li>Ada (0/2)</li><li>Dee (1/2)</li></section><p>2</p>"
                        + "<div><li>Bob (0/2)</li><li>Cy (1/2)</li></div><ol><li>Cy</li></ol>");
        assertThat(sourceOutput.get("team.md")).contains("- Ada (lead)", "- Bob (dev)");
        assertThat(generatedFiles(target)).as("generated output identical to the source project").isEqualTo(sourceOutput);
    }

    /**
     * Picking a record set exports it with its live records (container semantics, like a folder), its dataset
     * implicitly, and nothing of another set.
     */
    @Test
    void pickingARecordSetExportsItsRecordsAndItsDatasetImplicitly() {
        Fixture source = newFixture("m25_pick", "M25 Set Pick");
        SetSite site = setSite(source);

        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(Set.of(site.leads()), false, false, Set.of()));
        Map<String, Boolean> explicitByUid = parseAssets(archive).stream()
                .filter(a -> !"FOLDER".equals(a.type()))
                .collect(Collectors.toMap(a -> a.type() + ":" + a.uid(), ExportedAsset::isExplicit));
        // Ada, Dee and Eve are the leads set's records; a record's uid is its uuid in uid form.
        java.util.function.Function<UUID, String> recordKey = uuid -> "RECORD:" + uuid.toString().replace('-', '_');
        assertThat(explicitByUid).containsExactlyInAnyOrderEntriesOf(Map.of(
                "RECORD_SET:leads", true,
                recordKey.apply(site.records().get(0)), true,
                recordKey.apply(site.records().get(1)), true,
                recordKey.apply(site.records().get(2)), true,
                "DATASET:team", false));
        assertThat(parseAssets(archive).stream().filter(a -> "FOLDER".equals(a.type())).map(ExportedAsset::uid))
                .as("the set's folders ride along as ancestors")
                .contains("people", "leads", FolderScope.CONTENT_ROOT_UID);
    }

    /**
     * {@code RECORD_SET_MISSING}: a record whose set is neither in the archive nor in the target blocks the import;
     * the same archive imports into a project that has the set, and the record joins it.
     */
    @Test
    void aRecordWhoseSetIsMissingIsABlockingConflictUnlessTheTargetHasTheSet() {
        Fixture source = newFixture("m25_noset", "M25 Missing Set");
        var team = datasetService.create(
                new com.acme.staticforge.asset.dataset.CreateDatasetCommand(source.project().getId(), null, "Team", TEAM_CDL, null, null),
                source.ctx());
        var ada = createRecord(source, team, null, "{\"name\":\"Ada\"}");
        byte[] archive = ArchiveFixtures.withoutEntry(
                exportImportService.exportSelection(
                        source.project().getId(), new ExportSelection(Set.of(ada.uuid()), false, false, Set.of())),
                "assets/" + ada.recordSetUuid() + ".json");

        Fixture target = newFixture("m25_noset_tgt", "M25 Missing Set Target");
        ConflictReport report = exportImportService.analyzeImport(target.project().getId(), archive, ImportOptions.DEFAULT);
        assertThat(report.conflicts())
                .filteredOn(c -> c.severity() == ConflictSeverity.BLOCKING)
                .extracting(ImportConflict::type, ImportConflict::elementUuid)
                .containsExactly(org.assertj.core.groups.Tuple.tuple(ConflictType.RECORD_SET_MISSING, ada.uuid().toString()));
        assertThat(report.blocksImport()).isTrue();
        assertThatThrownBy(() -> exportImportService.importProject(
                        target.project().getId(), archive, target.ctx(), ImportOptions.DEFAULT))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(409));
        assertThat(assetRepository.findByProjectIdAndUuid(target.project().getId(), ada.uuid())).isEmpty();

        // Into the source project, which has the set: no conflict, the record keeps its set and folder path.
        var edited = recordService.update(ada.uuid(), json("{\"name\":\"Ada Lovelace\"}"), ada.revision(), source.ctx()).record();
        assertThat(exportImportService.analyzeImport(source.project().getId(), archive, ImportOptions.DEFAULT).conflicts())
                .noneMatch(c -> c.severity() == ConflictSeverity.BLOCKING);
        exportImportService.importProject(source.project().getId(), archive, source.ctx(), ImportOptions.DEFAULT);
        var restored = recordService.find(source.project().getId(), ada.uuid(), null).orElseThrow();
        assertThat(restored.content().path("name").asText()).isEqualTo("Ada");
        assertThat(restored.recordSetUuid()).isEqualTo(edited.recordSetUuid());
        assertThat(restored.folderPath()).isEqualTo(edited.folderPath());
    }

    /**
     * {@code RECORD_SET_DATASET_MISMATCH}: a record whose {@code datasetRef} is another dataset than its set's, and a
     * set that would overwrite a target set of another dataset, both block the import (a set's dataset never
     * changes; records never merge into a set of another dataset).
     */
    @Test
    void aRecordOrSetOfAnotherDatasetThanItsSetIsABlockingConflict() {
        Fixture source = newFixture("m25_mismatch", "M25 Dataset Mismatch");
        long sourceId = source.project().getId();
        var team = datasetService.create(
                new com.acme.staticforge.asset.dataset.CreateDatasetCommand(sourceId, null, "Team", TEAM_CDL, null, null), source.ctx());
        var faq = datasetService.create(
                new com.acme.staticforge.asset.dataset.CreateDatasetCommand(
                        sourceId, null, "FAQ", "content { editor text name { label \"Question\" } }", null, null),
                source.ctx());
        var ada = createRecord(source, team, null, "{\"name\":\"Ada\"}");
        byte[] archive = exportImportService.exportSelection(
                sourceId, new ExportSelection(Set.of(ada.recordSetUuid(), faq.uuid()), false, false, Set.of()));

        byte[] recordOfFaq = ArchiveFixtures.editAsset(archive, ada.uuid(), asset -> {
            ((ObjectNode) asset.get("payload")).put("datasetRef", faq.uuid().toString());
            asset.put("templateUuid", faq.uuid().toString());
        });
        Fixture target = newFixture("m25_mismatch_tgt", "M25 Dataset Mismatch Target");
        ConflictReport report = exportImportService.analyzeImport(target.project().getId(), recordOfFaq, ImportOptions.DEFAULT);
        assertThat(report.conflicts())
                .filteredOn(c -> c.severity() == ConflictSeverity.BLOCKING)
                .extracting(ImportConflict::type, ImportConflict::elementUuid)
                .containsExactly(org.assertj.core.groups.Tuple.tuple(ConflictType.RECORD_SET_DATASET_MISMATCH, ada.uuid().toString()));
        assertThatThrownBy(() -> exportImportService.importProject(
                        target.project().getId(), recordOfFaq, target.ctx(), ImportOptions.DEFAULT))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(409));
        assertThat(assetRepository.findByProjectIdAndUuid(target.project().getId(), ada.uuid())).isEmpty();

        byte[] setOfFaq = ArchiveFixtures.editAsset(archive, ada.recordSetUuid(), asset -> {
            ((ObjectNode) asset.get("payload")).put("datasetRef", faq.uuid().toString());
            asset.put("templateUuid", faq.uuid().toString());
        });
        ConflictReport overwrite = exportImportService.analyzeImport(sourceId, setOfFaq, ImportOptions.DEFAULT);
        assertThat(overwrite.conflicts())
                .filteredOn(c -> c.type() == ConflictType.RECORD_SET_DATASET_MISMATCH)
                .extracting(ImportConflict::elementUuid)
                .as("the set would change its dataset; its record no longer matches it")
                .containsExactlyInAnyOrder(ada.recordSetUuid().toString(), ada.uuid().toString());
        long head = recordSetService.find(sourceId, ada.recordSetUuid(), null).orElseThrow().revision();
        assertThatThrownBy(() -> exportImportService.importProject(sourceId, setOfFaq, source.ctx(), ImportOptions.DEFAULT))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(409));
        assertThat(recordSetService.find(sourceId, ada.recordSetUuid(), null).orElseThrow())
                .extracting(v -> v.datasetUuid(), v -> v.revision())
                .containsExactly(team.uuid(), head);
    }

    /**
     * A target set with the same uid but another dataset is an ordinary uid collision: the archive's set arrives
     * under a derived uid with its own records; nothing merges into the target's set.
     */
    @Test
    void aSetWhoseUidIsTakenByASetOfAnotherDatasetImportsUnderADerivedUid() {
        Fixture source = newFixture("m25_uid", "M25 Set Uid");
        SetSite site = setSite(source);
        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(Set.of(site.leads()), false, false, Set.of()));

        Fixture target = newFixture("m25_uid_tgt", "M25 Set Uid Target");
        long targetId = target.project().getId();
        var faq = datasetService.create(
                new com.acme.staticforge.asset.dataset.CreateDatasetCommand(
                        targetId, null, "FAQ", "content { editor text name { label \"Question\" } }", null, null),
                target.ctx());
        var theirs = recordSetService.create(new com.acme.staticforge.asset.dataset.CreateRecordSetCommand(
                        targetId, null, faq.uuid(), "leads", "Leads", com.acme.staticforge.template.query.RecordSetQuery.ALL),
                target.ctx());
        assertThat(exportImportService.analyzeImport(targetId, archive, ImportOptions.DEFAULT).hasBlocking()).isFalse();
        exportImportService.importProject(targetId, archive, target.ctx(), ImportOptions.DEFAULT);

        var imported = recordSetService.find(targetId, site.leads(), null).orElseThrow();
        assertThat(imported.uid()).isNotEqualTo("leads").startsWith("leads");
        assertThat(imported.datasetUuid()).isEqualTo(site.team());
        assertThat(imported.recordCount()).isEqualTo(3);
        assertThat(recordSetService.find(targetId, theirs.uuid(), null).orElseThrow())
                .extracting(v -> v.uid(), v -> v.datasetUuid(), v -> v.recordCount())
                .containsExactly("leads", faq.uuid(), 0L);
    }

    /**
     * A set's stored query is re-validated against the schema it gets in the target — the archive's dataset, or
     * the existing one when that is reused. A query that doesn't fit imports unchanged, reads {@code queryValid:
     * false}, and is a warning in {@code analyze}, never a blocker.
     */
    @Test
    void aSetQueryThatDoesNotFitTheTargetSchemaImportsFlaggedWithAWarning() {
        Fixture source = newFixture("m25_query", "M25 Set Query");
        long sourceId = source.project().getId();
        SetSite site = setSite(source);
        byte[] archive = exportImportService.exportSelection(sourceId, new ExportSelection(Set.of(site.leads()), false, false, Set.of()));

        // 1. The archive's own dataset: a hand-edited query on an undeclared field.
        byte[] edited = ArchiveFixtures.editAsset(archive, site.leads(),
                asset -> ((ObjectNode) asset.get("payload").get("query")).put("where", "nickname == 'x'"));
        Fixture target = newFixture("m25_query_tgt", "M25 Set Query Target");
        long targetId = target.project().getId();
        ConflictReport report = exportImportService.analyzeImport(targetId, edited, ImportOptions.DEFAULT);
        assertThat(report.hasBlocking()).isFalse();
        assertThat(report.conflicts())
                .filteredOn(c -> c.type() == ConflictType.RECORD_SET_QUERY_INVALID)
                .singleElement()
                .satisfies(c -> {
                    assertThat(c.severity()).isEqualTo(ConflictSeverity.WARNING);
                    assertThat(c.elementUuid()).isEqualTo(site.leads().toString());
                    assertThat(c.detail()).contains("nickname");
                });
        exportImportService.importProject(targetId, edited, target.ctx(), ImportOptions.DEFAULT);
        var imported = recordSetService.find(targetId, site.leads(), null).orElseThrow();
        assertThat(imported.queryValid()).isFalse();
        assertThat(imported.query().where()).isEqualTo("nickname == 'x'");
        assertThat(imported.recordCount()).isEqualTo(3);

        // 2. The target's existing dataset, reused as an implicit pick, no longer declares the field the query reads.
        var team = datasetService.find(sourceId, site.team(), null).orElseThrow();
        datasetService.update(site.team(),
                new com.acme.staticforge.asset.dataset.UpdateDatasetCommand(
                        "Team", SET_TEAM_CDL.replace("editor date joined { label \"Joined\" }", ""), "name", null),
                team.revision(), source.ctx());
        ImportOptions skip = new ImportOptions(true);
        assertThat(exportImportService.analyzeImport(sourceId, archive, skip).conflicts())
                .filteredOn(c -> c.type() == ConflictType.RECORD_SET_QUERY_INVALID)
                .extracting(ImportConflict::elementUuid)
                .containsExactly(site.leads().toString());
        exportImportService.importProject(sourceId, archive, source.ctx(), skip);
        assertThat(recordSetService.find(sourceId, site.leads(), null).orElseThrow().queryValid()).isFalse();
    }

    /**
     * {@code RECORD_OUTSIDE_RECORD_SET} (epic decision 8): the checked-in protocol-6 archive — records in a Content
     * folder and in the Content root, a page whose reference editor points at one of them — lists one conflict per
     * record. They block only themselves: the import creates none of them, no set, and everything else.
     */
    @Test
    void aProtocol6ArchiveRejectsItsRecordsOutsideSetsAndImportsEverythingElse() {
        byte[] archive = ArchiveFixtures.zipResourceDirectory(PROTOCOL_6_ARCHIVE);
        assertThat(parseManifest(archive).protocolVersion()).isEqualTo(6);
        Fixture target = newFixture("m25_p6", "M25 Protocol 6 Target");
        long targetId = target.project().getId();

        ConflictReport report = exportImportService.analyzeImport(targetId, archive, ImportOptions.DEFAULT);
        assertThat(report.conflicts())
                .filteredOn(c -> c.severity() == ConflictSeverity.BLOCKING)
                .extracting(ImportConflict::type, ImportConflict::elementUuid)
                .containsExactlyInAnyOrder(
                        org.assertj.core.groups.Tuple.tuple(ConflictType.RECORD_OUTSIDE_RECORD_SET, FIXTURE_ADA.toString()),
                        org.assertj.core.groups.Tuple.tuple(ConflictType.RECORD_OUTSIDE_RECORD_SET, FIXTURE_BOB.toString()),
                        org.assertj.core.groups.Tuple.tuple(ConflictType.RECORD_OUTSIDE_RECORD_SET, FIXTURE_CY.toString()));
        assertThat(report.hasBlocking()).isTrue();
        assertThat(report.blocksImport()).as("they reject only themselves").isFalse();
        assertThat(report.conflicts()).allSatisfy(c -> assertThat(c.blocksImport()).isFalse());

        ImportResult result = exportImportService.importProject(targetId, archive, target.ctx(), ImportOptions.DEFAULT);
        assertThat(uidsByType(targetId, AssetType.RECORD)).as("no record imported").isEmpty();
        assertThat(uidsByType(targetId, AssetType.RECORD_SET)).as("no set invented for them").isEmpty();
        for (UUID record : List.of(FIXTURE_ADA, FIXTURE_BOB, FIXTURE_CY)) {
            assertThat(assetRepository.findByProjectIdAndUuid(targetId, record)).isEmpty();
        }
        assertThat(datasetService.find(targetId, FIXTURE_TEAM, null).orElseThrow().recordCount()).isZero();
        assertThat(assetRepository.findByProjectIdAndUuid(targetId, FIXTURE_PEOPLE)).isPresent();
        assertThat(assetRepository.findByProjectIdAndUuid(targetId, FIXTURE_PAGE)).isPresent();
        assertThat(uidsByType(targetId, AssetType.PAGE_TEMPLATE)).containsKey("team_page");
        assertThat(result.importedAssetCount()).as("dataset, People folder, page template and page").isEqualTo(4);
    }

    /**
     * Dataset {@code team} (html + md record templates); Content folders {@code People} and {@code People/Leads};
     * set {@code leads} in {@code Leads} (leads, newest first: Ada, Dee — Eve is a developer) and {@code staff} in
     * {@code People} (by name: Bob, Cy); a page rendering {@code recordset:leads} and its {@code featured}
     * reference editor → {@code staff}, in both channels.
     */
    private SetSite setSite(Fixture fx) {
        long projectId = fx.project().getId();
        channelService.create(
                new CreateChannelRequest("md", "Markdown", "md", "text/markdown", "MARKDOWN", true, false, 1, null, null), fx.ctx());
        var team = datasetService.create(
                new com.acme.staticforge.asset.dataset.CreateDatasetCommand(
                        projectId, null, "Team", SET_TEAM_CDL, "name", null, Map.of("html", SET_RECORD_HTML, "md", SET_RECORD_MD)),
                fx.ctx());
        AssetVersionView people = folderService.create(null, "People", FolderScope.CONTENT, fx.ctx());
        AssetVersionView leadsFolder = folderService.create(people.uuid(), "Leads", FolderScope.CONTENT, fx.ctx());
        UUID leads = recordSetService.create(new com.acme.staticforge.asset.dataset.CreateRecordSetCommand(
                        projectId, leadsFolder.uuid(), team.uuid(), "leads", "Leads",
                        new com.acme.staticforge.template.query.RecordSetQuery("role == 'lead'", "-joined", null, null)),
                        fx.ctx())
                .uuid();
        UUID staff = recordSetService.create(new com.acme.staticforge.asset.dataset.CreateRecordSetCommand(
                        projectId, people.uuid(), team.uuid(), "staff", "Staff",
                        new com.acme.staticforge.template.query.RecordSetQuery(null, "name", 5, null)),
                        fx.ctx())
                .uuid();
        List<UUID> records = List.of(
                setRecord(fx, leads, "{\"name\":\"Ada\",\"role\":\"lead\",\"joined\":\"2021-03-01\"}"),
                setRecord(fx, leads, "{\"name\":\"Dee\",\"role\":\"lead\",\"joined\":\"2019-05-05\"}"),
                setRecord(fx, leads, "{\"name\":\"Eve\",\"role\":\"dev\",\"joined\":\"2024-02-02\"}"),
                setRecord(fx, staff, "{\"name\":\"Bob\",\"role\":\"dev\",\"joined\":\"2023-07-15\"}"),
                setRecord(fx, staff, "{\"name\":\"Cy\",\"role\":\"dev\",\"joined\":\"2022-11-30\"}"));

        TemplateView template = templateService.create(
                new CreateTemplateCommand(projectId, AssetType.PAGE_TEMPLATE, "Team Page", SET_PAGE_CDL,
                        Map.of("html", SET_PAGE_HTML, "md", SET_PAGE_MD), null, false,
                        Map.of("html", "{displayNameSlug}.{ext}", "md", "{displayNameSlug}.{ext}")),
                fx.ctx());
        AssetVersionView page = pageService.create(
                new com.acme.staticforge.asset.page.CreatePageCommand("Team", null, template.uuid()), fx.ctx());
        ObjectNode payload = page.payload().deepCopy();
        payload.putObject("content").set("featured", MAPPER.createObjectNode()
                .put("type", "ASSET_REF").put("uuid", staff.toString()).put("assetType", "RECORD_SET"));
        pageService.update(page.uuid(), payload, page.validFromRevision(), fx.ctx());
        return new SetSite(team.uuid(), leads, staff, records, page.uuid());
    }

    private record SetSite(UUID team, UUID leads, UUID staff, List<UUID> records, UUID page) {}

    private UUID setRecord(Fixture fx, UUID set, String content) {
        return recordService.create(
                        new com.acme.staticforge.asset.dataset.CreateRecordCommand(fx.project().getId(), set, json(content)),
                        fx.ctx())
                .record()
                .uuid();
    }

    /** Runs a FULL generation of every channel into a new filesystem target; the build's files by relative path. */
    private Map<String, String> generatedFiles(Fixture fx) throws Exception {
        GenerationTarget target = generationTargetRepository.save(new GenerationTarget(
                fx.project().getId(), "m25-output", TargetType.FILESYSTEM,
                MAPPER.readTree("{\"baseUrl\":\"https://example.com\"}"), false));
        releaseFixtures.releaseAll(fx.project().getKey());
        GenerationRun started = generationService.start(
                fx.project().getKey(),
                new GenerationRequest(GenerationMode.FULL, null, List.of("html", "md"), target.getId(), null, null, null, null),
                fx.user().getId());
        GenerationRun run = started;
        long deadline = System.currentTimeMillis() + 60_000;
        while (!Set.of(RunStatus.SUCCESS, RunStatus.PARTIAL, RunStatus.FAILED, RunStatus.CANCELLED).contains(run.getStatus())
                && System.currentTimeMillis() < deadline) {
            Thread.sleep(100);
            run = generationService.status(fx.project().getKey(), started.getId());
        }
        assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        Path build = TargetLocations.resolve(outputRoot, fx.project().getKey(), target)
                .resolve("builds")
                .resolve(String.valueOf(run.getId()));
        Map<String, String> files = new java.util.TreeMap<>();
        try (java.util.stream.Stream<Path> walk = Files.walk(build)) {
            for (Path file : walk.filter(Files::isRegularFile).toList()) {
                String name = build.relativize(file).toString().replace('\\', '/');
                if (name.endsWith(".html") || name.endsWith(".md")) {
                    files.put(name, Files.readString(file));
                }
            }
        }
        return files;
    }

    /** A record in the record set of {@code dataset} in {@code folder} (M25: records always live in a set). */
    private com.acme.staticforge.asset.dataset.RecordDetail createRecord(
            Fixture fixture, com.acme.staticforge.asset.dataset.DatasetView dataset, UUID folder, String content) {
        JsonNode values = json(content);
        UUID set = new RecordSetFixtures(recordSetService).setFor(fixture.project().getId(), dataset.uuid(), folder, fixture.ctx());
        return recordService.create(
                        new com.acme.staticforge.asset.dataset.CreateRecordCommand(
                                fixture.project().getId(), set, values),
                        fixture.ctx())
                .record();
    }

    private static JsonNode json(String content) {
        try {
            return MAPPER.readTree(content);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static byte[] withoutEntry(byte[] archiveBytes, String entryName) {
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archiveBytes));
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                java.util.zip.ZipOutputStream zipOut = new java.util.zip.ZipOutputStream(out)) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                byte[] bytes = zip.readAllBytes();
                if (entryName.equals(entry.getName())) {
                    continue;
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

    /**
     * A set whose media value wasn't selected must behave exactly like a page whose image wasn't
     * selected (`M17.1.3`): the referential-integrity rules are type-agnostic, and a set must not
     * quietly get a stricter or laxer treatment than a page. Rather than restating what that
     * treatment is, the test builds both situations side by side and asserts the reports agree.
     */
    @Test
    void aSetWithAnUnselectedMediaIsReportedExactlyLikeAPageWithOne() {
        Fixture source = newFixture("glb_media", "Globals Missing Media Source");
        AssetVersionView media = mediaService.upload(
                source.project().getId(), null, "logo.png", "image/png", solidPng(32, 32, Color.BLUE), source.ctx());

        GlobalSetView site = globalSetService.create(
                new CreateGlobalSetCommand(source.project().getId(), null, "Site", GLOBAL_SET_CDL), source.ctx());
        ObjectNode siteValues = MAPPER.createObjectNode();
        siteValues.put("title", "Acme Outdoor");
        siteValues.putObject("logo").put("type", "MEDIA_REF").put("uuid", media.uuid().toString());
        globalSetService.updateValues(site.uuid(), siteValues, site.revision(), source.ctx());

        TemplateView pageTemplate = createPageTemplate(source, "Landing", null);
        ObjectNode pagePayload = MAPPER.createObjectNode();
        pagePayload.put("templateRef", pageTemplate.uuid().toString());
        pagePayload.putObject("content").putObject("heroImage")
                .put("type", "MEDIA_REF")
                .put("uuid", media.uuid().toString());
        AssetVersionView page = assetService.create(
                new CreateAssetCommand(
                        source.project().getId(), AssetType.PAGE, "Home", null, pagePayload, pageTemplate.uuid()),
                source.ctx());

        byte[] setArchive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(Set.of(site.uuid()), false, false, Set.of()));
        byte[] pageArchive = exportImportService.exportSelection(
                source.project().getId(),
                new ExportSelection(Set.of(page.uuid(), pageTemplate.uuid()), false, false, Set.of()));

        assertThat(parseAssets(setArchive)).extracting(ExportedAsset::uuid).doesNotContain(media.uuid().toString());
        assertThat(parseAssets(pageArchive)).extracting(ExportedAsset::uuid).doesNotContain(media.uuid().toString());

        Fixture setTarget = newFixture("glb_media_set", "Globals Missing Media Set Target");
        Fixture pageTarget = newFixture("glb_media_page", "Globals Missing Media Page Target");
        List<ConflictType> setConflicts = conflictTypes(
                exportImportService.analyzeImport(setTarget.project().getId(), setArchive, ImportOptions.DEFAULT));
        List<ConflictType> pageConflicts = conflictTypes(
                exportImportService.analyzeImport(pageTarget.project().getId(), pageArchive, ImportOptions.DEFAULT));
        assertThat(setConflicts).isEqualTo(pageConflicts);

        // And the import itself resolves identically: the dangling MEDIA_REF uuid survives
        // untouched in both, since UuidRemapper leaves values it has no mapping for alone.
        exportImportService.importProject(setTarget.project().getId(), setArchive, setTarget.ctx(), ImportOptions.DEFAULT);
        exportImportService.importProject(
                pageTarget.project().getId(), pageArchive, pageTarget.ctx(), ImportOptions.DEFAULT);
        String setLogo = globalSetService.find(setTarget.project().getId(), site.uuid(), null).orElseThrow()
                .content().path("logo").path("uuid").asText();
        String pageHero = assetService.requireCurrent(pageTarget.project().getId(), page.uuid())
                .payload().path("content").path("heroImage").path("uuid").asText();
        assertThat(setLogo).isEqualTo(pageHero).isEqualTo(media.uuid().toString());
    }

    /**
     * Revision diffs of a set (`M17.1.3`). {@code DiffServiceImpl} is type-agnostic, so this is a
     * verification rather than a feature: a values change must show up as {@code content.*} field
     * changes, and a {@code renamedFrom} schema change must show the {@code contentDefinition} text
     * change <em>and</em> the value migration it caused in the same revision — the reviewable
     * evidence that the two really are one write.
     */
    @Test
    void revisionDiffShowsValueChangesAndASchemaChangeWithItsMigrationInOneRevision() {
        Fixture source = newFixture("glb_diff", "Globals Diff Source");
        GlobalSetView site = globalSetService.create(
                new CreateGlobalSetCommand(source.project().getId(), null, "Site", GLOBAL_SET_CDL), source.ctx());
        GlobalSetView valued = globalSetService.updateValues(
                site.uuid(), MAPPER.createObjectNode().put("title", "Acme Outdoor"), site.revision(), source.ctx());

        AssetDiff valuesDiff = onlyAssetDiff(diffService.diff(source.project().getId(), valued.revision()));
        assertThat(valuesDiff.uuid()).isEqualTo(site.uuid());
        assertThat(valuesDiff.type()).isEqualTo(AssetType.GLOBAL_SET.name());
        assertThat(valuesDiff.changes()).extracting(FieldChange::path)
                .contains("content.title")
                .doesNotContain("contentDefinition");
        assertThat(valuesDiff.changes()).filteredOn(c -> c.path().equals("content.title")).singleElement()
                .satisfies(change -> assertThat(change.after().asText()).isEqualTo("Acme Outdoor"));

        GlobalSetView renamed = globalSetService.updateSchema(
                site.uuid(),
                """
                content {
                  editor text siteTitle { label "Site title" required renamedFrom "title" }
                  editor media logo { label "Logo" }
                }
                """,
                valued.revision(),
                source.ctx());

        AssetDiff schemaDiff = onlyAssetDiff(diffService.diff(source.project().getId(), renamed.revision()));
        assertThat(schemaDiff.changes()).extracting(FieldChange::path)
                .as("the CDL text and the value migration it caused are the same revision")
                .contains("contentDefinition", "content.title", "content.siteTitle");
        assertThat(schemaDiff.changes()).filteredOn(c -> c.path().equals("content.title")).singleElement()
                .satisfies(change -> assertThat(change.isRemove()).isTrue());
        assertThat(schemaDiff.changes()).filteredOn(c -> c.path().equals("content.siteTitle")).singleElement()
                .satisfies(change -> {
                    assertThat(change.isAdd()).isTrue();
                    assertThat(change.after().asText()).isEqualTo("Acme Outdoor");
                });
    }

    private static List<ConflictType> conflictTypes(ConflictReport report) {
        return report.conflicts().stream().map(ImportConflict::type).sorted().toList();
    }

    private static AssetDiff onlyAssetDiff(RevisionDiff diff) {
        assertThat(diff.assets()).hasSize(1);
        return diff.assets().get(0);
    }

    private List<Asset> globalsRoots(long projectId) {
        return assetRepository.findAll().stream()
                .filter(a -> java.util.Objects.equals(a.getProjectId(), projectId)
                        && a.getAssetType() == AssetType.FOLDER
                        && FolderScope.GLOBALS_ROOT_UID.equals(a.getUid()))
                .toList();
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
