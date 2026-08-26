package com.acme.staticforge.asset.navigation;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.common.JsonUtil;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionContext;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link PageReferenceService} implementation. Structural validation resolves {@code target}
 * to a live {@code Page} or a live {@code FolderScope.PAGES} folder — there is no CDL here,
 * so this is the entirety of the validation a {@code PAGE_REFERENCE} payload needs (spec §17,
 * `M8.1.2`).
 */
@Service
@RevisionAware
public class PageReferenceServiceImpl implements PageReferenceService {

    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final AssetService assetService;

    public PageReferenceServiceImpl(
            AssetRepository assetRepository, AssetVersionRepository assetVersionRepository, AssetService assetService) {
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.assetService = assetService;
    }

    @Override
    @Transactional
    public AssetVersionView create(CreatePageReferenceCommand cmd, RevisionContext ctx) {
        requireValidTarget(cmd.targetKind(), cmd.targetAssetUuid());

        ObjectNode payload = JsonUtil.object(null);
        writeTarget(payload, cmd.targetKind(), cmd.targetAssetUuid());
        writeLabel(payload, cmd.label());

        return assetService.create(
                new CreateAssetCommand(
                        ctx.projectId(), AssetType.PAGE_REFERENCE, cmd.displayName(), cmd.folderUuid(), payload, null),
                ctx);
    }

    @Override
    @Transactional
    public AssetVersionView update(
            UUID uuid,
            PageReferenceTargetKind targetKind,
            UUID targetAssetUuid,
            String label,
            long expectedRevision,
            RevisionContext ctx) {
        requireValidTarget(targetKind, targetAssetUuid);

        Asset pageReference = requirePageReference(uuid);
        AssetVersion current = requireOpen(pageReference.getId());

        ObjectNode payload = current.getPayload().deepCopy();
        writeTarget(payload, targetKind, targetAssetUuid);
        writeLabel(payload, label);

        return assetService.update(
                uuid, new UpdateAssetCommand(current.getDisplayName(), payload), expectedRevision, ctx);
    }

    @Override
    @Transactional(readOnly = true)
    public AssetVersionView find(UUID uuid) {
        requirePageReference(uuid);
        return assetService.requireCurrent(uuid);
    }

    /**
     * Rejects a {@code target} whose {@code assetUuid} does not resolve to a live asset of the
     * declared {@code kind}: a {@code PAGE} target must be a live {@code PAGE}; a {@code FOLDER}
     * target must be a live {@code Folder} whose payload scope is {@code FolderScope.PAGES} (not
     * a navigation folder).
     */
    private void requireValidTarget(PageReferenceTargetKind kind, UUID targetAssetUuid) {
        if (kind == null || targetAssetUuid == null) {
            throw new SfException(ProblemFactory.unprocessableEntity("PageReference target requires a kind and assetUuid."));
        }
        Asset target = assetRepository.findByUuid(targetAssetUuid)
                .orElseThrow(() -> new SfException(ProblemFactory.unprocessableEntity(
                        "PageReference target " + targetAssetUuid + " does not exist.")));
        AssetVersion version = assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(target.getId())
                .orElseThrow(() -> new SfException(ProblemFactory.unprocessableEntity(
                        "PageReference target " + targetAssetUuid + " does not exist.")));
        if (version.isDeleted()) {
            throw new SfException(ProblemFactory.unprocessableEntity(
                    "PageReference target " + targetAssetUuid + " has been deleted."));
        }

        if (kind == PageReferenceTargetKind.PAGE) {
            if (target.getAssetType() != AssetType.PAGE) {
                throw new SfException(ProblemFactory.unprocessableEntity(
                        "PageReference target is declared as PAGE but the asset is a " + target.getAssetType() + "."));
            }
            return;
        }

        if (target.getAssetType() != AssetType.FOLDER) {
            throw new SfException(ProblemFactory.unprocessableEntity(
                    "PageReference target is declared as FOLDER but the asset is a " + target.getAssetType() + "."));
        }
        FolderScope scope = FolderScope.fromPayload(version.getPayload());
        if (scope != FolderScope.PAGES) {
            throw new SfException(ProblemFactory.unprocessableEntity(
                    "PageReference FOLDER target must be a page-store folder (FolderScope.PAGES)."));
        }
    }

    private static void writeTarget(ObjectNode payload, PageReferenceTargetKind kind, UUID targetAssetUuid) {
        ObjectNode target = payload.putObject("target");
        target.put("kind", kind.name());
        target.put("assetUuid", targetAssetUuid.toString());
    }

    private static void writeLabel(ObjectNode payload, String label) {
        if (label == null || label.isBlank()) {
            payload.putNull("label");
        } else {
            payload.put("label", label);
        }
    }

    private Asset requirePageReference(UUID uuid) {
        Asset asset = assetRepository.findByUuid(uuid)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("PageReference not found.")));
        if (asset.getAssetType() != AssetType.PAGE_REFERENCE) {
            throw new SfException(ProblemFactory.unprocessableEntity("Asset is not a PageReference."));
        }
        return asset;
    }

    private AssetVersion requireOpen(Long assetId) {
        return assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(assetId)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("PageReference has no current version.")));
    }
}
