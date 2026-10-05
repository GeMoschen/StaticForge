package com.acme.staticforge.asset.transfer;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionContext;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** {@link AssetTransferService} implementation. */
@Service
@RevisionAware
public class AssetTransferServiceImpl implements AssetTransferService {

    private final AssetService assetService;
    private final FolderService folderService;
    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final Map<AssetType, AssetDuplicator> duplicators = new EnumMap<>(AssetType.class);

    public AssetTransferServiceImpl(
            AssetService assetService,
            FolderService folderService,
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            List<AssetDuplicator> duplicators) {
        this.assetService = assetService;
        this.folderService = folderService;
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        duplicators.forEach(duplicator -> this.duplicators.put(duplicator.type(), duplicator));
    }

    @Override
    @Transactional
    public AssetVersionView duplicate(UUID uuid, UUID targetFolderUuid, RevisionContext ctx) {
        AssetVersionView source = assetService.requireCurrent(ctx.projectId(), uuid);
        if (source.deleted()) {
            throw new SfException(ProblemFactory.notFound("Asset not found."));
        }
        if (source.type() == AssetType.FOLDER) {
            throw new SfException(ProblemFactory.unprocessableEntity("Folders cannot be duplicated."));
        }
        AssetDuplicator duplicator = duplicators.get(source.type());
        if (duplicator == null) {
            throw new SfException(ProblemFactory.unprocessableEntity(
                    "Assets of type " + source.type() + " cannot be duplicated."));
        }
        return duplicator.duplicate(source, target(ctx.projectId(), source, targetFolderUuid), ctx);
    }

    @Override
    @Transactional
    public MoveOutcome move(UUID uuid, UUID targetFolderUuid, RevisionContext ctx) {
        AssetVersionView current = assetService.requireCurrent(ctx.projectId(), uuid);
        if (current.type() == AssetType.FOLDER) {
            return new MoveOutcome(null, folderService.move(uuid, targetFolderUuid, ctx));
        }
        return new MoveOutcome(assetService.move(uuid, targetFolderUuid, ctx), null);
    }

    @Override
    @Transactional(readOnly = true)
    public UUID parentUuid(AssetVersionView asset) {
        return asset.folderId() == null
                ? null
                : assetRepository.findById(asset.folderId()).map(Asset::getUuid).orElse(null);
    }

    /** The explicit target, else the source's own parent; with the names its live children carry. */
    private DuplicateTarget target(long projectId, AssetVersionView source, UUID targetFolderUuid) {
        Asset parent = targetFolderUuid != null
                ? assetRepository.findByProjectIdAndUuid(projectId, targetFolderUuid)
                        .orElseThrow(() -> new SfException(ProblemFactory.notFound("Target folder not found.")))
                : source.folderId() == null ? null : assetRepository.findById(source.folderId()).orElse(null);
        if (parent == null) {
            return new DuplicateTarget(null, List.of());
        }
        List<String> names = assetVersionRepository
                .findByFolderIdAndValidToRevisionIsNullAndDeletedFalse(parent.getId())
                .stream()
                .map(AssetVersion::getDisplayName)
                .toList();
        return new DuplicateTarget(parent.getUuid(), names);
    }
}
