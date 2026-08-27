package com.acme.staticforge.exportimport;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.UidGenerator;
import com.acme.staticforge.asset.folder.FolderNode;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.folder.PathService;
import com.acme.staticforge.asset.media.Blob;
import com.acme.staticforge.asset.media.BlobRepository;
import com.acme.staticforge.asset.media.BlobStore;
import com.acme.staticforge.channel.OutputChannel;
import com.acme.staticforge.channel.OutputChannelRepository;
import com.acme.staticforge.common.JsonUtil;
import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.revision.AssetChange;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link ProjectExportImportService} implementation (spec §26.5).
 *
 * <p><strong>Export</strong> reads the current, non-deleted asset snapshot and the
 * content-addressed media blobs backing {@code MEDIA} assets, then writes a deterministic
 * ZIP: {@code manifest.json}, {@code assets.json} (assets sorted by UUID) and one
 * {@code blobs/<sha256>} entry per distinct blob.
 *
 * <p><strong>Import</strong> parses the archive and recreates every asset in the target
 * project as a single {@code IMPORT} bulk revision (spec §7.2), written through the real
 * revision machinery. Each asset preserves its source UUID by default (feature
 * `cross-project-import-identity`, `M9.3.1`) — a fresh UUIDv7 is minted only when that UUID
 * already exists in the target project ({@code asset.uuid} is unique per {@code (project_id,
 * uuid)}, not server-wide, since `M9.1`) — a UID re-derived by {@link UidGenerator} so it stays
 * unique, a remapped payload (via {@link UuidRemapper}) with {@code payload.origin} provenance
 * (§6.1, plus {@code origin.sourceUuid} when the collision path re-keyed the asset), and
 * resolved folder/template edges.
 */
@Service
@RevisionAware
public class ProjectExportImportServiceImpl implements ProjectExportImportService {

    private static final String MANIFEST_ENTRY = "manifest.json";
    private static final String ASSETS_ENTRY = "assets.json";
    private static final String SETTINGS_ENTRY = "settings.json";
    private static final String BLOBS_PREFIX = "blobs/";
    private static final String ROOT_UID = "root";

    /**
     * Known-sensitive JSON field names (case-insensitive), stripped recursively from
     * {@code OutputChannel.settings}/{@code GenerationTarget.config} before either is
     * written to an export archive (spec §26.3: secrets never leave the secret manager).
     * No field in {@code OutputChannel}/{@code GenerationTarget} carries credentials today
     * (both {@code settings}/{@code config} are free-form JSON columns with no defined
     * secret fields as of this writing — verified by tracing every consumer of {@code
     * GenerationTarget.config} in {@code TargetWriterSelector}/{@code S3TargetWriter}/
     * {@code GenerationService}), but these columns accept arbitrary JSON, so a future
     * S3/remote target config could add access-key-shaped fields — this denylist is
     * defense in depth, not a response to a known leak. DO NOT casually "fix" this by
     * adding fields back without re-confirming they're safe.
     */
    private static final Set<String> REDACTED_KEYS = Set.of(
            "accesskey", "secretkey", "secretaccesskey", "password", "token", "credentials");

    /** Import order for non-folder assets: templates first, dependents last. */
    private static final List<String> NON_FOLDER_ORDER =
            List.of("SECTION_TEMPLATE", "PAGE_TEMPLATE", "MEDIA", "PAGE", "PAGE_REFERENCE");

    private final ProjectRepository projectRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final AssetRepository assetRepository;
    private final AssetService assetService;
    private final UidGenerator uidGenerator;
    private final PathService pathService;
    private final FolderService folderService;
    private final RevisionService revisionService;
    private final BlobStore blobStore;
    private final BlobRepository blobRepository;
    private final ObjectMapper objectMapper;
    private final OutputChannelRepository outputChannelRepository;
    private final GenerationTargetRepository generationTargetRepository;

    public ProjectExportImportServiceImpl(
            ProjectRepository projectRepository,
            AssetVersionRepository assetVersionRepository,
            AssetRepository assetRepository,
            AssetService assetService,
            UidGenerator uidGenerator,
            PathService pathService,
            FolderService folderService,
            RevisionService revisionService,
            BlobStore blobStore,
            BlobRepository blobRepository,
            ObjectMapper objectMapper,
            OutputChannelRepository outputChannelRepository,
            GenerationTargetRepository generationTargetRepository) {
        this.projectRepository = projectRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.assetRepository = assetRepository;
        this.assetService = assetService;
        this.uidGenerator = uidGenerator;
        this.pathService = pathService;
        this.folderService = folderService;
        this.revisionService = revisionService;
        this.blobStore = blobStore;
        this.blobRepository = blobRepository;
        this.objectMapper = objectMapper;
        this.outputChannelRepository = outputChannelRepository;
        this.generationTargetRepository = generationTargetRepository;
    }

