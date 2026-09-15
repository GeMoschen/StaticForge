package com.acme.staticforge.asset.reference;

import com.acme.staticforge.asset.AssetReference;
import com.acme.staticforge.asset.ReferenceKind;

/**
 * One resolved outgoing edge of an asset version, independent of its revision interval: the
 * identity {@link ReferenceMaterializer} compares a version's derived edge set against the open
 * {@link AssetReference} rows with.
 */
public record ReferenceEdge(long toAssetId, ReferenceKind kind, String sourcePath) {

    public ReferenceEdge {
        sourcePath = sourcePath == null ? "" : sourcePath;
    }

    public static ReferenceEdge of(AssetReference row) {
        return new ReferenceEdge(row.getToAssetId(), row.getKind(), row.getSourcePath());
    }
}
