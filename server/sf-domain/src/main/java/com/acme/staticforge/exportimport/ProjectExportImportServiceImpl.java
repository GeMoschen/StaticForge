package com.acme.staticforge.exportimport;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.UidGenerator;
import com.acme.staticforge.asset.folder.PathService;
import com.acme.staticforge.asset.media.Blob;
import com.acme.staticforge.asset.media.BlobRepository;
import com.acme.staticforge.asset.media.BlobStore;
import com.acme.staticforge.common.JsonUtil;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
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
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
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
 * revision machinery. Each asset receives a fresh UUIDv7, a UID re-derived by
 * {@link UidGenerator} so it stays unique, a remapped payload (via {@link UuidRemapper})
 * with {@code payload.origin} provenance (§6.1), and resolved folder/template edges.
 */
@Service
@RevisionAware
public class ProjectExportImportServiceImpl implements ProjectExportImportService {

    private static final String MANIFEST_ENTRY = "manifest.json";
    private static final String ASSETS_ENTRY = "assets.json";
    private static final String BLOBS_PREFIX = "blobs/";
    private static final String ROOT_UID = "root";

    /** Import order for non-folder assets: templates first, dependents last. */
    private static final List<String> NON_FOLDER_ORDER =
            List.of("SECTION_TEMPLATE", "PAGE_TEMPLATE", "MEDIA", "PAGE", "PAGE_REFERENCE");

    private final ProjectRepository projectRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final AssetRepository assetRepository;
    private final AssetService assetService;
    private final UidGenerator uidGenerator;
    private final PathService pathService;
    private final RevisionService revisionService;
    private final BlobStore blobStore;
    private final BlobRepository blobRepository;
    private final ObjectMapper objectMapper;

    public ProjectExportImportServiceImpl(
            ProjectRepository projectRepository,
            AssetVersionRepository assetVersionRepository,
            AssetRepository assetRepository,
            AssetService assetService,
            UidGenerator uidGenerator,
            PathService pathService,
            RevisionService revisionService,
            BlobStore blobStore,
            BlobRepository blobRepository,
            ObjectMapper objectMapper) {
        this.projectRepository = projectRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.assetRepository = assetRepository;
        this.assetService = assetService;
        this.uidGenerator = uidGenerator;
        this.pathService = pathService;
        this.revisionService = revisionService;
        this.blobStore = blobStore;
        this.blobRepository = blobRepository;
        this.objectMapper = objectMapper;
    }

    // ------------------------------------------------------------------
    // Export
    // ------------------------------------------------------------------

    @Override
    public byte[] exportProject(long projectId) {
        Project project = projectRepository.findById(projectId)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Project not found.")));

        List<AssetVersion> versions = assetVersionRepository.findCurrentSnapshot(projectId);
        Map<Long, String> uuidByAssetId = new HashMap<>();
        for (AssetVersion version : versions) {
            uuidByAssetId.put(version.getAssetId(), version.getAsset().getUuid().toString());
        }

        List<ExportedAsset> assets = new ArrayList<>();
        Map<String, byte[]> blobs = new TreeMap<>();
        for (AssetVersion version : versions) {
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
                    version.getSizeBytes()));
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

    // ------------------------------------------------------------------
    // Import
    // ------------------------------------------------------------------

    @Override
    @Transactional
    public ImportResult importProject(long targetProjectId, byte[] zipBytes, RevisionContext ctx) {
        ArchiveContent content = readArchive(zipBytes);
        ExportManifest manifest = content.manifest();
        if (manifest.protocolVersion() != PROTOCOL_VERSION) {
            throw new SfException(ProblemFactory.unprocessableEntity(
                    "Unsupported export protocol version " + manifest.protocolVersion() + "."));
        }

        List<ExportedAsset> assets = content.assets();

        Revision revision = revisionService.allocate(
                targetProjectId, ChangeType.IMPORT, ctx.comment(), ctx.userId());

        Map<String, UUID> remap = new HashMap<>();
        for (ExportedAsset asset : assets) {
            remap.put(asset.uuid().toLowerCase(), UuidV7.generate());
        }

        ExportedAsset rootAsset = findRootFolder(assets);
        AssetVersionView targetRoot = assetService.ensureRootFolder(targetProjectId, ctx);
        Long targetRootId = assetRepository.findByUuid(targetRoot.uuid())
                .map(Asset::getId)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Root folder not found.")));
        if (rootAsset != null) {
            remap.put(rootAsset.uuid().toLowerCase(), targetRoot.uuid());
        }

        IdMaps idMaps = new IdMaps();
        idMaps.put(rootAsset == null ? null : rootAsset.uuid().toLowerCase(), targetRootId, PathService.ROOT_PATH);

        Set<String> importedShas = new HashSet<>();
        for (ExportedAsset asset : assets) {
            if ("MEDIA".equals(asset.type())) {
                importBlobs(asset.payload(), content.blobs(), importedShas);
            }
        }

        Instant importedAt = Instant.now();
        int created = 0;
        for (ExportedAsset asset : order(assets, rootAsset)) {
            if (asset == rootAsset) {
                continue;
            }
            createImportedAsset(targetProjectId, asset, remap, idMaps, manifest, importedAt,
                    revision.getRevisionId(), ctx);
            created++;
        }

        return new ImportResult(manifest.sourceProjectKey(), created, importedShas.size());
    }

    private void createImportedAsset(
            long projectId, ExportedAsset asset, Map<String, UUID> remap, IdMaps idMaps,
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

    private void writeJson(ZipOutputStream zip, String name, Object value) throws IOException {
        zip.putNextEntry(new ZipEntry(name));
        zip.write(objectMapper.writeValueAsBytes(value));
        zip.closeEntry();
    }

    private ArchiveContent readArchive(byte[] zipBytes) {
        ExportManifest manifest = null;
        List<ExportedAsset> assets = null;
        Map<String, byte[]> blobs = new HashMap<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(zipBytes))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                String name = entry.getName();
                if (MANIFEST_ENTRY.equals(name)) {
                    manifest = objectMapper.readValue(zip.readAllBytes(), ExportManifest.class);
                } else if (ASSETS_ENTRY.equals(name)) {
                    assets = new ArrayList<>(objectMapper.readValue(zip.readAllBytes(), ExportArchive.class).assets());
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
        return new ArchiveContent(manifest, assets, blobs);
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
            ExportManifest manifest, List<ExportedAsset> assets, Map<String, byte[]> blobs) {}
}
