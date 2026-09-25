package com.acme.staticforge.exportimport;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.content.TemplateContentDefinitions;
import com.acme.staticforge.asset.dataset.RecordValues;
import com.acme.staticforge.asset.UidGenerator;
import com.acme.staticforge.asset.folder.FolderNode;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.folder.PathService;
import com.acme.staticforge.asset.folder.RecordSetContainment;
import com.acme.staticforge.asset.media.Blob;
import com.acme.staticforge.asset.media.BlobRepository;
import com.acme.staticforge.asset.media.BlobStore;
import com.acme.staticforge.asset.media.MediaFiles;
import com.acme.staticforge.asset.reference.ReferenceMaterializer;
import com.acme.staticforge.asset.template.TemplateHierarchy;
import com.acme.staticforge.channel.OutputChannel;
import com.acme.staticforge.channel.OutputChannelRepository;
import com.acme.staticforge.common.JsonUtil;
import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.release.AssetRelease;
import com.acme.staticforge.release.AssetReleaseRepository;
import com.acme.staticforge.release.Chunks;
import com.acme.staticforge.release.ReleasableTypes;
import com.acme.staticforge.release.ReleaseLocales;
import com.acme.staticforge.revision.AssetChange;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionService;
import com.acme.staticforge.template.query.RecordSetQueries;
import com.acme.staticforge.template.query.RecordSetQuery;
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
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
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
 *
 * <p><strong>Record sets</strong> (M25, protocol {@code 7} — see {@link #PROTOCOL_VERSION}): a record's archive
 * parent is its {@code RECORD_SET}, a set's {@code templateUuid} its dataset. Export pulls a picked record's set
 * and dataset in implicitly and exports a picked set's records with it. Import creates datasets, then sets, then
 * records, and judges every record's placement with {@link RecordSetContainment}: a record outside a set — every
 * record of a protocol {@code <= 6} archive — is rejected on its own ({@link
 * ConflictType#RECORD_OUTSIDE_RECORD_SET}) while the rest of the archive imports. Such records are never migrated
 * or grouped into sets (epic decision 8).
 *
 * <p><strong>Release state</strong> (M27, protocol {@code 8}): every releasable asset carries its open release
 * pointers and the locale keys it was unpublished in ({@link ExportedRelease}), and an asset whose draft is deleted
 * while it is still released is exported as its tombstone. A {@link ReleaseMode#KEEP} import writes each released
 * version that differs from the draft as an extra version of the asset, opened and closed in the import revision
 * ({@code validFrom = validTo}): it is never the version valid at any revision — so the "one valid version per
 * revision" invariant holds and every reader of versions is unaffected — and only the pointer, opened in the same
 * revision, reads it. An unpublished locale key likewise becomes a pointer opened and closed in the import revision:
 * valid at no revision, it only records that the key was released once. Pointers, versions and the draft all belong
 * to the one import revision.
 */
@Service
@RevisionAware
public class ProjectExportImportServiceImpl implements ProjectExportImportService {

    private static final String MANIFEST_ENTRY = "manifest.json";
    private static final String ASSETS_ENTRY = "assets.json";
    private static final String ASSETS_PREFIX = "assets/";
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

    /**
     * Import order for non-folder assets: templates first, dependents last. Reference rows are
     * materialized only after every asset exists, so the order is about readability of the import,
     * not about edges resolving.
     *
     * <p>Every non-folder {@link AssetType} must appear here: {@link #order} imports exactly these
     * types, so a missing one is dropped from an import without any error (that is how M17's
     * {@code GLOBAL_SET} first went missing). The static check turns that into a startup failure.
     */
    private static final List<AssetType> NON_FOLDER_ORDER = List.of(
            AssetType.SECTION_TEMPLATE,
            AssetType.PAGE_TEMPLATE,
            AssetType.MEDIA,
            AssetType.GLOBAL_SET,
            // A record's validation and its template_asset_id need its dataset (M19.1.3); a record's
            // folder path is its record set's (M25), so sets come after datasets and before records.
            AssetType.DATASET,
            AssetType.RECORD_SET,
            AssetType.RECORD,
            AssetType.PAGE,
            AssetType.PAGE_REFERENCE);

    static {
        EnumSet<AssetType> unordered = EnumSet.complementOf(EnumSet.of(AssetType.FOLDER));
        NON_FOLDER_ORDER.forEach(unordered::remove);
        if (!unordered.isEmpty()) {
            throw new IllegalStateException("Asset types missing from the import order: " + unordered);
        }
    }

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
    private final ReferenceMaterializer referenceMaterializer;
    private final com.acme.staticforge.project.ProjectLocales projectLocales;
    private final AssetReleaseRepository releaseRepository;

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
            GenerationTargetRepository generationTargetRepository,
            ReferenceMaterializer referenceMaterializer,
            com.acme.staticforge.project.ProjectLocales projectLocales,
            AssetReleaseRepository releaseRepository) {
        this.projectRepository = projectRepository;
        this.projectLocales = projectLocales;
        this.releaseRepository = releaseRepository;
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
        this.referenceMaterializer = referenceMaterializer;
    }

    // ------------------------------------------------------------------
    // Export
    // ------------------------------------------------------------------

    @Override
    public byte[] exportProject(long projectId) {
        List<AssetVersion> versions = exportableVersions(projectId, openPointers(projectId));
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

        Map<Long, List<AssetRelease>> pointers = openPointers(projectId);
        List<AssetVersion> versions = exportableVersions(projectId, pointers);
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

        List<AssetVersion> exported = versions.stream()
                .filter(v -> explicitIds.contains(v.getAssetId()) || ancestorIds.contains(v.getAssetId()))
                .toList();
        Map<Long, AssetVersion> releasedVersions = releasedVersions(exported, pointers);
        addMissingUuids(uuidByAssetId, releasedVersions.values());
        Map<Long, Set<String>> everReleased = everReleased(exported);

        List<ExportedAsset> assets = new ArrayList<>();
        Map<String, byte[]> blobs = new TreeMap<>();
        for (AssetVersion version : exported) {
            Asset asset = version.getAsset();
            List<ExportedRelease> release = ReleasableTypes.isReleasable(asset.getAssetType(), version.getPayload(), asset.getUid())
                    ? releaseEntries(version, pointers.getOrDefault(version.getAssetId(), List.of()), releasedVersions,
                            everReleased.getOrDefault(version.getAssetId(), Set.of()), uuidByAssetId)
                    : null;
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
                    !ancestorIds.contains(version.getAssetId()),
                    release,
                    version.isDeleted() ? Boolean.TRUE : null));
            if (asset.getAssetType() == AssetType.MEDIA) {
                collectBlobs(version.getPayload(), blobs);
                if (release != null) {
                    release.forEach(entry -> collectBlobs(entry.payload(), blobs));
                }
            }
        }
        assets.sort(Comparator.comparing(ExportedAsset::uuid));

        ExportManifest manifest = new ExportManifest(
                PROTOCOL_VERSION, project.getKey(), project.getName(), project.getDescription(), Instant.now(),
                projectLocales.forProject(projectId).codes());

        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (ZipOutputStream zip = new ZipOutputStream(out)) {
                writeJson(zip, MANIFEST_ENTRY, manifest);
                for (ExportedAsset asset : assets) {
                    writeJson(zip, ASSETS_PREFIX + asset.uuid() + ".json", asset);
                }
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

    /** The open release pointers of a project, by asset id, each list in locale key order. */
    private Map<Long, List<AssetRelease>> openPointers(long projectId) {
        Map<Long, List<AssetRelease>> byAsset = new HashMap<>();
        releaseRepository.findByProjectIdAndValidToRevisionIsNull(projectId).stream()
                .sorted(Comparator.comparing(AssetRelease::getLocaleKey))
                .forEach(p -> byAsset.computeIfAbsent(p.getAssetId(), id -> new ArrayList<>()).add(p));
        return byAsset;
    }

    /**
     * What an export can contain (M27.5.1): the live assets, plus every tombstone that is still released somewhere
     * ({@code DELETION_PENDING}) and the deleted folders above such a tombstone, so its archive parent chain stays
     * intact. Other tombstones are gone and stay out.
     */
    private List<AssetVersion> exportableVersions(long projectId, Map<Long, List<AssetRelease>> pointers) {
        List<AssetVersion> versions = new ArrayList<>(assetVersionRepository.findCurrentSnapshot(projectId));
        Set<Long> known = versions.stream().map(AssetVersion::getAssetId).collect(Collectors.toSet());
        Set<Long> wanted = new HashSet<>(pointers.keySet());
        wanted.removeAll(known);
        while (!wanted.isEmpty()) {
            List<AssetVersion> tombstones = Chunks.flatMap(wanted, assetVersionRepository::findOpenWithAssetByAssetIdIn)
                    .stream()
                    .filter(AssetVersion::isDeleted)
                    .toList();
            known.addAll(wanted);
            versions.addAll(tombstones);
            wanted = tombstones.stream()
                    .map(AssetVersion::getFolderId)
                    .filter(id -> id != null && !known.contains(id))
                    .collect(Collectors.toSet());
        }
        return versions;
    }

    /** The released versions the pointers of {@code exported} name, except the exported versions themselves. */
    private Map<Long, AssetVersion> releasedVersions(List<AssetVersion> exported, Map<Long, List<AssetRelease>> pointers) {
        Set<Long> draftIds = exported.stream().map(AssetVersion::getId).collect(Collectors.toSet());
        Set<Long> ids = new HashSet<>();
        for (AssetVersion version : exported) {
            pointers.getOrDefault(version.getAssetId(), List.of()).stream()
                    .map(AssetRelease::getReleasedVersionId)
                    .filter(id -> !draftIds.contains(id))
                    .forEach(ids::add);
        }
        Map<Long, AssetVersion> byId = new HashMap<>();
        if (!ids.isEmpty()) {
            Chunks.flatMap(ids, assetVersionRepository::findAllById).forEach(v -> byId.put(v.getId(), v));
        }
        return byId;
    }

    /** The locale keys each of {@code exported} was ever released under, open or closed, by asset id. */
    private Map<Long, Set<String>> everReleased(List<AssetVersion> exported) {
        Set<Long> ids = exported.stream().map(AssetVersion::getAssetId).collect(Collectors.toSet());
        Map<Long, Set<String>> keys = new HashMap<>();
        if (!ids.isEmpty()) {
            Chunks.flatMap(ids, releaseRepository::findEverReleasedKeys)
                    .forEach(k -> keys.computeIfAbsent(k.assetId(), id -> new HashSet<>()).add(k.localeKey()));
        }
        return keys;
    }

    /** Adds the uuids of the parent folders and templates of {@code versions} that aren't in {@code uuidByAssetId} yet. */
    private void addMissingUuids(Map<Long, String> uuidByAssetId, java.util.Collection<AssetVersion> versions) {
        Set<Long> missing = new HashSet<>();
        for (AssetVersion version : versions) {
            for (Long id : new Long[] {version.getFolderId(), version.getTemplateAssetId()}) {
                if (id != null && !uuidByAssetId.containsKey(id)) {
                    missing.add(id);
                }
            }
        }
        if (!missing.isEmpty()) {
            Chunks.flatMap(missing, assetRepository::findAllById)
                    .forEach(asset -> uuidByAssetId.put(asset.getId(), asset.getUuid().toString()));
        }
    }

    /**
     * The release entries of one exported version (M27.5.1), in locale key order: {@link
     * ExportedRelease.State#DRAFT_EQUALS} for a pointer at the version itself, else the released version's content,
     * and {@link ExportedRelease.State#UNPUBLISHED} for a key released once without an open pointer now (a tombstone
     * has none: it is gone there, not pending). A pointer whose version is gone (only reachable through manual SQL) is
     * left out.
     */
    private static List<ExportedRelease> releaseEntries(
            AssetVersion draft, List<AssetRelease> pointers, Map<Long, AssetVersion> releasedVersions,
            Set<String> everReleased, Map<Long, String> uuidByAssetId) {
        Asset asset = draft.getAsset();
        List<ExportedRelease> entries = new ArrayList<>();
        Set<String> open = pointers.stream().map(AssetRelease::getLocaleKey).collect(Collectors.toSet());
        if (!draft.isDeleted()) {
            everReleased.stream()
                    .filter(key -> !open.contains(key))
                    .forEach(key -> entries.add(ExportedRelease.unpublished(key)));
        }
        for (AssetRelease pointer : pointers) {
            String uid = Objects.equals(pointer.getReleasedUid(), asset.getUid()) ? null : pointer.getReleasedUid();
            if (pointer.getReleasedVersionId().equals(draft.getId())) {
                entries.add(ExportedRelease.draftEquals(pointer.getLocaleKey(), uid));
                continue;
            }
            AssetVersion released = releasedVersions.get(pointer.getReleasedVersionId());
            if (released == null) {
                continue;
            }
            boolean media = asset.getAssetType() == AssetType.MEDIA;
            entries.add(new ExportedRelease(
                    pointer.getLocaleKey(),
                    ExportedRelease.State.PAYLOAD,
                    uid,
                    released.getPayload(),
                    released.getDisplayName(),
                    released.getFolderId() == null ? null : uuidByAssetId.get(released.getFolderId()),
                    released.getFolderPath(),
                    released.getTemplateAssetId() == null ? null : uuidByAssetId.get(released.getTemplateAssetId()),
                    media ? released.getMimeType() : null,
                    media ? released.getSizeBytes() : null));
        }
        entries.sort(Comparator.comparing(ExportedRelease::locale));
        return entries;
    }

    /**
     * Expands the caller's explicit {@code assetUuids} picks into the full set of asset
     * ids to export: a picked folder pulls in every live descendant transitively (matched
     * by {@code folderPath} prefix), a picked record set pulls in its live records (M25), a
     * picked non-folder asset is included by itself (its own template reference is
     * deliberately left out, see {@link ProjectExportImportService#exportSelection}, except
     * for the implicit picks named there), and every ancestor folder of an included asset is
     * always added too, up to the project root.
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
                } else if (picked.getAsset().getAssetType() == AssetType.RECORD_SET) {
                    // A record set is a container (M25), like a folder: picking it picks its live records. They
                    // share the set's folder path, so they are matched by parent, not by path prefix.
                    included.add(picked.getAssetId());
                    for (AssetVersion candidate : versions) {
                        if (Objects.equals(candidate.getFolderId(), picked.getAssetId())) {
                            included.add(candidate.getAssetId());
                        }
                    }
                } else {
                    included.add(picked.getAssetId());
                }
            }
        }

        // Implicit provenance of the Content store (M19.1.3, M25): a record is meaningless outside its record
        // set, and a record or set without its schema. A picked record pulls in its set, and every record or
        // set its dataset — as implicit picks, exactly like an ancestor folder, so an import can reuse an
        // existing copy. (The set is the record's parent, so the ancestor walk below would find it too; it is
        // named here so that its dataset joins as well.)
        Set<Long> ancestors = new HashSet<>();
        for (Long id : List.copyOf(included)) {
            AssetVersion version = versionByAssetId.get(id);
            if (version.getAsset().getAssetType() != AssetType.RECORD) {
                continue;
            }
            Long setId = version.getFolderId();
            AssetVersion set = setId == null ? null : versionByAssetId.get(setId);
            if (set != null && set.getAsset().getAssetType() == AssetType.RECORD_SET && !included.contains(setId)) {
                ancestors.add(setId);
            }
        }
        Set<Long> contentAssets = new HashSet<>(included);
        contentAssets.addAll(ancestors);
        for (Long id : contentAssets) {
            AssetVersion version = versionByAssetId.get(id);
            AssetType type = version.getAsset().getAssetType();
            Long datasetId = type == AssetType.RECORD || type == AssetType.RECORD_SET ? version.getTemplateAssetId() : null;
            if (datasetId != null && !included.contains(datasetId) && versionByAssetId.containsKey(datasetId)) {
                ancestors.add(datasetId);
            }
        }

        // A page template that extends another can't render without its chain (M20.2.2): every ancestor
        // template joins as an implicit pick, like a record's dataset.
        Map<UUID, AssetVersion> byUuid = new HashMap<>();
        versions.forEach(version -> byUuid.put(version.getAsset().getUuid(), version));
        for (Long id : List.copyOf(included)) {
            AssetVersion version = versionByAssetId.get(id);
            if (version.getAsset().getAssetType() != AssetType.PAGE_TEMPLATE) {
                continue;
            }
            Set<UUID> seen = new HashSet<>();
            UUID parent = TemplateHierarchy.TemplateVersion.parentTemplateRef(version.getPayload());
            while (parent != null && seen.add(parent) && byUuid.containsKey(parent)) {
                AssetVersion ancestor = byUuid.get(parent);
                if (!included.contains(ancestor.getAssetId())) {
                    ancestors.add(ancestor.getAssetId());
                }
                parent = TemplateHierarchy.TemplateVersion.parentTemplateRef(ancestor.getPayload());
            }
        }

        // Always include every ancestor folder up to the project root.
        Set<Long> withImplicit = new HashSet<>(included);
        withImplicit.addAll(ancestors);
        for (Long id : withImplicit) {
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
        ArchiveContent archive = readArchive(zipBytes);
        ReleaseMode releaseMode = releaseMode(archive.manifest(), options);
        ArchiveContent content = archive.forReleaseMode(releaseMode);
        ExportManifest manifest = content.manifest();

        // Re-run the exact same conflict detection analyzeImport uses, unconditionally — a
        // caller that skipped straight past a blocking analyzeImport report (or never called it
        // at all) must still be refused here, before any write happens. A same-type
        // DUPLICATE_UUID is never in this set (its severity is WARNING, not BLOCKING — the import
        // always wins by overwriting, see the remap/overwritten map below); a
        // DUPLICATE_UUID_TYPE_MISMATCH always is, since there is no safe automatic resolution for
        // it.
        ConflictReport report = detectConflicts(targetProjectId, content, options);
        List<ImportConflict> hardBlocking = report.conflicts().stream()
                .filter(ImportConflict::blocksImport)
                .toList();
        assertNoBlockingConflicts(new ConflictReport(hardBlocking));
        // A conflict that rejects only its own asset (M25: a record outside a record set) keeps that asset out
        // of the import; everything else in the archive imports.
        Set<String> rejected = report.conflicts().stream()
                .filter(c -> c.type().rejectsAssetOnly())
                .map(c -> c.elementUuid().toLowerCase())
                .collect(Collectors.toSet());

        List<ExportedAsset> assets = content.assets();

        Revision revision = revisionService.allocate(
                targetProjectId, ChangeType.IMPORT, ctx.comment(), ctx.userId());

        // Every asset keeps its source UUID (feature cross-project-import-identity, M9.3.1) —
        // this service never mints a substitute identity for a colliding asset, since doing so
        // would sever the cross-project identity M9 exists to preserve. Three outcomes per asset:
        // (1) no collision — a brand-new asset is created under its source UUID; (2) a same-type
        // collision that was only implicitly included (an ancestor folder, never an explicit pick
        // — asset.isExplicit() is false) and skipExistingImplicit is on (feature
        // selection-provenance, M11.2.2) — the existing target asset is left untouched and reused
        // as-is, recorded in `skipped`; (3) any other same-type collision — the import always
        // wins: the existing asset's content is overwritten with a new version, recorded in
        // `overwritten`. A type-mismatched collision never reaches this loop at all — it was
        // already refused above by assertNoBlockingConflicts.
        Map<String, UUID> remap = new HashMap<>();
        Set<String> overwritten = new HashSet<>();
        Set<String> skipped = new HashSet<>();
        for (ExportedAsset asset : assets) {
            String key = asset.uuid().toLowerCase();
            UUID sourceUuid = UUID.fromString(asset.uuid());
            Optional<Asset> existing = assetRepository.findByProjectIdAndUuid(targetProjectId, sourceUuid);
            remap.put(key, sourceUuid);
            if (existing.isPresent() && options.skipExistingImplicit() && !asset.isExplicit()) {
                skipped.add(key);
            } else if (existing.isPresent()) {
                overwritten.add(key);
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
        Set<String> fixedFolderKeys = new HashSet<>();
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
                fixedFolderKeys.add(key);
            }
        }

        // The fixed, protected "All Navigation", "All Templates", "All Pages", "All Media" and
        // "All Globals" wrapper roots (generalized from M13.1.2's two-fixed-folder pattern) get the exact same
        // resolve-not-create treatment: every project already has its own copy, so an archive's
        // copy must remap onto the target's existing folder rather than create a duplicate.
        fixedFolderKeys.addAll(resolveFixedFolder(
                findFixedFolderByUid(assets, FolderScope.NAVIGATION_ROOT_UID),
                assetService.ensureNavigationRootFolder(targetProjectId, ctx),
                targetProjectId, remap, idMaps));
        fixedFolderKeys.addAll(resolveFixedFolder(
                findFixedFolderByUid(assets, FolderScope.TEMPLATES_ROOT_UID),
                assetService.ensureTemplatesRootFolder(targetProjectId, ctx),
                targetProjectId, remap, idMaps));
        fixedFolderKeys.addAll(resolveFixedFolder(
                findFixedFolderByUid(assets, FolderScope.PAGES_ROOT_UID),
                assetService.ensurePagesRootFolder(targetProjectId, ctx),
                targetProjectId, remap, idMaps));
        fixedFolderKeys.addAll(resolveFixedFolder(
                findFixedFolderByUid(assets, FolderScope.MEDIA_ROOT_UID),
                assetService.ensureMediaRootFolder(targetProjectId, ctx),
                targetProjectId, remap, idMaps));
        fixedFolderKeys.addAll(resolveFixedFolder(
                findFixedFolderByUid(assets, FolderScope.GLOBALS_ROOT_UID),
                assetService.ensureGlobalsRootFolder(targetProjectId, ctx),
                targetProjectId, remap, idMaps));
        fixedFolderKeys.addAll(resolveFixedFolder(
                findFixedFolderByUid(assets, FolderScope.CONTENT_ROOT_UID),
                assetService.ensureContentRootFolder(targetProjectId, ctx),
                targetProjectId, remap, idMaps));

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

        // A record may join a record set the target already has and the archive doesn't carry (M25): that set
        // resolves like a skipped asset, so the record takes its id and folder path.
        Set<String> archiveKeys = assets.stream().map(a -> a.uuid().toLowerCase()).collect(Collectors.toSet());
        for (ExportedAsset asset : assets) {
            String parentUuid = asset.parentFolderUuid();
            if (!AssetType.RECORD.name().equals(asset.type()) || rejected.contains(asset.uuid().toLowerCase())
                    || parentUuid == null || archiveKeys.contains(parentUuid.toLowerCase()) || idMaps.idOf(parentUuid) != null) {
                continue;
            }
            Asset set = assetRepository.findByProjectIdAndUuid(targetProjectId, UUID.fromString(parentUuid))
                    .orElseThrow(() -> new SfException(ProblemFactory.notFound("Record set not found.")));
            AssetVersion setVersion = assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(set.getId())
                    .orElseThrow(() -> new SfException(ProblemFactory.notFound("Record set has no current version.")));
            idMaps.put(parentUuid.toLowerCase(), set.getId(), setVersion.getFolderPath());
        }

        Set<String> importedShas = new HashSet<>();
        for (ExportedAsset asset : assets) {
            if ("MEDIA".equals(asset.type())) {
                // Once per blob and asset, whether the draft, a released version or both hold it.
                Map<String, String> shas = blobShas(asset.payload());
                if (releaseMode == ReleaseMode.KEEP) {
                    asset.releases().forEach(entry -> blobShas(entry.payload()).forEach(shas::putIfAbsent));
                }
                shas.forEach((sha, mime) -> importBlob(sha, mime, content.blobs(), importedShas));
            }
        }

        Instant importedAt = Instant.now();
        int created = 0;
        int updated = 0;
        List<AssetVersion> importedVersions = new ArrayList<>();
        List<ImportedDraft> imported = new ArrayList<>();
        for (ExportedAsset asset : order(assets, rootAsset)) {
            String key = asset.uuid().toLowerCase();
            if (asset == rootAsset || skipped.contains(key) || fixedFolderKeys.contains(key) || rejected.contains(key)) {
                continue;
            }
            AssetVersion draft = createImportedAsset(targetProjectId, asset, remap, overwritten, idMaps, manifest,
                    importedAt, revision.getRevisionId(), ctx);
            importedVersions.add(draft);
            imported.add(new ImportedDraft(asset, draft, overwritten.contains(key)));
            if (overwritten.contains(key)) {
                updated++;
            } else {
                created++;
            }
        }

        // Outgoing reference rows for every imported asset, in the import's revision (§5.4) —
        // only once all assets exist, since a reference may point at an asset imported later.
        for (AssetVersion version : importedVersions) {
            referenceMaterializer.materialize(version.getAsset(), version);
        }

        int released = releaseMode == ReleaseMode.KEEP
                ? importReleaseState(targetProjectId, content, imported, remap, idMaps, manifest, importedAt, revision, ctx)
                : 0;

        if (content.settings() != null) {
            importSettings(targetProjectId, content.settings());
        }

        return new ImportResult(manifest.sourceProjectKey(), created, updated, importedShas.size(), released);
    }

    @Override
    @Transactional(readOnly = true)
    public ConflictReport analyzeImport(long targetProjectId, byte[] zipBytes, ImportOptions options) {
        ArchiveContent archive = readArchive(zipBytes);
        return detectConflicts(targetProjectId, archive.forReleaseMode(releaseMode(archive.manifest(), options)), options);
    }

    /** The release mode an import applies: the requested one, or {@link ReleaseMode#DRAFT} without release state. */
    private static ReleaseMode releaseMode(ExportManifest manifest, ImportOptions options) {
        return manifest.protocolVersion() >= RELEASE_STATE_PROTOCOL ? options.releaseMode() : ReleaseMode.DRAFT;
    }

    /**
     * The languages the target project will have once the import has run: its own, or — when it has none — the
     * archive's, which {@link #importSettings} adopts.
     */
    private LocaleConfig effectiveLocales(long targetProjectId, ArchiveContent content) {
        LocaleConfig target = projectLocales.forProject(targetProjectId);
        if (target.isLocalized() || content.settings() == null || content.settings().locales() == null) {
            return target;
        }
        return content.settings().locales();
    }

    /**
     * The languages of the archive (M27.5.1): the manifest's list, else — an archive without it — the languages of
     * its settings, else none.
     */
    private static Set<String> archiveLocales(ArchiveContent content) {
        if (content.manifest().locales() != null) {
            return Set.copyOf(content.manifest().locales());
        }
        if (content.settings() != null && content.settings().locales() != null) {
            return Set.copyOf(content.settings().locales().codes());
        }
        return Set.of();
    }

    /**
     * The release entries of an archived asset keyed by the locale key they get in the target (M27.5.1, epic
     * decision 4): an entry whose key the asset has there is kept. The shared key {@code ""} stands for every
     * language of the archive, so it releases the target languages that are also the archive's ({@code
     * archiveLocales}) and that no entry names; a target language the archive doesn't have stays unreleased. An
     * archive without languages counts as the target's default language: its single-language content is that. Any
     * other key — and a shared entry that matches no target language — is added to {@code dropped}. Empty for an
     * asset that isn't releasable.
     */
    private static Map<String, ExportedRelease> targetPointers(
            ExportedAsset asset, LocaleConfig locales, Set<String> archiveLocales, List<String> dropped) {
        Map<String, ExportedRelease> out = new LinkedHashMap<>();
        AssetType type = AssetType.valueOf(asset.type());
        if (asset.releases().isEmpty() || !ReleasableTypes.isReleasable(type, asset.payload(), asset.uid())) {
            return out;
        }
        List<String> keys = ReleaseLocales.keysFor(locales, type, asset.payload());
        ExportedRelease shared = null;
        for (ExportedRelease entry : asset.releases()) {
            String locale = entry.locale() == null ? ReleaseLocales.ALL : entry.locale();
            if (keys.contains(locale)) {
                out.put(locale, entry);
            } else if (ReleaseLocales.ALL.equals(locale)) {
                shared = entry;
            } else if (entry.state() != ExportedRelease.State.UNPUBLISHED) {
                dropped.add(locale); // an unpublished key renders nothing: losing it needs no warning
            }
        }
        if (shared != null) {
            Set<String> languages = archiveLocales.isEmpty() && locales.defaultLocale() != null
                    ? Set.of(locales.defaultLocale())
                    : archiveLocales;
            boolean matched = false;
            for (String key : keys) {
                if (languages.contains(key)) {
                    out.putIfAbsent(key, shared);
                    matched = true;
                }
            }
            if (!matched && shared.state() != ExportedRelease.State.UNPUBLISHED) {
                dropped.add(ReleaseLocales.ALL);
            }
        }
        return out;
    }

    /** {@link ConflictType#RELEASE_LOCALE_MISSING} per asset released in a locale the target won't have. */
    private List<ImportConflict> releaseLocaleConflicts(long targetProjectId, ArchiveContent content) {
        LocaleConfig locales = effectiveLocales(targetProjectId, content);
        Set<String> archiveLocales = archiveLocales(content);
        List<ImportConflict> conflicts = new ArrayList<>();
        for (ExportedAsset asset : content.assets()) {
            List<String> dropped = new ArrayList<>();
            targetPointers(asset, locales, archiveLocales, dropped);
            if (dropped.isEmpty()) {
                continue;
            }
            String label = asset.displayName() != null ? asset.displayName() : asset.uid();
            conflicts.add(ImportConflict.of(
                    ConflictType.RELEASE_LOCALE_MISSING,
                    asset.uuid(),
                    label,
                    dropped.contains(ReleaseLocales.ALL)
                            ? "Released for all languages, but none of this project's languages is in the archive: "
                                    + "imported as not released."
                            : "Released in " + String.join(", ", dropped.stream().map(l -> "'" + l + "'").toList())
                                    + (locales.isLocalized()
                                            ? ", which this project doesn't have"
                                            : ", but this project has no languages")
                                    + ": imported as not released there.",
                    asset.isExplicit()));
        }
        return conflicts;
    }

    /**
     * Opens the archive's release pointers for every imported asset in the import revision (M27.5.1, {@link
     * ReleaseMode#KEEP}). A pointer at the draft names the imported draft; every distinct released version is written
     * once — with the same remapping and provenance as the draft, so the locale projections compare exactly as they
     * did in the source — and closed in the import revision (see the class comment). An overwritten asset loses the
     * target's pointers: the import wins. An unpublished key gets a pointer valid at no revision (see the class
     * comment). Returns the number of pointers opened.
     */
    private int importReleaseState(
            long projectId, ArchiveContent content, List<ImportedDraft> imported, Map<String, UUID> remap,
            IdMaps idMaps, ExportManifest manifest, Instant importedAt, Revision revision, RevisionContext ctx) {
        LocaleConfig locales = effectiveLocales(projectId, content);
        Set<String> archiveLocales = archiveLocales(content);
        long rev = revision.getRevisionId();
        PathRebase paths = PathRebase.of(content.assets(), idMaps);
        List<AssetRelease> closed = new ArrayList<>();
        List<AssetRelease> opened = new ArrayList<>();
        List<AssetChange> summary = new ArrayList<>();
        for (ImportedDraft item : imported) {
            Asset asset = item.draft().getAsset();
            if (item.overwrite()) {
                for (AssetRelease pointer : releaseRepository.findByAssetIdAndValidToRevisionIsNull(asset.getId())) {
                    pointer.setValidToRevision(rev);
                    closed.add(pointer);
                }
            }
            Map<String, AssetVersion> releasedByContent = new HashMap<>();
            for (Map.Entry<String, ExportedRelease> target : targetPointers(item.source(), locales, archiveLocales, new ArrayList<>()).entrySet()) {
                ExportedRelease entry = target.getValue();
                if (entry.state() == ExportedRelease.State.UNPUBLISHED) {
                    if (!item.draft().isDeleted()) {
                        AssetRelease history = new AssetRelease(projectId, asset.getId(), target.getKey(),
                                item.draft().getId(), asset.getUid(), rev, ctx.userId(), importedAt);
                        history.setValidToRevision(rev);
                        opened.add(history);
                    }
                    continue;
                }
                AssetVersion version;
                if (entry.state() == ExportedRelease.State.PAYLOAD) {
                    version = releasedByContent.computeIfAbsent(signature(entry), s -> writeReleasedVersion(
                            projectId, item, entry, remap, idMaps, paths, manifest, importedAt, rev, ctx));
                } else if (!item.draft().isDeleted()) {
                    version = item.draft();
                } else {
                    continue; // a tombstone is never released; a hand-edited archive can't make it so
                }
                String uid = entry.uid() != null ? entry.uid() : asset.getUid();
                opened.add(new AssetRelease(
                        projectId, asset.getId(), target.getKey(), version.getId(), uid, rev, ctx.userId(), importedAt));
                summary.add(AssetChange.release(asset.getUuid().toString(), asset.getAssetType().name(), asset.getUid(),
                        "RELEASE", target.getKey(), version.getId()));
            }
        }
        releaseRepository.saveAll(closed);
        releaseRepository.saveAll(opened);
        if (!summary.isEmpty()) {
            revisionService.appendSummaries(projectId, rev, summary);
        }
        return summary.size();
    }

    /** One released version's content as a key: entries of several locales that carry the same content share a version. */
    private String signature(ExportedRelease entry) {
        ObjectNode node = objectMapper.valueToTree(entry);
        node.remove("locale");
        node.remove("uid");
        return node.toString();
    }

    /**
     * Writes a released version of an imported asset, opened and closed in the import revision. Its parent and
     * template resolve like the draft's; a parent the archive doesn't hold falls back to the draft's placement, and
     * its folder path is the archive's, rebased onto the target's folders.
     */
    private AssetVersion writeReleasedVersion(
            long projectId, ImportedDraft item, ExportedRelease entry, Map<String, UUID> remap, IdMaps idMaps,
            PathRebase paths, ExportManifest manifest, Instant importedAt, long revision, RevisionContext ctx) {
        AssetVersion draft = item.draft();
        Long parentId = idMaps.idOf(entry.parentFolderUuid());
        AssetVersion version = new AssetVersion(
                draft.getAssetId(),
                revision,
                entry.displayName(),
                withOrigin(UuidRemapper.remap(entry.payload(), remap), manifest, importedAt, item.overwrite()),
                ctx.userId(),
                importedAt);
        version.setFolderId(parentId != null ? parentId : draft.getFolderId());
        version.setFolderPath(parentId != null && entry.folderPath() != null
                ? paths.rebase(entry.folderPath())
                : draft.getFolderPath());
        version.setTemplateAssetId(templateIdOf(projectId, entry.templateUuid(), remap, idMaps));
        if (draft.getAsset().getAssetType() == AssetType.MEDIA) {
            version.setMimeType(entry.mimeType());
            version.setSizeBytes(entry.sizeBytes());
        }
        version.setValidToRevision(revision);
        version.setAsset(draft.getAsset());
        return assetVersionRepository.save(version);
    }

    /**
     * What the languages of the archive and of the target project say about each other (M24.5.1).
     * Both findings are warnings: nothing is lost either way, but the operator should know that some
     * translations will sit unused, or that some values arrive with the wrong shape until a migration
     * runs.
     */
    private List<ImportConflict> localeConflicts(long targetProjectId, ArchiveContent content) {
        com.acme.staticforge.project.LocaleConfig target = projectLocales.forProject(targetProjectId);
        com.acme.staticforge.project.LocaleConfig archive =
                content.settings() == null || content.settings().locales() == null
                        ? com.acme.staticforge.project.LocaleConfig.EMPTY
                        : content.settings().locales();
        List<ImportConflict> conflicts = new ArrayList<>();

        if (archive.isLocalized() && target.isLocalized() && !archive.codes().equals(target.codes())) {
            List<String> onlyInArchive = archive.codes().stream().filter(code -> !target.declares(code)).toList();
            List<String> onlyInTarget = target.codes().stream().filter(code -> !archive.declares(code)).toList();
            conflicts.add(ImportConflict.of(
                    ConflictType.LOCALE_CONFIG_MISMATCH,
                    null,
                    null,
                    "The archive's languages " + archive.codes() + " differ from this project's " + target.codes()
                            + (onlyInArchive.isEmpty()
                                    ? ""
                                    : ". Values for " + onlyInArchive + " are kept but unused until those languages are added")
                            + (onlyInTarget.isEmpty()
                                    ? ""
                                    : ". " + onlyInTarget + " will have no translations from this archive")
                            + "."));
        }

        // Does any imported payload carry language-dependent values?
        boolean archiveHasL10n = content.assets().stream()
                .anyMatch(asset -> com.acme.staticforge.common.L10nValues.containsL10n(asset.payload()));
        boolean expected = archive.isLocalized() || target.isLocalized();
        if (archiveHasL10n && !target.isLocalized()) {
            conflicts.add(ImportConflict.of(
                    ConflictType.LOCALIZATION_SHAPE_MISMATCH,
                    null,
                    null,
                    "The archive holds values in several languages, but this project has none configured. "
                            + "The values are imported as they are; adding languages, or saving the template, "
                            + "migrates their shape."));
        } else if (!archiveHasL10n && target.isLocalized() && expected) {
            conflicts.add(ImportConflict.of(
                    ConflictType.LOCALIZATION_SHAPE_MISMATCH,
                    null,
                    null,
                    "This project has languages configured, but the archive's values are single-language. "
                            + "They are imported as they are; the next template save migrates their shape."));
        }
        return conflicts;
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
        conflicts.addAll(localeConflicts(targetProjectId, content));
        boolean releaseState = manifest.protocolVersion() >= RELEASE_STATE_PROTOCOL;
        ReleaseMode releaseMode = releaseMode(manifest, options);
        if (!releaseState) {
            conflicts.add(ImportConflict.of(
                    ConflictType.ARCHIVE_WITHOUT_RELEASE_STATE,
                    null,
                    null,
                    "This archive has no release state — everything is imported as draft."));
        } else if (releaseMode == ReleaseMode.KEEP) {
            conflicts.addAll(releaseLocaleConflicts(targetProjectId, content));
        }
        List<ExportedAsset> assets = content.assets();
        Set<String> archiveUuids = assets.stream()
                .map(a -> a.uuid().toLowerCase(Locale.ROOT))
                .collect(Collectors.toSet());
        Map<String, ExportedAsset> archiveByUuid = new HashMap<>();
        assets.forEach(asset -> archiveByUuid.put(asset.uuid().toLowerCase(Locale.ROOT), asset));

        for (ExportedAsset asset : assets) {
            String label = asset.displayName() != null ? asset.displayName() : asset.uid();
            boolean record = AssetType.RECORD.name().equals(asset.type());
            boolean recordSet = AssetType.RECORD_SET.name().equals(asset.type());

            // Record set containment (M25) — decided first for a record, because a record outside a set is
            // rejected on its own (epic decision 8): nothing else about it matters, since it is never written.
            Optional<ImportConflict> containment = record
                    ? recordContainmentConflict(targetProjectId, asset, label, archiveByUuid, options)
                    : Optional.empty();
            if (containment.isPresent() && containment.get().type().rejectsAssetOnly()) {
                conflicts.add(containment.get());
                continue;
            }
            containment.ifPresent(conflicts::add);

            Optional<Asset> existingAsset =
                    assetRepository.findByProjectIdAndUuid(targetProjectId, UUID.fromString(asset.uuid()));
            if (existingAsset.isPresent() && existingAsset.get().getAssetType() != AssetType.valueOf(asset.type())) {
                // Type mismatch is always reported and always blocking, regardless of
                // skipExistingImplicit — it can never be resolved by overwriting or skipping,
                // and silently importing a different-typed asset under an existing UUID would
                // corrupt the target project's identity model.
                conflicts.add(ImportConflict.of(
                        ConflictType.DUPLICATE_UUID_TYPE_MISMATCH,
                        asset.uuid(),
                        label,
                        "An asset with this UUID already exists in the target project as a different type ("
                                + existingAsset.get().getAssetType() + " vs. " + asset.type() + ").",
                        asset.isExplicit()));
            } else if (existingAsset.isPresent()) {
                // Report-visibility filtering only (feature selection-provenance, M11.2.2):
                // skipExistingImplicit hides a DUPLICATE_UUID conflict from this report when the
                // colliding asset was never one of the caller's explicit picks (asset.isExplicit()
                // is false) — such assets are skipped on import, never overwritten, so there is
                // nothing here worth warning about.
                boolean suppressed = options.skipExistingImplicit() && !asset.isExplicit();
                if (!suppressed) {
                    conflicts.add(ImportConflict.of(
                            ConflictType.DUPLICATE_UUID,
                            asset.uuid(),
                            label,
                            "An asset with this UUID already exists in the target project and will be overwritten by the import.",
                            asset.isExplicit()));
                }
            }

            if (recordSet) {
                conflicts.addAll(recordSetConflicts(targetProjectId, asset, label, existingAsset, archiveByUuid, options));
            }

            // A set's dataset (its templateUuid) is checked by recordSetConflicts.
            String templateUuid = asset.templateUuid();
            if (templateUuid != null && !templateUuid.isBlank() && !recordSet) {
                boolean satisfied = archiveUuids.contains(templateUuid.toLowerCase(Locale.ROOT))
                        || assetRepository.findByProjectIdAndUuid(targetProjectId, UUID.fromString(templateUuid))
                                .isPresent();
                if (!satisfied && record) {
                    conflicts.add(ImportConflict.of(
                            ConflictType.RECORD_DATASET_MISSING,
                            asset.uuid(),
                            label,
                            "Belongs to dataset " + templateUuid
                                    + ", which is not in this archive and does not exist in the target project.",
                            asset.isExplicit()));
                } else if (!satisfied) {
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

            UUID parentTemplate = AssetType.PAGE_TEMPLATE.name().equals(asset.type())
                    ? TemplateHierarchy.TemplateVersion.parentTemplateRef(asset.payload())
                    : null;
            if (parentTemplate != null
                    && !archiveUuids.contains(parentTemplate.toString().toLowerCase(Locale.ROOT))
                    && assetRepository.findByProjectIdAndUuid(targetProjectId, parentTemplate).isEmpty()) {
                conflicts.add(ImportConflict.of(
                        ConflictType.PARENT_TEMPLATE_MISSING,
                        asset.uuid(),
                        label,
                        "Extends page template " + parentTemplate
                                + ", which is not in this archive and does not exist in the target project.",
                        asset.isExplicit()));
            }

            // A record's parent is its record set, checked above — it may also be a set the target already has.
            String parentFolderUuid = asset.parentFolderUuid();
            if (!record && parentFolderUuid != null && !archiveUuids.contains(parentFolderUuid.toLowerCase(Locale.ROOT))) {
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
            List<TargetImportPlan.Decision> targetPlan = TargetImportPlan.plan(
                    generationTargetRepository.findByProjectId(targetProjectId), content.settings().targets());
            for (TargetImportPlan.Decision decision : targetPlan) {
                String name = decision.source().name();
                switch (decision.action()) {
                    case SKIP_NAME_COLLISION -> conflicts.add(ImportConflict.of(
                            ConflictType.SETTINGS_KEY_COLLISION,
                            null,
                            name,
                            "A generation target named '" + name
                                    + "' already exists in the target project and will be skipped."));
                    case IMPORT_WITHOUT_PATH -> conflicts.add(ImportConflict.of(
                            ConflictType.TARGET_PATH_COLLISION,
                            null,
                            name,
                            "Generation target '" + name + "' will be imported without its output folder because "
                                    + decision.reason() + "; it will publish to its default folder instead."));
                    case IMPORT -> {
                        // no conflict
                    }
                }
            }
        }

        return new ConflictReport(conflicts, releaseState, releaseMode);
    }

    /**
     * Where an archived record would land (M25, epic decision 2), judged by {@link RecordSetContainment} — the
     * rule every other write path applies: {@link ConflictType#RECORD_OUTSIDE_RECORD_SET} for a record in the
     * Content store root or a Content folder (every pre-M25 archive), {@link ConflictType#RECORD_SET_MISSING} for
     * a set that is neither in the archive nor live in the target, and {@link
     * ConflictType#RECORD_SET_DATASET_MISMATCH} for a set of another dataset.
     */
    private Optional<ImportConflict> recordContainmentConflict(
            long targetProjectId, ExportedAsset record, String label, Map<String, ExportedAsset> archiveByUuid,
            ImportOptions options) {
        String parentUuid = record.parentFolderUuid();
        Optional<Placement> parent = placement(targetProjectId, parentUuid, archiveByUuid, options);
        if (parent.isEmpty()) {
            return Optional.of(ImportConflict.of(
                    ConflictType.RECORD_SET_MISSING,
                    record.uuid(),
                    label,
                    "Belongs to record set " + parentUuid
                            + ", which is not in this archive and does not exist in the target project.",
                    record.isExplicit()));
        }
        Placement set = parent.get();
        return RecordSetContainment.violation(AssetType.RECORD, record.payload(), set.type(), set.payload(), set.deleted())
                .map(detail -> {
                    ConflictType type = set.type() != AssetType.RECORD_SET
                            ? ConflictType.RECORD_OUTSIDE_RECORD_SET
                            : set.deleted() ? ConflictType.RECORD_SET_MISSING : ConflictType.RECORD_SET_DATASET_MISMATCH;
                    String prefix = type == ConflictType.RECORD_OUTSIDE_RECORD_SET
                            ? "Not imported: records from before record sets are not migrated. "
                            : "";
                    return ImportConflict.of(type, record.uuid(), label, prefix + detail, record.isExplicit());
                });
    }

    /**
     * The record set checks of an archived set (M25): its dataset must be in the archive or the target
     * ({@link ConflictType#RECORD_SET_DATASET_MISSING}); overwriting a target set may not change its dataset
     * ({@link ConflictType#RECORD_SET_DATASET_MISMATCH}); and its stored query is re-validated against the
     * schema the set will have in the target ({@link ConflictType#RECORD_SET_QUERY_INVALID}, a warning — the set
     * imports and reads {@code queryValid: false}). A set that is skipped (an existing implicit pick) is not
     * written, so only its dataset is checked.
     */
    private List<ImportConflict> recordSetConflicts(
            long targetProjectId, ExportedAsset set, String label, Optional<Asset> existing,
            Map<String, ExportedAsset> archiveByUuid, ImportOptions options) {
        UUID dataset = datasetOf(set);
        Optional<JsonNode> datasetPayload = dataset == null
                ? Optional.empty()
                : placement(targetProjectId, dataset.toString(), archiveByUuid, options).map(Placement::payload);
        if (datasetPayload.isEmpty()) {
            return List.of(ImportConflict.of(
                    ConflictType.RECORD_SET_DATASET_MISSING,
                    set.uuid(),
                    label,
                    "Holds records of dataset " + dataset
                            + ", which is not in this archive and does not exist in the target project.",
                    set.isExplicit()));
        }
        if (existing.isEmpty() || existing.get().getAssetType() != AssetType.RECORD_SET) {
            return queryConflict(set, label, datasetPayload.get());
        }
        if (options.skipExistingImplicit() && !set.isExplicit()) {
            return List.of();
        }
        UUID targetDataset = assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(existing.get().getId())
                .map(version -> RecordValues.datasetRef(version.getPayload()))
                .orElse(null);
        if (targetDataset != null && !targetDataset.equals(dataset)) {
            return List.of(ImportConflict.of(
                    ConflictType.RECORD_SET_DATASET_MISMATCH,
                    set.uuid(),
                    label,
                    "Would overwrite a record set of dataset " + targetDataset + " with one of dataset " + dataset
                            + " — a record set's dataset never changes.",
                    set.isExplicit()));
        }
        return queryConflict(set, label, datasetPayload.get());
    }

    /** {@link ConflictType#RECORD_SET_QUERY_INVALID} when the set's stored query doesn't fit the dataset's schema. */
    private static List<ImportConflict> queryConflict(ExportedAsset set, String label, JsonNode datasetPayload) {
        RecordSetQuery query = RecordSetQuery.fromJson(set.payload() == null ? null : set.payload().get("query"));
        RecordSetQueries.Compiled compiled =
                RecordSetQueries.compile(query, TemplateContentDefinitions.of(datasetPayload));
        if (compiled.valid()) {
            return List.of();
        }
        return List.of(ImportConflict.of(
                ConflictType.RECORD_SET_QUERY_INVALID,
                set.uuid(),
                label,
                "The stored query does not fit the dataset's schema (" + compiled.diagnostics().get(0).message()
                        + "). The set is imported but shows no records until its query is fixed.",
                set.isExplicit()));
    }

    /** A record set's dataset: {@code payload.datasetRef}, else the mirrored {@code templateUuid}. */
    private static UUID datasetOf(ExportedAsset set) {
        UUID ref = RecordValues.datasetRef(set.payload());
        if (ref != null || set.templateUuid() == null || set.templateUuid().isBlank()) {
            return ref;
        }
        try {
            return UUID.fromString(set.templateUuid());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /**
     * What the asset {@code uuid} will be in the target once the import has run: the archive's copy, unless
     * that one is skipped as an existing implicit pick ({@link ImportOptions#skipExistingImplicit()}) or absent
     * — then the target's current version. Empty when it is in neither. A missing uuid is the store root (a
     * {@code FOLDER}, as {@link RecordSetContainment} expects).
     */
    private Optional<Placement> placement(
            long targetProjectId, String uuid, Map<String, ExportedAsset> archiveByUuid, ImportOptions options) {
        if (uuid == null || uuid.isBlank()) {
            return Optional.of(new Placement(AssetType.FOLDER, null, false));
        }
        UUID parsed;
        try {
            parsed = UUID.fromString(uuid);
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
        ExportedAsset archived = archiveByUuid.get(uuid.toLowerCase(Locale.ROOT));
        Optional<Asset> existing = assetRepository.findByProjectIdAndUuid(targetProjectId, parsed);
        if (archived != null && (existing.isEmpty() || archived.isExplicit() || !options.skipExistingImplicit())) {
            return Optional.of(new Placement(AssetType.valueOf(archived.type()), archived.payload(), false));
        }
        return existing.flatMap(asset -> assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(asset.getId())
                .map(version -> new Placement(asset.getAssetType(), version.getPayload(), version.isDeleted())));
    }

    /** An asset as the import will find it: its type, payload and whether it is soft-deleted. */
    private record Placement(AssetType type, JsonNode payload, boolean deleted) {}

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
                    body.put("blocksImport", c.blocksImport());
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
     * new entries, never overwrites. A target whose output folder is invalid or would clash
     * is imported without it ({@link TargetImportPlan}); both cases are reported by analysis.
     */
    private void importSettings(long targetProjectId, ExportedSettings settings) {
        // A target that already declares languages keeps its own: the archive describes the project
        // it came from, and silently re-pointing a live site's URLs would be the wrong default.
        if (settings.locales() != null && !projectLocales.forProject(targetProjectId).isLocalized()) {
            projectRepository.findById(targetProjectId).ifPresent(project -> {
                project.setLocaleConfig(objectMapper.valueToTree(settings.locales()));
                projectRepository.save(project);
            });
        }
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
        // A project has at most one default target (generation resolves it as a single row).
        boolean hasDefault = existingTargets.stream().anyMatch(GenerationTarget::isDefaultTarget);
        for (TargetImportPlan.Decision decision : TargetImportPlan.plan(existingTargets, settings.targets())) {
            if (decision.action() == TargetImportPlan.Action.SKIP_NAME_COLLISION) {
                continue;
            }
            ExportedGenerationTarget t = decision.source();
            boolean isDefault = t.isDefault() && !hasDefault;
            hasDefault |= isDefault;
            generationTargetRepository.save(new GenerationTarget(
                    targetProjectId, t.name(), TargetType.valueOf(t.type()), decision.config(), isDefault));
        }
    }

    /**
     * Writes one imported asset — either a brand-new {@link Asset} row (the common case), or,
     * for a same-type {@code uuid} collision ({@code overwritten}), a new {@link AssetVersion}
     * on the *existing* asset row: the import always wins, replacing the target's current
     * content rather than duplicating the archive's copy under a freshly-minted UUID. Either
     * way {@code uid} is never re-derived from the archive on overwrite — {@code Asset.uid} is
     * identity, changed only through the explicit rename flow, never as a side effect of import.
     */
    private AssetVersion createImportedAsset(
            long projectId, ExportedAsset asset, Map<String, UUID> remap, Set<String> overwritten, IdMaps idMaps,
            ExportManifest manifest, Instant importedAt, long revision, RevisionContext ctx) {
        AssetType type = AssetType.valueOf(asset.type());
        UUID uuid = remap.get(asset.uuid().toLowerCase());
        boolean overwrite = overwritten.contains(asset.uuid().toLowerCase());

        Asset identity;
        long assetId;
        String uid;
        String changeAction;
        if (overwrite) {
            Asset existing = assetRepository.findByProjectIdAndUuid(projectId, uuid)
                    .orElseThrow(() -> new SfException(ProblemFactory.notFound("Existing asset not found for overwrite.")));
            identity = existing;
            assetId = existing.getId();
            uid = existing.getUid();
            changeAction = "UPDATE";
            assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(assetId).ifPresent(current -> {
                current.setValidToRevision(revision);
                assetVersionRepository.save(current);
            });
        } else {
            uid = uidGenerator.deriveUid(asset.uid(), asset.displayName(), projectId, type);
            Asset saved = assetRepository.save(new Asset(uuid, projectId, type, uid, importedAt, ctx.userId()));
            identity = saved;
            assetId = saved.getId();
            changeAction = "CREATE";
        }

        Long parentFolderId = idMaps.idOf(asset.parentFolderUuid());
        String parentPath = idMaps.pathOf(asset.parentFolderUuid());
        String folderPath = type == AssetType.FOLDER
                ? pathService.childPath(parentPath, uid)
                : pathService.contentPath(parentPath);
        Long templateAssetId = templateIdOf(projectId, asset.templateUuid(), remap, idMaps);
        ObjectNode payload = withOrigin(UuidRemapper.remap(asset.payload(), remap), manifest, importedAt, overwrite);

        idMaps.put(asset.uuid().toLowerCase(), assetId, folderPath);

        AssetVersion version = new AssetVersion(assetId, revision, asset.displayName(), payload, ctx.userId(), importedAt);
        // A deletion-pending asset (M27.5.1) arrives as its tombstone; its released versions are written separately.
        version.setDeleted(asset.isDraftDeleted());
        version.setFolderId(parentFolderId);
        version.setFolderPath(folderPath);
        version.setTemplateAssetId(templateAssetId);
        if (type == AssetType.MEDIA) {
            version.setMimeType(asset.mimeType());
            version.setSizeBytes(asset.sizeBytes());
        }
        version.setAsset(identity);
        AssetVersion saved = assetVersionRepository.save(version);

        revisionService.appendSummary(projectId, revision,
                new AssetChange(uuid.toString(), type.name(), uid, changeAction, List.of(), false));
        return saved;
    }

    /**
     * The id {@code templateUuid} (a template, or a record's dataset) has in the target: the imported asset, else —
     * when the archive doesn't carry it — the target's existing one, since a record without {@code
     * template_asset_id} drops out of every dataset query (M19.1.3).
     */
    private Long templateIdOf(long projectId, String templateUuid, Map<String, UUID> remap, IdMaps idMaps) {
        Long templateAssetId = idMaps.idOf(templateUuid);
        if (templateAssetId == null && templateUuid != null && !templateUuid.isBlank()) {
            UUID targetTemplate = remap.getOrDefault(templateUuid.toLowerCase(), UUID.fromString(templateUuid));
            templateAssetId = assetRepository.findByProjectIdAndUuid(projectId, targetTemplate).map(Asset::getId).orElse(null);
        }
        return templateAssetId;
    }

    /** A copy of an imported payload with its {@code origin} provenance (§6.1). */
    private static ObjectNode withOrigin(JsonNode remapped, ExportManifest manifest, Instant importedAt, boolean overwrite) {
        ObjectNode payload = JsonUtil.object(remapped).deepCopy();
        ObjectNode origin = payload.putObject("origin");
        origin.put("from", "import");
        origin.put("sourceProjectKey", manifest.sourceProjectKey());
        origin.put("importedAt", importedAt.toString());
        if (overwrite) {
            // Debugging/audit metadata only (§6.1) — the DB-level (project_id, uuid) existence
            // check is what actually drove the overwrite path, this just lets a human
            // inspecting the asset's history see this version replaced pre-existing content.
            origin.put("overwrite", true);
        }
        return payload;
    }

    /**
     * Every blob a media payload holds (M27.3.1): its file and variants, and those of each per-locale file of a
     * localized media asset.
     */
    private static Map<String, String> blobShas(JsonNode payload) {
        Map<String, String> shas = new LinkedHashMap<>();
        if (payload == null || !payload.isObject()) {
            return shas;
        }
        List<JsonNode> files = new ArrayList<>();
        files.add(payload);
        MediaFiles.localeFileKeys(payload).forEach(locale -> files.add(payload.path(MediaFiles.LOCALE_FILES).get(locale)));
        for (JsonNode file : files) {
            String sha = textOrNull(file.path("blobSha256"));
            if (sha != null) {
                shas.putIfAbsent(sha, textOrNull(file.path("mimeType")));
            }
            JsonNode variants = file.get("variants");
            if (variants != null && variants.isArray()) {
                for (JsonNode variant : variants) {
                    String variantSha = textOrNull(variant.path("blobSha256"));
                    if (variantSha != null) {
                        shas.putIfAbsent(variantSha, null);
                    }
                }
            }
        }
        return shas;
    }

    private void importBlob(String sha, String mimeType, Map<String, byte[]> archiveBlobs, Set<String> importedShas) {
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
                            sha, bytes.length, mimeType, blobStore.storageKey(sha), 1, Instant.now()));
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
        for (AssetType type : NON_FOLDER_ORDER) {
            assets.stream()
                    .filter(asset -> type.name().equals(asset.type()))
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
            } else if (FolderScope.DATASETS_UID.equals(asset.uid())) {
                found.put(AssetType.DATASET, asset);
            }
        }
        return found;
    }

    /** Matches an archive {@link ExportedAsset} of type {@code FOLDER} by well-known uid — the
     * single-root analogue of {@link #findFixedTemplateFolders} (used for {@code
     * FolderScope#NAVIGATION_ROOT_UID}/{@code TEMPLATES_ROOT_UID}, which have exactly one fixed
     * folder each rather than two keyed by kind). */
    private static ExportedAsset findFixedFolderByUid(List<ExportedAsset> assets, String uid) {
        for (ExportedAsset asset : assets) {
            if ("FOLDER".equals(asset.type()) && uid.equals(asset.uid())) {
                return asset;
            }
        }
        return null;
    }

    /**
     * Resolve-not-create for a single fixed, protected root folder: if the archive contains one
     * (by well-known uid), remap its uuid onto the target's own already-ensured copy and
     * pre-populate {@code idMaps} so descendants resolve their parent correctly. Returns the
     * archive key to exclude from the generic create loop (empty if the archive had none).
     */
    private Set<String> resolveFixedFolder(
            ExportedAsset archiveFolder, AssetVersionView targetFolder, long targetProjectId,
            Map<String, UUID> remap, IdMaps idMaps) {
        if (archiveFolder == null) {
            return Set.of();
        }
        Long targetFolderId = assetRepository.findByProjectIdAndUuid(targetProjectId, targetFolder.uuid())
                .map(Asset::getId)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Fixed root folder not found.")));
        String key = archiveFolder.uuid().toLowerCase();
        remap.put(key, targetFolder.uuid());
        idMaps.put(key, targetFolderId, targetFolder.folderPath());
        return Set.of(key);
    }

    private void collectBlobs(JsonNode payload, Map<String, byte[]> blobs) {
        for (String sha : blobShas(payload).keySet()) {
            if (!blobs.containsKey(sha) && blobStore.exists(sha)) {
                blobs.put(sha, blobStore.get(sha));
            }
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
        // The language configuration travels with the settings, so an archive restores a localized
        // project as one rather than as a single-language project holding L10N values (M24.5.1).
        com.acme.staticforge.project.LocaleConfig locales = projectLocales.forProject(projectId);
        return new ExportedSettings(channels, targets, locales.isLocalized() ? locales : null);
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
        List<ExportedAsset> legacyAssets = null;
        List<ExportedAsset> perFileAssets = null;
        ExportedSettings settings = null;
        Map<String, byte[]> blobs = new HashMap<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(zipBytes))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                String name = entry.getName();
                if (MANIFEST_ENTRY.equals(name)) {
                    manifest = objectMapper.readValue(zip.readAllBytes(), ExportManifest.class);
                } else if (ASSETS_ENTRY.equals(name)) {
                    legacyAssets =
                            new ArrayList<>(objectMapper.readValue(zip.readAllBytes(), ExportArchive.class).assets());
                } else if (name.startsWith(ASSETS_PREFIX)) {
                    if (perFileAssets == null) {
                        perFileAssets = new ArrayList<>();
                    }
                    perFileAssets.add(objectMapper.readValue(zip.readAllBytes(), ExportedAsset.class));
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
        // Two independent accumulators over the same one pass: legacyAssets (single assets.json,
        // M10-M13, protocolVersion <= 2) and perFileAssets (assets/<uuid>.json, M14.1+). An archive
        // is written by exactly one exporter version, so only one of these is ever non-empty for
        // any real archive — the per-file branch wins if both are somehow populated, since that
        // shape is what every current and future exporter writes (no dedicated error path needed
        // for a shape no real writer produces). Neither accumulator ending up populated is not
        // itself an error: a legitimate selection can have zero assets (e.g. a channels-only
        // export, ExportSelection with an empty assetUuids set and includeChannels true) — under
        // the per-file shape that means literally zero assets/ entries, which is indistinguishable
        // from "this shape wasn't used", so it's treated as an empty asset list rather than
        // rejected. Only a missing manifest.json (structurally required by every version) is a
        // real corruption signal.
        List<ExportedAsset> assets = perFileAssets != null ? perFileAssets
                : legacyAssets != null ? legacyAssets : new ArrayList<>();
        if (manifest == null) {
            throw new SfException(ProblemFactory.badRequest("Export archive is missing a manifest document."));
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
            ExportedSettings settings) {

        /**
         * The archive as an import in {@code mode} reads it: a {@link ReleaseMode#DRAFT} import leaves out the
         * deletion-pending assets (M27.5.1) — a tombstone is no draft, and without its released versions it would
         * only delete.
         */
        ArchiveContent forReleaseMode(ReleaseMode mode) {
            if (mode == ReleaseMode.KEEP || assets.stream().noneMatch(ExportedAsset::isDraftDeleted)) {
                return this;
            }
            List<ExportedAsset> drafts = assets.stream().filter(asset -> !asset.isDraftDeleted()).toList();
            return new ArchiveContent(manifest, drafts, blobs, settings);
        }
    }

    /** An imported asset: its archive entry, the draft version the import wrote, and whether it overwrote one. */
    private record ImportedDraft(ExportedAsset source, AssetVersion draft, boolean overwrite) {}

    /**
     * Moves archive folder paths onto the target's (M27.5.1): a released version carries the folder path it had in
     * the source project, and the folders above it may have other uids — hence other paths — in the target. The
     * longest archive folder path that prefixes a path is replaced by that folder's target path; a path under no
     * imported folder is kept.
     */
    private record PathRebase(Map<String, String> targetByArchivePath) {

        static PathRebase of(List<ExportedAsset> assets, IdMaps idMaps) {
            Map<String, String> map = new HashMap<>();
            map.put(PathService.ROOT_PATH, PathService.ROOT_PATH);
            for (ExportedAsset asset : assets) {
                String target = idMaps.pathOf(asset.uuid());
                if ("FOLDER".equals(asset.type()) && asset.folderPath() != null && target != null) {
                    map.put(asset.folderPath(), target);
                }
            }
            return new PathRebase(map);
        }

        String rebase(String archivePath) {
            String best = null;
            for (String prefix : targetByArchivePath.keySet()) {
                if (archivePath.startsWith(prefix) && (best == null || prefix.length() > best.length())) {
                    best = prefix;
                }
            }
            return best == null ? archivePath : targetByArchivePath.get(best) + archivePath.substring(best.length());
        }
    }
}
