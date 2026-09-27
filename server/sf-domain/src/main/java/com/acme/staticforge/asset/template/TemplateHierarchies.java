package com.acme.staticforge.asset.template;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * Builds {@link TemplateHierarchy} views over the database (M20): the current page templates, or those valid at a
 * revision for time travel. Definitions compile through {@link CompiledTemplateCache}, keyed by version, so walking a
 * chain on every request costs lookups, not CDL compiles. Generation builds its own hierarchy over its snapshot.
 */
@Component
public class TemplateHierarchies {

    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final CompiledTemplateCache compiledTemplates;

    public TemplateHierarchies(
            AssetRepository assetRepository, AssetVersionRepository assetVersionRepository, CompiledTemplateCache compiledTemplates) {
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.compiledTemplates = compiledTemplates;
    }

    /** The project's current page templates. */
    public TemplateHierarchy live(long projectId) {
        return at(projectId, null);
    }

    /** The project's page templates valid at {@code revision}; the current ones when {@code null}. */
    public TemplateHierarchy at(long projectId, Long revision) {
        return new TemplateHierarchy(uuid -> assetRepository.findByProjectIdAndUuid(projectId, uuid)
                .filter(asset -> asset.getAssetType() == AssetType.PAGE_TEMPLATE)
                .flatMap(asset -> version(asset, revision).filter(version -> !version.isDeleted())
                        .map(version -> toVersion(projectId, asset, version))));
    }

    private Optional<AssetVersion> version(Asset asset, Long revision) {
        return revision == null
                ? assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(asset.getId())
                : assetVersionRepository.findValidAtRevision(asset.getId(), revision);
    }

    private TemplateHierarchy.TemplateVersion toVersion(long projectId, Asset asset, AssetVersion version) {
        String cdl = version.getPayload().path("contentDefinition").asText("");
        return new TemplateHierarchy.TemplateVersion(
                asset.getUuid(),
                asset.getUid(),
                version.getPayload(),
                compiledTemplates.definition(projectId, asset.getUuid(), version.getOwnRevision(), cdl),
                // The version's own revision, not validFromRevision: compaction may move that onto a removed version's.
                version.getOwnRevision());
    }
}
