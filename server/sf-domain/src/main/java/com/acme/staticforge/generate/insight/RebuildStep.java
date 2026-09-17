package com.acme.staticforge.generate.insight;

import java.util.UUID;

/**
 * One asset on a rebuild chain and the edge by which it depends on the next asset towards the root (M22.1.1).
 *
 * @param assetType the {@code AssetType} name (a string, so a plan stays readable after a type is renamed)
 * @param referenceKind the {@code ReferenceKind} name for a {@link RebuildEdgeKind#REFERENCE} edge; otherwise {@code null}
 * @param sourcePath where the dependency is spelled: the reference row's source path ({@code bodies.main[2].templateRef},
 *     {@code channelTemplates.html}), or the uid of the dataset/folder a dataset or pagination edge goes through
 */
public record RebuildStep(
        UUID assetUuid, String assetType, String uid, RebuildEdgeKind edge, String referenceKind, String sourcePath) {}
