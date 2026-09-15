package com.acme.staticforge.generate.render;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.content.AssetValueProjection;
import com.acme.staticforge.asset.folder.AssetReferencePrefixes;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.template.render.AssetValueResolver;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.MissingNode;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Generation's {@link AssetValueResolver}: cross-asset values read from the revision-pinned
 * {@link Snapshot} (so every page of a build sees the same state), projected through {@link
 * AssetValueProjection} exactly like preview. The snapshot is per project, so lookups can never
 * reach another project's asset.
 *
 * <p>Shared by all render threads of one build; projections are memoized per UUID, which the
 * immutable snapshot makes safe.
 */
final class SnapshotAssetValueResolver implements AssetValueResolver {

    private final Snapshot snapshot;
    private final Map<UUID, JsonNode> projections = new ConcurrentHashMap<>();

    SnapshotAssetValueResolver(Snapshot snapshot) {
        this.snapshot = snapshot;
    }

    @Override
    public JsonNode valueOf(String assetType, UUID uuid) {
        return projections.computeIfAbsent(uuid, u -> project(assetType, u));
    }

    private JsonNode project(String assetType, UUID uuid) {
        SnapshotAsset asset = snapshot.assetByUuid(uuid);
        AssetType expected = AssetReferencePrefixes.assetTypeForRef(assetType);
        if (asset == null || asset.type() != expected) {
            return MissingNode.getInstance();
        }
        return AssetValueProjection.project(asset.type(), asset.uid(), asset.displayName(), asset.payload(), asset.deleted());
    }
}
