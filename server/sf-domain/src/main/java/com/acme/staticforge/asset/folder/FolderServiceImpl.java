package com.acme.staticforge.asset.folder;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.UpdateAssetCommand;
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

    public FolderServiceImpl(
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            AssetService assetService,
            PathService pathService,
            RevisionService revisionService) {
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.assetService = assetService;
        this.pathService = pathService;
        this.revisionService = revisionService;
    }

    @Override
    @Transactional(readOnly = true)
    public List<FolderNode> tree(long projectId, FolderScope scope, int depth, RevisionContext ctx) {
        List<AssetVersion> folders = assetVersionRepository.findCurrentByProjectAndType(projectId, AssetType.FOLDER);

        java.util.Map<Long, FolderInfo> info = new java.util.LinkedHashMap<>();
        java.util.Map<Long, List<Long>> children = new java.util.LinkedHashMap<>();
        Long hiddenRootId = null;
        for (AssetVersion version : folders) {
            Asset asset = assetRepository.findById(version.getAssetId()).orElse(null);
            if (asset == null) {
                continue;
            }
            if (PathService.ROOT_UID.equals(asset.getUid())) {
                hiddenRootId = asset.getId();
            }
            info.put(asset.getId(), new FolderInfo(
                    asset.getUuid(), asset.getUid(), version.getDisplayName(), version.getFolderPath(),
                    FolderScope.fromPayload(version.getPayload())));
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
                .map(id -> toNode(id, info, children, depth))
                .filter(node -> node.scope() == scope)
                .toList();
    }

    private static FolderNode toNode(Long id, java.util.Map<Long, FolderInfo> info,
            java.util.Map<Long, List<Long>> children, int depth) {
        FolderInfo f = info.get(id);
        List<FolderNode> childNodes = (depth == 0)
                ? List.of()
                : children.get(id).stream().map(cid -> toNode(cid, info, children, depth - 1)).toList();
        return new FolderNode(f.uuid(), f.uid(), f.displayName(), f.path(), f.scope(), childNodes);
    }

    private record FolderInfo(UUID uuid, String uid, String displayName, String path, FolderScope scope) {}

    @Override
    @Transactional
    public AssetVersionView create(UUID parentFolderUuid, String displayName, FolderScope scope, RevisionContext ctx) {
        String parentPath = PathService.ROOT_PATH;
        FolderScope effectiveScope = scope;
        if (parentFolderUuid != null) {
            Asset parentAsset = requireFolder(parentFolderUuid, ctx.projectId());
            AssetVersion parentVersion = requireOpen(parentAsset.getId());
            parentPath = parentVersion.getFolderPath();
            FolderScope parentScope = FolderScope.fromPayload(parentVersion.getPayload());
            if (parentScope != null) {
                if (scope != null && scope != parentScope) {
                    throw new SfException(ProblemFactory.unprocessableEntity("A subfolder's store must match its parent folder's."));
                }
                effectiveScope = parentScope;
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
        return assetService.create(
                new CreateAssetCommand(ctx.projectId(), AssetType.FOLDER, displayName, parentFolderUuid, payload, null),
                ctx);
    }

    @Override
    @Transactional
    public AssetVersionView update(UUID uuid, String displayName, long expectedRevision, RevisionContext ctx) {
        Asset folder = requireFolder(uuid, ctx.projectId());
        AssetVersion current = requireOpen(folder.getId());
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
            Asset targetAsset = assetRepository.findByUuid(startNode.assetUuid())
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
        String oldPath = current.getFolderPath();

        if (targetParentFolderUuid != null && targetParentFolderUuid.equals(folderUuid)) {
            throw new SfException(ProblemFactory.unprocessableEntity("A folder cannot be moved into itself."));
        }

        if (targetParentFolderUuid != null) {
            Asset targetAsset = requireFolder(targetParentFolderUuid, ctx.projectId());
            AssetVersion targetVersion = requireOpen(targetAsset.getId());
            FolderScope targetScope = FolderScope.fromPayload(targetVersion.getPayload());
            FolderScope ownScope = FolderScope.fromPayload(current.getPayload());
            if (targetScope != null && ownScope != null && targetScope != ownScope) {
                throw new SfException(ProblemFactory.unprocessableEntity("Cannot move a folder into a different store's folder tree."));
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

        Revision revision = revisionService.allocate(ctx.projectId(), ChangeType.MOVE, ctx.comment(), ctx.userId());
        for (AssetVersion version : subtree) {
            Long newFolderId = version.getAssetId().equals(folder.getId()) ? target.id() : version.getFolderId();
            String rebased = pathService.rebase(version.getFolderPath(), oldPath, newPath);
            close(version.getAssetId(), revision.getRevisionId());
            insertVersion(
                    version.getAssetId(),
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
        Asset folder = requireFolder(uuid, ctx.projectId());
        AssetVersion current = requireOpen(folder.getId());

        List<AssetVersion> subtree = assetVersionRepository.findCurrentByProject(ctx.projectId()).stream()
                .filter(v -> pathService.isUnder(v.getFolderPath(), current.getFolderPath()))
                .toList();

        if (!cascade && subtree.size() > 1) {
            throw new SfException(ProblemFactory.other(409, "SF-DOM-0110", "Conflict", "Folder is not empty."));
        }

        Revision revision = revisionService.allocate(ctx.projectId(), ChangeType.DELETE, ctx.comment(), ctx.userId());
        for (AssetVersion version : subtree) {
            close(version.getAssetId(), revision.getRevisionId());
            insertVersion(
                    version.getAssetId(),
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

    private Asset requireFolder(UUID uuid, long projectId) {
        Asset asset = assetRepository.findByUuid(uuid)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Folder not found.")));
        if (asset.getAssetType() != AssetType.FOLDER) {
            throw new SfException(ProblemFactory.unprocessableEntity("Asset is not a folder."));
        }
        return asset;
    }

    private FolderRef resolveTarget(UUID targetUuid, long projectId, RevisionContext ctx) {
        if (targetUuid == null) {
            AssetVersionView root = assetService.ensureRootFolder(projectId, ctx);
            Asset rootAsset = assetRepository.findByUuid(root.uuid()).orElseThrow();
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

    private void insertVersion(
            Long assetId, long revisionId, String displayName, JsonNode payload, Long changedBy, Instant changedAt,
            Long folderId, String folderPath, Long templateAssetId, boolean deleted) {
        AssetVersion version = new AssetVersion(assetId, revisionId, displayName, payload, changedBy, changedAt);
        version.setFolderId(folderId);
        version.setFolderPath(folderPath);
        version.setTemplateAssetId(templateAssetId);
        version.setDeleted(deleted);
        assetVersionRepository.save(version);
    }

    private void appendSummary(Asset asset, Revision revision, String action, List<String> fields) {
        revisionService.appendSummary(
                asset.getProjectId(),
                revision.getRevisionId(),
                AssetChange.create(asset.getUuid().toString(), asset.getAssetType().name(), action, fields));
    }

    private record FolderRef(Long id, String path) {}
}
