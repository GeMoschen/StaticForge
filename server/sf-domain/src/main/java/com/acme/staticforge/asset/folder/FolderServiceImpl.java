package com.acme.staticforge.asset.folder;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetUidHistoryRepository;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.ChildCount;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.reference.ReferenceMaterializer;
import com.acme.staticforge.common.JsonUtil;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.revision.AssetChange;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link FolderService} implementation. Subtree moves close and reopen every affected
 * version row in a single revision; deletion is {@code deleted=true} rows, never physical.
 */
@Service
@RevisionAware
public class FolderServiceImpl implements FolderService {

    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final AssetService assetService;
    private final PathService pathService;
    private final RevisionService revisionService;
    private final ReferenceMaterializer referenceMaterializer;
    private final AssetUidHistoryRepository assetUidHistoryRepository;

    public FolderServiceImpl(
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            AssetService assetService,
            PathService pathService,
            RevisionService revisionService,
            ReferenceMaterializer referenceMaterializer,
            AssetUidHistoryRepository assetUidHistoryRepository) {
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.assetService = assetService;
        this.pathService = pathService;
        this.revisionService = revisionService;
        this.referenceMaterializer = referenceMaterializer;
        this.assetUidHistoryRepository = assetUidHistoryRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public List<FolderNode> tree(long projectId, FolderScope scope, int depth, RevisionContext ctx) {
        return assemble(
                assetVersionRepository.findCurrentByProjectAndType(projectId, AssetType.FOLDER),
                Map.of(),
                scope,
                depth,
                scope == FolderScope.CONTENT ? recordSetNodes(projectId) : Map.of());
    }

    @Override
    @Transactional(readOnly = true)
    public List<FolderNode> treeAt(long projectId, FolderScope scope, int depth, long revision) {
        Map<Long, String> uids = assetUidHistoryRepository.uidsAt(projectId, revision);
        return assemble(
                assetVersionRepository.findValidAtByProjectAndType(projectId, AssetType.FOLDER, revision),
                uids,
                scope,
                depth,
                scope == FolderScope.CONTENT ? recordSetNodesAt(projectId, revision, uids) : Map.of());
    }

    /** The tree of {@code scope} from the folder versions read; {@code uids} overrides the uid of the assets in it. */
    private List<FolderNode> assemble(
            List<AssetVersion> folders,
            Map<Long, String> uids,
            FolderScope scope,
            int depth,
            Map<Long, List<FolderNode>> setsByFolder) {
        Map<Long, FolderInfo> info = new java.util.LinkedHashMap<>();
        Map<Long, List<Long>> children = new java.util.LinkedHashMap<>();
        Long hiddenRootId = null;
        for (AssetVersion version : folders) {
            Asset asset = version.getAsset();
            if (asset == null) {
                continue;
            }
            if (PathService.ROOT_UID.equals(asset.getUid())) {
                hiddenRootId = asset.getId();
            }
            info.put(asset.getId(), new FolderInfo(
                    asset.getUuid(), uids.getOrDefault(asset.getId(), asset.getUid()), version.getDisplayName(),
                    version.getFolderPath(), FolderScope.fromPayload(version.getPayload()),
                    FolderScope.isProtected(version.getPayload()), version.getValidFromRevision()));
            children.put(asset.getId(), new java.util.ArrayList<>());
        }
        List<Long> roots = new java.util.ArrayList<>();
        for (AssetVersion version : folders) {
            Long assetId = version.getAssetId();
            if (!children.containsKey(assetId) || assetId.equals(hiddenRootId)) {
                continue;
            }
            Long parentId = version.getFolderId();
            boolean topLevel = parentId == null || parentId.equals(hiddenRootId) || !children.containsKey(parentId);
            if (topLevel) {
                roots.add(assetId);
            } else {
                children.get(parentId).add(assetId);
            }
        }
        return roots.stream()
                .map(id -> toNode(id, info, children, setsByFolder, depth))
                .filter(node -> node.scope() == scope)
                .toList();
    }

    /**
     * The Content store's record sets as leaf nodes keyed by their folder's asset id (M25), each with its
     * live record count from one grouped query — never a count per set.
     */
    private Map<Long, List<FolderNode>> recordSetNodes(long projectId) {
        return recordSetNodes(
                assetVersionRepository.findCurrentByProjectAndType(projectId, AssetType.RECORD_SET),
                assetVersionRepository.countCurrentRecordsPerSet(projectId),
                Map.of());
    }

    /** {@link #recordSetNodes(long)} as of revision {@code revision}: the sets and record counts live then. */
    private Map<Long, List<FolderNode>> recordSetNodesAt(long projectId, long revision, Map<Long, String> uids) {
        return recordSetNodes(
                assetVersionRepository.findValidAtByProjectAndType(projectId, AssetType.RECORD_SET, revision),
                assetVersionRepository.countRecordsPerSetAt(projectId, revision),
                uids);
    }

    private static Map<Long, List<FolderNode>> recordSetNodes(
            List<AssetVersion> allSets, List<ChildCount> recordCounts, Map<Long, String> uids) {
        Map<Long, Long> counts = new java.util.HashMap<>();
        for (ChildCount count : recordCounts) {
            counts.put(count.folderId(), count.count());
        }
        Map<Long, List<FolderNode>> byFolder = new java.util.HashMap<>();
        List<AssetVersion> sets = allSets.stream()
                .sorted(java.util.Comparator.comparing(AssetVersion::getDisplayName, String.CASE_INSENSITIVE_ORDER))
                .toList();
        for (AssetVersion set : sets) {
            Asset asset = set.getAsset();
            byFolder.computeIfAbsent(set.getFolderId(), id -> new java.util.ArrayList<>()).add(new FolderNode(
                    asset.getUuid(), uids.getOrDefault(asset.getId(), asset.getUid()), set.getDisplayName(),
                    set.getFolderPath(), FolderScope.CONTENT, false, AssetType.RECORD_SET,
                    counts.getOrDefault(asset.getId(), 0L), set.getValidFromRevision(), List.of()));
        }
        return byFolder;
    }

    private static FolderNode toNode(Long id, java.util.Map<Long, FolderInfo> info,
            java.util.Map<Long, List<Long>> children, java.util.Map<Long, List<FolderNode>> setsByFolder, int depth) {
        FolderInfo f = info.get(id);
        List<FolderNode> childNodes = new java.util.ArrayList<>();
        if (depth != 0) {
            children.get(id).forEach(cid -> childNodes.add(toNode(cid, info, children, setsByFolder, depth - 1)));
            childNodes.addAll(setsByFolder.getOrDefault(id, List.of()));
        }
        return new FolderNode(
                f.uuid(), f.uid(), f.displayName(), f.path(), f.scope(), f.protectedFolder(), AssetType.FOLDER, null,
                f.revision(), List.copyOf(childNodes));
    }

    private record FolderInfo(UUID uuid, String uid, String displayName, String path, FolderScope scope, boolean protectedFolder,
            long revision) {}

    @Override
    @Transactional
    public AssetVersionView create(UUID parentFolderUuid, String displayName, FolderScope scope, RevisionContext ctx) {
        return create(parentFolderUuid, displayName, scope, null, ctx);
    }

    @Override
    @Transactional
    public AssetVersionView create(
            UUID parentFolderUuid, String displayName, FolderScope scope, AssetType templateKind, RevisionContext ctx) {
        if (parentFolderUuid == null && scope == FolderScope.TEMPLATES) {
            throw new SfException(ProblemFactory.unprocessableEntity(
                    "The top level of the template store is fixed to \"Page Templates\", \"Section Templates\" and \"Datasets\" — "
                            + "new top-level folders cannot be created there."));
        }

        String parentPath = PathService.ROOT_PATH;
        FolderScope effectiveScope = scope;
        AssetType effectiveTemplateKind = templateKind;
        if (parentFolderUuid != null) {
            Asset parentAsset = requireFolderParent(parentFolderUuid, ctx.projectId());
            AssetVersion parentVersion = requireOpen(parentAsset.getId());
            parentPath = parentVersion.getFolderPath();
            FolderScope parentScope = FolderScope.fromPayload(parentVersion.getPayload());
            if (parentScope != null) {
                if (scope != null && scope != parentScope) {
                    throw new SfException(ProblemFactory.unprocessableEntity("A subfolder's store must match its parent folder's."));
                }
                effectiveScope = parentScope;
            }
            AssetType parentTemplateKind = FolderScope.templateKindFromPayload(parentVersion.getPayload());
            if (parentTemplateKind != null) {
                if (templateKind != null && templateKind != parentTemplateKind) {
                    throw new SfException(ProblemFactory.unprocessableEntity(
                            "A subfolder's template kind must match its parent folder's."));
                }
                effectiveTemplateKind = parentTemplateKind;
            } else if (parentScope == FolderScope.TEMPLATES) {
                // The parent is TEMPLATES-scoped but carries no determined kind — the only such
                // folder is the fixed "All Templates" wrapper root itself (real content only ever
                // lives under its two kind-determined children). A new folder created directly
                // under it would be permanently kind-less/orphaned, so reject the same way a
                // top-level TEMPLATES folder already is above.
                throw new SfException(ProblemFactory.unprocessableEntity(
                        "New folders can't be created directly under the templates root — "
                                + "pick Page Templates, Section Templates or Datasets first."));
            }
        }
        if (effectiveScope == null) {
            throw new SfException(ProblemFactory.unprocessableEntity("Folder scope is required."));
        }
        if (pathService.depth(parentPath) + 1 > PathService.MAX_DEPTH) {
            throw new SfException(ProblemFactory.other(
                    422, "SF-DOM-0103", "Validation Failed", "Folder depth limit of " + PathService.MAX_DEPTH + " exceeded."));
        }
        ObjectNode payload = (ObjectNode) JsonUtil.parse("{}");
        payload.put("scope", effectiveScope.name());
        if (effectiveScope == FolderScope.TEMPLATES && effectiveTemplateKind != null) {
            payload.put("templateKind", effectiveTemplateKind.name());
        }
        return assetService.create(
                new CreateAssetCommand(ctx.projectId(), AssetType.FOLDER, displayName, parentFolderUuid, payload, null),
                ctx);
    }

    @Override
    @Transactional
    public AssetVersionView update(UUID uuid, String displayName, long expectedRevision, RevisionContext ctx) {
        Asset folder = requireFolder(uuid, ctx.projectId());
        AssetVersion current = requireOpen(folder.getId());
        requireNotProtected(current, "renamed");
        return assetService.update(uuid, new UpdateAssetCommand(displayName, current.getPayload()), expectedRevision, ctx);
    }

    @Override
    @Transactional
    public AssetVersionView updateStartNode(UUID uuid, StartNode startNode, long expectedRevision, RevisionContext ctx) {
        Asset folder = requireFolder(uuid, ctx.projectId());
        AssetVersion current = requireOpen(folder.getId());
        FolderScope scope = FolderScope.fromPayload(current.getPayload());
        if (scope != FolderScope.NAVIGATION) {
            throw new SfException(ProblemFactory.unprocessableEntity("startNode only applies to navigation folders."));
        }

        if (startNode != null) {
            Asset targetAsset = assetRepository.findByProjectIdAndUuid(ctx.projectId(), startNode.assetUuid())
                    .orElseThrow(() -> new SfException(ProblemFactory.unprocessableEntity("startNode target not found.")));
            AssetVersion targetVersion = requireOpen(targetAsset.getId());
            if (targetVersion.getFolderId() == null || !targetVersion.getFolderId().equals(folder.getId())) {
                throw new SfException(ProblemFactory.unprocessableEntity(
                        "startNode must reference a direct child of this folder."));
            }
            AssetType expectedType = startNode.kind() == StartNodeKind.FOLDER ? AssetType.FOLDER : AssetType.PAGE_REFERENCE;
            if (targetAsset.getAssetType() != expectedType) {
                throw new SfException(ProblemFactory.unprocessableEntity(
                        "startNode kind does not match the target asset's type."));
            }
        }

        ObjectNode payload = current.getPayload().deepCopy();
        if (startNode == null) {
            payload.putNull("startNode");
        } else {
            ObjectNode startNodeNode = payload.putObject("startNode");
            startNodeNode.put("kind", startNode.kind().name());
            startNodeNode.put("assetUuid", startNode.assetUuid().toString());
        }
        return assetService.update(uuid, new UpdateAssetCommand(current.getDisplayName(), payload), expectedRevision, ctx);
    }

    @Override
    @Transactional
    public MoveResult move(UUID folderUuid, UUID targetParentFolderUuid, RevisionContext ctx) {
        Asset folder = requireFolder(folderUuid, ctx.projectId());
        AssetVersion current = requireOpen(folder.getId());
        requireNotProtected(current, "moved");
        String oldPath = current.getFolderPath();

        if (targetParentFolderUuid != null && targetParentFolderUuid.equals(folderUuid)) {
            throw new SfException(ProblemFactory.unprocessableEntity("A folder cannot be moved into itself."));
        }

        if (targetParentFolderUuid != null) {
            Asset targetAsset = requireFolderParent(targetParentFolderUuid, ctx.projectId());
            AssetVersion targetVersion = requireOpen(targetAsset.getId());
            FolderScope targetScope = FolderScope.fromPayload(targetVersion.getPayload());
            FolderScope ownScope = FolderScope.fromPayload(current.getPayload());
            if (targetScope != null && ownScope != null && targetScope != ownScope) {
                throw new SfException(ProblemFactory.unprocessableEntity("Cannot move a folder into a different store's folder tree."));
            }

            // TEMPLATES-scope folders additionally carry a templateKind (M13.1.2) that FolderScope
            // alone doesn't capture — "Page Templates" and "Section Templates" share one scope but
            // must stay separate subtrees, mirroring the template-kind guard in `create` above.
            AssetType targetTemplateKind = FolderScope.templateKindFromPayload(targetVersion.getPayload());
            AssetType ownTemplateKind = FolderScope.templateKindFromPayload(current.getPayload());
            if (targetTemplateKind != null && ownTemplateKind != null && targetTemplateKind != ownTemplateKind) {
                throw new SfException(ProblemFactory.unprocessableEntity(
                        "A folder's template kind must match its new parent folder's."));
            }
        }

        FolderRef target = resolveTarget(targetParentFolderUuid, ctx.projectId(), ctx);
        if (pathService.isUnder(target.path(), oldPath)) {
            throw new SfException(ProblemFactory.unprocessableEntity("A folder cannot be moved into its own descendant."));
        }

        String newPath = pathService.childPath(target.path(), folder.getUid());
        if (newPath.equals(oldPath)) {
            return new MoveResult(0, current.getValidFromRevision());
        }

        List<AssetVersion> subtree = assetVersionRepository.findCurrentByProject(ctx.projectId()).stream()
                .filter(v -> pathService.isUnder(v.getFolderPath(), oldPath))
                .toList();

        // Joins an open batch: a discard (M27.1.2) moves folders back in the discard revision.
        Revision revision = revisionService.allocateOrJoin(ctx, ChangeType.MOVE);
        for (AssetVersion version : subtree) {
            Long newFolderId = version.getAssetId().equals(folder.getId()) ? target.id() : version.getFolderId();
            String rebased = pathService.rebase(version.getFolderPath(), oldPath, newPath);
            close(version.getAssetId(), revision.getRevisionId());
            insertVersion(
                    version.getAsset(),
                    revision.getRevisionId(),
                    version.getDisplayName(),
                    version.getPayload(),
                    ctx.userId(),
                    Instant.now(),
                    newFolderId,
                    rebased,
                    version.getTemplateAssetId(),
                    version.isDeleted());
        }
        appendSummary(folder, revision, "MOVE", List.of("folder"));
        return new MoveResult(subtree.size(), revision.getRevisionId());
    }

    @Override
    @Transactional
    public void delete(UUID uuid, boolean cascade, RevisionContext ctx) {
        Asset folder = assetRepository.findByProjectIdAndUuid(ctx.projectId(), uuid)
                .filter(asset -> asset.getAssetType() == AssetType.RECORD_SET)
                .orElseGet(() -> requireFolder(uuid, ctx.projectId()));
        AssetVersion current = requireOpen(folder.getId());
        requireNotProtected(current, "deleted");

        List<AssetVersion> subtree;
        if (folder.getAssetType() == AssetType.RECORD_SET) {
            // A record set follows folder delete semantics (M25): its subtree is itself and its live records.
            // (Its records share its folder path, so the path prefix can't tell them from its siblings.)
            List<AssetVersion> records = assetVersionRepository.findByFolderIdAndValidToRevisionIsNullAndDeletedFalse(folder.getId());
            if (!cascade && !records.isEmpty()) {
                throw RecordSetContainment.notEmpty(records.size());
            }
            subtree = new java.util.ArrayList<>(records);
            if (!current.isDeleted()) {
                subtree.add(current);
            }
        } else {
            subtree = assetVersionRepository.findCurrentByProject(ctx.projectId()).stream()
                    .filter(v -> pathService.isUnder(v.getFolderPath(), current.getFolderPath()))
                    .toList();
            if (!cascade && subtree.size() > 1) {
                throw new SfException(ProblemFactory.other(409, "SF-DOM-0110", "Conflict", "Folder is not empty."));
            }
        }

        Revision revision = revisionService.allocate(ctx.projectId(), ChangeType.DELETE, ctx.comment(), ctx.userId());
        for (AssetVersion version : subtree) {
            close(version.getAssetId(), revision.getRevisionId());
            insertVersion(
                    version.getAsset(),
                    revision.getRevisionId(),
                    version.getDisplayName(),
                    version.getPayload(),
                    ctx.userId(),
                    Instant.now(),
                    version.getFolderId(),
                    version.getFolderPath(),
                    version.getTemplateAssetId(),
                    true);
        }
        appendSummary(folder, revision, "DELETE", List.of());
    }

    @Override
    @Transactional
    public AssetVersionView restore(UUID uuid, RevisionContext ctx) {
        Asset folder = requireFolder(uuid, ctx.projectId());
        if (!requireOpen(folder.getId()).isDeleted()) {
            throw new SfException(ProblemFactory.other(409, "SF-DOM-0111", "Conflict", "Folder is not deleted."));
        }
        AssetVersion lastLive = assetVersionRepository.findByAssetIdOrderByValidFromRevisionDesc(folder.getId()).stream()
                .filter(version -> !version.isDeleted())
                .findFirst()
                .filter(version -> version.getValidToRevision() != null)
                .orElseThrow(() -> new SfException(ProblemFactory.other(
                        409, "SF-DOM-0111", "Conflict", "Folder was never live, so there is nothing to restore.")));
        long deletedAt = lastLive.getValidToRevision();

        // The delete allocated its own revision, so what it tombstoned and is still deleted is its subtree.
        Map<Long, AssetVersion> liveBefore = new java.util.HashMap<>();
        for (AssetVersion version : assetVersionRepository.findLiveVersionsClosedAt(ctx.projectId(), deletedAt)) {
            liveBefore.put(version.getAssetId(), version);
        }
        liveBefore.put(folder.getId(), lastLive);
        List<AssetVersion> toRestore = new java.util.ArrayList<>();
        for (AssetVersion tombstone : assetVersionRepository.findCurrentTombstonesWrittenAt(ctx.projectId(), deletedAt)) {
            if (liveBefore.containsKey(tombstone.getAssetId()) && !tombstone.getAssetId().equals(folder.getId())) {
                toRestore.add(liveBefore.get(tombstone.getAssetId()));
            }
        }
        toRestore.add(lastLive);

        Long parentId = lastLive.getFolderId();
        String parentPath = PathService.ROOT_PATH;
        if (parentId != null) {
            AssetVersion parent = assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(parentId)
                    .filter(version -> !version.isDeleted())
                    .orElseThrow(() -> new SfException(ProblemFactory.other(
                            409, "SF-DOM-0112", "Conflict",
                            "The parent folder has been deleted — restore it first.")));
            parentPath = parent.getFolderPath();
        }
        String oldPath = lastLive.getFolderPath();
        String newPath = pathService.childPath(parentPath, folder.getUid());
        boolean taken = assetVersionRepository.findCurrentByProjectAndType(ctx.projectId(), AssetType.FOLDER).stream()
                .anyMatch(version -> !Objects.equals(version.getAssetId(), folder.getId())
                        && pathService.ensureTrailingSlash(version.getFolderPath()).equals(newPath));
        if (taken) {
            throw new SfException(ProblemFactory.other(
                    409, "SF-DOM-0113", "Conflict",
                    "A folder with the same path exists now — rename or delete it before restoring this one."));
        }

        // Parents before children: shallower paths first, folders and record sets ahead of their contents.
        toRestore.sort(java.util.Comparator
                .comparingInt((AssetVersion version) -> pathService.depth(version.getFolderPath()))
                .thenComparingInt(version -> switch (version.getAsset().getAssetType()) {
                    case FOLDER -> 0;
                    case RECORD_SET -> 1;
                    default -> 2;
                }));

        Revision revision = revisionService.allocateOrJoin(ctx, ChangeType.RESTORE);
        for (AssetVersion source : toRestore) {
            close(source.getAssetId(), revision.getRevisionId());
            insertVersion(
                    source.getAsset(),
                    revision.getRevisionId(),
                    source.getDisplayName(),
                    source.getPayload() == null ? null : source.getPayload().deepCopy(),
                    ctx.userId(),
                    Instant.now(),
                    source.getFolderId(),
                    pathService.rebase(source.getFolderPath(), oldPath, newPath),
                    source.getTemplateAssetId(),
                    false);
            appendSummary(source.getAsset(), revision, "RESTORE", List.of());
        }
        return assetService.requireCurrent(ctx.projectId(), folder.getUuid());
    }

    /**
     * Rejects mutating the TARGET folder itself (rename/move/delete) when its own payload
     * carries {@code protected: true} (M13.1.1). This never blocks creating a child under a
     * protected folder, nor moving another folder INTO one — only mutating/moving/deleting the
     * protected folder itself.
     */
    private void requireNotProtected(AssetVersion version, String action) {
        if (FolderScope.isProtected(version.getPayload())) {
            throw new SfException(ProblemFactory.unprocessableEntity("This folder is protected and cannot be " + action + "."));
        }
    }

    /**
     * The folder a new or moved folder goes into. A record set is not one: the containment rules
     * (M25, {@link RecordSetContainment}) reject it with their own error.
     */
    private Asset requireFolderParent(UUID uuid, long projectId) {
        assetRepository.findByProjectIdAndUuid(projectId, uuid)
                .filter(asset -> asset.getAssetType() == AssetType.RECORD_SET)
                .ifPresent(set -> RecordSetContainment.require(AssetType.FOLDER, null, AssetType.RECORD_SET, null, false));
        return requireFolder(uuid, projectId);
    }

    private Asset requireFolder(UUID uuid, long projectId) {
        Asset asset = assetRepository.findByProjectIdAndUuid(projectId, uuid)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Folder not found.")));
        if (asset.getAssetType() != AssetType.FOLDER) {
            throw new SfException(ProblemFactory.unprocessableEntity("Asset is not a folder."));
        }
        return asset;
    }

    private FolderRef resolveTarget(UUID targetUuid, long projectId, RevisionContext ctx) {
        if (targetUuid == null) {
            AssetVersionView root = assetService.ensureRootFolder(projectId, ctx);
            Asset rootAsset = assetRepository.findByProjectIdAndUuid(projectId, root.uuid()).orElseThrow();
            return new FolderRef(rootAsset.getId(), PathService.ROOT_PATH);
        }
        Asset target = requireFolder(targetUuid, projectId);
        AssetVersion version = requireOpen(target.getId());
        return new FolderRef(target.getId(), version.getFolderPath());
    }

    private AssetVersion requireOpen(Long assetId) {
        return assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(assetId)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Folder has no current version.")));
    }

    private void close(Long assetId, long revisionId) {
        assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(assetId).ifPresent(v -> {
            v.setValidToRevision(revisionId);
            assetVersionRepository.save(v);
        });
    }

    /** Inserts the new version and, in the same revision, syncs its outgoing reference rows (§5.4). */
    private void insertVersion(
            Asset asset, long revisionId, String displayName, JsonNode payload, Long changedBy, Instant changedAt,
            Long folderId, String folderPath, Long templateAssetId, boolean deleted) {
        AssetVersion version = new AssetVersion(asset.getId(), revisionId, displayName, payload, changedBy, changedAt);
        version.setFolderId(folderId);
        version.setFolderPath(folderPath);
        version.setTemplateAssetId(templateAssetId);
        version.setDeleted(deleted);
        version.projectMediaColumns(asset.getAssetType());
        referenceMaterializer.materialize(asset, assetVersionRepository.save(version));
    }

    private void appendSummary(Asset asset, Revision revision, String action, List<String> fields) {
        revisionService.appendSummary(
                asset.getProjectId(),
                revision.getRevisionId(),
                AssetChange.create(asset.getUuid().toString(), asset.getAssetType().name(), action, fields));
    }

    private record FolderRef(Long id, String path) {}
}
