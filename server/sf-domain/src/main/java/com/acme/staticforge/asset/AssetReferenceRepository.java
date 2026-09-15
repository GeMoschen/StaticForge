package com.acme.staticforge.asset;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AssetReferenceRepository extends JpaRepository<AssetReference, Long> {

    List<AssetReference> findByToAssetId(Long toAssetId);

    List<AssetReference> findByFromAssetId(Long fromAssetId);

    /** The open (current) outgoing edge set of an asset. */
    List<AssetReference> findByFromAssetIdAndValidToRevisionIsNull(Long fromAssetId);

    /** Outgoing edges closed at exactly {@code validToRevision}. */
    List<AssetReference> findByFromAssetIdAndValidToRevision(Long fromAssetId, Long validToRevision);
}