    // ------------------------------------------------------------------
    // Export
    // ------------------------------------------------------------------

    @Override
    public byte[] exportProject(long projectId) {
        List<AssetVersion> versions = assetVersionRepository.findCurrentSnapshot(projectId);
        Set<UUID> allUuids = versions.stream()
                .map(version -> version.getAsset().getUuid())
                .collect(Collectors.toSet());
        return exportSelection(projectId, new ExportSelection(allUuids, true, true, Set.of()));
    }

    @Override
    public byte[] exportSelection(long projectId, ExportSelection selection) {
        Set<FolderScope> fullStores = selection.fullStores() == null ? Set.of() : selection.fullStores();
        if ((selection.assetUuids() == null || selection.assetUuids().isEmpty())
                && fullStores.isEmpty()
                && !selection.includeChannels()
                && !selection.includeGenerationTargets()) {
            throw new SfException(
                    ProblemFactory.unprocessableEntity("Export selection is empty — nothing to export."));
        }

        Project project = projectRepository.findById(projectId)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Project not found.")));

        List<AssetVersion> versions = assetVersionRepository.findCurrentSnapshot(projectId);
        Map<Long, String> uuidByAssetId = new HashMap<>();
        Map<Long, AssetVersion> versionByAssetId = new HashMap<>();
        for (AssetVersion version : versions) {
            uuidByAssetId.put(version.getAssetId(), version.getAsset().getUuid().toString());
            versionByAssetId.put(version.getAssetId(), version);
        }

        // fullStores (feature full-store-export, M11.1.3): a one-click "everything currently
        // live in this store" pick, additive to the caller's explicit assetUuids — union each
        // scope's current top-level folder UUIDs into the same picks set passed to
        // resolveIncludedAssetIds, so the existing folder-subtree-expansion path (a picked
        // FOLDER already pulls in its whole live subtree) does the rest with no separate
        // expansion mechanism.
        Set<UUID> picks = new HashSet<>();
        if (selection.assetUuids() != null) {
            picks.addAll(selection.assetUuids());
        }
        if (!fullStores.isEmpty()) {
            RevisionContext readCtx = RevisionContext.of(projectId, null, "full-store export selection");
            for (FolderScope scope : fullStores) {
                for (FolderNode topLevelFolder : folderService.tree(projectId, scope, 0, readCtx)) {
                    picks.add(topLevelFolder.uuid());
                }
            }
        }

        IncludedIds includedIds = resolveIncludedAssetIds(versions, versionByAssetId, picks);
        Set<Long> explicitIds = includedIds.explicit();
        Set<Long> ancestorIds = includedIds.ancestors();

        List<ExportedAsset> assets = new ArrayList<>();
        Map<String, byte[]> blobs = new TreeMap<>();
        for (AssetVersion version : versions) {
            if (!explicitIds.contains(version.getAssetId()) && !ancestorIds.contains(version.getAssetId())) {
                continue;
            }
            Asset asset = version.getAsset();
            assets.add(new ExportedAsset(
                    asset.getUuid().toString(),
                    asset.getAssetType().name(),
                    asset.getUid(),
                    version.getDisplayName(),
                    version.getFolderId() == null ? null : uuidByAssetId.get(version.getFolderId()),
                    version.getFolderPath(),
                    version.getTemplateAssetId() == null ? null : uuidByAssetId.get(version.getTemplateAssetId()),
                    version.getPayload(),
                    version.getMimeType(),
                    version.getSizeBytes(),
                    !ancestorIds.contains(version.getAssetId())));
            if (asset.getAssetType() == AssetType.MEDIA) {
                collectBlobs(version.getPayload(), blobs);
            }
        }
        assets.sort(Comparator.comparing(ExportedAsset::uuid));

        ExportManifest manifest = new ExportManifest(
                PROTOCOL_VERSION, project.getKey(), project.getName(), project.getDescription(), Instant.now());

        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (ZipOutputStream zip = new ZipOutputStream(out)) {
                writeJson(zip, MANIFEST_ENTRY, manifest);
                writeJson(zip, ASSETS_ENTRY, new ExportArchive(PROTOCOL_VERSION, assets));
                if (selection.includeChannels() || selection.includeGenerationTargets()) {
                    writeJson(zip, SETTINGS_ENTRY, buildExportedSettings(projectId, selection));
                }
                for (Map.Entry<String, byte[]> blob : blobs.entrySet()) {
                    zip.putNextEntry(new ZipEntry(BLOBS_PREFIX + blob.getKey()));
                    zip.write(blob.getValue());
                    zip.closeEntry();
                }
            }
            return out.toByteArray();
        } catch (IOException e) {
            throw new SfException(
                    ProblemFactory.other(500, "SF-EXP-0500", "Export Failed", "Failed to write export archive."),
                    e.getMessage(), e);
        }
    }

    /**
     * Expands the caller's explicit {@code assetUuids} picks into the full set of asset
     * ids to export: a picked folder pulls in every live descendant transitively (matched
     * by {@code folderPath} prefix), a picked non-folder asset is included by itself
     * (its own template reference is deliberately left out, see {@link
     * ProjectExportImportService#exportSelection}), and every ancestor folder of an
     * included asset is always added too, up to the project root.
     */
    private IncludedIds resolveIncludedAssetIds(
            List<AssetVersion> versions, Map<Long, AssetVersion> versionByAssetId, Set<UUID> assetUuids) {
        Set<Long> included = new HashSet<>();
        if (assetUuids != null) {
            for (UUID uuid : assetUuids) {
                AssetVersion picked = versions.stream()
                        .filter(v -> v.getAsset().getUuid().equals(uuid))
                        .findFirst()
                        .orElse(null);
                if (picked == null) {
                    // Stale/foreign UUID — out of scope for this task (M10.2 handles conflicts).
                    continue;
                }
                if (picked.getAsset().getAssetType() == AssetType.FOLDER) {
                    String folderPath = picked.getFolderPath();
                    for (AssetVersion candidate : versions) {
                        if (pathService.isUnder(candidate.getFolderPath(), folderPath)) {
                            included.add(candidate.getAssetId());
                        }
                    }
                } else {
                    included.add(picked.getAssetId());
                }
            }
        }

        // Always include every ancestor folder up to the project root.
        Set<Long> ancestors = new HashSet<>();
        for (Long id : included) {
            Long folderId = versionByAssetId.get(id).getFolderId();
            while (folderId != null && !included.contains(folderId) && ancestors.add(folderId)) {
                AssetVersion folderVersion = versionByAssetId.get(folderId);
                folderId = folderVersion == null ? null : folderVersion.getFolderId();
            }
        }
        return new IncludedIds(included, ancestors);
    }

    /**
     * Split result of {@link #resolveIncludedAssetIds}: {@code explicit} is exactly the
     * pre-ancestor-merge {@code included} set (the caller's direct picks — individual
     * non-folder assets, a picked folder's live subtree, and/or a {@code fullStores} scope's
     * top-level folders, which were already unioned into the picks argument before this
     * method runs), and {@code ancestors} is every additional ancestor folder pulled in only
     * to keep the archive's {@code parentFolderUuid} chain intact. Named distinctly from
     * {@link IdMaps} to avoid confusion between the export-side and import-side helpers.
     */
    private record IncludedIds(Set<Long> explicit, Set<Long> ancestors) {}

    // ------------------------------------------------------------------
    // Import
    // ------------------------------------------------------------------

    @Override
    @Transactional
    public ImportResult importProject(long targetProjectId, byte[] zipBytes, RevisionContext ctx, ImportOptions options) {
        ArchiveContent content = readArchive(zipBytes);
        ExportManifest manifest = content.manifest();

        // Re-run the exact same conflict detection analyzeImport uses, unconditionally — a
        // caller that skipped straight past a blocking analyzeImport report (or never called
        // it at all) must still be refused here, before any write happens. DUPLICATE_UUID is
        // deliberately excluded from the set that actually aborts the commit: unlike the other
        // BLOCKING types, it already has an established, safe automatic resolution right here in
        // importProject (mint a fresh UUIDv7 instead of the colliding source UUID — feature
        // cross-project-import-identity, M9.3.1, see the remap/collided map below), so reporting
        // it as BLOCKING in analyzeImport's UI-facing report does not mean commit must refuse it.
        ConflictReport report = detectConflicts(targetProjectId, content, options);
        // NOTE: this filter is unconditional and independent of ImportOptions.skipExistingImplicit
        // (feature selection-provenance, M11.2.2). skipExistingImplicit only changes which
        // DUPLICATE_UUID conflicts detectConflicts *reports* (report-visibility filtering, above);
        // it must never be folded into this "does not abort a commit" filter, since DUPLICATE_UUID
        // always has a safe automatic resolution here (mint-fresh-UUID, or — when the flag and
        // asset provenance allow — reuse-existing) regardless of whether it was reported.
        List<ImportConflict> hardBlocking = report.conflicts().stream()
                .filter(c -> c.severity() == ConflictSeverity.BLOCKING && c.type() != ConflictType.DUPLICATE_UUID)
                .toList();
        assertNoBlockingConflicts(new ConflictReport(hardBlocking));

        List<ExportedAsset> assets = content.assets();

        Revision revision = revisionService.allocate(
                targetProjectId, ChangeType.IMPORT, ctx.comment(), ctx.userId());

        // Preserve each asset's source UUID by default (feature cross-project-import-identity,
        // M9.3.1) — a fresh UUIDv7 is only minted when the source UUID already exists in the
        // *target* project, which is now a real, per-asset possibility rather than an impossible
        // case, since M9.1 loosened asset.uuid uniqueness to (project_id, uuid). A third branch
        // (feature selection-provenance, M11.2.2): when skipExistingImplicit is on and the
        // colliding asset was only implicitly included (an ancestor folder, never an explicit
        // pick — asset.isExplicit() is false), reuse the existing target asset instead of
        // minting a duplicate; such assets are recorded in `skipped` and never passed to
        // createImportedAsset below.
        Map<String, UUID> remap = new HashMap<>();
        Set<String> collided = new HashSet<>();
        Set<String> skipped = new HashSet<>();
        for (ExportedAsset asset : assets) {
            String key = asset.uuid().toLowerCase();
            UUID sourceUuid = UUID.fromString(asset.uuid());
            java.util.Optional<Asset> existing = assetRepository.findByProjectIdAndUuid(targetProjectId, sourceUuid);
            if (existing.isPresent() && options.skipExistingImplicit() && !asset.isExplicit()) {
                remap.put(key, sourceUuid);
                skipped.add(key);
            } else if (existing.isPresent()) {
                remap.put(key, UuidV7.generate());
                collided.add(key);
            } else {
                remap.put(key, sourceUuid);
            }
        }

        ExportedAsset rootAsset = findRootFolder(assets);
        AssetVersionView targetRoot = assetService.ensureRootFolder(targetProjectId, ctx);
        Long targetRootId = assetRepository.findByProjectIdAndUuid(targetProjectId, targetRoot.uuid())
                .map(Asset::getId)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Root folder not found.")));
        if (rootAsset != null) {
            remap.put(rootAsset.uuid().toLowerCase(), targetRoot.uuid());
        }

        IdMaps idMaps = new IdMaps();
        idMaps.put(rootAsset == null ? null : rootAsset.uuid().toLowerCase(), targetRootId, PathService.ROOT_PATH);

        // The two fixed, protected TEMPLATES-scope root folders (spec M13.1.2) get the exact
        // same resolve-not-create treatment as the hidden root above (feature
        // template-store-folders, M13.2.2): every project already has its own "Page Templates" /
        // "Section Templates" folder, so an archive's copy of either must remap onto the
        // target's existing folder rather than create a second, differently-uid'd duplicate.
        // ensureTemplateFolders is idempotent find-or-create, so this is safe even for a target
        // project that (unexpectedly) doesn't have them yet.
        Map<AssetType, ExportedAsset> fixedTemplateFolderAssets = findFixedTemplateFolders(assets);
        Set<String> fixedTemplateFolderKeys = new HashSet<>();
        if (!fixedTemplateFolderAssets.isEmpty()) {
            Map<AssetType, AssetVersionView> targetFixedFolders = assetService.ensureTemplateFolders(targetProjectId, ctx);
            for (Map.Entry<AssetType, ExportedAsset> entry : fixedTemplateFolderAssets.entrySet()) {
                ExportedAsset archiveFolder = entry.getValue();
                AssetVersionView targetFolder = targetFixedFolders.get(entry.getKey());
                Long targetFolderId = assetRepository.findByProjectIdAndUuid(targetProjectId, targetFolder.uuid())
                        .map(Asset::getId)
                        .orElseThrow(() -> new SfException(ProblemFactory.notFound("Fixed template folder not found.")));
                String key = archiveFolder.uuid().toLowerCase();
                remap.put(key, targetFolder.uuid());
                idMaps.put(key, targetFolderId, targetFolder.folderPath());
                fixedTemplateFolderKeys.add(key);
            }
        }

        // Pre-populate idMaps for every skipped asset with the *existing* target asset's real
        // (assetId, folderPath) — not a to-be-created one — so descendants still explicitly
        // imported below resolve their parentFolderUuid against the reused folder correctly.
        for (ExportedAsset asset : assets) {
            String key = asset.uuid().toLowerCase();
            if (!skipped.contains(key)) {
                continue;
            }
            Asset existingAsset = assetRepository.findByProjectIdAndUuid(targetProjectId, UUID.fromString(asset.uuid()))
                    .orElseThrow(() -> new SfException(ProblemFactory.notFound("Existing asset not found.")));
            AssetVersion existingVersion = assetVersionRepository
                    .findByAssetIdAndValidToRevisionIsNull(existingAsset.getId())
                    .orElseThrow(() -> new SfException(ProblemFactory.notFound("Existing asset has no current version.")));
            idMaps.put(key, existingAsset.getId(), existingVersion.getFolderPath());
        }

        Set<String> importedShas = new HashSet<>();
        for (ExportedAsset asset : assets) {
            if ("MEDIA".equals(asset.type())) {
                importBlobs(asset.payload(), content.blobs(), importedShas);
            }
        }

        Instant importedAt = Instant.now();
        int created = 0;
        for (ExportedAsset asset : order(assets, rootAsset)) {
            if (asset == rootAsset
                    || skipped.contains(asset.uuid().toLowerCase())
                    || fixedTemplateFolderKeys.contains(asset.uuid().toLowerCase())) {
                continue;
            }
            createImportedAsset(targetProjectId, asset, remap, collided, idMaps, manifest, importedAt,
                    revision.getRevisionId(), ctx);
            created++;
        }

        if (content.settings() != null) {
            importSettings(targetProjectId, content.settings());
        }

        return new ImportResult(manifest.sourceProjectKey(), created, importedShas.size());
    }

    @Override
    @Transactional(readOnly = true)
    public ConflictReport analyzeImport(long targetProjectId, byte[] zipBytes, ImportOptions options) {
        ArchiveContent content = readArchive(zipBytes);
        return detectConflicts(targetProjectId, content, options);
    }

    /**
     * Shared conflict-detection logic reused by both {@link #analyzeImport} (read-only) and
     * {@link #importProject} (which re-runs this unconditionally right before it starts
     * writing, so the two paths can never drift apart). Performs no writes.
     */
    private ConflictReport detectConflicts(long targetProjectId, ArchiveContent content, ImportOptions options) {
        ExportManifest manifest = content.manifest();
        if (manifest.protocolVersion() > PROTOCOL_VERSION) {
            // Protocol mismatch short-circuits: no point reporting template/folder issues in an
            // archive we can't even trust the shape of.
            return new ConflictReport(List.of(ImportConflict.of(
                    ConflictType.PROTOCOL_VERSION_MISMATCH,
                    null,
                    null,
                    "Archive protocol version " + manifest.protocolVersion()
                            + " is newer than the supported version " + PROTOCOL_VERSION + ".")));
        }

        List<ImportConflict> conflicts = new ArrayList<>();
        List<ExportedAsset> assets = content.assets();
        Set<String> archiveUuids = assets.stream()
                .map(a -> a.uuid().toLowerCase(Locale.ROOT))
                .collect(Collectors.toSet());

        for (ExportedAsset asset : assets) {
            String label = asset.displayName() != null ? asset.displayName() : asset.uid();

            if (assetRepository.findByProjectIdAndUuid(targetProjectId, UUID.fromString(asset.uuid())).isPresent()) {
                // Report-visibility filtering only (feature selection-provenance, M11.2.2),
                // applied as its own distinct step: skipExistingImplicit hides a DUPLICATE_UUID
                // conflict from this report when the colliding asset was never one of the
                // caller's explicit picks (asset.isExplicit() is false). This is entirely
                // separate from — and must never be merged with — importProject's unconditional
                // hardBlocking filter, which excludes ALL DUPLICATE_UUID conflicts from what can
                // abort a commit regardless of this option or of report visibility.
                boolean suppressed = options.skipExistingImplicit() && !asset.isExplicit();
                if (!suppressed) {
                    conflicts.add(ImportConflict.of(
                            ConflictType.DUPLICATE_UUID,
                            asset.uuid(),
                            label,
                            "An asset with this UUID already exists in the target project.",
                            asset.isExplicit()));
                }
            }

            String templateUuid = asset.templateUuid();
            if (templateUuid != null && !templateUuid.isBlank()) {
                boolean satisfied = archiveUuids.contains(templateUuid.toLowerCase(Locale.ROOT))
                        || assetRepository.findByProjectIdAndUuid(targetProjectId, UUID.fromString(templateUuid))
                                .isPresent();
                if (!satisfied) {
                    // Deliberately no UID-based fallback lookup here: once the missing template is
                    // excluded from the archive, its human-assigned UID isn't derivable from what
                    // remains — scope limitation, not an oversight.
                    conflicts.add(ImportConflict.of(
                            ConflictType.MISSING_TEMPLATE_REFERENCE,
                            asset.uuid(),
                            label,
                            "References template " + templateUuid
                                    + ", which is not in this archive and does not exist in the target project.",
                            asset.isExplicit()));
                }
            }

            String parentFolderUuid = asset.parentFolderUuid();
            if (parentFolderUuid != null && !archiveUuids.contains(parentFolderUuid.toLowerCase(Locale.ROOT))) {
                conflicts.add(ImportConflict.of(
                        ConflictType.MISSING_PARENT_FOLDER,
                        asset.uuid(),
                        label,
                        "Parent folder " + parentFolderUuid + " is not present in this archive.",
                        asset.isExplicit()));
            }
        }

        if (content.settings() != null) {
            for (ExportedChannel c : content.settings().channels()) {
                if (outputChannelRepository.existsByProjectIdAndKey(targetProjectId, c.key())) {
                    conflicts.add(ImportConflict.of(
                            ConflictType.SETTINGS_KEY_COLLISION,
                            null,
                            c.key(),
                            "A channel with key '" + c.key()
                                    + "' already exists in the target project and will be skipped."));
                }
            }
            List<GenerationTarget> existingTargets = generationTargetRepository.findByProjectId(targetProjectId);
            Set<String> existingNames =
                    existingTargets.stream().map(GenerationTarget::getName).collect(Collectors.toSet());
            for (ExportedGenerationTarget t : content.settings().targets()) {
                if (existingNames.contains(t.name())) {
                    conflicts.add(ImportConflict.of(
                            ConflictType.SETTINGS_KEY_COLLISION,
                            null,
                            t.name(),
                            "A generation target named '" + t.name()
                                    + "' already exists in the target project and will be skipped."));
                }
            }
        }

        return new ConflictReport(conflicts);
    }

    private void assertNoBlockingConflicts(ConflictReport report) {
        if (!report.hasBlocking()) {
            return;
        }
        List<Map<String, Object>> conflictBodies = report.conflicts().stream()
                .map(c -> {
                    Map<String, Object> body = new HashMap<>();
                    body.put("severity", c.severity().name());
                    body.put("type", c.type().name());
                    body.put("elementUuid", c.elementUuid());
                    body.put("elementLabel", c.elementLabel());
                    body.put("detail", c.detail());
                    return body;
                })
                .toList();
        Problem problem = Problem.builder()
                .type("https://cms.example.com/problems/sf-api-0409")
                .title("Conflict")
                .status(409)
                .detail("The import archive has one or more blocking conflicts with the target project.")
                .property("code", "SF-API-0409")
                .property("conflicts", conflictBodies)
                .build();
        throw new SfException(problem);
    }

    /**
     * Merges exported channels/targets into the target project: a key/name that already
     * exists there is left untouched and skipped silently — settings import only *adds*
     * new entries, never overwrites (collisions surface as an `M10.2` conflict later, out
     * of scope here).
     */
    private void importSettings(long targetProjectId, ExportedSettings settings) {
        for (ExportedChannel c : settings.channels()) {
            if (outputChannelRepository.existsByProjectIdAndKey(targetProjectId, c.key())) {
                continue;
            }
            outputChannelRepository.save(new OutputChannel(
                    targetProjectId,
                    c.key(),
                    c.name(),
                    c.fileExtension(),
                    c.mimeType(),
                    c.defaultEscaping(),
                    c.enabled(),
                    c.isDefault(),
                    c.position() == null ? 0 : c.position(),
                    c.settings()));
        }

        List<GenerationTarget> existingTargets = generationTargetRepository.findByProjectId(targetProjectId);
        Set<String> existingNames = existingTargets.stream().map(GenerationTarget::getName).collect(Collectors.toSet());
        for (ExportedGenerationTarget t : settings.targets()) {
            if (existingNames.contains(t.name())) {
                continue;
            }
            generationTargetRepository.save(new GenerationTarget(
                    targetProjectId, t.name(), TargetType.valueOf(t.type()), t.config(), t.isDefault()));
        }
    }

    private void createImportedAsset(
            long projectId, ExportedAsset asset, Map<String, UUID> remap, Set<String> collided, IdMaps idMaps,
            ExportManifest manifest, Instant importedAt, long revision, RevisionContext ctx) {
        AssetType type = AssetType.valueOf(asset.type());
        UUID uuid = remap.get(asset.uuid().toLowerCase());
        String uid = uidGenerator.deriveUid(asset.displayName(), projectId, type);

        Long parentFolderId = idMaps.idOf(asset.parentFolderUuid());
        String parentPath = idMaps.pathOf(asset.parentFolderUuid());
        String folderPath = type == AssetType.FOLDER
                ? pathService.childPath(parentPath, uid)
                : pathService.contentPath(parentPath);
        Long templateAssetId = idMaps.idOf(asset.templateUuid());

        JsonNode remapped = UuidRemapper.remap(asset.payload(), remap);
        ObjectNode payload = JsonUtil.object(remapped).deepCopy();
        ObjectNode origin = payload.putObject("origin");
        origin.put("from", "import");
        origin.put("sourceProjectKey", manifest.sourceProjectKey());
        origin.put("importedAt", importedAt.toString());
        if (collided.contains(asset.uuid().toLowerCase())) {
            // Debugging/audit metadata only (§6.1) — the DB-level (project_id, uuid) existence
            // check above is what actually drove the collision path, this just lets a human
            // inspecting the asset's history see it was re-keyed on import.
            origin.put("sourceUuid", asset.uuid());
        }

        Asset saved = assetRepository.save(new Asset(uuid, projectId, type, uid, importedAt, ctx.userId()));
        idMaps.put(asset.uuid().toLowerCase(), saved.getId(), folderPath);

        AssetVersion version = new AssetVersion(saved.getId(), revision, asset.displayName(), payload, ctx.userId(), importedAt);
        version.setFolderId(parentFolderId);
        version.setFolderPath(folderPath);
        version.setTemplateAssetId(templateAssetId);
        if (type == AssetType.MEDIA) {
            version.setMimeType(asset.mimeType());
            version.setSizeBytes(asset.sizeBytes());
        }
        assetVersionRepository.save(version);

        revisionService.appendSummary(projectId, revision,
                new AssetChange(uuid.toString(), type.name(), uid, "CREATE", List.of(), false));
    }

    private void importBlobs(JsonNode payload, Map<String, byte[]> archiveBlobs, Set<String> importedShas) {
        if (payload == null) {
            return;
        }
        importBlob(payload.path("blobSha256"), payload.path("mimeType"), archiveBlobs, importedShas);
        JsonNode variants = payload.get("variants");
        if (variants != null && variants.isArray()) {
            variants.forEach(variant -> importBlob(variant.path("blobSha256"), null, archiveBlobs, importedShas));
        }
    }

    private void importBlob(JsonNode shaNode, JsonNode mimeNode, Map<String, byte[]> archiveBlobs, Set<String> importedShas) {
        String sha = textOrNull(shaNode);
        if (sha == null) {
            return;
        }
        byte[] bytes = archiveBlobs.get(sha);
        if (bytes == null) {
            return;
        }
        blobRepository.findById(sha).ifPresentOrElse(
                existing -> {
                    existing.setRefCount(existing.getRefCount() + 1);
                    blobRepository.save(existing);
                },
                () -> {
                    blobStore.put(sha, bytes);
                    blobRepository.save(new Blob(
                            sha, bytes.length, textOrNull(mimeNode), blobStore.storageKey(sha), 1, Instant.now()));
                });
        importedShas.add(sha);
    }

    // ------------------------------------------------------------------
    // Ordering + helpers
    // ------------------------------------------------------------------

    private static List<ExportedAsset> order(List<ExportedAsset> assets, ExportedAsset rootAsset) {
        List<ExportedAsset> ordered = new ArrayList<>();
        assets.stream()
                .filter(asset -> asset != rootAsset && "FOLDER".equals(asset.type()))
                .sorted(Comparator.comparing(ExportedAsset::folderPath))
                .forEach(ordered::add);
        for (String type : NON_FOLDER_ORDER) {
            assets.stream()
                    .filter(asset -> type.equals(asset.type()))
                    .sorted(Comparator.comparing(ExportedAsset::uuid))
                    .forEach(ordered::add);
        }
        return ordered;
    }

    private static ExportedAsset findRootFolder(List<ExportedAsset> assets) {
        for (ExportedAsset asset : assets) {
            if ("FOLDER".equals(asset.type()) && ROOT_UID.equals(asset.uid())) {
                return asset;
            }
        }
        return null;
    }

    /**
     * Matches archive {@link ExportedAsset}s of type {@code FOLDER} whose {@code uid} is one of
     * the two well-known {@link FolderScope#PAGE_TEMPLATES_UID}/{@link
     * FolderScope#SECTION_TEMPLATES_UID} constants (spec M13.1.2), keyed by the {@link AssetType}
     * each fixed folder holds ({@code PAGE_TEMPLATE}/{@code SECTION_TEMPLATE}) — the same key
     * shape {@link AssetService#ensureTemplateFolders} returns, so the two maps line up directly.
     * Analogous to {@link #findRootFolder}, but for the two fixed {@code TEMPLATES}-scope roots
     * instead of the single hidden project root (feature template-store-folders, M13.2.2).
     */
    private static Map<AssetType, ExportedAsset> findFixedTemplateFolders(List<ExportedAsset> assets) {
        Map<AssetType, ExportedAsset> found = new HashMap<>();
        for (ExportedAsset asset : assets) {
            if (!"FOLDER".equals(asset.type())) {
                continue;
            }
            if (FolderScope.PAGE_TEMPLATES_UID.equals(asset.uid())) {
                found.put(AssetType.PAGE_TEMPLATE, asset);
            } else if (FolderScope.SECTION_TEMPLATES_UID.equals(asset.uid())) {
                found.put(AssetType.SECTION_TEMPLATE, asset);
            }
        }
        return found;
    }

    private void collectBlobs(JsonNode payload, Map<String, byte[]> blobs) {
        if (payload == null) {
            return;
        }
        collectBlob(payload.path("blobSha256"), blobs);
        JsonNode variants = payload.get("variants");
        if (variants != null && variants.isArray()) {
            variants.forEach(variant -> collectBlob(variant.path("blobSha256"), blobs));
        }
    }

    private void collectBlob(JsonNode shaNode, Map<String, byte[]> blobs) {
        String sha = textOrNull(shaNode);
        if (sha == null || blobs.containsKey(sha)) {
            return;
        }
        if (blobStore.exists(sha)) {
            blobs.put(sha, blobStore.get(sha));
        }
    }

    private ExportedSettings buildExportedSettings(long projectId, ExportSelection selection) {
        List<ExportedChannel> channels = selection.includeChannels()
                ? outputChannelRepository.findByProjectIdOrderByPositionAsc(projectId).stream()
                        .map(c -> new ExportedChannel(
                                c.getKey(),
                                c.getName(),
                                c.getFileExtension(),
                                c.getMimeType(),
                                c.getDefaultEscaping(),
                                c.isEnabled(),
                                c.isDefaultChannel(),
                                c.getPosition(),
                                redact(c.getSettings())))
                        .toList()
                : List.of();
        List<ExportedGenerationTarget> targets = selection.includeGenerationTargets()
                ? generationTargetRepository.findByProjectId(projectId).stream()
                        .map(t -> new ExportedGenerationTarget(
                                t.getName(), t.getType().name(), redact(t.getConfig()), t.isDefaultTarget()))
                        .toList()
                : List.of();
        return new ExportedSettings(channels, targets);
    }

    /**
     * Strips any JSON object field whose name matches a known-sensitive key (case-insensitive,
     * see {@link #REDACTED_KEYS}), recursively through nested objects/arrays, returning a deep
     * copy. Fields are removed entirely (not just blanked) so the UI/JSON doesn't even hint the
     * key existed. Returns {@code null} for {@code null} input.
     */
    private static JsonNode redact(JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        if (node.isObject()) {
            ObjectNode copy = node.deepCopy();
            Iterator<String> fieldNames = copy.fieldNames();
            List<String> toRemove = new ArrayList<>();
            while (fieldNames.hasNext()) {
                String field = fieldNames.next();
                if (REDACTED_KEYS.contains(field.toLowerCase(Locale.ROOT))) {
                    toRemove.add(field);
                }
            }
            toRemove.forEach(copy::remove);
            for (Iterator<Map.Entry<String, JsonNode>> it = copy.fields(); it.hasNext(); ) {
                Map.Entry<String, JsonNode> entry = it.next();
                copy.set(entry.getKey(), redact(entry.getValue()));
            }
            return copy;
        }
        if (node.isArray()) {
            ArrayNode copy = node.deepCopy();
            for (int i = 0; i < copy.size(); i++) {
                copy.set(i, redact(copy.get(i)));
            }
            return copy;
        }
        return node;
    }

    private void writeJson(ZipOutputStream zip, String name, Object value) throws IOException {
        zip.putNextEntry(new ZipEntry(name));
        zip.write(objectMapper.writeValueAsBytes(value));
        zip.closeEntry();
    }

    private ArchiveContent readArchive(byte[] zipBytes) {
        ExportManifest manifest = null;
        List<ExportedAsset> assets = null;
        ExportedSettings settings = null;
        Map<String, byte[]> blobs = new HashMap<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(zipBytes))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                String name = entry.getName();
                if (MANIFEST_ENTRY.equals(name)) {
                    manifest = objectMapper.readValue(zip.readAllBytes(), ExportManifest.class);
                } else if (ASSETS_ENTRY.equals(name)) {
                    assets = new ArrayList<>(objectMapper.readValue(zip.readAllBytes(), ExportArchive.class).assets());
                } else if (SETTINGS_ENTRY.equals(name)) {
                    settings = objectMapper.readValue(zip.readAllBytes(), ExportedSettings.class);
                } else if (name.startsWith(BLOBS_PREFIX)) {
                    blobs.put(name.substring(BLOBS_PREFIX.length()), zip.readAllBytes());
                }
            }
        } catch (IOException e) {
            throw new SfException(
                    ProblemFactory.badRequest("Invalid export archive: " + e.getMessage()), e.getMessage(), e);
        }
        if (manifest == null || assets == null) {
            throw new SfException(ProblemFactory.badRequest("Export archive is missing a manifest or assets document."));
        }
        assets.sort(Comparator.comparing(ExportedAsset::uuid));
        return new ArchiveContent(manifest, assets, blobs, settings);
    }

    private static String textOrNull(JsonNode node) {
        return node == null || node.isNull() || node.isMissingNode() || node.asText().isBlank() ? null : node.asText();
    }

    /** Source-UUID → target {@code (assetId, folderPath)} map built incrementally during import. */
    private static final class IdMaps {
        private final Map<String, Long> idByUuid = new HashMap<>();
        private final Map<String, String> pathByUuid = new HashMap<>();

        void put(String oldUuid, Long id, String folderPath) {
            idByUuid.put(oldUuid, id);
            pathByUuid.put(oldUuid, folderPath);
        }

        Long idOf(String oldUuid) {
            return idByUuid.get(oldUuid == null ? null : oldUuid.toLowerCase());
        }

        String pathOf(String oldUuid) {
            return pathByUuid.get(oldUuid == null ? null : oldUuid.toLowerCase());
        }
    }

    private record ArchiveContent(
            ExportManifest manifest, List<ExportedAsset> assets, Map<String, byte[]> blobs,
            ExportedSettings settings) {}
}
