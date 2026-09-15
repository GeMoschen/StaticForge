package com.acme.staticforge.asset.reference;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.folder.AssetReferencePrefixes;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.template.octl.ReferenceResolver;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * The project-scoped OCTL {@link ReferenceResolver} used on template save (spec §16.4): shared by
 * compile-on-save validation ({@code TemplateServiceImpl}) and template reference materialization
 * ({@link ReferenceMaterializer}), so a reference that saves cleanly is exactly the one persisted as
 * an edge.
 */
@Component
public class ProjectReferenceResolver {

    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;

    public ProjectReferenceResolver(AssetRepository assetRepository, AssetVersionRepository assetVersionRepository) {
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
    }

    public ReferenceResolver forProject(long projectId) {
        return (assetType, uid) -> {
            AssetType type = AssetReferencePrefixes.assetTypeForRef(assetType);
            if (type == null) {
                return Optional.empty();
            }
            if (!"nav".equals(assetType)) {
                return assetRepository.findByProjectIdAndAssetTypeAndUid(projectId, type, uid).map(Asset::getUuid);
            }
            // Same lookup and NAVIGATION-scope check as preview and generation, so a nav: reference
            // that saves cleanly also renders and generates.
            return assetRepository
                    .findByProjectIdAndAssetTypeAndUid(projectId, type, FolderScope.navigationReferenceUid(uid))
                    .filter(folder -> assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(folder.getId())
                            .map(version -> FolderScope.fromPayload(version.getPayload()) == FolderScope.NAVIGATION)
                            .orElse(false))
                    .map(Asset::getUuid);
        };
    }
}
