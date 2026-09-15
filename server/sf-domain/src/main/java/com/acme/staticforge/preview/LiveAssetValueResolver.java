package com.acme.staticforge.preview;

import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.content.AssetValueProjection;
import com.acme.staticforge.asset.folder.AssetReferencePrefixes;
import com.acme.staticforge.template.render.AssetValueResolver;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.MissingNode;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Preview's {@link AssetValueResolver}: cross-asset values from the version valid at the preview
 * revision — the current version for a live preview, the version at {@code revision} for time
 * travel — projected through {@link AssetValueProjection}, exactly like generation's snapshot
 * resolver. Lookups are scoped to one project (UUIDs are only unique per project).
 *
 * <p>One instance per page render (single thread): projections are memoized per UUID, so a value
 * read inside a loop hits the repository once.
 */
final class LiveAssetValueResolver implements AssetValueResolver {

    private final AssetService assetService;
    private final AssetRepository assetRepository;
    private final long projectId;
    private final Long revision;
    private final Map<UUID, JsonNode> projections = new HashMap<>();

    /** @param revision the time-travel revision, or {@code null} for the current state */
    LiveAssetValueResolver(AssetService assetService, AssetRepository assetRepository, long projectId, Long revision) {
        this.assetService = assetService;
        this.assetRepository = assetRepository;
        this.projectId = projectId;
        this.revision = revision;
    }

    @Override
    public JsonNode valueOf(String assetType, UUID uuid) {
        return projections.computeIfAbsent(uuid, u -> project(assetType, u));
    }

    private JsonNode project(String assetType, UUID uuid) {
        AssetType expected = AssetReferencePrefixes.assetTypeForRef(assetType);
        if (expected == null || assetRepository.findByProjectIdAndUuid(projectId, uuid).isEmpty()) {
            return MissingNode.getInstance();
        }
        Optional<AssetVersionView> version = revision == null
                ? Optional.of(assetService.requireCurrent(projectId, uuid))
                : assetService.findAt(projectId, uuid, revision);
        return version
                .filter(v -> v.type() == expected)
                .map(v -> AssetValueProjection.project(v.type(), v.uid(), v.displayName(), v.payload(), v.deleted()))
                .orElse(MissingNode.getInstance());
    }
}
